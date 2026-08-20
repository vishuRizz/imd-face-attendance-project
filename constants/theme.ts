// FaceScan Design System — Color Tokens & Theme

export const Colors = {
  // Brand — confident, fast and human
  primary: '#167D3D',
  primaryDark: '#0E5D2C',
  primaryLight: '#DDF5E5',
  accent: '#F6B51D',
  accentDark: '#D99500',

  // Backgrounds
  bg: '#F6F7F4',
  bgCard: '#FFFFFF',
  bgElevated: '#EEF1EC',
  bgInput: '#F1F3EF',
  bgSubtle: '#E8ECE6',

  // Borders
  border: '#E0E5DE',
  borderFocus: '#167D3D',

  // Text
  textPrimary: '#172019',
  textSecondary: '#5F6B61',
  textMuted: '#879187',
  textOnPrimary: '#FFFFFF',

  // Status
  success: '#168A46',
  successBg: '#E4F5E9',
  warning: '#D88C00',
  warningBg: '#FFF3D6',
  danger: '#D64B42',
  dangerBg: '#FDE8E6',
  unknown: '#6F7971',
  unknownBg: '#E9EDE9',

  // Attendance status
  present: '#00D4AA',
  absent: '#FF6B6B',
  uncertain: '#FFB547',

  // Overlays
  overlay: 'rgba(15,24,17,0.72)',
  overlayLight: 'rgba(15,24,17,0.42)',
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
  heading1: { fontSize: 32, fontWeight: '800' as const, letterSpacing: -1.1 },
  heading2: { fontSize: 24, fontWeight: '800' as const, letterSpacing: -0.6 },
  heading3: { fontSize: 17, fontWeight: '700' as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 22 },
  bodySmall: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  label: { fontSize: 11, fontWeight: '800' as const, letterSpacing: 0.7 },
  caption: { fontSize: 11, fontWeight: '400' as const },
} as const;
