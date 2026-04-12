/**
 * VenueCard — compact venue summary used in Search results and Favourites.
 *
 * Layout:
 *   [ icon pill ] [ name + subtext + rating ] [ featured badge (optional) ]
 *
 * The card is read-only — tapping it fires onPress so the parent can navigate
 * to the full venue detail screen. The heart / favourite state lives on the
 * detail screen, not here, to keep this component stateless and fast.
 *
 * Wrapped in React.memo so FlatList can skip re-renders for cards whose venue
 * prop hasn't changed. onPress must be stable (useCallback in the parent).
 */

import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';
import type { Venue } from '@/types';

// Human-readable labels for price range values stored as DB enums.
const PRICE_LABEL: Record<string, string> = {
  free:     'Free',
  budget:   '£',
  moderate: '££',
  premium:  '£££',
};

export interface VenueCardProps {
  venue: Venue;
  onPress: () => void;
}

function VenueCard({ venue, onPress }: VenueCardProps) {
  const priceLabel = venue.price_range ? PRICE_LABEL[venue.price_range] : null;

  // Build age-range chip text. Both min and max default to 0 in the DB schema
  // so we guard against showing "0–0 yrs".
  const hasAgeRange = venue.min_age > 0 || venue.max_age > 0;
  const ageLabel = hasAgeRange
    ? `${venue.min_age}–${venue.max_age} yrs`
    : null;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${venue.name}, ${venue.city}. Rating: ${venue.average_rating.toFixed(1)} out of 5.`}
    >
      {/* Left: category icon pill */}
      <View style={styles.iconPill}>
        <Text style={styles.iconEmoji}>{venue.category?.icon ?? '📍'}</Text>
      </View>

      {/* Centre: venue info */}
      <View style={styles.info}>
        {/* Name */}
        <Text style={styles.name} numberOfLines={1}>{venue.name}</Text>

        {/* City + category */}
        <Text style={styles.subtext} numberOfLines={1}>
          {venue.city}
          {venue.category?.name ? ` · ${venue.category.name}` : ''}
        </Text>

        {/* Rating */}
        <Text style={styles.rating}>
          {'★'} {venue.average_rating.toFixed(1)}
          <Text style={styles.reviewCount}> ({venue.review_count})</Text>
        </Text>

        {/* Chips row — price range + age range */}
        {(priceLabel || ageLabel) ? (
          <View style={styles.chipsRow}>
            {priceLabel ? (
              <View style={[styles.chip, styles.chipPrice]}>
                <Text style={styles.chipText}>{priceLabel}</Text>
              </View>
            ) : null}
            {ageLabel ? (
              <View style={[styles.chip, styles.chipAge]}>
                <Text style={styles.chipText}>{ageLabel}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* Right: "Featured" badge — only shown for premium venues */}
      {venue.is_premium ? (
        <View style={styles.featuredBadge}>
          <Text style={styles.featuredText}>Featured</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

export default memo(VenueCard);

// StyleSheet is used alongside NativeWind here because:
//   1. Shadow properties (shadowColor, shadowOffset, elevation) cannot be expressed
//      as NativeWind classes in a cross-platform way.
//   2. Dynamic values (chip colours from the theme) are cleaner as inline style objects
//      than interpolated className strings.
// NativeWind classes would still be preferred for layout on simpler components.
const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    // Cross-platform card shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  iconPill: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.sandDark,
    alignItems: 'center',
    justifyContent: 'center',
    // Prevent the icon pill from shrinking on small screens
    flexShrink: 0,
  },
  iconEmoji: {
    fontSize: 26,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontFamily: 'Nunito-Bold',
    color: Colors.charcoal,
  },
  subtext: {
    fontSize: 13,
    fontFamily: 'Nunito-Regular',
    color: Colors.grey,
  },
  rating: {
    fontSize: 13,
    fontFamily: 'Nunito-Bold',
    color: Colors.coral,
    marginTop: 2,
  },
  reviewCount: {
    fontSize: 12,
    fontFamily: 'Nunito-Regular',
    color: Colors.grey,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 11,
    fontFamily: 'Nunito-Bold',
    color: Colors.charcoal,
  },
  chipPrice: {
    backgroundColor: Colors.sandDark,
  },
  chipAge: {
    backgroundColor: Colors.sky + '33', // 20% opacity teal
  },
  featuredBadge: {
    backgroundColor: Colors.sun,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: 'flex-start',
    // Align to the top of the card so it sits in the corner even when
    // the info column is taller than the badge
    marginTop: 0,
    flexShrink: 0,
  },
  featuredText: {
    fontSize: 11,
    fontFamily: 'Nunito-Bold',
    color: Colors.charcoal,
  },
});
