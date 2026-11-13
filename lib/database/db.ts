import * as SQLite from 'expo-sqlite';
import type {
  Class,
  Student,
  FaceEmbedding,
  Attendance,
  AttendanceRecord,
  AttendanceStatus,
  ClassWithStats,
  StudentWithEmbeddings,
  AttendanceWithRecords,
} from './schema';

// Re-export extended types so screens can import from db
export type { ClassWithStats, StudentWithEmbeddings, AttendanceWithRecords } from './schema';


let db: SQLite.SQLiteDatabase | null = null;

/**
 * Version of the face pipeline that produced stored embeddings. Bump whenever
 * preprocessing or the model changes in a way that makes old embeddings
 * incomparable. v2 = BGR input + flip-fused AdaFace embeddings.
 */
export const PIPELINE_VERSION = 2;
/** Max classroom ("field") templates kept per student, on top of enrollment captures. */
const FIELD_TEMPLATE_CAP = 6;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('facescan_attendance.db');
  try {
    await initializeDatabase(db);
    await db.runAsync('PRAGMA foreign_keys = ON');
  } catch (e) {
    // Database is likely corrupted (e.g. FK violations in a WAL journal from
    // a previous crash). Close it, delete the file, and start fresh.
    console.warn('[DB] Initialization failed, resetting database:', e);
    try { await db.closeAsync(); } catch (_) {}
    db = null;
    await SQLite.deleteDatabaseAsync('facescan_attendance.db');
    db = await SQLite.openDatabaseAsync('facescan_attendance.db');
    await initializeDatabase(db);
    await db.runAsync('PRAGMA foreign_keys = ON');
  }
  return db;
}

