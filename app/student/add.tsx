import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { createStudent } from '@/lib/database/db';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';

export default function AddStudentScreen() {
  const { classId } = useLocalSearchParams<{ classId: string }>();
  const router = useRouter();

  const [name, setName] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [studentId, setStudentId] = useState('');
  const [saving, setSaving] = useState(false);

  const isValid = name.trim().length > 0 && rollNumber.trim().length > 0;

  const handleSave = async () => {
    if (!isValid || !classId) return;
    setSaving(true);
    try {
      const student = await createStudent(
        Number(classId),
        name.trim(),
        rollNumber.trim(),
        studentId.trim() || undefined
      );
      // Navigate directly to enrollment
      router.replace(`/student/${student.id}/enroll`);
    } catch (e: any) {
      Alert.alert('Error', e.message?.includes('UNIQUE') ? 'Roll number already exists in this class.' : e.message ?? 'Failed to add student');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.heroIcon}><Ionicons name="person-add" size={24} color={Colors.accent} /></View>
        <Text style={styles.heading}>Add a student</Text>
        <Text style={styles.subheading}>Save their details, then capture a few quick face references.</Text>

        <View style={styles.form}>
          <FormField id="input-name" label="Full Name *" placeholder="e.g. Rahul Sharma" value={name} onChangeText={setName} />
          <FormField id="input-roll" label="Roll Number *" placeholder="e.g. 2024CSE001" value={rollNumber} onChangeText={setRollNumber} />
          <FormField id="input-sid" label="Student ID (Optional)" placeholder="e.g. UID12345" value={studentId} onChangeText={setStudentId} />
        </View>

        <View style={styles.note}>
          <Ionicons name="sparkles" size={18} color={Colors.primaryLight} />
          <Text style={styles.noteText}>You’ll capture 5 quick face references immediately after saving.</Text>
        </View>

        <TouchableOpacity
          id="btn-save-student"
          style={[styles.saveButton, !isValid && styles.disabled]}
          onPress={handleSave}
          disabled={!isValid || saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <><Text style={styles.saveButtonText}>Save & enroll face</Text><Ionicons name="arrow-forward" size={18} color={Colors.textOnPrimary} /></>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function FormField({
  id, label, placeholder, value, onChangeText,
}: {
  id: string; label: string; placeholder: string; value: string; onChangeText: (v: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={fieldStyles.wrapper}>
      <Text style={fieldStyles.label}>{label}</Text>
      <TextInput
        nativeID={id}
        style={[fieldStyles.input, focused && fieldStyles.focused]}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  wrapper: { marginBottom: Spacing.md },
  label: { ...Typography.label, color: Colors.textSecondary, marginBottom: Spacing.xs },
  input: {
    backgroundColor: Colors.bgInput,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    color: Colors.textPrimary,
    ...Typography.body,
  },
  focused: { borderColor: Colors.borderFocus, shadowColor: Colors.primary, shadowOpacity: 0.16, shadowRadius: 8 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: Spacing.lg, paddingTop: Spacing.xl, paddingBottom: Spacing.xxl },
  heroIcon: { width: 52, height: 52, borderRadius: Radius.lg, backgroundColor: Colors.accent + '18', justifyContent: 'center', alignItems: 'center', marginBottom: Spacing.lg },
  heading: { ...Typography.heading2, color: Colors.textPrimary, marginBottom: Spacing.xs },
  subheading: { ...Typography.body, color: Colors.textSecondary, marginBottom: Spacing.xl },
  form: { marginBottom: Spacing.lg },
  note: {
    backgroundColor: Colors.primary + '15',
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    marginBottom: Spacing.xl,
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  noteText: { ...Typography.bodySmall, color: Colors.primaryLight, flex: 1 },
  saveButton: {
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
  disabled: { opacity: 0.45, shadowOpacity: 0 },
  saveButtonText: { ...Typography.heading3, color: Colors.textOnPrimary },
});
