// FaceScan Design System — Color Tokens & Theme

export const Colors = {
  // Brand
  primary: '#7C5CFC',
  primaryDark: '#5B38E5',
  primaryLight: '#B6A6FF',
  accent: '#43D6B3',
  accentDark: '#20AD8B',

  // Backgrounds
  bg: '#0A0B14',
  bgCard: '#121421',
  bgElevated: '#1A1D2E',
  bgInput: '#161827',
  bgSubtle: '#0F1120',

  // Borders
  border: '#262A3D',
  borderFocus: '#9B86FF',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#A6AAC0',
  textMuted: '#70758D',
  textOnPrimary: '#FFFFFF',

  // Status
  success: '#00D4AA',
  successBg: 'rgba(0, 212, 170, 0.12)',
  warning: '#FFB547',
  warningBg: 'rgba(255, 181, 71, 0.12)',
  danger: '#FF6B6B',
  dangerBg: 'rgba(255, 107, 107, 0.12)',
  unknown: '#8A8A9B',
  unknownBg: 'rgba(138, 138, 155, 0.12)',

  // Attendance status
  present: '#00D4AA',
  absent: '#FF6B6B',
  uncertain: '#FFB547',

  // Overlays
  overlay: 'rgba(0,0,0,0.7)',
  overlayLight: 'rgba(0,0,0,0.4)',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
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
  heading1: { fontSize: 30, fontWeight: '700' as const, letterSpacing: -0.8 },
  heading2: { fontSize: 23, fontWeight: '700' as const, letterSpacing: -0.4 },
  heading3: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 22 },
  bodySmall: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.5 },
  caption: { fontSize: 11, fontWeight: '400' as const },
} as const;