async function initializeDatabase(database: SQLite.SQLiteDatabase) {
  // Run each DDL statement individually to avoid expo-sqlite Android's batch
  // finalizer bug — execAsync internally uses sqlite3_exec which can trigger
  // FK constraint checks on finalize even with foreign_keys=OFF.
  await database.runAsync('PRAGMA foreign_keys = OFF');
  await database.runAsync('PRAGMA journal_mode = WAL');

  await database.runAsync(`CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    section TEXT NOT NULL,
    semester TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await database.runAsync(`CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    roll_number TEXT NOT NULL,
    student_id TEXT,
    is_enrolled INTEGER NOT NULL DEFAULT 0,
    enrolled_at TEXT,
    UNIQUE(class_id, roll_number)
  )`);

  await database.runAsync(`CREATE TABLE IF NOT EXISTS face_embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    embedding TEXT NOT NULL,
    capture_index INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await database.runAsync(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    photo_uri TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await database.runAsync(`CREATE TABLE IF NOT EXISTS attendance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attendance_id INTEGER NOT NULL,
    student_id INTEGER,
    status TEXT NOT NULL DEFAULT 'absent',
    confidence REAL,
    face_box TEXT,
    face_image_uri TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await database.runAsync(`CREATE TABLE IF NOT EXISTS sync_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  // Migrations (additive only)
  const studentCols = await database.getAllAsync<{ name: string }>('PRAGMA table_info(students)');
  if (!studentCols.some(c => c.name === 'photo_uri')) {
    await database.runAsync('ALTER TABLE students ADD COLUMN photo_uri TEXT');
  }

  const embCols = await database.getAllAsync<{ name: string }>('PRAGMA table_info(face_embeddings)');
  if (!embCols.some(c => c.name === 'pipeline')) {
    await database.runAsync('ALTER TABLE face_embeddings ADD COLUMN pipeline INTEGER NOT NULL DEFAULT 1');
    await database.runAsync('ALTER TABLE face_embeddings ADD COLUMN quality REAL');
    await database.runAsync("ALTER TABLE face_embeddings ADD COLUMN source TEXT NOT NULL DEFAULT 'enroll'");
    // Embeddings from the old pipeline are not comparable with the new one:
    // send those students back through (hands-free) face setup.
    await database.runAsync(
      `UPDATE students SET is_enrolled = 0 WHERE id IN (SELECT DISTINCT student_id FROM face_embeddings WHERE pipeline < ${PIPELINE_VERSION})`);
    await database.runAsync(`DELETE FROM face_embeddings WHERE pipeline < ${PIPELINE_VERSION}`);
  }
  const recCols = await database.getAllAsync<{ name: string }>('PRAGMA table_info(attendance_records)');
  if (!recCols.some(c => c.name === 'embedding')) {
    await database.runAsync('ALTER TABLE attendance_records ADD COLUMN embedding TEXT');
    await database.runAsync('ALTER TABLE attendance_records ADD COLUMN quality REAL');
    await database.runAsync('ALTER TABLE attendance_records ADD COLUMN manual INTEGER NOT NULL DEFAULT 0');
  }

  await database.runAsync('CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id)');
  await database.runAsync('CREATE INDEX IF NOT EXISTS idx_embeddings_student ON face_embeddings(student_id)');
  await database.runAsync('CREATE INDEX IF NOT EXISTS idx_attendance_class ON attendance(class_id)');
  await database.runAsync('CREATE INDEX IF NOT EXISTS idx_records_attendance ON attendance_records(attendance_id)');
}

// ─── Classes ────────────────────────────────────────────────────────────────

export async function createClass(
  name: string,
  section: string,
  semester?: string
): Promise<Class> {
  const database = await getDb();
  const result = await database.runAsync(
    `INSERT INTO classes (name, section, semester) VALUES (?, ?, ?)`,
    [name, section, semester ?? null]
  );
  return getClassById(result.lastInsertRowId);
}

export async function getClassById(id: number): Promise<Class> {
  const database = await getDb();
  const row = await database.getFirstAsync<any>(
    `SELECT id, name, section, semester, created_at FROM classes WHERE id = ?`,
    [id]
  );
  if (!row) throw new Error(`Class ${id} not found`);
  return mapClass(row);
}

export const localDateKey = (d = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export async function getAllClasses(): Promise<ClassWithStats[]> {
  const database = await getDb();
  const today = localDateKey();
  const rows = await database.getAllAsync<any>(`
    SELECT
      c.id, c.name, c.section, c.semester, c.created_at,
      (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) AS student_count,
      (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.is_enrolled = 1) AS enrolled_count,
      (SELECT MAX(a.date) FROM attendance a WHERE a.class_id = c.id) AS last_attendance,
      (SELECT a.id FROM attendance a WHERE a.class_id = c.id AND a.date = ? ORDER BY a.id DESC LIMIT 1) AS today_session_id
    FROM classes c
    ORDER BY c.created_at DESC, c.id DESC
  `, [today]);
  const classes = rows.map(mapClassWithStats);
  for (const cls of classes) {
    if (cls.todaySessionId) {
      const row = await database.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM attendance_records WHERE attendance_id = ? AND status = 'present'`,
        [cls.todaySessionId]
      );
      cls.todayPresent = row?.n ?? 0;
    }
  }
  return classes;
}

export async function deleteClass(id: number): Promise<void> {
  const database = await getDb();
  // No FK cascades in the schema — remove dependents explicitly.
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `DELETE FROM attendance_records WHERE attendance_id IN (SELECT id FROM attendance WHERE class_id = ?)`, [id]);
    await database.runAsync(`DELETE FROM attendance WHERE class_id = ?`, [id]);
    await database.runAsync(
      `DELETE FROM face_embeddings WHERE student_id IN (SELECT id FROM students WHERE class_id = ?)`, [id]);
    await database.runAsync(`DELETE FROM students WHERE class_id = ?`, [id]);
    await database.runAsync(`DELETE FROM classes WHERE id = ?`, [id]);
  });
}

// ─── Students ────────────────────────────────────────────────────────────────

export async function createStudent(
  classId: number,
  name: string,
  rollNumber: string,
  studentId?: string
): Promise<Student> {
  const database = await getDb();
  const result = await database.runAsync(
    `INSERT INTO students (class_id, name, roll_number, student_id) VALUES (?, ?, ?, ?)`,
    [classId, name, rollNumber, studentId ?? null]
  );
  return getStudentById(result.lastInsertRowId);
}

export async function getStudentById(id: number): Promise<Student> {
  const database = await getDb();
  const row = await database.getFirstAsync<any>(
    `SELECT * FROM students WHERE id = ?`,
    [id]
  );
  if (!row) throw new Error(`Student ${id} not found`);
  return mapStudent(row);
}

export async function getStudentsForClass(classId: number): Promise<StudentWithEmbeddings[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<any>(`
    SELECT
      s.*,
      COUNT(fe.id) AS embedding_count
    FROM students s
    LEFT JOIN face_embeddings fe ON fe.student_id = s.id
    WHERE s.class_id = ?
    GROUP BY s.id
    ORDER BY s.roll_number ASC
  `, [classId]);
  return rows.map(mapStudentWithEmbeddings);
}

export async function createStudentsBulk(
  classId: number,
  rows: Array<{ name: string; rollNumber: string }>
): Promise<{ created: number; skipped: string[] }> {
  const database = await getDb();
  let created = 0;
  const skipped: string[] = [];
  await database.withTransactionAsync(async () => {
    for (const row of rows) {
      const exists = await database.getFirstAsync<{ id: number }>(
        `SELECT id FROM students WHERE class_id = ? AND roll_number = ?`, [classId, row.rollNumber]);
      if (exists) { skipped.push(row.rollNumber); continue; }
      await database.runAsync(
        `INSERT INTO students (class_id, name, roll_number) VALUES (?, ?, ?)`,
        [classId, row.name, row.rollNumber]);
      created++;
    }
  });
  return { created, skipped };
}

export async function deleteStudent(id: number): Promise<void> {
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    await database.runAsync(`DELETE FROM face_embeddings WHERE student_id = ?`, [id]);
    await database.runAsync(`DELETE FROM attendance_records WHERE student_id = ?`, [id]);
    await database.runAsync(`DELETE FROM students WHERE id = ?`, [id]);
  });
}

/** Atomically replace a student's face templates and mark them enrolled. */
export async function saveEnrollment(
  studentId: number,
  captures: Array<{ embedding: number[]; quality?: number }>,
  photoUri?: string
): Promise<void> {
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    await database.runAsync(`DELETE FROM face_embeddings WHERE student_id = ?`, [studentId]);
    for (let i = 0; i < captures.length; i++) {
      await database.runAsync(
        `INSERT INTO face_embeddings (student_id, embedding, capture_index, pipeline, quality, source) VALUES (?, ?, ?, ?, ?, 'enroll')`,
        [studentId, JSON.stringify(captures[i].embedding), i, PIPELINE_VERSION, captures[i].quality ?? null]);
    }
    await database.runAsync(
      `UPDATE students SET is_enrolled = 1, enrolled_at = datetime('now'), photo_uri = COALESCE(?, photo_uri) WHERE id = ?`,
      [photoUri ?? null, studentId]);
  });
}

export async function markStudentEnrolled(studentId: number): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `UPDATE students SET is_enrolled = 1, enrolled_at = datetime('now') WHERE id = ?`,
    [studentId]
  );
}

// ─── Face Embeddings ──────────────────────────────────────────────────────────

export async function saveFaceEmbedding(
  studentId: number,
  embedding: number[],
  captureIndex: number
): Promise<FaceEmbedding> {
  const database = await getDb();
  const embeddingJson = JSON.stringify(embedding);
  const result = await database.runAsync(
    `INSERT INTO face_embeddings (student_id, embedding, capture_index) VALUES (?, ?, ?)`,
    [studentId, embeddingJson, captureIndex]
  );
  const row = await database.getFirstAsync<any>(
    `SELECT * FROM face_embeddings WHERE id = ?`,
    [result.lastInsertRowId]
  );
  return mapEmbedding(row!);
}

export async function getEmbeddingsForStudent(studentId: number): Promise<FaceEmbedding[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<any>(
    `SELECT * FROM face_embeddings WHERE student_id = ? ORDER BY capture_index ASC`,
    [studentId]
  );
  return rows.map(mapEmbedding);
}

export type StoredTemplate = {
  studentId: number;
  embedding: number[];
  quality?: number;
  source: 'enroll' | 'field';
};

export async function getAllEmbeddingsForClass(classId: number): Promise<StoredTemplate[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<any>(`
    SELECT fe.student_id, fe.embedding, fe.quality, fe.source
    FROM face_embeddings fe
    JOIN students s ON s.id = fe.student_id
    WHERE s.class_id = ? AND s.is_enrolled = 1 AND fe.pipeline = ?
  `, [classId, PIPELINE_VERSION]);
  return rows.map((r: any) => ({
    studentId: r.student_id,
    embedding: JSON.parse(r.embedding) as number[],
    quality: r.quality ?? undefined,
    source: r.source === 'field' ? 'field' : 'enroll',
  }));
}

/**
 * Adaptive learning: store teacher-confirmed classroom faces as extra
 * templates so recognition adapts to real classroom distance, angle and
 * lighting. Keeps the newest FIELD_TEMPLATE_CAP per student.
 */
export async function addFieldTemplates(
  items: Array<{ studentId: number; embedding: number[]; quality?: number }>
): Promise<number> {
  if (!items.length) return 0;
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    for (const it of items) {
      await database.runAsync(
        `INSERT INTO face_embeddings (student_id, embedding, capture_index, pipeline, quality, source) VALUES (?, ?, 100, ?, ?, 'field')`,
        [it.studentId, JSON.stringify(it.embedding), PIPELINE_VERSION, it.quality ?? null]);
      await database.runAsync(
        `DELETE FROM face_embeddings WHERE id IN (
           SELECT id FROM face_embeddings WHERE student_id = ? AND source = 'field'
           ORDER BY id DESC LIMIT -1 OFFSET ?)`,
        [it.studentId, FIELD_TEMPLATE_CAP]);
    }
  });
  return items.length;
}

/** Embeddings captured in a session, keyed by record id (for adaptive learning on save). */
export async function getSessionEmbeddings(sessionId: number): Promise<Map<number, { embedding: number[]; quality?: number }>> {
  const database = await getDb();
  const rows = await database.getAllAsync<any>(
    `SELECT id, embedding, quality FROM attendance_records WHERE attendance_id = ? AND embedding IS NOT NULL`, [sessionId]);
  return new Map(rows.map((r: any) => [r.id, { embedding: JSON.parse(r.embedding), quality: r.quality ?? undefined }]));
}

export async function deleteEmbeddingsForStudent(studentId: number): Promise<void> {
  const database = await getDb();
  await database.runAsync(`DELETE FROM face_embeddings WHERE student_id = ?`, [studentId]);
}

// ─── Attendance ───────────────────────────────────────────────────────────────

export async function createAttendanceSession(
  classId: number,
  date: string,
  photoUri?: string
): Promise<Attendance> {
  const database = await getDb();
  const result = await database.runAsync(
    `INSERT INTO attendance (class_id, date, photo_uri) VALUES (?, ?, ?)`,
    [classId, date, photoUri ?? null]
  );
  const row = await database.getFirstAsync<any>(
    `SELECT * FROM attendance WHERE id = ?`,
    [result.lastInsertRowId]
  );
  return mapAttendance(row!);
}

export async function saveAttendanceRecords(
  attendanceId: number,
  records: Array<{
    studentId?: number;
    status: AttendanceStatus;
    confidence?: number;
    faceBox?: object;
    faceImageUri?: string;
    embedding?: number[];
    quality?: number;
    manual?: boolean;
  }>
): Promise<void> {
  const database = await getDb();

  // Collect all studentIds that need FK validation
  const studentIdsToCheck = [
    ...new Set(records.map(r => r.studentId).filter((id): id is number => id != null)),
  ];

  // Build a set of valid student IDs to guard against stale references
  const validStudentIds = new Set<number>();
  for (const sid of studentIdsToCheck) {
    const row = await database.getFirstAsync<{ id: number }>(
      `SELECT id FROM students WHERE id = ?`,
      [sid]
    );
    if (row) validStudentIds.add(sid);
  }

  await database.withTransactionAsync(async () => {
    for (const r of records) {
      // If studentId doesn't exist in DB, treat as unknown face to avoid FK violation
      const resolvedStudentId =
        r.studentId != null && validStudentIds.has(r.studentId) ? r.studentId : null;
      const resolvedStatus =
        resolvedStudentId == null && r.studentId != null ? 'unknown' : r.status;

      await database.runAsync(
        `INSERT INTO attendance_records
          (attendance_id, student_id, status, confidence, face_box, face_image_uri, embedding, quality, manual)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          attendanceId,
          resolvedStudentId,
          resolvedStatus,
          r.confidence ?? null,
          r.faceBox ? JSON.stringify(r.faceBox) : null,
          r.faceImageUri ?? null,
          r.embedding ? JSON.stringify(r.embedding) : null,
          r.quality ?? null,
          r.manual ? 1 : 0,
        ]
      );
    }
  });
}

