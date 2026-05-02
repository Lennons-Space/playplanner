// ─────────────────────────────────────────────────────────────────
// Chip.tsx — pill-shaped filter/tag button
//
// Used in search filter rows and category selectors.
// When active the chip fills with the category colour; when inactive
// it shows a bordered ghost pill — matching the Chip in components.jsx.
// ─────────────────────────────────────────────────────────────────

import React from 'react';
import { Pressable, Text, type PressableProps } from 'react-native';

interface ChipProps extends Omit<PressableProps, 'children' | 'style'> {
  /** Whether this chip is currently selected. */
  active?: boolean;
  /** Category colour — used as the active background. */
  color?: string;
  /** Inactive background tone. Defaults to white. */
  tone?: string;
  children: React.ReactNode;
}

export function Chip({ active = false, color, tone, onPress, children, ...rest }: ChipProps) {
  // Inline styles are used for dynamic colour values that can't be Tailwind classes.
  const bg = active ? (color ?? '#1D2630') : (tone ?? '#FFFFFF');
  const textColor = active ? '#FFFFFF' : '#1D2630';
  const borderColor = active ? 'transparent' : '#E6E2DB';

  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 9999, // pill
        backgroundColor: bg,
        borderWidth: active ? 0 : 1,
        borderColor,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
      }}
      {...rest}
    >
      {/* numberOfLines={1} prevents wrapping in horizontal filter rows. */}
      <Text
        numberOfLines={1}
        style={{
          fontFamily: 'Nunito-Bold',
          fontSize: 13,
          color: textColor,
        }}
      >
        {children}
      </Text>
    </Pressable>
  );
}
