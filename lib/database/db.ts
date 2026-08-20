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

export async function getAllClasses(): Promise<ClassWithStats[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<any>(`
    SELECT
      c.id, c.name, c.section, c.semester, c.created_at,
      COUNT(DISTINCT s.id) AS student_count,
      SUM(CASE WHEN s.is_enrolled = 1 THEN 1 ELSE 0 END) AS enrolled_count,
      MAX(a.date) AS last_attendance
    FROM classes c
    LEFT JOIN students s ON s.class_id = c.id
    LEFT JOIN attendance a ON a.class_id = c.id
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `);
  return rows.map(mapClassWithStats);
}

export async function deleteClass(id: number): Promise<void> {
  const database = await getDb();
  await database.runAsync(`DELETE FROM classes WHERE id = ?`, [id]);
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

export async function deleteStudent(id: number): Promise<void> {
  const database = await getDb();
  await database.runAsync(`DELETE FROM students WHERE id = ?`, [id]);
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

export async function getAllEmbeddingsForClass(classId: number): Promise<
  Array<{ studentId: number; embedding: number[] }>
> {
  const database = await getDb();
  const rows = await database.getAllAsync<any>(`
    SELECT fe.student_id, fe.embedding
    FROM face_embeddings fe
    JOIN students s ON s.id = fe.student_id
    WHERE s.class_id = ? AND s.is_enrolled = 1
  `, [classId]);
  return rows.map((r: any) => ({
    studentId: r.student_id,
    embedding: JSON.parse(r.embedding) as number[],
  }));
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
          (attendance_id, student_id, status, confidence, face_box, face_image_uri)
          VALUES (?, ?, ?, ?, ?, ?)`,
        [
          attendanceId,
          resolvedStudentId,
          resolvedStatus,
          r.confidence ?? null,
          r.faceBox ? JSON.stringify(r.faceBox) : null,
          r.faceImageUri ?? null,
        ]
      );
    }
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
      SELECT ar.*, s.name AS student_name
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
    createdAt: row.created_at,
  };
}
