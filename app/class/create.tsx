import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { createClass } from '@/lib/database/db';
import { Colors, Spacing, Typography } from '@/constants/theme';
import { Button, Field } from '@/components/kit';

export default function CreateClassScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [section, setSection] = useState('');
  const [semester, setSemester] = useState('');
  const [saving, setSaving] = useState(false);
  const isValid = name.trim().length > 0;

  const handleCreate = async () => {
    if (!isValid) return;
    setSaving(true);
    try {
      const cls = await createClass(name.trim(), section.trim(), semester.trim() || undefined);
      router.replace(`/class/${cls.id}`);
    } catch (e: any) {
      Alert.alert('Could not create class', e.message ?? 'Please try again.');
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>New class</Text>
          <Text style={styles.subtitle}>Just a name is enough — you can add details later.</Text>
          <Field label="Class name" placeholder="e.g. CSE 3A" value={name} onChangeText={setName} autoFocus returnKeyType="next" autoCapitalize="characters" />
          <Field label="Section (optional)" placeholder="e.g. A, Morning batch" value={section} onChangeText={setSection} />
          <Field label="Semester (optional)" placeholder="e.g. Sem 3, 2025–26" value={semester} onChangeText={setSemester} returnKeyType="done" onSubmitEditing={handleCreate} />
        </ScrollView>
        <View style={styles.footer}>
          <Button title="Create class" onPress={handleCreate} disabled={!isValid} loading={saving} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: Spacing.lg, paddingTop: Spacing.sm },
  title: { ...Typography.heading1, color: Colors.textPrimary },
  subtitle: { ...Typography.body, color: Colors.textSecondary, marginTop: 6, marginBottom: Spacing.xl },
  footer: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
});
