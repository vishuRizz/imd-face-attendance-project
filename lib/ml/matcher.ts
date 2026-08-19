/**
 * Cosine similarity matching engine for face recognition.
 * Implements the thresholds from the PRD:
 *   >= 0.60 → Confident (Present)
 *   0.45–0.59 → Uncertain (Review)
 *   < 0.45  → Unknown
 */

export const THRESHOLD_CONFIDENT = 0.60;
export const THRESHOLD_UNCERTAIN = 0.45;

export type MatchResult =
  | { type: 'confident'; studentId: number; score: number }
  | { type: 'uncertain'; studentId: number; score: number }
  | { type: 'unknown' };

/** L2-normalize a vector in place */
export function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
  if (norm === 0) return vec;
  return vec.map(v => v / norm);
}

/** Cosine similarity between two L2-normalized vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return Math.max(-1, Math.min(1, dot));
}

/**
 * Average multiple embeddings for the same student (from 5 captures).
 * Then normalize the result.
 */
export function averageEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  const dim = embeddings[0].length;
  const avg = new Array(dim).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      avg[i] += emb[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    avg[i] /= embeddings.length;
  }
  return l2Normalize(avg);
}

export interface EnrolledStudent {
  studentId: number;
  /** Pre-averaged, L2-normalized embedding */
  embedding: number[];
}

/**
 * Given a face embedding from the group photo and all enrolled students,
 * return the best match result.
 */
export function matchFace(
  queryEmbedding: number[],
  enrolled: EnrolledStudent[]
): MatchResult {
  const normalized = l2Normalize([...queryEmbedding]);

  let bestScore = -1;
  let bestStudentId = -1;

  for (const student of enrolled) {
    const score = cosineSimilarity(normalized, student.embedding);
    if (score > bestScore) {
      bestScore = score;
      bestStudentId = student.studentId;
    }
  }

  if (bestScore >= THRESHOLD_CONFIDENT) {
    return { type: 'confident', studentId: bestStudentId, score: bestScore };
  } else if (bestScore >= THRESHOLD_UNCERTAIN) {
    return { type: 'uncertain', studentId: bestStudentId, score: bestScore };
  }
  return { type: 'unknown' };
}

/**
 * Build the averaged embedding map for a class from raw DB embeddings.
 * Groups per studentId and averages them.
 */
export function buildEnrolledStudents(
  rawEmbeddings: Array<{ studentId: number; embedding: number[] }>
): EnrolledStudent[] {
  const grouped = new Map<number, number[][]>();
  for (const { studentId, embedding } of rawEmbeddings) {
    if (!grouped.has(studentId)) grouped.set(studentId, []);
    grouped.get(studentId)!.push(embedding);
  }
  const result: EnrolledStudent[] = [];
  for (const [studentId, embeddings] of grouped.entries()) {
    result.push({ studentId, embedding: averageEmbeddings(embeddings) });
  }
  return result;
}
