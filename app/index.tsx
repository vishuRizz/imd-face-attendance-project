import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getAllClasses, type ClassWithStats } from '@/lib/database/db';
import { Colors, Radius, Shadow, Spacing, Typography, avatarTint } from '@/constants/theme';
import { Badge, Button, EmptyState, IconButton, Tap, initialsOf } from '@/components/kit';

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

export default function HomeScreen() {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setClasses(await getAllClasses()); } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const markedToday = classes.filter(c => c.todaySessionId).length;
  const presentToday = classes.reduce((n, c) => n + (c.todayPresent ?? 0), 0);
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={classes}
        keyExtractor={c => String(c.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.date}>{today}</Text>
                <Text style={styles.title}>{greeting()}</Text>
              </View>
              <IconButton icon="add" accessibilityLabel="Create class" onPress={() => router.push('/class/create')} />
            </View>

            {classes.length > 0 && (
              <View style={styles.hero}>
                <View style={styles.heroRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroLabel}>Today</Text>
                    <Text style={styles.heroValue}>
                      {markedToday}<Text style={styles.heroValueMuted}>/{classes.length} classes marked</Text>
                    </Text>
                  </View>
                  <View style={styles.heroIcon}><Ionicons name="scan" size={22} color="#000" /></View>
                </View>
                <View style={styles.heroDivider} />
                <Text style={styles.heroFoot}>
                  {presentToday > 0 ? `${presentToday} students checked in so far` : 'Open a class and point the camera — attendance marks itself.'}
                </Text>
              </View>
            )}

            {classes.length > 0 && <Text style={styles.sectionTitle}>Your classes</Text>}
          </>
        }
        renderItem={({ item }) => <ClassCard item={item} onOpen={() => router.push(`/class/${item.id}`)} onScan={() => router.push(`/attendance/scan/${item.id}`)} />}
        ListEmptyComponent={
          <EmptyState icon="school-outline" title="Set up your first class" body="Add a class and your students. After a one-time face setup, attendance takes seconds.">
            <Button title="Create class" icon="add" onPress={() => router.push('/class/create')} style={{ alignSelf: 'stretch' }} />
          </EmptyState>
        }
      />
    </SafeAreaView>
  );
}

function ClassCard({ item, onOpen, onScan }: { item: ClassWithStats; onOpen: () => void; onScan: () => void }) {
  const tint = avatarTint(item.name);
  const ready = item.enrolledCount > 0;
  const pending = item.studentCount - item.enrolledCount;
  return (
    <Tap onPress={onOpen} style={styles.card} scaleTo={0.985}>
      <View style={styles.cardTop}>
        <View style={[styles.mono, { backgroundColor: tint.bg }]}>
          <Text style={[styles.monoText, { color: tint.fg }]}>{initialsOf(item.name)}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.cardSub} numberOfLines={1}>
            {[item.section, item.semester].filter(Boolean).join(' · ')} · {item.studentCount} student{item.studentCount === 1 ? '' : 's'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
      </View>

      <View style={styles.cardBottom}>
        {item.todaySessionId ? (
          <Badge tone="success" icon="checkmark" label={`Marked · ${item.todayPresent ?? 0}/${item.enrolledCount}`} />
        ) : pending > 0 ? (
          <Badge tone="warning" label={`${pending} need face setup`} />
        ) : item.studentCount === 0 ? (
          <Badge label="No students yet" />
        ) : (
          <Badge label="Not marked today" />
        )}
        <View style={{ flex: 1 }} />
        {ready ? (
          <Button size="sm" title={item.todaySessionId ? 'Scan again' : 'Take attendance'} icon="scan" onPress={onScan} />
        ) : (
          <Button size="sm" variant="secondary" title="Set up" iconRight="arrow-forward" onPress={onOpen} />
        )}
      </View>
    </Tap>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg },
  list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl, flexGrow: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  date: { ...Typography.bodySmall, color: Colors.textSecondary, marginBottom: 2 },
  title: { ...Typography.heading1, color: Colors.textPrimary },
  hero: { backgroundColor: Colors.bgInverse, borderRadius: Radius.xl, padding: Spacing.lg, marginBottom: Spacing.xl },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  heroLabel: { ...Typography.bodySmall, color: Colors.textOnInverseMuted, marginBottom: 4 },
  heroValue: { fontSize: 34, fontWeight: '800', color: '#FFFFFF', letterSpacing: -1 },
  heroValueMuted: { fontSize: 16, fontWeight: '600', color: Colors.textOnInverseMuted, letterSpacing: 0 },
  heroIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  heroDivider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 14 },
  heroFoot: { ...Typography.bodySmall, color: 'rgba(255,255,255,0.82)' },
  sectionTitle: { ...Typography.heading2, color: Colors.textPrimary, marginBottom: 12 },
  card: { backgroundColor: Colors.bgCard, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: 12, borderWidth: 1, borderColor: Colors.border, ...Shadow.card },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  mono: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  monoText: { fontSize: 17, fontWeight: '800' },
  cardTitle: { ...Typography.heading3, color: Colors.textPrimary },
  cardSub: { ...Typography.bodySmall, color: Colors.textSecondary, marginTop: 2 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
});
