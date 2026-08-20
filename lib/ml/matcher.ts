/**
 * Cosine similarity matching engine for MobileFaceNet (128-dim or 512-dim).
 *
 * MobileFaceNet cosine similarity characteristics on a well-calibrated model:
 *   Same person, good lighting:    0.75 – 0.99
 *   Same person, different angle:  0.60 – 0.80
 *   Different people (random):     0.00 – 0.55
 *   Different people (similar):    0.40 – 0.65   ← the danger zone
 *
 * Strategy to avoid false positives:
 *   1. High absolute threshold (confident ≥ 0.72 for group, ≥ 0.78 solo)
 *   2. Average-of-templates scoring (not best-of — best-of rewards noise)
 *   3. Runner-up margin: best score must beat 2nd-best by ≥ MARGIN
 *   4. Uncertain band is narrow — only for human review, never auto-marked present
 */

// ─── Single-photo (enrollment validation) thresholds ─────────────────────────
export const THRESHOLD_CONFIDENT  = 0.78;
export const THRESHOLD_UNCERTAIN  = 0.65;

// ─── Group-photo thresholds ───────────────────────────────────────────────────
// With correct AdaFace embeddings, impostors are typically < 0.35 and
// genuine matches are typically > 0.45. Keep a clear open-set gap.
export const GROUP_THRESHOLD_CONFIDENT = 0.55;
export const GROUP_THRESHOLD_UNCERTAIN = 0.42;

/**
 * Minimum score gap between the best match and second-best match.
 * If two students score similarly, neither wins — prevents the model
 * from confidently picking the wrong twin/lookalike.
 */
export const MIN_MARGIN = 0.08;

/**
 * When only one student is enrolled, there is no runner-up to compare.
 * Require a higher absolute score so strangers are not auto-labeled.
 */
export const SINGLE_GALLERY_MIN_SCORE = 0.55;

export type MatchResult =
  | { type: 'confident'; studentId: number; score: number }
  | { type: 'uncertain'; studentId: number; score: number }
  | { type: 'unknown' };

// ─── Math helpers ─────────────────────────────────────────────────────────────

/** L2-normalize a vector. Returns a new array. */
export function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
  if (norm < 1e-10) return vec.map(() => 0);
  return vec.map(v => v / norm);
}

/** Cosine similarity between two L2-normalized vectors (dot product). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(-1, Math.min(1, dot));
}

/**
 * Average multiple embeddings for the same student, then L2-normalize.
 * This produces a single robust centroid template.
 */
export function averageEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  const dim = embeddings[0].length;
  const avg = new Array(dim).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) avg[i] += emb[i];
  }
  for (let i = 0; i < dim; i++) avg[i] /= embeddings.length;
  return l2Normalize(avg);
}

// ─── Data structures ──────────────────────────────────────────────────────────

export interface EnrolledStudent {
  studentId: number;
  /** Pre-averaged, L2-normalized centroid embedding */
  embedding: number[];
}

