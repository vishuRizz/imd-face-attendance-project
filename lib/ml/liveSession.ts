/**
 * Attendance session engine — one source of truth for a scan, fed by live
 * camera frames and/or group photos, plus the teacher's manual marks.
 *
 * Decision rules (precision first — a wrong "present" is worse than a review):
 *   LIVE   • PRESENT after ≥ 2 confident frames, or 1 frame that is very strong
 *            (score ≥ STRONG_SCORE, lead ≥ STRONG_MARGIN) on a good-quality face.
 *          • REVIEW when only ever matched in the uncertain band.
 *   PHOTO  • PRESENT on a confident match of a good-quality face (high-res,
 *            flip-fused embedding, one-to-one assignment across the photo).
 *          • REVIEW for uncertain or low-quality confident matches.
 *          • Unrecognised faces are kept (deduplicated across photos) so the
 *            teacher can assign them in review.
 *
 * Quality = AdaFace feature norm relative to the class's enrollment median.
 * Faces already resolved are tracked by box overlap and skipped natively, so
 * the recognizer only spends time on faces that still need an answer.
 */
import type { AnalyzeResult } from '../../modules/face-ml/index';
import { cosineSimilarity, matchGroupFaces, type MatchResult } from './matcher';
import type { Gallery } from './FaceMLClient';

// Calibrated on LFW: ~97% of genuine single frames clear this; no impostor exceeded 0.28.
const STRONG_SCORE = 0.55;
const STRONG_MARGIN = 0.15;
const CONFIRM_HITS = 2;
const FULL_PASS_EVERY = 4;
/** Below this fraction of the enrollment quality a face can't be trusted on its own. */
const LOW_QUALITY = 0.5;
/** Unknown faces below this relative quality are almost always false detections. */
const JUNK_QUALITY = 0.28;
const UNKNOWN_DEDUPE = 0.4;

export type NormBox = { x: number; y: number; w: number; h: number };
export type MarkerKind = 'present' | 'matching' | 'unknown' | 'far' | 'blurry' | 'turned';

export interface FaceMarker {
  id: string;
  box: NormBox;
  kind: MarkerKind;
  label?: string;
}

export interface StudentEvidence {
  studentId: number;
  confidentHits: number;
  uncertainHits: number;
  bestScore: number;
  bestRank: number;
  bestThumbUri?: string;
  bestBox?: NormBox;
  bestEmbedding?: number[];
  bestQuality?: number;
  status: 'present' | 'review' | 'pending';
  manual?: boolean;
  markedAt?: number;
}

export interface UnknownFace {
  id: string;
  embedding: number[];
  quality: number;
  thumbUri?: string;
  box: NormBox;
}

export interface FrameOutcome {
  newlyPresent: number[];
  markers: FaceMarker[];
  faceCount: number;
  unknownCount: number;
}

export interface PhotoOutcome {
  newlyPresent: number[];
  newlyReview: number[];
  unknownAdded: number;
  faceCount: number;
}

interface Track { box: NormBox; studentId: number }

const iou = (a: NormBox, b: NormBox) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter);
};

export class LiveAttendanceEngine {
  readonly evidence = new Map<number, StudentEvidence>();
  readonly unknowns: UnknownFace[] = [];
  private tracks: Track[] = [];
  private frame = 0;
  private photos = 0;

  constructor(private readonly gallery: Gallery, private readonly names: Map<number, string>) {}

  get presentIds(): number[] {
    return [...this.evidence.values()]
      .filter(e => e.status === 'present')
      .sort((a, b) => (b.markedAt ?? 0) - (a.markedAt ?? 0))
      .map(e => e.studentId);
  }

  get reviewIds(): number[] {
    return [...this.evidence.values()].filter(e => e.status === 'review').map(e => e.studentId);
  }

  isPresent(id: number) {
    return this.evidence.get(id)?.status === 'present';
  }

  /** Relative quality (1 = typical enrollment capture). Unknown → 1. */
  relQuality(q?: number) {
    if (!q || q <= 0 || this.gallery.qualityRef <= 0) return 1;
    return q / this.gallery.qualityRef;
  }

  nextSkipBoxes(): number[][] {
    if (this.frame % FULL_PASS_EVERY === FULL_PASS_EVERY - 1) return [];
    return this.tracks
      .filter(t => this.isPresent(t.studentId))
      .map(t => [t.box.x, t.box.y, t.box.w, t.box.h]);
  }

  forcePresent(studentId: number) {
    const ev = this.ensure(studentId);
    if (ev.status !== 'present') ev.markedAt = Date.now();
    ev.status = 'present';
    if (ev.confidentHits === 0 && ev.uncertainHits === 0) ev.manual = true;
  }

  unmark(studentId: number) {
    const ev = this.evidence.get(studentId);
    if (!ev) return;
    ev.status = ev.uncertainHits || ev.confidentHits ? 'review' : 'pending';
    ev.manual = false;
  }

  // ─── Live frames ───────────────────────────────────────────────────────────

