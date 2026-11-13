/**
 * Shared UI kit — small, opinionated building blocks used by every screen.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography, avatarTint } from '@/constants/theme';

export type IconName = keyof typeof Ionicons.glyphMap;

// ─── Tap feedback ────────────────────────────────────────────────────────────

/** Pressable that scales down slightly on press, like native mobility apps. */
export function Tap({
  style,
  children,
  scaleTo = 0.97,
  haptic = false,
  onPress,
  ...rest
}: PressableProps & { style?: StyleProp<ViewStyle>; scaleTo?: number; haptic?: boolean; children?: React.ReactNode }) {
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  return (
    <Pressable
      {...rest}
      onPress={e => {
        if (haptic) Haptics.selectionAsync().catch(() => {});
        onPress?.(e);
      }}
      onPressIn={e => { animate(scaleTo); rest.onPressIn?.(e); }}
      onPressOut={e => { animate(1); rest.onPressOut?.(e); }}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// ─── Button ──────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'inverse';

export function Button({
  title,
  icon,
  iconRight,
  variant = 'primary',
  size = 'lg',
  loading,
  disabled,
  onPress,
  style,
  testID,
}: {
  title: string;
  icon?: IconName;
  iconRight?: IconName;
  variant?: ButtonVariant;
  size?: 'lg' | 'md' | 'sm';
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const palette = {
    primary: { bg: Colors.primary, fg: Colors.textOnPrimary },
    secondary: { bg: Colors.bgSubtle, fg: Colors.textPrimary },
    ghost: { bg: 'transparent', fg: Colors.textPrimary },
    danger: { bg: Colors.dangerBg, fg: Colors.danger },
    success: { bg: Colors.accent, fg: '#FFFFFF' },
    inverse: { bg: '#FFFFFF', fg: Colors.textPrimary },
  }[variant];
  const height = size === 'lg' ? 56 : size === 'md' ? 48 : 38;
  const font = size === 'sm' ? 14 : 16;
  return (
    <Tap
      testID={testID}
      haptic
      disabled={disabled || loading}
      onPress={onPress}
      style={[
        styles.button,
        { backgroundColor: palette.bg, height, borderRadius: size === 'sm' ? Radius.full : Radius.md, paddingHorizontal: size === 'sm' ? 14 : 20 },
        (disabled || loading) && { opacity: 0.4 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={font + 3} color={palette.fg} />}
          <Text style={[styles.buttonText, { color: palette.fg, fontSize: font }]} numberOfLines={1}>{title}</Text>
          {iconRight && <Ionicons name={iconRight} size={font + 2} color={palette.fg} />}
        </>
      )}
    </Tap>
  );
}

export function IconButton({
  icon,
  onPress,
  variant = 'secondary',
  size = 44,
  style,
  accessibilityLabel,
  color,
}: {
  icon: IconName;
  onPress?: () => void;
  variant?: 'secondary' | 'glass' | 'primary' | 'plain';
  size?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
  color?: string;
}) {
  const bg = { secondary: Colors.bgSubtle, glass: Colors.glass, primary: Colors.primary, plain: 'transparent' }[variant];
  const fg = color ?? (variant === 'glass' || variant === 'primary' ? '#FFFFFF' : Colors.textPrimary);
  return (
    <Tap
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={8}
      scaleTo={0.9}
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <Ionicons name={icon} size={Math.round(size * 0.48)} color={fg} />
    </Tap>
  );
}

// ─── Avatar ──────────────────────────────────────────────────────────────────

export const initialsOf = (name?: string) =>
  (name ?? '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';

export function Avatar({
  name,
  uri,
  size = 44,
  seed,
  ring,
  style,
}: {
  name?: string;
  uri?: string;
  size?: number;
  seed?: string | number;
  ring?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const tint = avatarTint(seed ?? name ?? '?');
  const [failed, setFailed] = useState(false);
  const ringStyle = ring ? { borderWidth: 2.5, borderColor: ring } : null;
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: tint.bg, alignItems: 'center', justifyContent: 'center' },
        ringStyle,
        style,
      ]}
    >
      {uri && !failed ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} onError={() => setFailed(true)} />
      ) : (
        <Text style={{ color: tint.fg, fontWeight: '700', fontSize: Math.round(size * 0.36) }}>{initialsOf(name)}</Text>
      )}
    </View>
  );
}

// ─── Chips / badges ──────────────────────────────────────────────────────────

