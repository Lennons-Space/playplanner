// ─────────────────────────────────────────────────────────────────────────
// ExploreCard — large horizontal "Continue Exploring" card for the Home
// discovery row. Airbnb/editorial style: full-bleed image (or category
// placeholder), a dark bottom gradient, and overlaid venue name + meta.
//
// REAL DATA ONLY:
//   - rating shows ONLY when venue.review_count > 0 (never a fake "0.0").
//   - the context pill shows ONLY when a real reason is passed in.
//   - distance comes from the real distance_km.
// No popularity/"trending" claims are made anywhere.
//
// Layout note: the photo is an IN-FLOW layer with an explicit height so the
// fixed-height card never collapses (the absolute overlays alone would leave
// zero in-flow content — the same lesson as SmartFeaturedCard).
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FontFamily, BorderRadius } from '@/constants/theme';
import { getCategoryMeta } from '@/constants/categories';
import { CategoryPlaceholder } from '@/components/ui/CategoryPlaceholder';
import { Icon } from '@/components/ui/Icon';
// Minimal venue shape this card needs. A full `Venue` is structurally
// assignable, and so is the slim RecentlyViewedVenue — so one card serves both
// the "Continue Exploring" row and the "Recently viewed" row.
export interface ExploreCardVenue {
  id: string;
  name: string;
  cover_photo_url?: string | null;
  average_rating?: number;
  review_count?: number;
  distance_km?: number;
  category?: { slug?: string | null } | null;
}

const SIZES = {
  lg: { w: 210, h: 270, nameSize: 17, iconSize: 64 },
  sm: { w: 172, h: 212, nameSize: 15, iconSize: 52 },
} as const;

// Mirrors VenueCard2/SmartFeaturedCard formatter (km stored, shown in mi/m).
function formatDistance(km: number | undefined): string | null {
  if (km == null) return null;
  if (km < 1) return `${Math.round(km * 1000)}m`;
  const miles = km * 0.621371;
  return `${miles.toFixed(1)}mi`;
}

export interface ExploreCardProps {
  venue: ExploreCardVenue;
  onPress: () => void;
  /** A real "why this" reason. Pass null/undefined to hide (never fabricate). */
  contextTag?: string | null;
  /** 'lg' (Continue Exploring, default) or 'sm' (Recently viewed). */
  size?: 'lg' | 'sm';
}

export function ExploreCard({ venue, onPress, contextTag, size = 'lg' }: ExploreCardProps) {
  const { w, h, nameSize, iconSize } = SIZES[size];
  const categorySlug = venue.category?.slug ?? null;
  const meta = getCategoryMeta(categorySlug);
  const distanceText = formatDistance(venue.distance_km);
  const hasRating = (venue.review_count ?? 0) > 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${venue.name}`}
      style={({ pressed }) => ({
        width: w,
        height: h,
        borderRadius: 22,
        overflow: 'hidden',
        // Premium floating shadow — card is opaque, so elevation is safe.
        shadowColor: '#1A1208',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.2,
        shadowRadius: 20,
        elevation: 7,
        opacity: pressed ? 0.94 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      {/* In-flow photo layer — owns the card's fixed size. Uses NUMERIC width
          (not '100%') because percentage dimensions don't resolve inside a
          horizontal ScrollView (indefinite main axis), which collapsed the box
          and let the absolute overlays escape. */}
      <View style={{ width: w, height: h }}>
        {venue.cover_photo_url ? (
          <Image
            source={{ uri: venue.cover_photo_url }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            accessibilityLabel={`Photo of ${venue.name}`}
          />
        ) : (
          <CategoryPlaceholder categorySlug={categorySlug} fill iconSize={iconSize} borderRadius={0} />
        )}
      </View>

      <LinearGradient
        colors={['rgba(8,6,10,0.92)', 'rgba(8,6,10,0.25)', 'rgba(8,6,10,0)']}
        locations={[0, 0.5, 0.85]}
        start={{ x: 0, y: 1 }}
        end={{ x: 0, y: 0 }}
        style={{ position: 'absolute', inset: 0 }}
      />

      {/* Real context/reason pill (top-left) — only when provided */}
      {contextTag != null && (
        <View
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            maxWidth: w - 24,
            backgroundColor: 'rgba(255,255,255,0.18)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.18)',
            borderRadius: BorderRadius.pill,
            paddingHorizontal: 10,
            paddingVertical: 5,
          }}
        >
          <Text numberOfLines={1} style={{ fontFamily: FontFamily.bodyStrong, fontSize: 11.5, color: '#FFFFFF' }}>
            {contextTag}
          </Text>
        </View>
      )}

      {/* Name + meta */}
      <View style={{ position: 'absolute', left: 14, right: 14, bottom: 14 }}>
        <Text
          numberOfLines={2}
          style={{ fontFamily: FontFamily.display, fontSize: nameSize, color: '#FFFFFF', letterSpacing: -0.3, lineHeight: nameSize + 4, marginBottom: 6 }}
        >
          {venue.name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {distanceText != null && (
            <Text style={{ fontFamily: FontFamily.body, fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>
              {distanceText}
            </Text>
          )}
          {hasRating && (
            <>
              {distanceText != null && <Text style={{ color: 'rgba(255,255,255,0.4)' }}>·</Text>}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Icon name="star" size={12} color="#FFC53D" />
                <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 13, color: '#FFFFFF' }}>
                  {(venue.average_rating ?? 0).toFixed(1)}
                </Text>
              </View>
            </>
          )}
          <Text style={{ fontFamily: FontFamily.body, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
            {meta.label}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
