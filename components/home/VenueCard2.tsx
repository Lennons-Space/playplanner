// ─────────────────────────────────────────────────────────────────────────
// VenueCard2 — the Browse (Home) venue list row (Play Planner v2).
//
// Spec (README "Venue list" / pp2-home VenueCard2):
//   surface card, 20px radius, 1px separator border, 11px padding.
//   92×92 thumbnail (15px radius) with an optional dark-glass price badge
//   (bottom-left). Title 17px/display, truncated. A CONTEXTUAL TAG pill
//   (accentLight bg / accent text) shows the specific reason this venue matches
//   the active filter. Meta row: type · distance. Rating + open-status row.
//
// All values are real venue data; the contextual tag is computed honestly in
// lib/homeIntents.getContextTag from the active intent/age (which this venue
// already matched). No fabricated prices/ratings.
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { Venue } from '@/types';
import { Colors, FontFamily, BorderRadius } from '@/constants/theme';
import { getCategoryMeta } from '@/constants/categories';
import { computeIsOpenNow } from '@/lib/venueAttributes';
import { CategoryPlaceholder } from '@/components/ui/CategoryPlaceholder';
import { Icon } from '@/components/ui/Icon';
import { Stars } from '@/components/ui/Stars';

function formatDistance(km: number | undefined): string | null {
  if (km == null) return null;
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${(km * 0.621371).toFixed(1)}mi`;
}

function priceBadge(venue: Venue): string | null {
  switch (venue.price_range) {
    case 'free':
      return 'Free';
    case 'budget':
      return '£';
    case 'moderate':
      return '££';
    case 'premium':
      return '£££';
    default:
      return null;
  }
}

export interface VenueCard2Props {
  venue: Venue;
  /** Honest contextual reason pill (from getContextTag). Hidden when null. */
  contextTag?: string | null;
  onPress: () => void;
}

export function VenueCard2({ venue, contextTag, onPress }: VenueCard2Props) {
  const categorySlug = venue.category?.slug ?? null;
  const meta = getCategoryMeta(categorySlug);
  const price = priceBadge(venue);
  const open = computeIsOpenNow(venue);
  const distance = formatDistance(venue.distance_km);
  const hasRating = (venue.review_count ?? 0) > 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={venue.name}
      style={({ pressed }) => ({
        backgroundColor: Colors.surface,
        borderRadius: BorderRadius.card,
        padding: 11,
        flexDirection: 'row',
        gap: 12,
        borderWidth: 1,
        borderColor: Colors.separator,
        opacity: pressed ? 0.94 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      {/* ── Thumbnail ── */}
      <View style={{ width: 92, height: 92, borderRadius: 15, overflow: 'hidden', flexShrink: 0 }}>
        {venue.cover_photo_url ? (
          <Image
            source={{ uri: venue.cover_photo_url }}
            style={{ width: 92, height: 92 }}
            resizeMode="cover"
            accessibilityLabel={`Photo of ${venue.name}`}
          />
        ) : (
          <CategoryPlaceholder categorySlug={categorySlug} size={92} borderRadius={0} />
        )}
        {price != null && (
          <View
            style={{
              position: 'absolute',
              bottom: 6,
              left: 6,
              backgroundColor: 'rgba(12,12,17,0.78)',
              borderRadius: BorderRadius.pill,
              paddingHorizontal: 7,
              paddingVertical: 2,
            }}
          >
            <Text style={{ fontFamily: FontFamily.caption, fontSize: 10, color: '#FFFFFF', letterSpacing: 0.2 }}>
              {price}
            </Text>
          </View>
        )}
      </View>

      {/* ── Detail stack ── */}
      <View style={{ flex: 1, minWidth: 0, justifyContent: 'center', gap: 4 }}>
        <Text
          style={{ fontFamily: FontFamily.display, fontSize: 17, color: Colors.label, letterSpacing: -0.3, lineHeight: 20 }}
          numberOfLines={1}
        >
          {venue.name}
        </Text>

        {contextTag != null && (
          <View
            style={{
              alignSelf: 'flex-start',
              backgroundColor: Colors.accentLight,
              borderRadius: BorderRadius.pill,
              paddingHorizontal: 8,
              paddingVertical: 2,
            }}
          >
            <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 12, color: Colors.accentTagText }} numberOfLines={1}>
              {contextTag}
            </Text>
          </View>
        )}

        {/* Meta: type · distance */}
        <Text style={{ fontFamily: FontFamily.body, fontSize: 13, color: Colors.label3 }} numberOfLines={1}>
          {meta.label}
          {distance != null ? ` · ${distance}` : ''}
        </Text>

        {/* Rating + open status */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {hasRating ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Stars rating={venue.average_rating} size={12} />
              <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 12, color: Colors.label2, marginLeft: 2 }}>
                {venue.average_rating.toFixed(1)}
              </Text>
            </View>
          ) : (
            <Text style={{ fontFamily: FontFamily.body, fontSize: 12, color: Colors.label3 }}>No reviews yet</Text>
          )}
          {open != null && (
            <>
              <Text style={{ color: Colors.label4 }}>·</Text>
              <Text
                style={{
                  fontFamily: FontFamily.bodyStrong,
                  fontSize: 12,
                  color: open ? '#5BD08A' : Colors.label3,
                }}
              >
                {open ? 'Open now' : 'Closed'}
              </Text>
            </>
          )}
          {open == null && distance == null && (
            <Icon name="pin" size={12} color={Colors.label4} />
          )}
        </View>
      </View>
    </Pressable>
  );
}
