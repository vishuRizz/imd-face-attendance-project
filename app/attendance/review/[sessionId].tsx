import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  SectionList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as db from '@/lib/database/db';
import type { AttendanceRecord, Student } from '@/lib/database/schema';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';

interface ReviewRecord extends AttendanceRecord {
  studentName?: string;
  student?: Student;
}

type SectionData = {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  data: ReviewRecord[];
};

export default function ReviewScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();

  const [sections, setSections] = useState<SectionData[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [classId, setClassId] = useState<number | null>(null);

  // Records keyed by id for local state management
  const [recordMap, setRecordMap] = useState<Map<number, ReviewRecord>>(new Map());

  const load = useCallback(async () => {
    try {
      const sessionDb = await db.getDb();
      // Load the session
      const session = await sessionDb.getFirstAsync<any>(
        'SELECT * FROM attendance WHERE id = ?', [Number(sessionId)]
      );
      if (!session) throw new Error('Session not found');
      setClassId(session.class_id);

      const [students, recordRows] = await Promise.all([
        db.getStudentsForClass(session.class_id),
        sessionDb.getAllAsync<any>(`
          SELECT ar.*, s.name AS student_name
          FROM attendance_records ar
          LEFT JOIN students s ON s.id = ar.student_id
          WHERE ar.attendance_id = ?
        `, [Number(sessionId)]),
      ]);
      setAllStudents(students);

      const records: ReviewRecord[] = recordRows.map((r: any) => ({
        id: r.id,
        attendanceId: r.attendance_id,
        studentId: r.student_id,
        status: r.status,
        confidence: r.confidence,
        faceBox: r.face_box,
        faceImageUri: r.face_image_uri,
        createdAt: r.created_at,
        studentName: r.student_name,
      }));

      const map = new Map(records.map(r => [r.id, r]));
      setRecordMap(map);
      buildSections(records, setSections);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  function buildSections(records: ReviewRecord[], setter: typeof setSections) {
    const present = records.filter(r => r.status === 'present');
    const uncertain = records.filter(r => r.status === 'uncertain');
    const unknown = records.filter(r => r.status === 'unknown');
    const absent = records.filter(r => r.status === 'absent');

    setter([
      { title: 'Present', icon: 'checkmark-circle-outline', color: Colors.present, data: present },
      { title: 'Review needed', icon: 'alert-circle-outline', color: Colors.uncertain, data: uncertain },
      { title: 'Unknown faces', icon: 'help-circle-outline', color: Colors.unknown, data: unknown },
      { title: 'Absent', icon: 'close-circle-outline', color: Colors.absent, data: absent },
    ]);
  }

  const updateRecord = (recordId: number, updates: Partial<ReviewRecord>) => {
    setRecordMap(prev => {
      const map = new Map(prev);
      const existing = map.get(recordId);
      if (existing) map.set(recordId, { ...existing, ...updates });
      return map;
    });
    // Rebuild sections
    const allRecords = Array.from(recordMap.values()).map(r =>
      r.id === recordId ? { ...r, ...updates } : r
    );
    buildSections(allRecords, setSections);
  };

  const handleConfirmMatch = (record: ReviewRecord) => {
    updateRecord(record.id, { status: 'present' });
  };

  const handleMarkAbsent = (record: ReviewRecord) => {
    updateRecord(record.id, { status: 'absent' });
  };

  const handleChangeStudent = (record: ReviewRecord) => {
    if (!classId) return;
    const enrolled = allStudents.filter(s => s.isEnrolled);
    Alert.alert(
      'Assign to Student',
      'Select the correct student for this face:',
      [
        ...enrolled.map(s => ({
          text: `${s.name} (${s.rollNumber})`,
          onPress: () => updateRecord(record.id, { studentId: s.id, studentName: s.name, status: 'present' }),
        })),
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleConfirmAll = async () => {
    setSaving(true);
    try {
      const database = await db.getDb();
      const records = Array.from(recordMap.values());
      await database.withTransactionAsync(async () => {
        for (const r of records) {
          await database.runAsync(
            'UPDATE attendance_records SET student_id = ?, status = ? WHERE id = ?',
            [r.studentId ?? null, r.status, r.id]
          );
        }
      });
      Alert.alert('Attendance Saved', 'Attendance has been confirmed and saved.', [
        { text: 'OK', onPress: () => router.replace('/') },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  const renderRecord = ({ item }: { item: ReviewRecord }) => {
    const record = recordMap.get(item.id) ?? item;
    const statusColor = record.status === 'present' ? Colors.present
      : record.status === 'uncertain' ? Colors.uncertain
      : record.status === 'absent' ? Colors.absent
      : Colors.unknown;

    return (
      <View style={styles.recordRow} id={`record-${record.id}`}>
        <View style={[styles.recordAvatar, { backgroundColor: statusColor + '20', borderColor: statusColor + '40' }]}>
          <Text style={styles.recordAvatarText}>
            {record.studentName ? record.studentName.charAt(0).toUpperCase() : '?'}
          </Text>
        </View>
        <View style={styles.recordInfo}>
          <Text style={styles.recordName}>{record.studentName ?? 'Unknown Face'}</Text>
          {record.confidence != null && (
            <Text style={styles.recordConfidence}>
              Confidence: {(record.confidence * 100).toFixed(0)}%
            </Text>
          )}
        </View>
        <View style={styles.recordActions}>
          {record.status === 'uncertain' && (
            <>
              <TouchableOpacity
                id={`btn-confirm-${record.id}`}
                style={styles.actionBtn}
                onPress={() => handleConfirmMatch(record)}
              >
                <Ionicons name="checkmark" size={18} color={Colors.success} />
              </TouchableOpacity>
              <TouchableOpacity
                id={`btn-change-${record.id}`}
                style={[styles.actionBtn, styles.actionBtnWarn]}
                onPress={() => handleChangeStudent(record)}
              >
                <Ionicons name="pencil" size={16} color={Colors.warning} />
              </TouchableOpacity>
            </>
          )}
          {record.status === 'unknown' && (
            <>
              <TouchableOpacity
                id={`btn-assign-${record.id}`}
                style={[styles.actionBtn, styles.actionBtnWarn]}
                onPress={() => handleChangeStudent(record)}
              >
                <Text style={styles.actionBtnText}>Assign</Text>
              </TouchableOpacity>
            </>
          )}
          {(record.status === 'present' || record.status === 'uncertain') && (
            <TouchableOpacity
              id={`btn-absent-${record.id}`}
              style={[styles.actionBtn, styles.actionBtnDanger]}
              onPress={() => handleMarkAbsent(record)}
            >
                <Ionicons name="close" size={18} color={Colors.danger} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const renderSectionHeader = ({ section }: { section: SectionData }) => {
    if (section.data.length === 0) return null;
    return (
      <View style={[styles.sectionHeader, { borderColor: section.color + '30' }]}>
        <Ionicons name={section.icon} size={17} color={section.color} />
        <Text style={[styles.sectionTitle, { color: section.color }]}>
          {section.title} ({section.data.length})
        </Text>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      </SafeAreaView>
    );
  }

  const allRecords = Array.from(recordMap.values());
  const presentCount = allRecords.filter(r => r.status === 'present').length;
  const uncertainCount = allRecords.filter(r => r.status === 'uncertain').length;

  return (
    <SafeAreaView style={styles.container}>
      {/* Summary bar */}
      <View style={styles.summaryBar}>
        <SummaryPill label="Present" count={presentCount} color={Colors.present} />
        <SummaryPill label="Uncertain" count={uncertainCount} color={Colors.uncertain} />
        <SummaryPill
          label="Absent"
          count={allRecords.filter(r => r.status === 'absent').length}
          color={Colors.absent}
        />
      </View>

      {uncertainCount > 0 && (
        <View style={styles.reviewNote}>
          <Ionicons name="alert-circle" size={18} color={Colors.warning} />
          <Text style={styles.reviewNoteText}>{uncertainCount} face{uncertainCount > 1 ? 's need' : ' needs'} your review before confirming</Text>
        </View>
      )}

      <SectionList
        sections={sections.filter(s => s.data.length > 0)}
        keyExtractor={item => item.id.toString()}
        renderItem={renderRecord}
        renderSectionHeader={renderSectionHeader}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
      />

      {/* Confirm button */}
      <View style={styles.footer}>
        <TouchableOpacity
          id="btn-confirm-attendance"
          style={[styles.confirmButton, saving && styles.confirmButtonDisabled]}
          onPress={handleConfirmAll}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <><Text style={styles.confirmButtonText}>Confirm attendance</Text><Ionicons name="checkmark-circle" size={19} color={Colors.textOnPrimary} /></>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function SummaryPill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <View style={[pillStyles.pill, { borderColor: color + '40' }]}>
      <Text style={[pillStyles.count, { color }]}>{count}</Text>
      <Text style={pillStyles.label}>{label}</Text>
    </View>
  );
}

const pillStyles = StyleSheet.create({
  pill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    backgroundColor: Colors.bgCard,
  },
  count: { ...Typography.heading3, fontWeight: '700' },
  label: { ...Typography.caption, color: Colors.textMuted },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  summaryBar: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.md,
    paddingTop: 0,
  },
  reviewNote: {
    marginHorizontal: Spacing.md,
    backgroundColor: Colors.warningBg,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.warning + '40',
    marginBottom: Spacing.xs,
    flexDirection: 'row',
    gap: Spacing.xs,
    alignItems: 'center',
  },
  reviewNoteText: { ...Typography.bodySmall, color: Colors.warning, textAlign: 'center', flex: 1 },
  list: { padding: Spacing.md, paddingBottom: 100 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderBottomWidth: 1,
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },
  sectionTitle: { ...Typography.label },
  recordRow: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    padding: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  recordAvatar: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginRight: Spacing.sm,
  },
  recordAvatarText: { ...Typography.body, fontWeight: '700', color: Colors.textPrimary },
  recordInfo: { flex: 1 },
  recordName: { ...Typography.body, color: Colors.textPrimary, fontWeight: '600' },
  recordConfidence: { ...Typography.caption, color: Colors.textMuted },
  recordActions: { flexDirection: 'row', gap: Spacing.xs },
  actionBtn: {
    backgroundColor: Colors.successBg,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.success + '40',
  },
  actionBtnWarn: { backgroundColor: Colors.warningBg, borderColor: Colors.warning + '40' },
  actionBtnDanger: { backgroundColor: Colors.dangerBg, borderColor: Colors.danger + '40' },
  actionBtnText: { ...Typography.bodySmall, color: Colors.warning, fontWeight: '700' },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: Spacing.lg,
    backgroundColor: Colors.bg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  confirmButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  confirmButtonDisabled: { opacity: 0.5, shadowOpacity: 0 },
  confirmButtonText: { ...Typography.heading3, color: Colors.textOnPrimary },
});
