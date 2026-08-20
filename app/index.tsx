import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getAllClasses, type ClassWithStats } from '@/lib/database/db';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';

const initials = (name: string) => name.split(' ').map((word) => word[0]).join('').slice(0, 2).toUpperCase();

export default function DashboardScreen() {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadClasses = useCallback(async () => {
    try { setClasses(await getAllClasses()); } catch (error) { console.error(error); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { loadClasses(); }, [loadClasses]));
  const totalStudents = classes.reduce((total, item) => total + item.studentCount, 0);
  const enrolledStudents = classes.reduce((total, item) => total + item.enrolledCount, 0);

  const renderClassCard = ({ item, index }: { item: ClassWithStats; index: number }) => {
    const enrollment = item.studentCount ? Math.round((item.enrolledCount / item.studentCount) * 100) : 0;
    return (
      <TouchableOpacity id={`class-card-${item.id}`} style={styles.card} onPress={() => router.push(`/class/${item.id}`)} activeOpacity={0.82}>
        <View style={styles.cardTop}>
          <View style={[styles.classIcon, index % 2 ? styles.classIconGold : undefined]}>
            <Text style={[styles.classIconText, index % 2 ? styles.classIconTextGold : undefined]}>{initials(item.name)}</Text>
          </View>
          <View style={styles.cardInfo}><Text style={styles.className}>{item.name}</Text><Text style={styles.classSection}>{item.section}{item.semester ? ` · ${item.semester}` : ''}</Text></View>
          <View style={styles.arrow}><Ionicons name="arrow-forward" size={18} color={Colors.textPrimary} /></View>
        </View>
        <View style={styles.cardDivider} />
        <View style={styles.cardBottom}>
          <View><Text style={styles.metaValue}>{item.studentCount}</Text><Text style={styles.metaLabel}>STUDENTS</Text></View>
          <View style={styles.progressWrap}><View style={styles.progressLabels}><Text style={styles.enrolledText}>{item.enrolledCount} enrolled</Text><Text style={styles.percent}>{enrollment}%</Text></View><View style={styles.track}><View style={[styles.bar, { width: `${enrollment}%` }]} /></View></View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) return <SafeAreaView style={styles.container}><View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View></SafeAreaView>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={classes} keyExtractor={(item) => item.id.toString()} renderItem={renderClassCard}
        contentContainerStyle={[styles.list, classes.length === 0 && styles.listEmpty]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadClasses(); }} tintColor={Colors.primary} />}
        ListHeaderComponent={<>
          <View style={styles.header}><View><Text style={styles.greeting}>ATTENDANCE HUB</Text><Text style={styles.title}>Good morning.</Text><Text style={styles.subtitle}>Everything for today, in one place.</Text></View><View style={styles.profile}><Ionicons name="person-outline" size={21} color={Colors.primaryDark} /></View></View>
          <View style={styles.summary}><View style={styles.summaryIcon}><Ionicons name="people" size={22} color={Colors.primary} /></View><View style={styles.summaryCopy}><Text style={styles.summaryTitle}>{totalStudents} students across {classes.length} classes</Text><Text style={styles.summarySub}>{enrolledStudents} ready for face scan</Text></View></View>
          {classes.length > 0 && <View style={styles.sectionRow}><Text style={styles.sectionTitle}>YOUR CLASSES</Text><Text style={styles.sectionCount}>{classes.length} active</Text></View>}
        </>}
        ListEmptyComponent={<View style={styles.emptyState}><View style={styles.emptyArtwork}><View style={styles.emptyCircle}><Ionicons name="school-outline" size={42} color={Colors.primary} /></View><View style={styles.emptySpark}><Ionicons name="sparkles" size={16} color={Colors.accentDark} /></View></View><Text style={styles.emptyTitle}>Your day starts here</Text><Text style={styles.emptySubtitle}>Create a class to enroll students and take attendance in seconds.</Text></View>}
      />
      <TouchableOpacity id="fab-create-class" style={styles.fab} onPress={() => router.push('/class/create')} activeOpacity={0.86}><Ionicons name="add" size={22} color={Colors.textOnPrimary} /><Text style={styles.fabText}>Create class</Text></TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: Spacing.lg, paddingBottom: 112 }, listEmpty: { flexGrow: 1 },
  header: { paddingTop: Spacing.lg, paddingBottom: Spacing.xl, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  greeting: { ...Typography.label, color: Colors.primary, marginBottom: 7 }, title: { ...Typography.heading1, color: Colors.textPrimary }, subtitle: { ...Typography.bodySmall, color: Colors.textSecondary, marginTop: 5 },
  profile: { width: 44, height: 44, backgroundColor: Colors.primaryLight, borderRadius: Radius.full, justifyContent: 'center', alignItems: 'center' },
  summary: { backgroundColor: '#173C27', borderRadius: Radius.xl, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.xl, shadowColor: '#173C27', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 2 },
  summaryIcon: { width: 46, height: 46, borderRadius: Radius.md, backgroundColor: '#E5F5D7', alignItems: 'center', justifyContent: 'center', marginRight: Spacing.md }, summaryCopy: { flex: 1 }, summaryTitle: { ...Typography.bodySmall, color: '#FFFFFF', fontWeight: '700' }, summarySub: { ...Typography.caption, color: '#B7D6BF', marginTop: 4 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm }, sectionTitle: { ...Typography.label, color: Colors.textMuted }, sectionCount: { ...Typography.caption, color: Colors.primary, fontWeight: '700' },
  card: { backgroundColor: Colors.bgCard, borderRadius: Radius.xl, padding: Spacing.md, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border, shadowColor: '#142119', shadowOpacity: 0.035, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'center' }, classIcon: { width: 50, height: 50, borderRadius: 15, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' }, classIconGold: { backgroundColor: '#FFF1CF' }, classIconText: { ...Typography.heading3, color: Colors.primaryDark }, classIconTextGold: { color: Colors.accentDark }, cardInfo: { flex: 1, marginLeft: 12 }, className: { ...Typography.heading3, color: Colors.textPrimary }, classSection: { ...Typography.bodySmall, color: Colors.textSecondary, marginTop: 3 }, arrow: { width: 34, height: 34, backgroundColor: Colors.bgElevated, borderRadius: Radius.full, justifyContent: 'center', alignItems: 'center' },
  cardDivider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.md }, cardBottom: { flexDirection: 'row', alignItems: 'center' }, metaValue: { ...Typography.heading3, color: Colors.textPrimary }, metaLabel: { ...Typography.caption, color: Colors.textMuted, letterSpacing: 0.5, marginTop: 1 }, progressWrap: { flex: 1, marginLeft: Spacing.lg }, progressLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }, enrolledText: { ...Typography.caption, color: Colors.textSecondary }, percent: { ...Typography.caption, color: Colors.primary, fontWeight: '700' }, track: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.bgSubtle, overflow: 'hidden' }, bar: { height: '100%', borderRadius: Radius.full, backgroundColor: Colors.primary },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, paddingBottom: 80 }, emptyArtwork: { width: 120, height: 110, marginBottom: Spacing.lg, alignItems: 'center', justifyContent: 'center' }, emptyCircle: { width: 94, height: 94, borderRadius: 47, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' }, emptySpark: { position: 'absolute', top: 4, right: 5, width: 32, height: 32, borderRadius: 16, backgroundColor: '#FFF1CF', justifyContent: 'center', alignItems: 'center' }, emptyTitle: { ...Typography.heading2, color: Colors.textPrimary, textAlign: 'center' }, emptySubtitle: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.sm, lineHeight: 23 },
  fab: { position: 'absolute', left: Spacing.lg, right: Spacing.lg, bottom: Spacing.md, minHeight: 56, borderRadius: 18, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, shadowColor: Colors.primaryDark, shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 7 }, fabText: { ...Typography.heading3, color: Colors.textOnPrimary },
});