export interface SessionRecord extends AttendanceRecord {
  studentName?: string;
  rollNumber?: string;
  studentPhotoUri?: string;
}

export async function getAttendanceSession(sessionId: number): Promise<{
  session: Attendance;
  records: SessionRecord[];
}> {
  const database = await getDb();
  const row = await database.getFirstAsync<any>(`SELECT * FROM attendance WHERE id = ?`, [sessionId]);
  if (!row) throw new Error('Attendance session not found');
  const rows = await database.getAllAsync<any>(`
    SELECT ar.id, ar.attendance_id, ar.student_id, ar.status, ar.confidence, ar.face_box, ar.face_image_uri, ar.quality, ar.manual, ar.created_at, s.name AS student_name, s.roll_number AS roll_number, s.photo_uri AS student_photo_uri
    FROM attendance_records ar
    LEFT JOIN students s ON s.id = ar.student_id
    WHERE ar.attendance_id = ?
    ORDER BY s.roll_number ASC, ar.id ASC
  `, [sessionId]);
  return {
    session: mapAttendance(row),
    records: rows.map((r: any) => ({
      ...mapRecord(r),
      studentName: r.student_name ?? undefined,
      rollNumber: r.roll_number ?? undefined,
      studentPhotoUri: r.student_photo_uri ?? undefined,
    })),
  };
}

