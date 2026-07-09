// ─────────────────────────────────────────────────────────────────────────
// VenueCard2 — the Browse (Home) venue list row (Play Planner v2).
//
// EXACT-V2 SOURCE (final pp2-home.jsx `VenueCard2`, as rendered by
// Play Planner v2.html): row card — surface bg (dimmed fill when closed),
// 20px radius, 11px padding, hairline ring. 82×82 thumbnail (14px radius;
// closed → dark overlay + "CLOSED"). Info stack: near-square contextual tag
// chip (r5, accent), name 16/700 body-family truncated, meta row with a
// 7px category-colour dot + type · distance, then a single star glyph +
// rating and the open status ("Open till X" green / red CLOSED badge).
// Right: a 34×34 heart save button. The prototype's thumbnail price badge
// and "duration" meta belong to the older iteration / mock data — price is
// dropped per final jsx, and duration is OMITTED because the real app has
// no honest duration source (no fabricated data).
//
// All values are real venue data; the contextual tag is computed honestly in
// lib/homeIntents.getContextTag from the active intent (which this venue
// already matched). The heart is wired to the app's REAL favourites
// mutation by the parent (Home passes saved + onToggleSave).
//
// Android safety: plain Views only — no BlurView in repeated list rows.
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { Venue } from '@/types';
import { Colors, FontFamily, BorderRadius } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { getCategoryMeta } from '@/constants/categories';
import { computeIsOpenNow } from '@/lib/venueAttributes';
import { closesAtText } from '@/components/home/SmartFeaturedCard';
import { CategoryPlaceholder } from '@/components/ui/CategoryPlaceholder';
import { Icon } from '@/components/ui/Icon';

function formatDistance(km: number | undefined): string | null {
  if (km == null) return null;
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${(km * 0.621371).toFixed(1)}mi`;
}

export interface VenueCard2Props {
  venue: Venue;
  /** Honest contextual reason pill (from getContextTag). Hidden when null. */
  contextTag?: string | null;
  onPress: () => void;
  /** Whether this venue is in the user's saved list (drives the heart). */
  saved?: boolean;
  /** Real favourites toggle. Omit to hide the heart button. */
  onToggleSave?: () => void;
}

export function VenueCard2({ venue, contextTag, onPress, saved = false, onToggleSave }: VenueCard2Props) {
  const { tokens, accent } = useAppTheme();
  const categorySlug = venue.category?.slug ?? null;
  const meta = getCategoryMeta(categorySlug);
  const open = computeIsOpenNow(venue);
  const closes = open === true ? closesAtText(venue) : null;
  const distance = formatDistance(venue.distance_km);
  const hasRating = (venue.review_count ?? 0) > 0;
  const isClosed = open === false;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={venue.name}
      // STATIC style only — NativeWind 4 interop drops Pressable
      // style-as-function props on device (2026-07-09 screenshot debugging);
      // press feedback via android_ripple instead of opacity/scale.
      android_ripple={{ color: 'rgba(255,255,255,0.07)', foreground: true }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        // Closed venues sit back on a dim fill instead of the surface card
        // (prototype: rgba(255,255,255,0.035) in dark mode).
        backgroundColor: isClosed ? 'rgba(255,255,255,0.035)' : tokens.surface,
        borderRadius: BorderRadius.card,
        padding: 11,
        borderWidth: 1,
        borderColor: tokens.separator,
        overflow: 'hidden',
      }}
    >
      {/* ── Thumbnail (82×82, r14; closed → dark overlay + CLOSED) ── */}
      <View style={{ width: 82, height: 82, borderRadius: 14, overflow: 'hidden', flexShrink: 0 }}>
        {venue.cover_photo_url ? (
          <Image
            source={{ uri: venue.cover_photo_url }}
            style={{ width: 82, height: 82 }}
            resizeMode="cover"
            accessibilityLabel={`Photo of ${venue.name}`}
          />
        ) : (
          <CategoryPlaceholder categorySlug={categorySlug} size={82} borderRadius={0} variant="dark" />
        )}
        {isClosed && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.4)',
            }}
          >
            <Text
              style={{
                fontFamily: FontFamily.caption,
                fontSize: 9,
                color: 'rgba(255,255,255,0.75)',
                textTransform: 'uppercase',
                letterSpacing: 0.9,
              }}
            >
              Closed
            </Text>
          </View>
        )}
      </View>

      {/* ── Detail stack ── */}
      <View style={{ flex: 1, minWidth: 0 }}>
        {contextTag != null && (
          <View
            style={{
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              backgroundColor: accent.light,
              borderRadius: 5,
              paddingHorizontal: 7,
              paddingVertical: 2,
              marginBottom: 4,
            }}
          >
            <Icon name="check" size={9} color={accent.accent} strokeWidth={3} />
            <Text style={{ fontFamily: FontFamily.caption, fontSize: 11, color: accent.accent }} numberOfLines={1}>
              {contextTag}
            </Text>
          </View>
        )}

        <Text
          style={{
            fontFamily: FontFamily.bodyStrong,
            fontSize: 16,
            color: tokens.label,
            letterSpacing: -0.3,
            lineHeight: 19,
            marginBottom: 3,
          }}
          numberOfLines={1}
        >
          {venue.name}
        </Text>

        {/* Meta: category dot + type · distance. (Prototype "duration" is
            omitted — the real app has no honest duration source.) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: meta.color, flexShrink: 0 }} />
          <Text style={{ fontFamily: FontFamily.body, fontSize: 13.5, color: tokens.label3 }} numberOfLines={1}>
            {meta.label}
            {distance != null ? `  ·  ${distance}` : ''}
          </Text>
        </View>

        {/* Rating + open status */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {hasRating ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Icon name="star" size={12} color="#FFC53D" />
              <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 13, color: tokens.label }}>
                {venue.average_rating.toFixed(1)}
              </Text>
            </View>
          ) : (
            <Text style={{ fontFamily: FontFamily.body, fontSize: 12, color: tokens.label3 }}>No reviews yet</Text>
          )}
          {open != null && <Text style={{ color: tokens.label4, fontSize: 11 }}>·</Text>}
          {open === true && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: '#34C77B',
                  shadowColor: '#34C77B',
                  shadowOpacity: 0.5,
                  shadowRadius: 3,
                  shadowOffset: { width: 0, height: 0 },
                }}
              />
              <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 13, color: '#4BD68C' }}>
                {closes != null ? `Open till ${closes}` : 'Open now'}
              </Text>
            </View>
          )}
          {isClosed && (
            <View
              style={{
                backgroundColor: 'rgba(255,80,80,0.14)',
                borderRadius: 6,
                paddingHorizontal: 8,
                paddingVertical: 3,
              }}
            >
              <Text
                style={{
                  fontFamily: FontFamily.caption,
                  fontSize: 11,
                  color: '#FF8080',
                  textTransform: 'uppercase',
                  letterSpacing: 0.66,
                }}
              >
                Closed
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Heart save button (34×34, real favourites) ── */}
      {onToggleSave != null && (
        <Pressable
          onPress={onToggleSave}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={saved ? 'Remove from saved' : 'Save venue'}
          android_ripple={{ color: 'rgba(255,255,255,0.12)', foreground: true }}
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            flexShrink: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: tokens.fill,
            overflow: 'hidden',
          }}
        >
          <Icon
            name={saved ? 'heartFill' : 'heart'}
            size={16}
            color={saved ? Colors.coral : tokens.label3}
            strokeWidth={2}
          />
        </Pressable>
      )}
    </Pressable>
  );
}
