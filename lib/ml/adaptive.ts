/**
 * Adaptive templates: after the teacher saves a reviewed session, confirmed
 * classroom faces become extra templates for those students. Enrollment
 * captures are close-up; classroom faces are far, angled and differently lit —
 * learning from them closes that gap over the first few days of use.
 *
 * Guard rails (a bad template hurts every future scan):
 *  • only faces the teacher confirmed, or automatic matches that were very strong
 *  • must still resemble the student's own enrollment captures (anti mis-assign)
 *  • must be reasonable quality relative to that student's enrollment
 *  • near-duplicates of an existing template add nothing and are skipped
 */
import { addFieldTemplates, getAllEmbeddingsForClass, getSessionEmbeddings } from '../database/db';
import { averageEmbeddings, cosineSimilarity } from './matcher';

const AUTO_ACCEPT_SCORE = 0.6;
const MIN_SELF_SIMILARITY = 0.35;
const MIN_REL_QUALITY = 0.6;
const DUPLICATE = 0.93;

export interface FinalRecord {
  id: number;
  studentId?: number | null;
  status: string;
  confidence?: number;
  manual?: boolean;
  teacherConfirmed: boolean;
}

export async function learnFromSession(sessionId: number, classId: number, records: FinalRecord[]): Promise<number> {
  const [captured, stored] = await Promise.all([getSessionEmbeddings(sessionId), getAllEmbeddingsForClass(classId)]);
  if (!captured.size) return 0;

  const byStudent = new Map<number, typeof stored>();
  for (const t of stored) {
    if (!byStudent.has(t.studentId)) byStudent.set(t.studentId, []);
    byStudent.get(t.studentId)!.push(t);
  }

  const items: Array<{ studentId: number; embedding: number[]; quality?: number }> = [];
  for (const r of records) {
    if (r.status !== 'present' || r.studentId == null || r.manual) continue;
    if (!r.teacherConfirmed && (r.confidence ?? 0) < AUTO_ACCEPT_SCORE) continue;
    const cap = captured.get(r.id);
    const own = byStudent.get(r.studentId);
    if (!cap || !own?.length) continue;

    const enroll = own.filter(t => t.source === 'enroll');
    if (!enroll.length) continue;
    if (cosineSimilarity(cap.embedding, averageEmbeddings(enroll.map(t => t.embedding))) < MIN_SELF_SIMILARITY) continue;

    const qs = enroll.map(t => t.quality ?? -1).filter(q => q > 0).sort((a, b) => a - b);
    if (qs.length && cap.quality && cap.quality > 0 && cap.quality < qs[Math.floor(qs.length / 2)] * MIN_REL_QUALITY) continue;

    if (own.some(t => cosineSimilarity(t.embedding, cap.embedding) >= DUPLICATE)) continue;
    items.push({ studentId: r.studentId, embedding: cap.embedding, quality: cap.quality });
  }
  return addFieldTemplates(items);
}
