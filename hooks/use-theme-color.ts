/**
 * FaceScan uses a fixed dark theme.
 * This hook returns the color from our flat Colors palette, with an optional override.
 */

import { Colors } from '@/constants/theme';

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors
) {
  // Always dark mode — return override if provided, otherwise Colors value
  const colorFromProps = props['dark'] ?? props['light'];
  if (colorFromProps) return colorFromProps;
  return Colors[colorName];
}