export interface EnrolledStudentTemplates {
  studentId: number;
  /** All enrollment captures, each L2-normalized */
  embeddings: number[][];
  /** Cached centroid (average of all captures) */
  centroid: number[];
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Score a query face against a student's enrollment templates.
 *
 * Uses AVERAGE similarity across all templates (not max).
 * Max-of-templates rewards lucky noise and causes false positives.
 * Average is more conservative and more accurate in practice.
 */
function averageTemplateScore(queryEmbedding: number[], templates: number[][]): number {
  if (templates.length === 0) return 0;
  const total = templates.reduce(
    (sum, template) => sum + cosineSimilarity(queryEmbedding, template),
    0
  );
  return total / templates.length;
}

/**
 * Combined score: weighted blend of centroid similarity and average template similarity.
 * Centroid is fast; template average catches asymmetric enrollments.
 */
function studentMatchScore(
  queryEmbedding: number[],
  student: EnrolledStudentTemplates
): number {
  const centroidScore = cosineSimilarity(queryEmbedding, student.centroid);
  const avgTemplateScore = averageTemplateScore(queryEmbedding, student.embeddings);
  // Blend: centroid gets 40%, per-template average gets 60%
  // The template average is more discriminative with 5 captures.
  return 0.4 * centroidScore + 0.6 * avgTemplateScore;
}

interface RankedStudentScore {
  studentId: number;
  score: number;
}

function rankStudentScores(
  queryEmbedding: number[],
  enrolled: EnrolledStudentTemplates[]
): RankedStudentScore[] {
  return enrolled
    .map(student => ({
      studentId: student.studentId,
      score: studentMatchScore(queryEmbedding, student),
    }))
    .sort((a, b) => b.score - a.score);
}

// ─── Single-face matching (used for enrollment validation) ────────────────────

/**
 * Match a single face embedding against enrolled students.
 * Used for single-person validation (not group photos).
 */
export function matchFace(
  queryEmbedding: number[],
  enrolled: EnrolledStudent[]
): MatchResult {
  if (enrolled.length === 0) return { type: 'unknown' };

  const normalized = l2Normalize([...queryEmbedding]);

  let bestScore = -1;
  let secondBestScore = -1;
  let bestStudentId = -1;

  for (const student of enrolled) {
    const score = cosineSimilarity(normalized, student.embedding);
    if (score > bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestStudentId = student.studentId;
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  // Must have a clear margin over the runner-up (when gallery has 2+)
  const margin = enrolled.length === 1 ? Infinity : bestScore - secondBestScore;
  if (enrolled.length === 1 && bestScore < SINGLE_GALLERY_MIN_SCORE) {
    return { type: 'unknown' };
  }
  if (enrolled.length > 1 && margin < MIN_MARGIN) return { type: 'unknown' };

  if (bestScore >= THRESHOLD_CONFIDENT) {
    return { type: 'confident', studentId: bestStudentId, score: bestScore };
  } else if (bestScore >= THRESHOLD_UNCERTAIN) {
    return { type: 'uncertain', studentId: bestStudentId, score: bestScore };
  }
  return { type: 'unknown' };
}

// ─── Group-photo matching ─────────────────────────────────────────────────────

/**
 * Classify a group-photo match score into a result type.
 * Returns null if the score is below all thresholds (unknown face).
 */
function classifyGroupMatch(
  score: number,
  margin: number,
  gallerySize: number
): MatchResult['type'] | null {
  if (gallerySize <= 1) {
    // Open-set: one enrolled identity — strangers must not auto-match.
    if (score < SINGLE_GALLERY_MIN_SCORE) return null;
    if (score >= GROUP_THRESHOLD_CONFIDENT) return 'confident';
    return 'uncertain';
  }

  if (margin < MIN_MARGIN) return null;
  if (score >= GROUP_THRESHOLD_CONFIDENT) return 'confident';
  if (score >= GROUP_THRESHOLD_UNCERTAIN) return 'uncertain';
  return null;
}

/**
 * Match many detected faces to enrolled students with one-to-one assignment.
 *
 * Algorithm:
 *   1. Score every (face, student) pair using average-template similarity.
 *   2. Require both a high absolute score AND a margin over the runner-up.
 *   3. Process face↔student pairs in descending score order (greedy optimal).
 *   4. Each student can only be claimed once.
 *   5. Faces that don't clear the threshold → unknown.
 */
export function matchGroupFaces(
  queryEmbeddings: number[][],
  enrolled: EnrolledStudentTemplates[]
): MatchResult[] {
  const results: MatchResult[] = Array.from({ length: queryEmbeddings.length }, () => ({
    type: 'unknown' as const,
  }));

  if (queryEmbeddings.length === 0 || enrolled.length === 0) {
    return results;
  }

  const normalizedQueries = queryEmbeddings.map(e => l2Normalize([...e]));

  // Build ranked scores per face, with margin computation
  const rankedByFace = normalizedQueries.map(query => {
    const ranked = rankStudentScores(query, enrolled);
    return ranked.map((entry, idx) => ({
      ...entry,
      // Margin vs. the next-best student for this face
      margin: idx === 0
        ? (ranked.length > 1 ? entry.score - ranked[1].score : Infinity)
        : entry.score - (ranked[idx + 1]?.score ?? -1),
    }));
  });

  // Build a flat list of all (face, student) candidate pairs, sorted by score desc
  // Only include pairs that clear at least the uncertain threshold
  interface Candidate {
    faceIdx: number;
    studentId: number;
    score: number;
    margin: number;
  }

  const candidates: Candidate[] = [];
  for (let faceIdx = 0; faceIdx < normalizedQueries.length; faceIdx++) {
    for (const { studentId, score, margin } of rankedByFace[faceIdx]) {
      if (score < GROUP_THRESHOLD_UNCERTAIN) break; // sorted desc, no point continuing
      candidates.push({ faceIdx, studentId, score, margin });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const assignedStudents = new Set<number>();
  const assignedFaces = new Set<number>();

  for (const { faceIdx, studentId, score, margin } of candidates) {
    if (assignedFaces.has(faceIdx)) continue;
    if (assignedStudents.has(studentId)) continue;

    const matchType = classifyGroupMatch(score, margin, enrolled.length);
    if (!matchType) continue;

    results[faceIdx] = { type: matchType, studentId, score };
    assignedStudents.add(studentId);
    assignedFaces.add(faceIdx);
  }

  return results;
}

// ─── Template builders ────────────────────────────────────────────────────────

/** Build averaged embedding map — used for single-face matching. */
export function buildEnrolledStudents(
  rawEmbeddings: Array<{ studentId: number; embedding: number[] }>
): EnrolledStudent[] {
  const grouped = new Map<number, number[][]>();
  for (const { studentId, embedding } of rawEmbeddings) {
    if (!grouped.has(studentId)) grouped.set(studentId, []);
    grouped.get(studentId)!.push(embedding);
  }
  return [...grouped.entries()].map(([studentId, embeddings]) => ({
    studentId,
    embedding: averageEmbeddings(embeddings),
  }));
}

/**
 * Build per-student template sets — used for group matching.
 * Each template is individually L2-normalized.
 * Also pre-computes the centroid for fast scoring.
 */
export function buildEnrolledTemplates(
  rawEmbeddings: Array<{ studentId: number; embedding: number[] }>
): EnrolledStudentTemplates[] {
  const grouped = new Map<number, number[][]>();
  for (const { studentId, embedding } of rawEmbeddings) {
    if (!grouped.has(studentId)) grouped.set(studentId, []);
    grouped.get(studentId)!.push(l2Normalize(embedding));
  }
  return [...grouped.entries()].map(([studentId, embeddings]) => ({
    studentId,
    embeddings,
    centroid: averageEmbeddings(embeddings),
  }));
}
