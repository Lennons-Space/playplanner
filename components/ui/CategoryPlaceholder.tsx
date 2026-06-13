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
}

export function CategoryPlaceholder({
  categorySlug,
  size,
  borderRadius = 18,
  fill = false,
  iconSize,
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
