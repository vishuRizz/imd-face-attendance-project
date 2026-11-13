// FaceScan design system — high-contrast, mobility-app inspired.
// Black primary actions, white canvas, soft grey surfaces, one green for "done".

export const Colors = {
  // Brand
  primary: '#000000',
  primaryDark: '#000000',
  primaryLight: '#EEEEEE',
  accent: '#06C167',
  accentDark: '#048848',
  blue: '#276EF1',

  // Backgrounds
  bg: '#FFFFFF',
  bgCard: '#FFFFFF',
  bgElevated: '#F6F6F6',
  bgInput: '#F3F3F3',
  bgSubtle: '#EEEEEE',
  bgInverse: '#000000',

  // Borders
  border: '#E8E8E8',
  borderFocus: '#000000',

  // Text
  textPrimary: '#000000',
  textSecondary: '#5E5E5E',
  textMuted: '#8F8F8F',
  textOnPrimary: '#FFFFFF',
  textOnInverseMuted: 'rgba(255,255,255,0.64)',

  // Status
  success: '#05944F',
  successBg: '#E6F7EE',
  warning: '#B26B00',
  warningBg: '#FFF4E0',
  danger: '#E11900',
  dangerBg: '#FFEFED',
  unknown: '#6B6B6B',
  unknownBg: '#EEEEEE',

  // Attendance status
  present: '#06C167',
  absent: '#E11900',
  uncertain: '#FFC043',

  // Overlays
  overlay: 'rgba(0,0,0,0.72)',
  overlayLight: 'rgba(0,0,0,0.42)',
  glass: 'rgba(0,0,0,0.55)',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 20,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  full: 999,
} as const;

export const Typography = {
  display: { fontSize: 40, fontWeight: '800' as const, letterSpacing: -1.4, lineHeight: 44 },
  heading1: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.9, lineHeight: 36 },
  heading2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.5, lineHeight: 28 },
  heading3: { fontSize: 17, fontWeight: '700' as const, letterSpacing: -0.2, lineHeight: 22 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 22 },
  bodyStrong: { fontSize: 16, fontWeight: '600' as const, lineHeight: 22 },
  bodySmall: { fontSize: 14, fontWeight: '400' as const, lineHeight: 19 },
  label: { fontSize: 12, fontWeight: '700' as const, letterSpacing: 0.4 },
  caption: { fontSize: 12, fontWeight: '500' as const, lineHeight: 16 },
} as const;

export const Shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  sheet: {
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -6 },
    elevation: 16,
  },
} as const;

/** Deterministic soft tint for initials avatars. */
const AVATAR_TINTS = [
  ['#E8F0FE', '#1A4FB8'],
  ['#E6F7EE', '#03703C'],
  ['#FFF4E0', '#8A5300'],
  ['#F3E8FF', '#6B21A8'],
  ['#FFEFED', '#A11300'],
  ['#E0F7FA', '#006D7A'],
] as const;

export function avatarTint(seed: string | number) {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const [bg, fg] = AVATAR_TINTS[h % AVATAR_TINTS.length];
  return { bg, fg };
}
