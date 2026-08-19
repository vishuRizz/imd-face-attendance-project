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
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { createClass } from '@/lib/database/db';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';

export default function CreateClassScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [section, setSection] = useState('');
  const [semester, setSemester] = useState('');
  const [saving, setSaving] = useState(false);

  const isValid = name.trim().length > 0 && section.trim().length > 0;

  const handleCreate = async () => {
    if (!isValid) return;
    setSaving(true);
    try {
      const newClass = await createClass(name.trim(), section.trim(), semester.trim() || undefined);
      router.replace(`/class/${newClass.id}`);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to create class');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.heroIcon}><Ionicons name="school" size={25} color={Colors.primaryLight} /></View>
        <Text style={styles.heading}>Create a class</Text>
        <Text style={styles.subheading}>Set up the space where you’ll enroll students and record attendance.</Text>

        <View style={styles.form}>
          <FormField
            id="input-class-name"
            label="Class Name *"
            placeholder="e.g. CSE 3A, BCA 2B"
            value={name}
            onChangeText={setName}
          />
          <FormField
            id="input-section"
            label="Section *"
            placeholder="e.g. A, B, Morning"
            value={section}
            onChangeText={setSection}
          />
          <FormField
            id="input-semester"
            label="Semester (Optional)"
            placeholder="e.g. Sem 3, 2025-26"
            value={semester}
            onChangeText={setSemester}
          />
        </View>

        <View style={styles.preview}>
          <Text style={styles.previewLabel}>CLASS PREVIEW</Text>
          <View style={styles.previewCard}>
            <View style={styles.previewIcon}>
              <Text style={styles.previewIconText}>
                {name ? name.slice(0, 2).toUpperCase() : '??'}
              </Text>
            </View>
            <View>
              <Text style={styles.previewName}>{name || 'Class Name'}</Text>
              <Text style={styles.previewSection}>
                {section || 'Section'}{semester ? ` · ${semester}` : ''}
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          id="btn-create-class"
          style={[styles.createButton, !isValid && styles.createButtonDisabled]}
          onPress={handleCreate}
          disabled={!isValid || saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <><Text style={styles.createButtonText}>Create class</Text><Ionicons name="arrow-forward" size={18} color={Colors.textOnPrimary} /></>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function FormField({
  id,
  label,
  placeholder,
  value,
  onChangeText,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (v: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={fieldStyles.wrapper}>
      <Text style={fieldStyles.label}>{label}</Text>
      <TextInput
        nativeID={id}
        style={[fieldStyles.input, focused && fieldStyles.inputFocused]}
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
  inputFocused: {
    borderColor: Colors.borderFocus,
    shadowColor: Colors.primary,
    shadowOpacity: 0.16,
    shadowRadius: 8,
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: Spacing.lg, paddingTop: Spacing.xl, paddingBottom: Spacing.xxl },
  heroIcon: { width: 52, height: 52, borderRadius: Radius.lg, backgroundColor: Colors.primary + '20', justifyContent: 'center', alignItems: 'center', marginBottom: Spacing.lg },
  heading: { ...Typography.heading2, color: Colors.textPrimary, marginBottom: Spacing.xs },
  subheading: { ...Typography.body, color: Colors.textSecondary, marginBottom: Spacing.xl },
  form: { marginBottom: Spacing.lg },
  preview: { marginBottom: Spacing.xl },
  previewLabel: { ...Typography.label, color: Colors.textMuted, marginBottom: Spacing.sm },
  previewCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  previewIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary + '25',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.primary + '50',
  },
  previewIconText: { ...Typography.heading3, color: Colors.primary },
  previewName: { ...Typography.heading3, color: Colors.textPrimary },
  previewSection: { ...Typography.bodySmall, color: Colors.textSecondary },
  createButton: {
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
  createButtonDisabled: { opacity: 0.45 },
  createButtonText: { ...Typography.heading3, color: Colors.textOnPrimary },
});
