import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import {
  getClassById,
  getStudentsForClass,
  deleteStudent,
  deleteClass,
  type StudentWithEmbeddings,
} from '@/lib/database/db';
import type { Class } from '@/lib/database/schema';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';

export default function ClassScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const classId = Number(id);
  const router = useRouter();
  const navigation = useNavigation();

  const [cls, setCls] = useState<Class | null>(null);
  const [students, setStudents] = useState<StudentWithEmbeddings[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [classData, studentData] = await Promise.all([
        getClassById(classId),
        getStudentsForClass(classId),
      ]);
      setCls(classData);
      setStudents(studentData);
      navigation.setOptions({ title: classData.name });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleDeleteStudent = (student: StudentWithEmbeddings) => {
    Alert.alert(
      'Delete Student',
      `Remove ${student.name} from this class? This also deletes their face data.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteStudent(student.id);
            setStudents(prev => prev.filter(s => s.id !== student.id));
          },
        },
      ]
    );
  };

  const handleDeleteClass = () => {
    Alert.alert(
      'Delete Class',
      `Delete "${cls?.name}"? All students and attendance records will be permanently removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteClass(classId);
            router.replace('/');
          },
        },
      ]
    );
  };

  const enrolledCount = students.filter(s => s.isEnrolled).length;
  const canScan = enrolledCount > 0;

  const renderStudent = ({ item }: { item: StudentWithEmbeddings }) => (
    <View style={styles.studentCard} id={`student-${item.id}`}>
      <View style={styles.studentAvatar}>
        <Text style={styles.studentAvatarText}>{item.name.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.studentInfo}>
        <Text style={styles.studentName}>{item.name}</Text>
        <Text style={styles.studentRoll}>Roll #{item.rollNumber}</Text>
      </View>
      <View style={styles.studentActions}>
        {item.isEnrolled ? (
          <View style={styles.enrolledBadge}>
            <Text style={styles.enrolledBadgeText}>✓ Enrolled</Text>
          </View>
        ) : (
          <TouchableOpacity
            id={`btn-enroll-${item.id}`}
            style={styles.enrollButton}
            onPress={() => router.push(`/student/${item.id}/enroll`)}
          >
            <Text style={styles.enrollButtonText}>Enroll</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          id={`btn-delete-student-${item.id}`}
          onPress={() => handleDeleteStudent(item)}
          style={styles.deleteIcon}
        >
          <Text style={styles.deleteIconText}>🗑</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={students}
        keyExtractor={item => item.id.toString()}
        renderItem={renderStudent}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            {/* Stats bar */}
            <View style={styles.statsRow}>
              <StatCard label="Students" value={students.length} color={Colors.primary} />
              <StatCard label="Enrolled" value={enrolledCount} color={Colors.accent} />
              <StatCard label="Pending" value={students.length - enrolledCount} color={Colors.warning} />
            </View>

            {/* Action buttons */}
            <TouchableOpacity
              id="btn-scan-attendance"
              style={[styles.scanButton, !canScan && styles.scanButtonDisabled]}
              onPress={() => canScan && router.push(`/attendance/scan/${classId}`)}
              disabled={!canScan}
              activeOpacity={0.85}
            >
              <Text style={styles.scanButtonIcon}>📷</Text>
              <Text style={styles.scanButtonText}>Scan Attendance</Text>
            </TouchableOpacity>

            {!canScan && (
              <Text style={styles.scanHint}>Enroll at least one student to enable scanning</Text>
            )}

            <Text style={styles.sectionLabel}>STUDENTS ({students.length})</Text>
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>👤</Text>
            <Text style={styles.emptyText}>No students yet</Text>
            <Text style={styles.emptySubtext}>Add your first student below</Text>
          </View>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <TouchableOpacity
              id="btn-delete-class"
              style={styles.dangerButton}
              onPress={handleDeleteClass}
            >
              <Text style={styles.dangerButtonText}>Delete Class</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* Add Student FAB */}
      <TouchableOpacity
        id="fab-add-student"
        style={styles.fab}
        onPress={() => router.push({ pathname: '/student/add', params: { classId: classId.toString() } })}
        activeOpacity={0.85}
      >
        <Text style={styles.fabText}>+ Add Student</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[statStyles.card, { borderColor: color + '30' }]}>
      <Text style={[statStyles.value, { color }]}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}

const statStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
  },
  value: { ...Typography.heading2, fontWeight: '700' },
  label: { ...Typography.caption, color: Colors.textMuted, marginTop: 2 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: Spacing.lg, paddingBottom: 100 },
  statsRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  scanButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  scanButtonDisabled: { opacity: 0.4, shadowOpacity: 0 },
  scanButtonIcon: { fontSize: 18 },
  scanButtonText: { ...Typography.heading3, color: Colors.textOnPrimary },
  scanHint: {
    ...Typography.caption,
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  sectionLabel: { ...Typography.label, color: Colors.textMuted, marginTop: Spacing.md, marginBottom: Spacing.sm },
  studentCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  studentAvatar: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.primary + '40',
  },
  studentAvatarText: { ...Typography.body, color: Colors.primary, fontWeight: '700' },
  studentInfo: { flex: 1, marginLeft: Spacing.sm },
  studentName: { ...Typography.body, color: Colors.textPrimary, fontWeight: '600' },
  studentRoll: { ...Typography.caption, color: Colors.textMuted },
  studentActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  enrolledBadge: {
    backgroundColor: Colors.successBg,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.success + '40',
  },
  enrolledBadgeText: { ...Typography.caption, color: Colors.success, fontWeight: '600' },
  enrollButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  enrollButtonText: { ...Typography.caption, color: Colors.textOnPrimary, fontWeight: '700' },
  deleteIcon: { padding: Spacing.xs },
  deleteIconText: { fontSize: 16 },
  empty: { alignItems: 'center', paddingVertical: Spacing.xl },
  emptyIcon: { fontSize: 48, marginBottom: Spacing.sm },
  emptyText: { ...Typography.heading3, color: Colors.textSecondary },
  emptySubtext: { ...Typography.bodySmall, color: Colors.textMuted },
  footer: { paddingTop: Spacing.xl },
  dangerButton: {
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.danger + '50',
  },
  dangerButtonText: { ...Typography.body, color: Colors.danger, fontWeight: '600' },
  fab: {
    position: 'absolute',
    bottom: Spacing.xl,
    left: Spacing.lg,
    right: Spacing.lg,
    backgroundColor: Colors.accent,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  fabText: { ...Typography.heading3, color: '#0D0D1A' },
});
