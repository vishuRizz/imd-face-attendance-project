import React, { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { createStudent, createStudentsBulk, getStudentsForClass } from '@/lib/database/db';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
import { Button, Field, Segmented } from '@/components/kit';

type Mode = 'single' | 'bulk';

/** Parse "12 Rahul Sharma", "Rahul Sharma, 12", "12<TAB>Rahul" … one per line. */
function parseRoster(text: string): { name: string; rollNumber: string }[] {
  const out: { name: string; rollNumber: string }[] = [];
  let auto = 1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-•*]\s*/, '');
    if (!line) continue;
    const parts = line.split(/\s*[,\t;|]\s*/).filter(Boolean);
    let name = '';
    let roll = '';
    if (parts.length >= 2) {
      const looksRoll = (s: string) => /\d/.test(s) && s.length <= 16 && !/\s/.test(s);
      if (looksRoll(parts[0])) { roll = parts[0]; name = parts.slice(1).join(' '); }
      else if (looksRoll(parts[parts.length - 1])) { roll = parts[parts.length - 1]; name = parts.slice(0, -1).join(' '); }
      else { name = parts.join(' '); }
    } else {
      const m = line.match(/^(\S*\d\S*)[.)]?\s+(.+)$/);
      if (m) { roll = m[1]; name = m[2]; } else { name = line; }
    }
    if (!roll) roll = String(auto);
    auto++;
    if (name) out.push({ name: name.trim(), rollNumber: roll.trim() });
  }
  return out;
}

export default function AddStudentScreen() {
  const { classId } = useLocalSearchParams<{ classId: string }>();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('single');
  const [name, setName] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [studentId, setStudentId] = useState('');
  const [bulk, setBulk] = useState('');
  const [saving, setSaving] = useState(false);
  const [addedCount, setAddedCount] = useState(0);

  const suggestRoll = async () => {
    try {
      const students = await getStudentsForClass(Number(classId));
      const nums = students.map(s => Number(s.rollNumber)).filter(n => Number.isFinite(n));
      if (students.length === 0) setRollNumber('1');
      else if (nums.length === students.length) setRollNumber(String(Math.max(...nums) + 1));
    } catch {}
  };
  useEffect(() => { suggestRoll(); }, [classId]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(() => parseRoster(bulk), [bulk]);
  const validSingle = name.trim().length > 0 && rollNumber.trim().length > 0;

  const saveSingle = async (then: 'enroll' | 'another') => {
    if (!validSingle) return;
    setSaving(true);
    try {
      const s = await createStudent(Number(classId), name.trim(), rollNumber.trim(), studentId.trim() || undefined);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (then === 'enroll') {
        router.replace(`/student/${s.id}/enroll`);
        return;
      }
      setAddedCount(c => c + 1);
      setName(''); setStudentId('');
      await suggestRoll();
    } catch (e: any) {
      Alert.alert('Could not add student', e.message?.includes('UNIQUE') ? `Roll number ${rollNumber} already exists in this class.` : e.message);
    } finally {
      setSaving(false);
    }
  };

  const saveBulk = async () => {
    if (parsed.length === 0) return;
    setSaving(true);
    try {
      const { created, skipped } = await createStudentsBulk(Number(classId), parsed);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (skipped.length) {
        Alert.alert(`${created} students added`, `Skipped ${skipped.length} duplicate roll number${skipped.length > 1 ? 's' : ''}: ${skipped.slice(0, 8).join(', ')}${skipped.length > 8 ? '…' : ''}`, [{ text: 'OK', onPress: () => router.back() }]);
      } else {
        router.back();
      }
    } catch (e: any) {
      Alert.alert('Could not add students', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Add students</Text>
          <Text style={styles.subtitle}>
            {mode === 'single' ? 'Add one at a time, or paste your whole roster.' : 'One student per line, e.g. “12 Rahul Sharma” or “Rahul Sharma, 12”.'}
          </Text>
          <View style={{ marginBottom: Spacing.lg }}>
            <Segmented<Mode> value={mode} onChange={setMode} options={[{ value: 'single', label: 'One by one' }, { value: 'bulk', label: 'Paste a list' }]} />
          </View>

          {mode === 'single' ? (
            <>
              {addedCount > 0 && <Text style={styles.added}>✓ {addedCount} added — keep going</Text>}
              <Field label="Full name" placeholder="e.g. Rahul Sharma" value={name} onChangeText={setName} autoFocus autoCapitalize="words" returnKeyType="next" />
              <Field label="Roll number" placeholder="e.g. 12" value={rollNumber} onChangeText={setRollNumber} autoCapitalize="characters" />
              <Field label="Student ID (optional)" placeholder="e.g. UID12345" value={studentId} onChangeText={setStudentId} />
            </>
          ) : (
            <>
              <Field label="Roster" placeholder={'1 Aarav Mehta\n2 Diya Patel\n3 Kabir Singh'} value={bulk} onChangeText={setBulk} multiline autoCapitalize="words" />
              {parsed.length > 0 && (
                <View style={styles.preview}>
                  <Text style={styles.previewTitle}>{parsed.length} student{parsed.length > 1 ? 's' : ''} detected</Text>
                  {parsed.slice(0, 4).map((p, i) => (
                    <Text key={i} style={styles.previewRow} numberOfLines={1}>{p.rollNumber} · {p.name}</Text>
                  ))}
                  {parsed.length > 4 && <Text style={styles.previewRow}>+ {parsed.length - 4} more</Text>}
                </View>
              )}
            </>
          )}
        </ScrollView>

        <View style={styles.footer}>
          {mode === 'single' ? (
            <>
              <Button title="Save & set up face" iconRight="arrow-forward" onPress={() => saveSingle('enroll')} disabled={!validSingle} loading={saving} />
              <Button title="Save & add another" variant="ghost" size="md" onPress={() => saveSingle('another')} disabled={!validSingle || saving} />
            </>
          ) : (
            <Button title={parsed.length ? `Add ${parsed.length} students` : 'Add students'} onPress={saveBulk} disabled={!parsed.length} loading={saving} />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: Spacing.lg, paddingTop: Spacing.sm },
  title: { ...Typography.heading1, color: Colors.textPrimary },
  subtitle: { ...Typography.body, color: Colors.textSecondary, marginTop: 6, marginBottom: Spacing.lg },
  added: { ...Typography.bodySmall, color: Colors.success, fontWeight: '700', marginBottom: Spacing.md },
  preview: { backgroundColor: Colors.bgElevated, borderRadius: Radius.md, padding: Spacing.md },
  previewTitle: { ...Typography.bodyStrong, color: Colors.textPrimary, marginBottom: 6 },
  previewRow: { ...Typography.bodySmall, color: Colors.textSecondary, marginTop: 2 },
  footer: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.md, gap: 4 },
});