export async function updateAttendanceRecords(
  records: Array<{ id: number; studentId?: number | null; status: AttendanceStatus }>
): Promise<void> {
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    for (const r of records) {
      await database.runAsync(
        `UPDATE attendance_records SET student_id = ?, status = ? WHERE id = ?`,
        [r.studentId ?? null, r.status, r.id]);
    }
  });
}

export async function deleteAttendanceRecords(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    for (const id of ids) await database.runAsync(`DELETE FROM attendance_records WHERE id = ?`, [id]);
  });
}

export async function deleteAttendanceSession(sessionId: number): Promise<void> {
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    await database.runAsync(`DELETE FROM attendance_records WHERE attendance_id = ?`, [sessionId]);
    await database.runAsync(`DELETE FROM attendance WHERE id = ?`, [sessionId]);
  });
}

export async function getAttendanceHistory(classId: number): Promise<AttendanceWithRecords[]> {
  const database = await getDb();
  const sessions = await database.getAllAsync<any>(
    `SELECT * FROM attendance WHERE class_id = ? ORDER BY date DESC, id DESC`,
    [classId]
  );

  const result: AttendanceWithRecords[] = [];
  for (const session of sessions) {
    const records = await database.getAllAsync<any>(`
      SELECT ar.id, ar.attendance_id, ar.student_id, ar.status, ar.confidence, ar.face_box, ar.face_image_uri, ar.quality, ar.manual, ar.created_at, s.name AS student_name
      FROM attendance_records ar
      LEFT JOIN students s ON s.id = ar.student_id
      WHERE ar.attendance_id = ?
    `, [session.id]);

    const mapped = records.map((r: any) => ({
      ...mapRecord(r),
      studentName: r.student_name,
    }));

    result.push({
      ...mapAttendance(session),
      records: mapped,
      presentCount: mapped.filter(r => r.status === 'present').length,
      absentCount: mapped.filter(r => r.status === 'absent').length,
      uncertainCount: mapped.filter(r => r.status === 'uncertain').length,
    });
  }
  return result;
}

