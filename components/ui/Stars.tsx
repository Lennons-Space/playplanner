// ─────────────────────────────────────────────────────────────────
// Stars.tsx — 5-star rating row
//
// Renders filled stars up to Math.round(rating), outlined stars for
// the remainder. Matches the Stars component in components.jsx.
// ─────────────────────────────────────────────────────────────────

import React from 'react';
import { View } from 'react-native';
import { Icon } from './Icon';

interface StarsProps {
  /** Numeric rating 0–5 (decimals are rounded to nearest integer). */
  rating: number;
  /** Icon size in logical pixels. Default 12. */
  size?: number;
  /** Fill colour for active stars. Default pp-star amber. */
  color?: string;
}

export function Stars({ rating, size = 12, color = '#F5A524' }: StarsProps) {
  const rounded = Math.round(Math.max(0, Math.min(5, rating)));

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon
          key={i}
          name={i <= rounded ? 'star' : 'starLine'}
          size={size}
          color={color}
        />
      ))}
    </View>
  );
}
