import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import {
  deleteAttendanceRecords,
  deleteAttendanceSession,
  getAttendanceSession,
  getClassById,
  getStudentsForClass,
  updateAttendanceRecords,
  type SessionRecord,
  type StudentWithEmbeddings,
} from '@/lib/database/db';
import type { AttendanceStatus } from '@/lib/database/schema';
import { learnFromSession } from '@/lib/ml/adaptive';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
import { Avatar, Button, IconButton, ProgressBar, Segmented, Sheet, StudentPicker, Tap } from '@/components/kit';

type Filter = 'all' | 'present' | 'absent' | 'check';

const strength = (c?: number) => (c == null ? undefined : c >= 0.6 ? 'Strong match' : c >= 0.45 ? 'Good match' : 'Weak match');

export default function ReviewScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [classId, setClassId] = useState<number | null>(null);
  const initial = useRef(new Map<number, { status: string; studentId?: number | null }>());
  const [removed, setRemoved] = useState<number[]>([]);
  const [students, setStudents] = useState<StudentWithEmbeddings[]>([]);
  const [className, setClassName] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [compare, setCompare] = useState<SessionRecord | null>(null);
  const [assigning, setAssigning] = useState<SessionRecord | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { session, records: recs } = await getAttendanceSession(Number(sessionId));
        const [cls, studs] = await Promise.all([getClassById(session.classId), getStudentsForClass(session.classId)]);
        setRecords(recs);
        setClassId(session.classId);
        initial.current = new Map(recs.map(r => [r.id, { status: r.status, studentId: r.studentId }]));
        setStudents(studs);
        setClassName(cls.name);
        setDate(session.date);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [sessionId]);

  const byStudent = useMemo(() => new Map(students.map(s => [s.id, s])), [students]);
  const people = records.filter(r => r.studentId != null && !removed.includes(r.id));
  const unknown = records.filter(r => r.status === 'unknown' && r.studentId == null && !removed.includes(r.id));
  const present = people.filter(r => r.status === 'present');
  const absent = people.filter(r => r.status === 'absent');
  const check = people.filter(r => r.status === 'uncertain');

  const visible = useMemo(() => {
    const order: Record<string, number> = { uncertain: 0, present: 1, absent: 2 };
    const list = filter === 'present' ? present : filter === 'absent' ? absent : filter === 'check' ? check : people;
    return [...list].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || (a.studentName ?? '').localeCompare(b.studentName ?? ''));
  }, [filter, people, present, absent, check]);

  const setStatus = (rec: SessionRecord, status: AttendanceStatus) => {
    Haptics.selectionAsync().catch(() => {});
    setRecords(rs => rs.map(r => (r.id === rec.id ? { ...r, status } : r)));
    setDirty(true);
  };

  /** Assign an unknown face to a student (replaces that student's absent row). */
  const assignTo = (rec: SessionRecord, studentId: number) => {
    const s = byStudent.get(studentId);
    const existing = records.find(r => r.studentId === studentId && r.id !== rec.id && !removed.includes(r.id));
    if (existing) setRemoved(x => [...x, existing.id]);
    setRecords(rs => rs.map(r => (r.id === rec.id
      ? { ...r, studentId, status: 'present' as const, studentName: s?.name, rollNumber: s?.rollNumber, studentPhotoUri: s?.photoUri }
      : r)));
    setDirty(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  const save = async () => {
    setSaving(true);
    try {
      await deleteAttendanceRecords(removed);
      const final = records.filter(r => !removed.includes(r.id)).map(r => ({
        id: r.id,
        studentId: r.studentId,
        // Anything still unchecked is saved as absent so totals are final.
        status: (r.status === 'uncertain' ? 'absent' : r.status) as AttendanceStatus,
      }));
      await updateAttendanceRecords(final);
      // Learn from what the teacher confirmed (best-effort, never blocks saving).
      if (classId != null) {
        const byId = new Map(records.map(r => [r.id, r]));
        learnFromSession(Number(sessionId), classId, final.map(f => {
          const before = initial.current.get(f.id);
          const rec = byId.get(f.id);
          return {
            ...f,
            confidence: rec?.confidence,
            manual: rec?.manual,
            teacherConfirmed: !!before && (before.status !== 'present' || before.studentId !== f.studentId),
          };
        })).catch(e => __DEV__ && console.warn('[adaptive]', e));
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? 'Please try again.');
      setSaving(false);
    }
  };

  const onSave = () => {
    if (check.length) {
      Alert.alert(`${check.length} still unchecked`, 'Unchecked students will be saved as absent.', [
        { text: 'Review them', style: 'cancel', onPress: () => setFilter('check') },
        { text: 'Save anyway', onPress: save },
      ]);
      return;
    }
    save();
  };

  const share = useCallback(() => {
    const d = new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const line = (r: SessionRecord) => `${r.rollNumber ?? ''} ${r.studentName ?? ''}`.trim();
    const p = people.filter(r => r.status === 'present').sort((a, b) => (a.rollNumber ?? '').localeCompare(b.rollNumber ?? '', undefined, { numeric: true }));
    const a = people.filter(r => r.status !== 'present').sort((x, y) => (x.rollNumber ?? '').localeCompare(y.rollNumber ?? '', undefined, { numeric: true }));
    Share.share({
      message: `${className} — ${d}\nPresent ${p.length}/${people.length}\n\nAbsent (${a.length}):\n${a.map(line).join('\n') || '—'}\n\nPresent (${p.length}):\n${p.map(line).join('\n') || '—'}`,
    }).catch(() => {});
  }, [className, date, people]);

  const confirmDelete = useCallback(() => {
    Alert.alert('Delete this attendance?', 'This scan and its results will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteAttendanceSession(Number(sessionId)); router.back(); } },
    ]);
  }, [router, sessionId]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <IconButton icon="share-outline" size={38} accessibilityLabel="Share attendance" onPress={share} />
          <IconButton icon="trash-outline" size={38} accessibilityLabel="Delete attendance" onPress={confirmDelete} />
        </View>
      ),
    });
  }, [navigation, share, confirmDelete]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;

  const total = people.length;
  const pickable = students.filter(s => s.isEnrolled || people.some(p => p.studentId === s.id));

  const header = (
    <View>
      <Text style={styles.eyebrow}>{className} · {date ? new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }) : ''}</Text>
      <View style={styles.summary}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Text style={styles.big}>{present.length}</Text>
          <Text style={styles.bigOf}> / {total} present</Text>
        </View>
        <View style={{ marginTop: 12 }}><ProgressBar value={total ? present.length / total : 0} height={8} track="rgba(255,255,255,0.2)" /></View>
        <View style={styles.chips}>
          <Text style={styles.chip}>{absent.length} absent</Text>
          {check.length > 0 && <Text style={[styles.chip, { color: Colors.uncertain }]}>{check.length} to check</Text>}
          {unknown.length > 0 && <Text style={styles.chip}>{unknown.length} unrecognised</Text>}
        </View>
      </View>

      {unknown.length > 0 && (
        <View style={{ marginTop: Spacing.lg }}>
          <Text style={styles.sectionTitle}>Unrecognised faces</Text>
          <Text style={styles.sectionSub}>Tap a face to assign it to a student.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 12 }}>
            {unknown.map(u => (
              <Tap key={u.id} onPress={() => setAssigning(u)} style={{ alignItems: 'center' }}>
                <Avatar uri={u.faceImageUri} name="?" size={64} />
                <Text style={styles.assign}>Assign</Text>
              </Tap>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={{ marginTop: Spacing.lg, marginBottom: 8 }}>
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'present', label: 'Present', count: present.length },
            { value: 'absent', label: 'Absent', count: absent.length },
            ...(check.length ? [{ value: 'check' as Filter, label: 'Check', count: check.length }] : []),
          ]}
        />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={visible}
        keyExtractor={r => String(r.id)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={header}
        renderItem={({ item }) => {
          const isPresent = item.status === 'present';
          const isCheck = item.status === 'uncertain';
          return (
            <View style={styles.row}>
              <Tap onPress={() => item.faceImageUri && setCompare(item)} scaleTo={0.92}>
                <Avatar
                  name={item.studentName}
                  uri={item.faceImageUri ?? item.studentPhotoUri}
                  seed={item.studentId}
                  size={48}
                  ring={isPresent ? Colors.accent : isCheck ? Colors.uncertain : undefined}
                />
              </Tap>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.studentName ?? 'Unknown'}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  Roll {item.rollNumber}
                  {isCheck ? ' · Is this them? Tap photo' : item.manual && isPresent ? ' · Marked by you' : item.faceImageUri && isPresent ? ` · ${strength(item.confidence) ?? 'Seen'}` : isPresent ? ' · Marked by you' : ' · Not seen'}
                </Text>
              </View>
              {isCheck ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <IconButton icon="close" size={40} accessibilityLabel="Not them" onPress={() => setStatus(item, 'absent')} />
                  <IconButton icon="checkmark" size={40} variant="primary" accessibilityLabel="Confirm present" onPress={() => setStatus(item, 'present')} />
                </View>
              ) : (
                <Tap
                  onPress={() => setStatus(item, isPresent ? 'absent' : 'present')}
                  style={[styles.toggle, isPresent ? styles.toggleOn : styles.toggleOff]}
                  scaleTo={0.94}
                >
                  <Ionicons name={isPresent ? 'checkmark' : 'close'} size={14} color={isPresent ? '#fff' : Colors.textSecondary} />
                  <Text style={[styles.toggleText, { color: isPresent ? '#fff' : Colors.textSecondary }]}>{isPresent ? 'Present' : 'Absent'}</Text>
                </Tap>
              )}
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>Nobody here.</Text>}
      />

      <View style={styles.footer}>
        <Button title={dirty || check.length ? `Save · ${present.length} present` : `Done · ${present.length} present`} onPress={onSave} loading={saving} />
      </View>

      <Sheet visible={!!compare} onClose={() => setCompare(null)} title={compare?.status === 'uncertain' ? `Is this ${compare?.studentName?.split(' ')[0]}?` : compare?.studentName}>
        {compare && (
          <View>
            <View style={styles.compareRow}>
              <View style={styles.compareCol}>
                <Avatar uri={compare.faceImageUri} name="?" size={120} />
                <Text style={styles.compareLabel}>In this scan</Text>
              </View>
              <View style={styles.compareCol}>
                <Avatar uri={compare.studentPhotoUri} name={compare.studentName} seed={compare.studentId} size={120} />
                <Text style={styles.compareLabel}>Enrolled photo</Text>
              </View>
            </View>
            <Button title="Yes, mark present" icon="checkmark" onPress={() => { setStatus(compare, 'present'); setCompare(null); }} />
            <Button title="Someone else…" variant="secondary" onPress={() => { const c = compare; setCompare(null); setAssigning(c); }} style={{ marginTop: 8 }} />
            <Button title="Not them — absent" variant="ghost" onPress={() => { setStatus(compare, 'absent'); setCompare(null); }} style={{ marginTop: 4 }} />
          </View>
        )}
      </Sheet>

      <StudentPicker
        visible={!!assigning}
        onClose={() => setAssigning(null)}
        faceUri={assigning?.faceImageUri}
        students={pickable.map(s => ({ id: s.id, name: s.name, rollNumber: s.rollNumber, photoUri: s.photoUri }))}
        onPick={s => {
          const rec = assigning!;
          setAssigning(null);
          if (rec.studentId != null && rec.studentId !== s.id) {
            // Wrong match: the face belongs to `s`; the original student goes back to absent.
            const original = rec.studentId;
            setRecords(rs => {
              const target = rs.find(r => r.studentId === s.id && r.id !== rec.id);
              const next = rs.map(r => {
                if (r.id === rec.id) return { ...r, studentId: s.id, status: 'present' as const, studentName: s.name, rollNumber: s.rollNumber, studentPhotoUri: s.photoUri };
                if (target && r.id === target.id) return { ...r, studentId: original, status: 'absent' as const, faceImageUri: undefined, confidence: undefined, studentName: byStudent.get(original)?.name, rollNumber: byStudent.get(original)?.rollNumber, studentPhotoUri: byStudent.get(original)?.photoUri };
                return r;
              });
              return next;
            });
            setDirty(true);
          } else {
            assignTo(rec, s.id);
          }
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg },
  list: { paddingHorizontal: Spacing.lg, paddingBottom: 120 },
  eyebrow: { ...Typography.bodySmall, color: Colors.textSecondary, marginBottom: 10 },
  summary: { backgroundColor: Colors.bgInverse, borderRadius: Radius.xl, padding: Spacing.lg },
  big: { fontSize: 52, fontWeight: '800', color: '#fff', letterSpacing: -2 },
  bigOf: { ...Typography.heading3, color: Colors.textOnInverseMuted },
  chips: { flexDirection: 'row', gap: 14, marginTop: 12 },
  chip: { color: 'rgba(255,255,255,0.85)', fontWeight: '600', fontSize: 14 },
  sectionTitle: { ...Typography.heading3, color: Colors.textPrimary },
  sectionSub: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  assign: { ...Typography.caption, fontWeight: '700', color: Colors.textPrimary, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  rowText: { flex: 1, marginLeft: 14, marginRight: 8 },
  rowTitle: { ...Typography.bodyStrong, color: Colors.textPrimary },
  rowSub: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 36, paddingHorizontal: 12, borderRadius: Radius.full, minWidth: 96, justifyContent: 'center' },
  toggleOn: { backgroundColor: Colors.success },
  toggleOff: { backgroundColor: Colors.bgSubtle },
  toggleText: { fontSize: 13, fontWeight: '700' },
  empty: { ...Typography.body, color: Colors.textMuted, textAlign: 'center', padding: Spacing.xl },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: Spacing.lg, paddingTop: 12, paddingBottom: Spacing.lg, backgroundColor: Colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  compareRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: Spacing.lg },
  compareCol: { alignItems: 'center' },
  compareLabel: { ...Typography.caption, color: Colors.textSecondary, marginTop: 8 },
});