  ingest(result: AnalyzeResult): FrameOutcome {
    this.frame++;
    const norm = this.normalizer(result);
    const { idx, matches } = this.match(result);

    const newlyPresent: number[] = [];
    const markers: FaceMarker[] = [];
    const nextTracks: Track[] = [];
    let unknownCount = 0;

    idx.forEach((faceIdx, k) => {
      const face = result.faces[faceIdx];
      const box = norm(face.box);
      const m = matches[k];
      const id = `f${this.frame}-${faceIdx}`;
      if (m.type === 'unknown') {
        unknownCount++;
        markers.push({ id, box, kind: 'unknown' });
        return;
      }
      const rq = this.relQuality(face.quality);
      const ev = this.ensure(m.studentId);
      const wasPresent = ev.status === 'present';
      if (m.type === 'confident') ev.confidentHits++;
      else ev.uncertainHits++;
      this.recordBest(ev, m.score, rq, face.thumbUri, box, face.embedding, face.quality);

      const strongSingle = m.type === 'confident' && m.score >= STRONG_SCORE && (m.margin ?? 0) >= STRONG_MARGIN && rq >= LOW_QUALITY;
      if (!wasPresent && (ev.confidentHits >= CONFIRM_HITS || strongSingle)) {
        ev.status = 'present';
        ev.markedAt = Date.now();
        newlyPresent.push(ev.studentId);
      } else if (!wasPresent) {
        ev.status = ev.confidentHits > 0 ? 'pending' : 'review';
      }

      markers.push({
        id, box,
        kind: ev.status === 'present' ? 'present' : 'matching',
        label: ev.status === 'present' ? this.firstName(ev.studentId) : undefined,
      });
      if (m.type === 'confident') nextTracks.push({ box, studentId: ev.studentId });
    });

    result.faces.forEach((face, i) => {
      if (face.status === 'embedded') return;
      const box = norm(face.box);
      const id = `f${this.frame}-${i}`;
      if (face.status === 'skipped') {
        let best: Track | undefined; let bestIou = 0;
        for (const t of this.tracks) { const o = iou(t.box, box); if (o > bestIou) { bestIou = o; best = t; } }
        if (best) {
          nextTracks.push({ box, studentId: best.studentId });
          markers.push({ id, box, kind: 'present', label: this.firstName(best.studentId) });
        }
        return;
      }
      markers.push({ id, box, kind: face.status === 'blurry' ? 'blurry' : face.status === 'pose' ? 'turned' : 'far' });
    });

    this.tracks = nextTracks;
    return { newlyPresent, markers, faceCount: result.faces.length, unknownCount };
  }

  // ─── Group photos ──────────────────────────────────────────────────────────

  ingestPhoto(result: AnalyzeResult): PhotoOutcome {
    this.photos++;
    const norm = this.normalizer(result);
    const { idx, matches } = this.match(result);
    const newlyPresent: number[] = [];
    const newlyReview: number[] = [];
    let unknownAdded = 0;

    idx.forEach((faceIdx, k) => {
      const face = result.faces[faceIdx];
      const box = norm(face.box);
      const m = matches[k];
      const rq = this.relQuality(face.quality);

      if (m.type === 'unknown') {
        if (rq < JUNK_QUALITY || !face.embedding) return;
        if (this.addUnknown({ id: `p${this.photos}-${faceIdx}`, embedding: face.embedding, quality: face.quality ?? -1, thumbUri: face.thumbUri, box })) unknownAdded++;
        return;
      }

      const ev = this.ensure(m.studentId);
      const wasPresent = ev.status === 'present';
      if (m.type === 'confident') ev.confidentHits++;
      else ev.uncertainHits++;
      this.recordBest(ev, m.score, rq, face.thumbUri, box, face.embedding, face.quality);
      if (wasPresent) return;

      if (m.type === 'confident' && rq >= LOW_QUALITY) {
        ev.status = 'present';
        ev.markedAt = Date.now();
        newlyPresent.push(ev.studentId);
      } else if (ev.status !== 'review') {
        ev.status = 'review';
        newlyReview.push(ev.studentId);
      }
    });

    return { newlyPresent, newlyReview, unknownAdded, faceCount: result.faces.length };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private match(result: AnalyzeResult): { idx: number[]; matches: MatchResult[] } {
    const idx: number[] = [];
    const embs: number[][] = [];
    result.faces.forEach((f, i) => {
      if (f.status === 'embedded' && f.embedding) { idx.push(i); embs.push(f.embedding); }
    });
    return { idx, matches: matchGroupFaces(embs, this.gallery.templates) };
  }

  private normalizer(result: AnalyzeResult) {
    const { imageWidth: W, imageHeight: H } = result;
    return (b: { x: number; y: number; width: number; height: number }): NormBox => ({
      x: b.x / W, y: b.y / H, w: b.width / W, h: b.height / H,
    });
  }

  private recordBest(ev: StudentEvidence, score: number, rq: number, thumb?: string, box?: NormBox, emb?: number[], quality?: number) {
    // Rank by match score, nudged by face quality, so the review photo and the
    // template we may learn from are the clearest view we saw.
    const rank = score + 0.05 * Math.min(rq, 1.5);
    if (rank > ev.bestRank) {
      ev.bestRank = rank;
      ev.bestScore = Math.max(ev.bestScore, score);
      if (thumb) ev.bestThumbUri = thumb;
      ev.bestBox = box;
      ev.bestEmbedding = emb;
      ev.bestQuality = quality;
    } else {
      ev.bestScore = Math.max(ev.bestScore, score);
      if (!ev.bestThumbUri && thumb) ev.bestThumbUri = thumb;
    }
  }

  private addUnknown(u: UnknownFace): boolean {
    for (const existing of this.unknowns) {
      if (cosineSimilarity(existing.embedding, u.embedding) >= UNKNOWN_DEDUPE) {
        if (u.quality > existing.quality) Object.assign(existing, { embedding: u.embedding, quality: u.quality, thumbUri: u.thumbUri, box: u.box });
        return false;
      }
    }
    this.unknowns.push(u);
    return true;
  }

  private ensure(studentId: number): StudentEvidence {
    let ev = this.evidence.get(studentId);
    if (!ev) {
      ev = { studentId, confidentHits: 0, uncertainHits: 0, bestScore: 0, bestRank: -1, status: 'pending' };
      this.evidence.set(studentId, ev);
    }
    return ev;
  }

  private firstName(studentId: number) {
    return (this.names.get(studentId) ?? '').split(' ')[0];
  }
}
