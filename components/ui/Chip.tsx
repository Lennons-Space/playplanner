// ─────────────────────────────────────────────────────────────────
// Chip.tsx — pill-shaped filter/tag button
//
// Used in search filter rows, category selectors, and facility tags.
// ─────────────────────────────────────────────────────────────────

import React from 'react';
import { Pressable, Text, type PressableProps } from 'react-native';
import { Colors, FontFamily } from '@/constants/theme';

interface ChipProps extends Omit<PressableProps, 'children' | 'style'> {
  /** Whether this chip is currently selected. */
  active?: boolean;
  /** Category/accent colour — used as the active background fill. */
  color?: string;
  /** Inactive background tone. Defaults to Colors.surface. */
  tone?: string;
  /**
   * 'default'  — standard filter/category chip (Hanken Bold, uppercase caption style).
   * 'facility' — venue facility tag (Hanken Medium, sentence case, lighter weight).
   */
  variant?: 'default' | 'facility';
  children: React.ReactNode;
}

export function Chip({
  active = false,
  color,
  tone,
  variant = 'default',
  onPress,
  children,
  ...rest
}: ChipProps) {
  const isFacility = variant === 'facility';

  const bg          = active ? (color ?? Colors.accent) : (tone ?? Colors.surface);
  const textColor   = active ? '#FFFFFF' : Colors.label;
  const borderColor = active ? 'transparent' : Colors.separator;

  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 9999,
        backgroundColor: bg,
        borderWidth: active ? 0 : 1,
        borderColor,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
      }}
      {...rest}
    >
      <Text
        numberOfLines={1}
        style={{
          fontFamily: isFacility ? FontFamily.body : FontFamily.caption,
          fontSize: 13,
          color: textColor,
        }}
      >
        {children}
      </Text>
    </Pressable>
  );
}
