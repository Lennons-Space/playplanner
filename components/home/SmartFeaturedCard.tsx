// ─────────────────────────────────────────────────────────────────────────
// SmartFeaturedCard — the hero "Good for today" card on the Home screen.
//
// Ported from the design handoff's SmartFeaturedCard (pp2-home.jsx), restyled
// with useAppTheme() tokens for chrome that sits OUTSIDE the photo (there is
// none — the card is full-bleed), but using the EXACT glass/gradient values
// from the README for the overlays on top of the photo, which are
// theme-independent (always white text on a dark photo-gradient).
//
// Spec (README "Good for today" — smart featured card):
//   - Tall magazine cover (460px), large radius (64), full-bleed image.
//   - Bottom gradient rgba(8,6,10,0.94) → transparent at 72%, via
//     expo-linear-gradient (already installed).
//   - Top-left: price/"Free entry" dark-glass pill — ONLY if
//     venue.price_range is set (no fabricated prices).
//   - Top-right: 40px circular button → venue detail (no save mutation
//     exists yet, see hard constraint 8 — pressing always opens the venue).
//   - Bottom stack: open-status glass pill (green dot + "Open now · till X")
//     ONLY when both computeIsOpenNow() AND a closing time are known; venue
//     name (26px/700/display, white); rating · type · distance row; up to 3
//     "why" glass pills from generateRecommendationReasons().
//
// "Glass" pills here are emulated with semi-opaque rgba(...) View
// backgrounds — expo-blur is not installed (hard constraint 7).
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, FontFamily, BorderRadius } from '@/constants/theme';
import { getCategoryMeta } from '@/constants/categories';
import { computeIsOpenNow } from '@/lib/venueAttributes';
import { generateRecommendationReasons } from '@/lib/recommendations/recommendationReasons';
import { CategoryPlaceholder } from '@/components/ui/CategoryPlaceholder';
import { Icon } from '@/components/ui/Icon';
import { Stars } from '@/components/ui/Stars';
import type { Venue } from '@/types';

function formatDistance(km: number | undefined): string | null {
  if (km == null) return null;
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${(km * 0.621371).toFixed(1)}mi`;
}

// ── Price pill text ──────────────────────────────────────────────────────
// Only rendered when venue.price_range is set — never fabricated.
function pricePillText(venue: Venue): string | null {
  switch (venue.price_range) {
    case 'free':
      return 'Free entry';
    case 'budget':
      return '£ Budget-friendly';
    case 'moderate':
      return '££ Moderate';
    case 'premium':
      return '£££ Premium';
    default:
      return null;
  }
}

// ── "Open now · till X" — only when BOTH are confirmed ─────────────────────
// computeIsOpenNow() can return true without a parseable closing time (e.g.
// is_closed/opens_at/closes_at edge cases already filtered there, but we
// re-derive the display string defensively). If we can't produce an honest
// "till HH:MM", we don't show the pill at all rather than show a bare
// "Open now" that implies a closing time we don't have.
function openUntilText(venue: Venue): string | null {
  if (computeIsOpenNow(venue) !== true) return null;
  const today = new Date().getDay();
  const row = venue.opening_hours?.find((h) => h.day_of_week === today);
  if (!row || row.is_closed || !row.closes_at) return null;
  // "17:00" -> "5pm"; "17:30" -> "5:30pm"
  const [hStr, mStr] = row.closes_at.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const time = m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, '0')}${period}`;
  return `Open now · till ${time}`;
}

export interface SmartFeaturedCardProps {
  venue: Venue;
  onPress: () => void;
  /**
   * Curation reasons from curateVenues() — e.g. the weather-context badge
   * ("🌧 Great in rain") computed from the enriched venue.category +
   * current weather. These are prepended to generateRecommendationReasons()
   * (deduped, capped at 3) so the hero card surfaces the SAME "why now"
   * signal a parent would see elsewhere on Home, not just static
   * category/rating facts.
   */
  contextReasons?: string[];
  /** Whether this venue is in the user's saved list (drives the heart icon). */
  saved?: boolean;
  /** Called when the save heart is pressed. Omit to hide the heart. */
  onToggleSave?: () => void;
}

