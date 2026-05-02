// ─────────────────────────────────────────────────────────────────
// VenueMini.tsx — compact venue card (64×64 photo, single-line meta)
//
// Used in bottom sheets, horizontal scroll carousels, and map pop-ups.
// Matches VenueMini in components.jsx.
//
// Same photo rule as VenueCard: real photo if available, otherwise
// CategoryPlaceholder — no cartoons.
// ─────────────────────────────────────────────────────────────────

import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { Venue } from '../../types';
import { getCategoryMeta } from '../../constants/categories';
import { CategoryPlaceholder } from './CategoryPlaceholder';
import { Icon } from './Icon';

// ── Price range formatter ─────────────────────────────────────────
// Converts DB enum value to a user-facing string.
// Matches the design's `v.priceLabel` concept.
const PRICE_LABELS: Record<string, string> = {
  free:     'Free',
  budget:   '£',
  moderate: '££',
  premium:  '£££',
};

function priceLabel(venue: Venue): string {
  if (!venue.price_range) return '';
  return PRICE_LABELS[venue.price_range] ?? '';
}

function formatDistanceMini(km: number | undefined): string | null {
  if (km == null) return null;
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${(km * 0.621371).toFixed(1)}mi`;
}

// ── Component ──────────────────────────────────────────────────────

export interface VenueMiniProps {
  venue: Venue;
  saved?: boolean;
  onToggleSave?: () => void;
  onPress?: () => void;
}

export function VenueMini({ venue, saved = false, onToggleSave, onPress }: VenueMiniProps) {
  const categorySlug = venue.category?.slug ?? null;
  const meta = getCategoryMeta(categorySlug);
  const distText = formatDistanceMini(venue.distance_km);
  const price = priceLabel(venue);

  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 18,      // r-md
        padding: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderWidth: 1,
        borderColor: '#E6E2DB',
        minWidth: 240,
      }}
    >
      {/* ── Thumbnail ── */}
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 12,    // r-sm
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {venue.cover_photo_url ? (
          <Image
            source={{ uri: venue.cover_photo_url }}
            style={{ width: 64, height: 64 }}
            resizeMode="cover"
            accessibilityLabel={`Photo of ${venue.name}`}
          />
        ) : (
          <CategoryPlaceholder categorySlug={categorySlug} size={64} borderRadius={0} />
        )}
      </View>

      {/* ── Text stack ── */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            fontFamily: 'Nunito-ExtraBold',
            fontSize: 13,
            color: '#1D2630',
          }}
          numberOfLines={1}
        >
          {venue.name}
        </Text>

        <Text
          style={{
            fontFamily: 'Nunito-Regular',
            fontSize: 11,
            color: '#7B8794',
            marginTop: 2,
          }}
          numberOfLines={1}
        >
          {meta.label}
          {distText ? ` · ${distText}` : ''}
        </Text>

        {/* Rating + price in a single row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
          <Icon name="star" size={11} color="#F5A524" />
          <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 11, color: '#1D2630' }}>
            {venue.review_count > 0 ? venue.average_rating.toFixed(1) : '–'}
          </Text>
          {price ? (
            <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 11, color: '#7B8794' }}>
              {'· '}{price}
            </Text>
          ) : null}
        </View>
      </View>

      {/* ── Save button ── */}
      <Pressable
        onPress={onToggleSave}
        hitSlop={8}
        accessibilityLabel={saved ? 'Remove from saved' : 'Save venue'}
        accessibilityRole="button"
        style={{ paddingHorizontal: 4 }}
      >
        <Icon
          name={saved ? 'heartFill' : 'heart'}
          size={18}
          color={saved ? '#FF6B6B' : '#7B8794'}
        />
      </Pressable>
    </Pressable>
  );
}
