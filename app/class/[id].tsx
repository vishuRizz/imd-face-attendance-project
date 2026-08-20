import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getClassById, getStudentsForClass, deleteStudent, deleteClass, getAttendanceHistory, type StudentWithEmbeddings, type AttendanceWithRecords } from '@/lib/database/db';
import type { Class } from '@/lib/database/schema';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';

const todayKey = () => new Date().toISOString().slice(0, 10);

export default function ClassScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const classId = Number(id);
  const router = useRouter();
  const navigation = useNavigation();
  const [cls, setCls] = useState<Class | null>(null);
  const [students, setStudents] = useState<StudentWithEmbeddings[]>([]);
  const [history, setHistory] = useState<AttendanceWithRecords[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [classData, studentData, historyData] = await Promise.all([getClassById(classId), getStudentsForClass(classId), getAttendanceHistory(classId)]);
      setCls(classData); setStudents(studentData); setHistory(historyData);
      navigation.setOptions({ title: classData.name });
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
  }, [classId, navigation]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const removeStudent = (student: StudentWithEmbeddings) => Alert.alert('Remove student?', `${student.name}'s face data will also be removed.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => { await deleteStudent(student.id); setStudents(current => current.filter(item => item.id !== student.id)); } },
  ]);

  const removeClass = () => Alert.alert('Delete class?', `This will remove ${cls?.name}, its students, and all attendance history.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete class', style: 'destructive', onPress: async () => { await deleteClass(classId); router.replace('/'); } },
  ]);

  const enrolledCount = students.filter(student => student.isEnrolled).length;
  const todaysAttendance = history.find(session => session.date === todayKey());
  const previousSessions = history.filter(session => session.id !== todaysAttendance?.id);
  const canScan = enrolledCount > 0;

  const renderStudent = ({ item }: { item: StudentWithEmbeddings }) => (
    <View style={styles.studentRow} id={`student-${item.id}`}>
      <View style={[styles.avatar, !item.isEnrolled && styles.avatarPending]}><Text style={[styles.avatarText, !item.isEnrolled && styles.avatarTextPending]}>{item.name.charAt(0).toUpperCase()}</Text></View>
      <View style={styles.studentCopy}><Text style={styles.studentName}>{item.name}</Text><Text style={styles.studentRoll}>Roll no. {item.rollNumber}</Text></View>
      {item.isEnrolled ? <View style={styles.readyBadge}><Ionicons name="checkmark" size={13} color={Colors.success} /><Text style={styles.readyText}>Ready</Text></View> : <TouchableOpacity id={`btn-enroll-${item.id}`} style={styles.enrollButton} onPress={() => router.push(`/student/${item.id}/enroll`)}><Text style={styles.enrollText}>Enroll</Text></TouchableOpacity>}
      <TouchableOpacity id={`btn-delete-student-${item.id}`} style={styles.deleteButton} onPress={() => removeStudent(item)}><Ionicons name="ellipsis-horizontal" size={19} color={Colors.textMuted} /></TouchableOpacity>
    </View>
  );

  if (loading) return <SafeAreaView style={styles.container}><View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View></SafeAreaView>;

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={students}
        keyExtractor={item => item.id.toString()}
        renderItem={renderStudent}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<>
          <View style={styles.hero}>
            <View style={styles.heroTop}><View style={styles.monogram}><Text style={styles.monogramText}>{cls?.name.slice(0, 2).toUpperCase()}</Text></View><View style={styles.heroCopy}><Text style={styles.heroTitle}>{cls?.name}</Text><Text style={styles.heroSubtitle}>{cls?.section}{cls?.semester ? ` · ${cls.semester}` : ''}</Text></View></View>
            <View style={styles.heroMeta}><View style={styles.heroMetaItem}><Ionicons name="people-outline" size={15} color="#C9E6D0" /><Text style={styles.heroMetaText}>{students.length} students</Text></View><View style={styles.heroMetaDot} /><View style={styles.heroMetaItem}><Ionicons name="scan-outline" size={15} color="#C9E6D0" /><Text style={styles.heroMetaText}>{enrolledCount} ready</Text></View></View>
          </View>

          <Text style={styles.sectionLabel}>TODAY</Text>
          {todaysAttendance ? (
            <TouchableOpacity id="btn-view-todays-attendance" style={styles.attendanceCard} onPress={() => router.push(`/attendance/review/${todaysAttendance.id}`)} activeOpacity={0.82}>
              <View style={styles.attendanceIcon}><Ionicons name="checkmark" size={20} color={Colors.success} /></View>
              <View style={styles.attendanceCopy}><Text style={styles.attendanceEyebrow}>ATTENDANCE RECORDED</Text><Text style={styles.attendanceTitle}>{todaysAttendance.presentCount} present <Text style={styles.attendanceMuted}>of {enrolledCount} enrolled</Text></Text>{todaysAttendance.uncertainCount > 0 && <Text style={styles.attendanceReview}>{todaysAttendance.uncertainCount} match{todaysAttendance.uncertainCount > 1 ? 'es' : ''} need review</Text>}</View>
              <Ionicons name="chevron-forward" size={20} color={Colors.primary} />
            </TouchableOpacity>
          ) : (
            <View style={styles.emptyAttendance}><View style={styles.attendanceIcon}><Ionicons name="calendar-outline" size={20} color={Colors.primary} /></View><View><Text style={styles.attendanceTitle}>Not marked yet</Text><Text style={styles.emptyAttendanceText}>Start when your class is ready.</Text></View></View>
          )}

          <TouchableOpacity id="btn-scan-attendance" style={[styles.scanButton, !canScan && styles.scanButtonDisabled]} onPress={() => canScan && router.push(`/attendance/scan/${classId}`)} disabled={!canScan} activeOpacity={0.85}>
            <Ionicons name="scan-outline" size={21} color={Colors.textOnPrimary} /><Text style={styles.scanText}>{todaysAttendance ? 'Take another scan' : 'Start attendance scan'}</Text>
          </TouchableOpacity>
          {!canScan && <Text style={styles.disabledHint}>Enroll at least one student before scanning.</Text>}
          <TouchableOpacity id="btn-add-student" style={styles.addStudentButton} onPress={() => router.push({ pathname: '/student/add', params: { classId: classId.toString() } })}><Ionicons name="person-add-outline" size={18} color={Colors.primary} /><Text style={styles.addStudentText}>Add student</Text></TouchableOpacity>

          <View style={styles.studentsHeading}><Text style={styles.sectionLabel}>STUDENTS</Text><Text style={styles.studentCount}>{students.length}</Text></View>
        </>}
        ListEmptyComponent={<View style={styles.emptyStudents}><Ionicons name="people-outline" size={28} color={Colors.primary} /><Text style={styles.emptyStudentsTitle}>No students added</Text><Text style={styles.emptyStudentsText}>Add students to begin enrollment.</Text></View>}
        ListFooterComponent={<View style={styles.footer}>
          {previousSessions.length > 0 && <View style={styles.history}><Text style={styles.sectionLabel}>PREVIOUS ATTENDANCE</Text>{previousSessions.map(session => <TouchableOpacity key={session.id} style={styles.historyRow} onPress={() => router.push(`/attendance/review/${session.id}`)}><View><Text style={styles.historyDate}>{new Date(`${session.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</Text><Text style={styles.historyStats}>{session.presentCount} present · {session.absentCount} absent</Text></View><Ionicons name="chevron-forward" size={18} color={Colors.textMuted} /></TouchableOpacity>)}</View>}
          <TouchableOpacity id="btn-delete-class" style={styles.deleteClassButton} onPress={removeClass}><Text style={styles.deleteClassText}>Delete class</Text></TouchableOpacity>
        </View>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, list: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  hero: { backgroundColor: '#173C27', borderRadius: Radius.xl, padding: Spacing.md, marginBottom: Spacing.xl }, heroTop: { flexDirection: 'row', alignItems: 'center' }, monogram: { width: 52, height: 52, borderRadius: 16, backgroundColor: '#E5F5D7', justifyContent: 'center', alignItems: 'center' }, monogramText: { ...Typography.heading3, color: Colors.primaryDark }, heroCopy: { flex: 1, marginLeft: 12 }, heroTitle: { ...Typography.heading3, color: '#FFFFFF' }, heroSubtitle: { ...Typography.bodySmall, color: '#C9E6D0', marginTop: 3 }, heroMeta: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.14)' }, heroMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 }, heroMetaText: { ...Typography.caption, color: '#C9E6D0', fontWeight: '700' }, heroMetaDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#83B894', marginHorizontal: 10 },
  sectionLabel: { ...Typography.label, color: Colors.textMuted, marginBottom: Spacing.sm }, attendanceCard: { backgroundColor: Colors.successBg, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.success + '45', flexDirection: 'row', alignItems: 'center' }, emptyAttendance: { backgroundColor: Colors.bgCard, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, flexDirection: 'row', alignItems: 'center' }, attendanceIcon: { width: 42, height: 42, borderRadius: Radius.full, backgroundColor: Colors.bgCard, alignItems: 'center', justifyContent: 'center', marginRight: 12 }, attendanceCopy: { flex: 1 }, attendanceEyebrow: { ...Typography.label, color: Colors.success, marginBottom: 3 }, attendanceTitle: { ...Typography.body, color: Colors.textPrimary, fontWeight: '800' }, attendanceMuted: { color: Colors.textSecondary, fontWeight: '400' }, attendanceReview: { ...Typography.caption, color: Colors.warning, fontWeight: '700', marginTop: 3 }, emptyAttendanceText: { ...Typography.caption, color: Colors.textSecondary, marginTop: 3 },
  scanButton: { backgroundColor: Colors.primary, minHeight: 54, marginTop: Spacing.sm, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, shadowColor: Colors.primaryDark, shadowOpacity: 0.18, shadowOffset: { width: 0, height: 6 }, shadowRadius: 10, elevation: 4 }, scanButtonDisabled: { opacity: 0.42, shadowOpacity: 0 }, scanText: { ...Typography.heading3, color: Colors.textOnPrimary }, disabledHint: { ...Typography.caption, color: Colors.textMuted, textAlign: 'center', marginTop: 7 }, addStudentButton: { minHeight: 46, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.primary + '55', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, marginTop: Spacing.sm }, addStudentText: { ...Typography.bodySmall, color: Colors.primary, fontWeight: '800' },
  studentsHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.xl }, studentCount: { ...Typography.caption, color: Colors.primary, fontWeight: '800', backgroundColor: Colors.primaryLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full, marginBottom: Spacing.sm }, studentRow: { backgroundColor: Colors.bgCard, minHeight: 66, borderRadius: Radius.md, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.xs, borderWidth: 1, borderColor: Colors.border }, avatar: { width: 38, height: 38, borderRadius: Radius.full, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' }, avatarPending: { backgroundColor: '#FFF1CF' }, avatarText: { ...Typography.bodySmall, color: Colors.primaryDark, fontWeight: '800' }, avatarTextPending: { color: Colors.accentDark }, studentCopy: { flex: 1, marginLeft: 10 }, studentName: { ...Typography.bodySmall, color: Colors.textPrimary, fontWeight: '800' }, studentRoll: { ...Typography.caption, color: Colors.textMuted, marginTop: 2 }, readyBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.successBg, borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 4 }, readyText: { ...Typography.caption, color: Colors.success, fontWeight: '800' }, enrollButton: { backgroundColor: Colors.primaryLight, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 6 }, enrollText: { ...Typography.caption, color: Colors.primaryDark, fontWeight: '800' }, deleteButton: { padding: 8, marginLeft: 2 },
  emptyStudents: { backgroundColor: Colors.bgCard, borderRadius: Radius.lg, padding: Spacing.xl, alignItems: 'center', borderWidth: 1, borderColor: Colors.border }, emptyStudentsTitle: { ...Typography.body, color: Colors.textPrimary, fontWeight: '800', marginTop: Spacing.sm }, emptyStudentsText: { ...Typography.bodySmall, color: Colors.textSecondary, marginTop: 3 }, footer: { paddingTop: Spacing.xl }, history: { marginBottom: Spacing.lg }, historyRow: { backgroundColor: Colors.bgCard, borderRadius: Radius.md, padding: Spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.xs }, historyDate: { ...Typography.bodySmall, color: Colors.textPrimary, fontWeight: '800' }, historyStats: { ...Typography.caption, color: Colors.textSecondary, marginTop: 3 }, deleteClassButton: { alignItems: 'center', paddingVertical: Spacing.md, marginTop: Spacing.lg }, deleteClassText: { ...Typography.bodySmall, color: Colors.danger, fontWeight: '700' },
});