export function SmartFeaturedCard({ venue, onPress, contextReasons = [], saved = false, onToggleSave }: SmartFeaturedCardProps) {
  const categorySlug = venue.category?.slug ?? null;
  const meta = getCategoryMeta(categorySlug);

  const pricePill = pricePillText(venue);
  const openPill = openUntilText(venue);
  const distance = formatDistance(venue.distance_km);
  const hasRating = (venue.review_count ?? 0) > 0;
  // Up to 3 honest "why" pills: curation reasons first, then recommendation
  // reasons (deduped). Never fabricated — all derive from real venue data.
  const whyReasons = Array.from(
    new Set([...contextReasons, ...generateRecommendationReasons(venue)]),
  ).slice(0, 3);

  return (
    // Plain, static, in-flow card — NO Animated/reanimated wrapper. The root
    // Pressable itself owns the fixed height + overflow clip, so the column
    // layout always reserves a 380px box and the absolute children
    // (image/gradient/pills/overlay) are clipped inside it and can never escape
    // upward over the "Good for today" heading or age chips.
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${venue.name}`}
      style={({ pressed }) => ({
        height: 440,
        width: '100%',
        position: 'relative',
        borderRadius: BorderRadius.featured,
        overflow: 'hidden',
        // Editorial magazine cover — soft, diffuse shadow only. This is the
        // dominant object on Home, but the lift stays gentle (cream-paper feel).
        // Opaque card, so Android elevation is safe (no translucent-plate artifact).
        shadowColor: '#1A1208',
        shadowOffset: { width: 0, height: 18 },
        shadowOpacity: 0.16,
        shadowRadius: 40,
        elevation: 8,
        opacity: pressed ? 0.94 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
        {/* ── Full-bleed photo (IN-FLOW layer) ──
            This View is the card's single in-flow child, with an explicit
            height equal to the card. It exists so the root has real in-flow
            content: with only position:absolute children, the box collapsed to
            0 height (the explicit height didn't hold) and the bottom-anchored
            overlay escaped upward over the headings. The image/placeholder fill
            this layer; the gradient + pills + text overlay it absolutely. */}
        <View style={{ width: '100%', height: 440 }}>
          {venue.cover_photo_url ? (
            <Image
              source={{ uri: venue.cover_photo_url }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              accessibilityLabel={`Photo of ${venue.name}`}
            />
          ) : (
            <CategoryPlaceholder categorySlug={categorySlug} fill iconSize={60} borderRadius={0} />
          )}
        </View>

        {/* ── Bottom gradient — rgba(8,6,10,0.94) -> transparent at 72% ── */}
        <LinearGradient
          colors={['rgba(8,6,10,0.96)', 'rgba(8,6,10,0.45)', 'rgba(8,6,10,0)']}
          locations={[0, 0.42, 0.8]}
          start={{ x: 0, y: 1 }}
          end={{ x: 0, y: 0 }}
          style={{ position: 'absolute', inset: 0 }}
        />

        {/* ── Top-left: price / "Free entry" glass pill ── */}
        {pricePill != null && (
          <View
            style={{
              position: 'absolute',
              top: 16,
              left: 16,
              backgroundColor: 'rgba(20,18,24,0.7)',
              borderRadius: BorderRadius.pill,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.12)',
              paddingHorizontal: 12,
              paddingVertical: 6,
            }}
          >
            <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 12, color: '#FFFFFF' }}>
              {pricePill}
            </Text>
          </View>
        )}

        {/* ── Top-right: save heart (dark glass circle) ── */}
        {onToggleSave != null && (
          <Pressable
            onPress={onToggleSave}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={saved ? 'Remove from saved' : 'Save venue'}
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(20,18,24,0.55)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.12)',
            }}
          >
            <Icon name={saved ? 'heartFill' : 'heart'} size={20} color={saved ? Colors.coral : '#FFFFFF'} />
          </Pressable>
        )}

        {/* ── Bottom content stack — magazine cover: open pill, big name, one
            honest editorial reason, large soft Explore pill. ── */}
        <View style={{ position: 'absolute', left: 24, right: 24, bottom: 26 }}>
          {openPill != null && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                alignSelf: 'flex-start',
                backgroundColor: 'rgba(255,255,255,0.14)',
                borderRadius: BorderRadius.pill,
                paddingHorizontal: 11,
                paddingVertical: 5,
                marginBottom: 12,
              }}
            >
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#5BD08A' }} />
              <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 12, color: '#FFFFFF' }}>
                {openPill}
              </Text>
            </View>
          )}

          <Text
            style={{
              fontFamily: FontFamily.display,
              fontSize: 26,
              color: '#FFFFFF',
              letterSpacing: -0.5,
              lineHeight: 30,
            }}
            numberOfLines={2}
          >
            {venue.name}
          </Text>

          {/* Rating · type · distance row (real data; pieces hide when absent). */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {hasRating && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Stars rating={venue.average_rating} size={13} />
                <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 14.5, color: '#FFFFFF' }}>
                  {venue.average_rating.toFixed(1)}
                </Text>
              </View>
            )}
            <Text style={{ fontFamily: FontFamily.body, fontSize: 14, color: 'rgba(255,255,255,0.85)' }}>
              {meta.label}
            </Text>
            {distance != null && (
              <Text style={{ fontFamily: FontFamily.body, fontSize: 14, color: 'rgba(255,255,255,0.85)' }}>
                · {distance}
              </Text>
            )}
          </View>

          {/* Up to 3 honest "why" glass pills (with white checkmark). */}
          {whyReasons.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
              {whyReasons.map((reason) => (
                <View
                  key={reason}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                    backgroundColor: 'rgba(255,255,255,0.16)',
                    borderRadius: BorderRadius.pill,
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.18)',
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                  }}
                >
                  <Icon name="check" size={12} color="#FFFFFF" />
                  <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 12, color: '#FFFFFF' }} numberOfLines={1}>
                    {reason}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </Pressable>
  );
}
