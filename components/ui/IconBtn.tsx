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

interface IconBtnProps extends Omit<PressableProps, 'style' | 'children'> {
  /** Icon or any node to render inside the button. */
  children: React.ReactNode;
  /** Button diameter in logical pixels. Default 40. */
  size?: number;
  /** Background colour. Default white (#FFFFFF). */
  tone?: string;
  /** Whether to render a border. Default true. */
  border?: boolean;
  /** Shadow style (optional — e.g. elevated map controls). */
  shadow?: boolean;
}

export function IconBtn({
  children,
  size = 40,
  tone = '#FFFFFF',
  border = true,
  shadow = false,
  onPress,
  accessibilityLabel,
  ...rest
}: IconBtnProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2, // always a perfect circle
        backgroundColor: pressed ? '#F1ECE2' : tone,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: border ? 1 : 0,
        borderColor: '#E6E2DB',
        // Shadow is only applied when explicitly requested to avoid
        // performance cost on lists with many IconBtns.
        ...(shadow
          ? {
              shadowColor: '#1D2630',
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