// ─── Cloud sync ──────────────────────────────────────────────────────────────

export type SyncSnapshot = {
  deviceId: string;
  classes: Record<string, unknown>[];
  students: Record<string, unknown>[];
  embeddings: Record<string, unknown>[];
  attendance: Record<string, unknown>[];
  attendanceRecords: Record<string, unknown>[];
};

/**
 * Returns a complete, local-first snapshot. Re-sending this payload is safe:
 * records are upserted remotely by the stable local id plus installation id.
 */
export async function getSyncSnapshot(): Promise<SyncSnapshot> {
  const database = await getDb();
  const existing = await database.getFirstAsync<{ value: string }>(
    `SELECT value FROM sync_metadata WHERE key = 'device_id'`
  );
  const deviceId = existing?.value ?? `facescan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  if (!existing) {
    await database.runAsync(`INSERT INTO sync_metadata (key, value) VALUES ('device_id', ?)`, [deviceId]);
  }

  const [classes, students, embeddings, attendance, attendanceRecords] = await Promise.all([
    database.getAllAsync<Record<string, unknown>>(`SELECT * FROM classes`),
    database.getAllAsync<Record<string, unknown>>(`SELECT * FROM students`),
    database.getAllAsync<Record<string, unknown>>(`SELECT * FROM face_embeddings`),
    database.getAllAsync<Record<string, unknown>>(`SELECT * FROM attendance`),
    database.getAllAsync<Record<string, unknown>>(`SELECT * FROM attendance_records`),
  ]);
  return { deviceId, classes, students, embeddings, attendance, attendanceRecords };
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

function mapClass(row: any): Class {
  return {
    id: row.id,
    name: row.name,
    section: row.section,
    semester: row.semester,
    createdAt: row.created_at,
  };
}

function mapClassWithStats(row: any): ClassWithStats {
  return {
    ...mapClass(row),
    studentCount: row.student_count ?? 0,
    enrolledCount: row.enrolled_count ?? 0,
    lastAttendance: row.last_attendance ?? undefined,
    todaySessionId: row.today_session_id ?? undefined,
  };
}

function mapStudent(row: any): Student {
  return {
    id: row.id,
    classId: row.class_id,
    name: row.name,
    rollNumber: row.roll_number,
    studentId: row.student_id,
    isEnrolled: row.is_enrolled === 1,
    enrolledAt: row.enrolled_at,
    photoUri: row.photo_uri ?? undefined,
  };
}

function mapStudentWithEmbeddings(row: any): StudentWithEmbeddings {
  return {
    ...mapStudent(row),
    embeddingCount: row.embedding_count ?? 0,
  };
}

function mapEmbedding(row: any): FaceEmbedding {
  return {
    id: row.id,
    studentId: row.student_id,
    embedding: row.embedding,
    captureIndex: row.capture_index,
    createdAt: row.created_at,
  };
}

function mapAttendance(row: any): Attendance {
  return {
    id: row.id,
    classId: row.class_id,
    date: row.date,
    photoUri: row.photo_uri,
    createdAt: row.created_at,
  };
}

function mapRecord(row: any): AttendanceRecord {
  return {
    id: row.id,
    attendanceId: row.attendance_id,
    studentId: row.student_id,
    status: row.status as AttendanceStatus,
    confidence: row.confidence,
    faceBox: row.face_box,
    faceImageUri: row.face_image_uri,
    quality: row.quality ?? undefined,
    manual: row.manual === 1,
    createdAt: row.created_at,
  };
}
