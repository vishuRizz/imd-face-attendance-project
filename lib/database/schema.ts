// Database entity types — mirrors Room DB schema from PRD

export interface Class {
  id: number;
  name: string;
  section: string;
  semester?: string;
  createdAt: string;
}

export interface Student {
  id: number;
  classId: number;
  name: string;
  rollNumber: string;
  studentId?: string;
  enrolledAt?: string;
  isEnrolled: boolean;
}

export interface FaceEmbedding {
  id: number;
  studentId: number;
  embedding: string; // JSON-serialized Float32Array (512-dim)
  captureIndex: number; // 0–4 (which of the 5 captures)
  createdAt: string;
}

export interface Attendance {
  id: number;
  classId: number;
  date: string; // ISO date string
  photoUri?: string;
  createdAt: string;
}

export type AttendanceStatus = 'present' | 'absent' | 'uncertain' | 'unknown';

export interface AttendanceRecord {
  id: number;
  attendanceId: number;
  studentId?: number; // null for unknown faces
  status: AttendanceStatus;
  confidence?: number; // 0–1 cosine similarity score
  faceBox?: string; // JSON: {x, y, w, h} in the group photo
  faceImageUri?: string; // cropped face thumbnail
  createdAt: string;
}

// Extended types for UI queries
export interface StudentWithEmbeddings extends Student {
  embeddingCount: number;
}

export interface AttendanceWithRecords extends Attendance {
  records: (AttendanceRecord & { studentName?: string })[];
  presentCount: number;
  absentCount: number;
  uncertainCount: number;
}

export interface ClassWithStats extends Class {
  studentCount: number;
  enrolledCount: number;
  lastAttendance?: string;
}
