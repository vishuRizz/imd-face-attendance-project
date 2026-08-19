// FaceScan Design System — Color Tokens & Theme

export const Colors = {
  // Brand
  primary: '#6C63FF',       // Vibrant indigo-violet
  primaryDark: '#4A42CC',
  primaryLight: '#9B94FF',
  accent: '#00D4AA',        // Teal accent
  accentDark: '#00A882',

  // Backgrounds
  bg: '#0D0D1A',            // Near-black deep navy
  bgCard: '#15152A',        // Card surface
  bgElevated: '#1E1E38',    // Elevated elements
  bgInput: '#1A1A30',       // Input fields

  // Borders
  border: '#2A2A45',
  borderFocus: '#6C63FF',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#9090B0',
  textMuted: '#5A5A75',
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
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

export const Typography = {
  heading1: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5 },
  heading2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading3: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 22 },
  bodySmall: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.5 },
  caption: { fontSize: 11, fontWeight: '400' as const },
} as const;
