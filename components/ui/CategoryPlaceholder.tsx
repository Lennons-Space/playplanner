// ─────────────────────────────────────────────────────────────────
// CategoryPlaceholder.tsx — photo fallback for venues with no image
//
// User decision: no cartoon VenueIllustration scenes.
// When a venue has no approved photo, we render a solid soft-tint
// background in the category colour with the category icon centred.
//
// This is the ONLY place that imports the Icon component for category
// rendering, keeping the logic in one file.
// ─────────────────────────────────────────────────────────────────

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { getCategoryMeta } from '../../constants/categories';

interface CategoryPlaceholderProps {
  /** Category slug from the venue row (e.g. 'soft-play', 'park'). */
  categorySlug: string | null | undefined;
  /**
   * Fixed square container size in logical pixels (width = height). Used for
   * thumbnails. Ignored when `fill` is set.
   */
  size?: number;
  /** Border radius of the container. */
  borderRadius?: number;
  /**
   * Fill the parent (StyleSheet.absoluteFill) instead of a fixed square. Use
   * for full-bleed hero/cover areas where the parent already has a fixed height
   * and `overflow: 'hidden'` — this prevents a fixed square from over/under-
   * shooting the card width and looking like it "escapes" the image area.
   */
  fill?: boolean;
  /** Explicit icon size. Defaults to ~35% of `size` (or 96 when filling). */
  iconSize?: number;
  /**
   * 'soft' (default): light category-tint background — used on light surfaces
   * (list thumbnails). 'dark': a dark v2 base with the category icon inside a
   * soft category-tinted disc — used behind the dark Home hero card, where the
   * light 'soft' tint reads as a jarring bright block under the dark gradient.
   */
  variant?: 'soft' | 'dark';
}

// hex ('#RRGGBB') -> rgba() at the given alpha. Category colours in the
// CATEGORIES map are 6-digit hex, so this builds the dark variant's soft accent
// disc without pulling in a colour library.
function tint(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return `rgba(255,255,255,${a})`;
  return `rgba(${r},${g},${b},${a})`;
}

// Dark v2 base — matches the Themes.dark surface family (constants/theme.ts).
const DARK_BASE = '#16141C';

export function CategoryPlaceholder({
  categorySlug,
  size,
  borderRadius = 18,
  fill = false,
  iconSize,
  variant = 'soft',
}: CategoryPlaceholderProps) {
  const meta = getCategoryMeta(categorySlug);

  // Icon is shown at ~35% of the container size (or an explicit iconSize),
  // which keeps it visually centred without being too large or too small.
  const resolvedIconSize = iconSize ?? Math.round((size ?? 96) * 0.35);

  // getCategoryMeta guarantees the icon string comes from our controlled
  // CATEGORIES map, so the cast to IconName is safe. If someone adds a new
  // category slug with an unmapped icon, getCategoryMeta returns CATEGORY_FALLBACK
  // which uses 'map' — a valid IconName.
  const iconName = meta.icon as IconName;

  // Dark variant: dark base + the category icon inside a soft category-tinted
  // disc (same treatment as the v2 intent-chip icon boxes), so it reads as an
  // intentional dark placeholder rather than a bright block. Icon colour is
  // lifted slightly for contrast against the dark base.
  if (variant === 'dark') {
    const disc = Math.round(resolvedIconSize * 1.9);
    return (
      <View
        style={[
          fill ? StyleSheet.absoluteFill : { width: size, height: size },
          {
            borderRadius,
            backgroundColor: DARK_BASE,
            alignItems: 'center',
            justifyContent: 'center',
          },
        ]}
      >
        <View
          style={{
            width: disc,
            height: disc,
            borderRadius: disc / 2,
            backgroundColor: tint(meta.color, 0.16),
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={iconName} size={resolvedIconSize} color={tint(meta.color, 0.9)} strokeWidth={1.75} />
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        fill ? StyleSheet.absoluteFill : { width: size, height: size },
        {
          borderRadius,
          backgroundColor: meta.soft,
          alignItems: 'center',
          justifyContent: 'center',
        },
      ]}
    >
      <Icon name={iconName} size={resolvedIconSize} color={meta.color} strokeWidth={1.75} />
    </View>
  );
}
