// ─────────────────────────────────────────────────────────────────
// IconBtn.tsx — round icon button
//
// Used for toolbar actions: filter, locate, back, close, etc.
// Matches IconBtn in components.jsx.
//
// Why Pressable not TouchableOpacity?
//   Pressable gives us finer-grained style feedback (pressed state)
//   and is the recommended modern API in React Native 0.64+.
// ─────────────────────────────────────────────────────────────────

import React from 'react';
import { Pressable, type PressableProps } from 'react-native';
import { Colors } from '@/constants/theme';

interface IconBtnProps extends Omit<PressableProps, 'style' | 'children'> {
  /** Icon or any node to render inside the button. */
  children: React.ReactNode;
  /** Button diameter in logical pixels. Default 40. */
  size?: number;
  /** Background colour. Defaults to Colors.surface. */
  tone?: string;
  /** Whether to render a border. Default true. */
  border?: boolean;
  /** Shadow style (optional — e.g. elevated map controls). */
  shadow?: boolean;
  /**
   * 'default' — standard round button (white/surface bg, separator border).
   * 'glass'   — dark translucent button for hero overlays (34px default, no border).
   */
  variant?: 'default' | 'glass';
}

export function IconBtn({
  children,
  size,
  tone,
  border = true,
  shadow = false,
  variant = 'default',
  onPress,
  accessibilityLabel,
  ...rest
}: IconBtnProps) {
  const isGlass = variant === 'glass';
  const resolvedSize = size ?? (isGlass ? 34 : 40);
  const resolvedTone = tone ?? (isGlass ? 'rgba(0,0,0,0.38)' : Colors.surface);
  const resolvedBorder = isGlass ? false : border;

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={({ pressed }) => ({
        width: resolvedSize,
        height: resolvedSize,
        borderRadius: resolvedSize / 2,
        backgroundColor: pressed
          ? (isGlass ? 'rgba(0,0,0,0.55)' : Colors.surface2)
          : resolvedTone,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: resolvedBorder ? 1 : 0,
        borderColor: Colors.separator,
        ...(shadow
          ? {
              shadowColor: Colors.label,
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.1,
              shadowRadius: 8,
              elevation: 3,
            }
          : {}),
      })}
      {...rest}
    >
      {children}
    </Pressable>
  );
}
