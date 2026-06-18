// ─────────────────────────────────────────────────────────────────────────
// ExploreCard — horizontal discovery card with two layouts:
//   • size="lg" → large full-bleed image with the venue name/meta OVERLAID on a
//     dark gradient (used by "Continue Exploring").
//   • size="sm" → compact Airbnb-style card: image on top, caption (name /
//     rating / category) on a white surface BELOW (used by "Recently viewed").
//
// REAL DATA ONLY: rating shows only when review_count > 0; the context pill only
// when a real reason is passed; distance only when present (recents omit it).
//
// Layout note: the image is always an IN-FLOW layer with explicit NUMERIC
// dimensions — percentage sizes don't resolve inside a horizontal scroll, which
// collapses the box and lets absolute children escape (same lesson as the hero).
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FontFamily, BorderRadius, Themes } from '@/constants/theme';
import { getCategoryMeta } from '@/constants/categories';
import { CategoryPlaceholder } from '@/components/ui/CategoryPlaceholder';
import { Icon } from '@/components/ui/Icon';

const t = Themes.light;

// Minimal venue shape this card needs. A full `Venue` is structurally
// assignable, and so is the slim RecentlyViewedVenue.
export interface ExploreCardVenue {
  id: string;
  name: string;
  cover_photo_url?: string | null;
  average_rating?: number;
  review_count?: number;
  distance_km?: number;
  category?: { slug?: string | null } | null;
}

// Mirrors VenueCard/SmartFeaturedCard formatter (km stored, shown in mi/m).
function formatDistance(km: number | undefined): string | null {
  if (km == null) return null;
  if (km < 1) return `${Math.round(km * 1000)}m`;
  const miles = km * 0.621371;
  return `${miles.toFixed(1)}mi`;
}

export interface ExploreCardProps {
  venue: ExploreCardVenue;
  onPress: () => void;
  /** A real "why this" reason (lg/md overlay). Pass null/undefined to hide. */
  contextTag?: string | null;
  /** Real closing time "HH:MM" → green "Open · until …" pill (Open Now). Never fake. */
  openUntil?: string | null;
  /** 'lg' overlay (default) · 'md' overlay (Open Now) · 'sm' compact (Recently viewed). */
  size?: 'lg' | 'md' | 'sm';
}

export function ExploreCard({ venue, onPress, contextTag, openUntil, size = 'lg' }: ExploreCardProps) {
  const categorySlug = venue.category?.slug ?? null;
  const meta = getCategoryMeta(categorySlug);
  const distanceText = formatDistance(venue.distance_km);
  const hasRating = (venue.review_count ?? 0) > 0;

  // ── Compact card (Recently viewed): rounded image + caption BELOW, sitting
  //    directly in the paper bubble — no own white surface (avoids white-on-
  //    white) and softer shadow / more breathing room. Airbnb style. ─────────
  if (size === 'sm') {
    const W = 228;
    const IMG_H = 150;
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Open ${venue.name}`}
        style={({ pressed }) => ({ width: W, opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] })}
      >
        {/* Rounded image with a soft lift (opaque → elevation safe) */}
        <View
          style={{
            width: W,
            height: IMG_H,
            borderRadius: 16,
            overflow: 'hidden',
            backgroundColor: t.fill,
            shadowColor: '#1A1208',
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.12,
            shadowRadius: 10,
            elevation: 3,
          }}
        >
          {venue.cover_photo_url ? (
            <Image
              source={{ uri: venue.cover_photo_url }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              accessibilityLabel={`Photo of ${venue.name}`}
            />
          ) : (
            // Deliberate empty-image state: soft category-tinted surface + a
            // calm centred category icon (not a loading/broken-image look).
            <CategoryPlaceholder categorySlug={categorySlug} fill iconSize={52} borderRadius={0} />
          )}
        </View>

        {/* Caption — on the bubble (no card surface) */}
        <View style={{ paddingTop: 10 }}>
          <Text
            numberOfLines={2}
            style={{ fontFamily: FontFamily.bodyStrong, fontSize: 14.5, color: t.label, lineHeight: 18 }}
          >
            {venue.name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
            {hasRating && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Icon name="star" size={12} color={t.star} />
                <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 12, color: t.label }}>
                  {(venue.average_rating ?? 0).toFixed(1)}
                </Text>
              </View>
            )}
            <Text style={{ fontFamily: FontFamily.body, fontSize: 12, color: t.label3 }}>{meta.label}</Text>
          </View>
        </View>
      </Pressable>
    );
  }

  // ── Overlay card: 'lg' (Continue Exploring) or 'md' (Open Now) ───────────
  const W = 210;
  const H = size === 'md' ? 230 : 270;
  const nameSize = size === 'md' ? 16 : 17;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${venue.name}`}
      style={({ pressed }) => ({
        width: W,
        height: H,
        borderRadius: 22,
        overflow: 'hidden',
        shadowColor: '#1A1208',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.2,
        shadowRadius: 20,
        elevation: 7,
        opacity: pressed ? 0.94 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <View style={{ width: W, height: H }}>
        {venue.cover_photo_url ? (
          <Image
            source={{ uri: venue.cover_photo_url }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            accessibilityLabel={`Photo of ${venue.name}`}
          />
        ) : (
          <CategoryPlaceholder categorySlug={categorySlug} fill iconSize={64} borderRadius={0} />
        )}
      </View>

      <LinearGradient
        colors={['rgba(8,6,10,0.92)', 'rgba(8,6,10,0.25)', 'rgba(8,6,10,0)']}
        locations={[0, 0.5, 0.85]}
        start={{ x: 0, y: 1 }}
        end={{ x: 0, y: 0 }}
        style={{ position: 'absolute', inset: 0 }}
      />

      {/* Top-left pill: green "Open · until …" for Open Now, else the glass reason pill */}
      {openUntil != null ? (
        <View
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            maxWidth: W - 24,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: 'rgba(28,140,80,0.92)',
            borderRadius: BorderRadius.pill,
            paddingHorizontal: 10,
            paddingVertical: 5,
          }}
        >
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#BFF3D4' }} />
          <Text numberOfLines={1} style={{ fontFamily: FontFamily.bodyStrong, fontSize: 11.5, color: '#FFFFFF' }}>
            {`Open · until ${openUntil}`}
          </Text>
        </View>
      ) : contextTag != null ? (
        <View
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            maxWidth: W - 24,
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
      ) : null}

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