export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'dark'; icon?: IconName }) {
  const t = {
    neutral: [Colors.bgSubtle, Colors.textSecondary],
    success: [Colors.successBg, Colors.success],
    warning: [Colors.warningBg, Colors.warning],
    danger: [Colors.dangerBg, Colors.danger],
    dark: [Colors.primary, '#FFFFFF'],
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t[0] }]}>
      {icon && <Ionicons name={icon} size={12} color={t[1]} />}
      <Text style={[styles.badgeText, { color: t[1] }]}>{label}</Text>
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  dark,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  dark?: boolean;
}) {
  return (
    <View style={[styles.segmented, dark && { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); onChange(o.value); }}
            style={[styles.segment, active && (dark ? styles.segmentActiveDark : styles.segmentActive)]}
          >
            <Text style={[styles.segmentText, dark && { color: 'rgba(255,255,255,0.7)' }, active && { color: dark ? '#000' : Colors.textPrimary }]}>
              {o.label}{o.count != null ? ` ${o.count}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ProgressBar({ value, color = Colors.accent, track = Colors.bgSubtle, height = 6 }: { value: number; color?: string; track?: string; height?: number }) {
  const pct = Math.max(0, Math.min(1, value || 0));
  return (
    <View style={{ height, borderRadius: height, backgroundColor: track, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: height, backgroundColor: color }} />
    </View>
  );
}

// ─── Form ────────────────────────────────────────────────────────────────────

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: Spacing.md }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={Colors.textMuted}
        {...props}
        onFocus={e => { setFocused(true); props.onFocus?.(e); }}
        onBlur={e => { setFocused(false); props.onBlur?.(e); }}
        style={[styles.input, focused && styles.inputFocused, props.multiline && { height: 180, paddingTop: 14, textAlignVertical: 'top' }, props.style]}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

// ─── Layout helpers ──────────────────────────────────────────────────────────

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={10}><Text style={styles.sectionAction}>{action}</Text></Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({ icon, title, body, children }: { icon: IconName; title: string; body: string; children?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><Ionicons name={icon} size={30} color={Colors.textPrimary} /></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {children}
    </View>
  );
}

// ─── Bottom sheet ────────────────────────────────────────────────────────────

export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.sheetHandle} />
          {title ? <Text style={styles.sheetTitle}>{title}</Text> : null}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export type PickableStudent = { id: number; name: string; rollNumber: string; photoUri?: string };

/** Searchable student list in a bottom sheet (replaces 3-button Android alerts). */
export function StudentPicker({
  visible,
  onClose,
  students,
  onPick,
  title = 'Who is this?',
  faceUri,
}: {
  visible: boolean;
  onClose: () => void;
  students: PickableStudent[];
  onPick: (s: PickableStudent) => void;
  title?: string;
  faceUri?: string;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return students;
    return students.filter(s => s.name.toLowerCase().includes(needle) || s.rollNumber.toLowerCase().includes(needle));
  }, [q, students]);
  return (
    <Sheet visible={visible} onClose={() => { setQ(''); onClose(); }} title={title}>
      {faceUri ? (
        <View style={{ alignItems: 'center', marginBottom: Spacing.md }}>
          <Avatar uri={faceUri} size={88} name="?" />
        </View>
      ) : null}
      <View style={styles.search}>
        <Ionicons name="search" size={18} color={Colors.textMuted} />
        <TextInput value={q} onChangeText={setQ} placeholder="Search name or roll no." placeholderTextColor={Colors.textMuted} style={styles.searchInput} autoCorrect={false} />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={s => String(s.id)}
        style={{ maxHeight: 380 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable style={({ pressed }) => [styles.pickRow, pressed && { backgroundColor: Colors.bgElevated }]} onPress={() => { setQ(''); onPick(item); }}>
            <Avatar name={item.name} uri={item.photoUri} seed={item.id} size={40} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.pickName}>{item.name}</Text>
              <Text style={styles.pickRoll}>Roll {item.rollNumber}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </Pressable>
        )}
        ListEmptyComponent={<Text style={[styles.pickRoll, { textAlign: 'center', padding: Spacing.lg }]}>No matching students</Text>}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { fontWeight: '700', letterSpacing: -0.1 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.full, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  segmented: { flexDirection: 'row', backgroundColor: Colors.bgSubtle, borderRadius: Radius.full, padding: 4 },
  segment: { flex: 1, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  segmentActive: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  segmentActiveDark: { backgroundColor: '#FFFFFF' },
  segmentText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  fieldLabel: { ...Typography.label, color: Colors.textPrimary, marginBottom: 8 },
  fieldHint: { ...Typography.caption, color: Colors.textMuted, marginTop: 6 },
  input: { height: 54, borderRadius: Radius.md, backgroundColor: Colors.bgInput, paddingHorizontal: 16, fontSize: 16, color: Colors.textPrimary, borderWidth: 2, borderColor: 'transparent' },
  inputFocused: { borderColor: Colors.borderFocus, backgroundColor: '#FFFFFF' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { ...Typography.heading3, color: Colors.textPrimary },
  sectionAction: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary, textDecorationLine: 'underline' },
  empty: { alignItems: 'center', paddingVertical: Spacing.xl, paddingHorizontal: Spacing.lg },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.bgSubtle, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  emptyTitle: { ...Typography.heading2, color: Colors.textPrimary, textAlign: 'center' },
  emptyBody: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center', marginTop: 6, marginBottom: Spacing.lg },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: Spacing.lg, paddingTop: 10 },
  sheetHandle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: Colors.border, marginBottom: 14 },
  sheetTitle: { ...Typography.heading2, color: Colors.textPrimary, marginBottom: Spacing.md },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, borderRadius: Radius.full, backgroundColor: Colors.bgInput, paddingHorizontal: 16, marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 16, color: Colors.textPrimary },
  pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, borderRadius: Radius.md },
  pickName: { ...Typography.bodyStrong, color: Colors.textPrimary },
  pickRoll: { ...Typography.caption, color: Colors.textMuted, marginTop: 1 },
});
