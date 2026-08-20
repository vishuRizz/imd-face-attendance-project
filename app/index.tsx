import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { getAllClasses, type ClassWithStats } from '@/lib/database/db';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';

export default function DashboardScreen() {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadClasses = useCallback(async () => {
    try {
      const data = await getAllClasses();
      setClasses(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadClasses();
    }, [loadClasses])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadClasses();
  };

  const renderClassCard = ({ item }: { item: ClassWithStats }) => (
    <TouchableOpacity
      id={`class-card-${item.id}`}
      style={styles.card}
      onPress={() => router.push(`/class/${item.id}`)}
      activeOpacity={0.75}
    >
      <View style={styles.cardHeader}>
        <View style={styles.classIcon}>
          <Text style={styles.classIconText}>
            {item.name.slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.className}>{item.name}</Text>
          <Text style={styles.classSection}>
            {item.section}{item.semester ? ` · ${item.semester}` : ''}
          </Text>
        </View>
        <View style={styles.chevron}>
          <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
        </View>
      </View>
      <View style={styles.cardStats}>
        <StatBadge label="Students" value={item.studentCount} color={Colors.primary} />
        <StatBadge label="Enrolled" value={item.enrolledCount} color={Colors.accent} />
        <View style={styles.lastAttendanceBadge}>
          <Text style={styles.statLabel}>Last Scan</Text>
          <Text style={styles.lastAttendanceText}>
            {item.lastAttendance
              ? new Date(item.lastAttendance).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
              : '—'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>GOOD TO SEE YOU</Text>
          <Text style={styles.appName}>FaceScan</Text>
          <Text style={styles.subtitle}>Attendance, made effortless.</Text>
        </View>
        <View style={styles.headerBadge}>
          <View style={styles.statusDot} />
          <Text style={styles.headerBadgeText}>PRIVATE & OFFLINE</Text>
        </View>
      </View>

      {/* Classes list */}
      <FlatList
        data={classes}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderClassCard}
        contentContainerStyle={[
          styles.list,
          classes.length === 0 && styles.listEmpty,
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}><Ionicons name="school-outline" size={32} color={Colors.primaryLight} /></View>
            <Text style={styles.emptyTitle}>No Classes Yet</Text>
            <Text style={styles.emptySubtitle}>
              Create your first class to start taking attendance
            </Text>
          </View>
        }
        ListHeaderComponent={
          classes.length > 0 ? (
            <Text style={styles.sectionTitle}>
              YOUR CLASSES ({classes.length})
            </Text>
          ) : null
        }
      />

      {/* FAB */}
      <TouchableOpacity
        id="fab-create-class"
        style={styles.fab}
        onPress={() => router.push('/class/create')}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={20} color={Colors.textOnPrimary} />
        <Text style={styles.fabText}>New class</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.statBadge, { borderColor: color + '33' }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.lg,
  },
  appName: {
    ...Typography.heading1,
    color: Colors.textPrimary,
  },
  eyebrow: { ...Typography.label, color: Colors.primaryLight, marginBottom: Spacing.xs },
  subtitle: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  headerBadge: {
    backgroundColor: Colors.successBg,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm + 4,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.success + '40',
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.success, marginRight: 6 },
  headerBadgeText: {
    ...Typography.label,
    color: Colors.success,
  },
  sectionTitle: {
    ...Typography.label,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
    marginTop: Spacing.xs,
  },
  list: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 100,
  },
  listEmpty: {
    flex: 1,
  },
  card: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  classIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary + '25',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.primary + '50',
  },
  classIconText: {
    ...Typography.heading3,
    color: Colors.primary,
  },
  cardInfo: {
    flex: 1,
    marginLeft: Spacing.sm,
  },
  className: {
    ...Typography.heading3,
    color: Colors.textPrimary,
  },
  classSection: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  chevron: {
    paddingLeft: Spacing.sm,
  },
  chevronText: {
    fontSize: 22,
    color: Colors.textMuted,
  },
  cardStats: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  statBadge: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
    backgroundColor: Colors.bgElevated,
  },
  statValue: {
    ...Typography.heading3,
    fontWeight: '700',
  },
  statLabel: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginTop: 2,
  },
  lastAttendanceBadge: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgElevated,
  },
  lastAttendanceText: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: '30%',
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: Radius.xl,
    backgroundColor: Colors.primary + '18',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  emptyTitle: {
    ...Typography.heading2,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
  },
  fab: {
    position: 'absolute',
    bottom: Spacing.xl,
    left: Spacing.lg,
    right: Spacing.lg,
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: Spacing.xs,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  fabText: {
    ...Typography.heading3,
    color: Colors.textOnPrimary,
  },
});
