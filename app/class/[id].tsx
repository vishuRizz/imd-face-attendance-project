import React, { useCallback, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  deleteClass,
  deleteStudent,
  getAttendanceHistory,
  getClassById,
  getStudentsForClass,
  localDateKey,
  type AttendanceWithRecords,
  type StudentWithEmbeddings,
} from '@/lib/database/db';
import type { Class } from '@/lib/database/schema';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
import { Avatar, Badge, Button, EmptyState, IconButton, ProgressBar, Segmented, Sheet, Tap } from '@/components/kit';

type Tab = 'students' | 'history';

export default function ClassScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const classId = Number(id);
  const router = useRouter();
  const navigation = useNavigation();
  const [cls, setCls] = useState<Class | null>(null);
  const [students, setStudents] = useState<StudentWithEmbeddings[]>([]);
  const [history, setHistory] = useState<AttendanceWithRecords[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('students');
  const [selected, setSelected] = useState<StudentWithEmbeddings | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, s, h] = await Promise.all([getClassById(classId), getStudentsForClass(classId), getAttendanceHistory(classId)]);
      setCls(c); setStudents(s); setHistory(h);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [classId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const confirmDeleteClass = useCallback(() => {
    Alert.alert('Delete this class?', 'Students, face data and attendance history for this class will be permanently removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteClass(classId); router.replace('/'); } },
    ]);
  }, [classId, router]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <IconButton icon="person-add-outline" size={38} accessibilityLabel="Add students" onPress={() => router.push({ pathname: '/student/add', params: { classId: String(classId) } })} />
          <IconButton icon="trash-outline" size={38} accessibilityLabel="Delete class" onPress={confirmDeleteClass} />
        </View>
      ),
    });
  }, [navigation, router, classId, confirmDeleteClass]);

  const enrolled = students.filter(s => s.isEnrolled);
  const pending = students.filter(s => !s.isEnrolled);
  const today = history.find(h => h.date === localDateKey());
  const canScan = enrolled.length > 0;

  const startEnrollQueue = () => {
    if (pending[0]) router.push({ pathname: '/student/[id]/enroll', params: { id: String(pending[0].id), queue: '1' } });
  };

  const removeStudent = (s: StudentWithEmbeddings) => {
    setSelected(null);
    Alert.alert(`Remove ${s.name}?`, 'Their face data and attendance entries will be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { await deleteStudent(s.id); load(); } },
    ]);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;

  const header = (
    <View>
      <Text style={styles.title}>{cls?.name}</Text>
      <Text style={styles.subtitle}>{[cls?.section, cls?.semester].filter(Boolean).join(' · ') || `${students.length} students`}</Text>

      <View style={styles.stats}>
        <Stat value={students.length} label="Students" />
        <Stat value={enrolled.length} label="Face ready" />
        <Stat value={today ? today.presentCount : '—'} label="Present today" accent={!!today} />
      </View>

      <Button
        title={today ? 'Scan again' : 'Take attendance'}
        icon="scan"
        onPress={() => router.push(`/attendance/scan/${classId}`)}
        disabled={!canScan}
        style={{ marginTop: Spacing.lg }}
      />
      {today && (
        <Tap style={styles.todayRow} onPress={() => router.push(`/attendance/review/${today.id}`)}>
          <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
          <Text style={styles.todayText}>Today’s attendance saved · {today.presentCount} present{today.uncertainCount ? ` · ${today.uncertainCount} to review` : ''}</Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
        </Tap>
      )}
      {!canScan && students.length > 0 && <Text style={styles.hint}>Set up at least one student’s face to start scanning.</Text>}

      {pending.length > 0 && (
        <Tap style={styles.setupCard} onPress={startEnrollQueue}>
          <View style={styles.setupIcon}><Ionicons name="happy-outline" size={22} color="#000" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.setupTitle}>{pending.length} student{pending.length > 1 ? 's' : ''} need face setup</Text>
            <Text style={styles.setupSub}>
              {pending.some(p => p.photoUri)
                ? 'The face engine was upgraded for better accuracy — a quick re-capture is needed. Hands-free, ~10s each.'
                : 'Hands-free, about 10 seconds each. We’ll go one after another.'}
            </Text>
          </View>
          <Ionicons name="arrow-forward" size={20} color="#000" />
        </Tap>
      )}

      <View style={{ marginTop: Spacing.xl, marginBottom: Spacing.md }}>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[{ value: 'students', label: 'Students', count: students.length }, { value: 'history', label: 'History', count: history.length }]}
        />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {tab === 'students' ? (
        <FlatList
          data={students}
          keyExtractor={s => String(s.id)}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          renderItem={({ item }) => (
            <Tap style={styles.row} scaleTo={0.985} onPress={() => (item.isEnrolled ? setSelected(item) : router.push(`/student/${item.id}/enroll`))}>
              <Avatar name={item.name} uri={item.photoUri} seed={item.id} size={46} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.rowSub}>Roll {item.rollNumber}</Text>
              </View>
              {item.isEnrolled ? <Badge tone="success" icon="checkmark" label="Ready" /> : <Badge tone="warning" label="Set up face" />}
            </Tap>
          )}
          ListEmptyComponent={
            <EmptyState icon="people-outline" title="No students yet" body="Add students one by one or paste your roster.">
              <Button title="Add students" icon="person-add-outline" onPress={() => router.push({ pathname: '/student/add', params: { classId: String(classId) } })} style={{ alignSelf: 'stretch' }} />
            </EmptyState>
          }
        />
      ) : (
        <FlatList
          data={history}
          keyExtractor={h => String(h.id)}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          renderItem={({ item }) => {
            const total = item.presentCount + item.absentCount + item.uncertainCount;
            return (
              <Tap style={styles.historyRow} scaleTo={0.985} onPress={() => router.push(`/attendance/review/${item.id}`)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{new Date(`${item.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</Text>
                  <Text style={styles.rowSub}>{item.presentCount} present · {item.absentCount} absent{item.uncertainCount ? ` · ${item.uncertainCount} review` : ''}</Text>
                  <View style={{ marginTop: 10 }}><ProgressBar value={total ? item.presentCount / total : 0} /></View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} style={{ marginLeft: 12 }} />
              </Tap>
            );
          }}
          ListEmptyComponent={<EmptyState icon="calendar-outline" title="No attendance yet" body="Your scans will show up here." />}
        />
      )}

      <Sheet visible={!!selected} onClose={() => setSelected(null)}>
        {selected && (
          <View>
            <View style={styles.sheetHead}>
              <Avatar name={selected.name} uri={selected.photoUri} seed={selected.id} size={64} />
              <View style={{ marginLeft: 14, flex: 1 }}>
                <Text style={styles.sheetName}>{selected.name}</Text>
                <Text style={styles.rowSub}>Roll {selected.rollNumber}{selected.studentId ? ` · ${selected.studentId}` : ''}</Text>
              </View>
            </View>
            <Button title="Redo face setup" icon="refresh" variant="secondary" onPress={() => { const s = selected; setSelected(null); router.push(`/student/${s.id}/enroll`); }} />
            <Button title="Remove student" icon="trash-outline" variant="ghost" onPress={() => removeStudent(selected)} style={{ marginTop: 6 }} />
          </View>
        )}
      </Sheet>
    </SafeAreaView>
  );
}

function Stat({ value, label, accent }: { value: number | string; label: string; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, accent && { color: Colors.success }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg },
  list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl },
  title: { ...Typography.heading1, color: Colors.textPrimary },
  subtitle: { ...Typography.body, color: Colors.textSecondary, marginTop: 2 },
  stats: { flexDirection: 'row', gap: 10, marginTop: Spacing.lg },
  stat: { flex: 1, backgroundColor: Colors.bgElevated, borderRadius: Radius.md, paddingVertical: 14, paddingHorizontal: 12 },
  statValue: { fontSize: 24, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.6 },
  statLabel: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  hint: { ...Typography.caption, color: Colors.textMuted, textAlign: 'center', marginTop: 8 },
  todayRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 4 },
  todayText: { ...Typography.bodySmall, color: Colors.textPrimary, fontWeight: '600', flex: 1 },
  setupCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFF4E0', borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md },
  setupIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.uncertain, alignItems: 'center', justifyContent: 'center' },
  setupTitle: { ...Typography.bodyStrong, color: Colors.textPrimary },
  setupSub: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  rowText: { flex: 1, marginLeft: 14, marginRight: 8 },
  rowTitle: { ...Typography.bodyStrong, color: Colors.textPrimary },
  rowSub: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  historyRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bgElevated, borderRadius: Radius.md, padding: Spacing.md, marginBottom: 10 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.lg },
  sheetName: { ...Typography.heading2, color: Colors.textPrimary },
});
