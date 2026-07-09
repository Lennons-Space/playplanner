// ─────────────────────────────────────────────────────────────────────────
// SmartFeaturedCard — the hero "Good for today" card on the v2 Home screen.
//
// Ported from the design handoff's SmartFeaturedCard (pp2-home.jsx) and the
// ground-truth screenshot (screens/01-home-dark.png), which shows a full-photo
// hero card with a price/free-entry pill, a save heart, an "Open now · till X"
// pill, the venue name, a rating/type/distance row and honest "why" pills —
// this is a DIFFERENT, richer component to the "EditorialCollectionHero" also
// present in pp2-home.jsx (a plain gradient+emoji "Collection" card): that one
// is a different hero used elsewhere in the prototype, not what "Good for
// today" actually renders. See the final report for this discrepancy.
//
// Spec (README "Good for today" — smart featured card):
//   - Tall magazine cover, BorderRadius.featured (26), full-bleed image.
//     Height is RESPONSIVE (getFeaturedCardHeight: 48% of window height,
//     clamped 340–430) — the handoff's fixed 440px was mockup-scale and
//     buried the bottom-anchored info below the fold on real Android phones.
//   - Bottom gradient rgba(8,6,10,0.94) → transparent at 72%.
//   - Top-left: price/"Free entry" dark-glass pill — ONLY if
//     venue.price_range is set (no fabricated prices).
//   - Top-right: 40px circular glass save-heart — only rendered when a save
//     handler is provided (NearbyPreview, an orphaned pre-v2 consumer of this
//     component, does not pass one, so no heart renders there — unchanged
//     behaviour for that screen).
//   - Bottom stack: open-status glass pill (green dot + "Open now · till X")
//     ONLY when both computeIsOpenNow() AND a closing time are known; venue
//     name (26px/700/display, white); rating · type · distance row; up to 3
//     "why" glass pills from generateRecommendationReasons().
//
// The price pill / save heart / open pill / why pills are real BlurView glass
// (components/ui/GlassSurface) — this card renders once per screen, so the
// native compositing cost of a few blurred pills is negligible. Compare
// VenueCard2's thumbnail price badge, which stays a plain semi-opaque View
// because it repeats once per list row.
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, FontFamily, BorderRadius, Shadow } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { getCategoryMeta } from '@/constants/categories';
import { computeIsOpenNow } from '@/lib/venueAttributes';
import { generateRecommendationReasons } from '@/lib/recommendations/recommendationReasons';
import { CategoryPlaceholder } from '@/components/ui/CategoryPlaceholder';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { Icon } from '@/components/ui/Icon';
import { Stars } from '@/components/ui/Stars';
import type { Venue } from '@/types';

function formatDistance(km: number | undefined): string | null {
  if (km == null) return null;
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${(km * 0.621371).toFixed(1)}mi`;
}

// ── Responsive card height (2026-07-08 Android correction pass) ────────────
// The handoff's fixed 440px magazine cover was mockup-scale: on a ~700dp
// Android viewport the card started so far down the page that only its top
// (image + heart) was visible above the tab bar — the bottom-anchored venue
// info never made the first screen. 48% of the window height, clamped to
// 340–430, keeps the magazine-cover feel while fitting real phones:
//   ~640dp phone → 340 · ~740dp → 355 · ~800dp → 384 · ≥900dp → 430.
// Exported so Home's loading skeleton (and tests) use the same formula.
export function getFeaturedCardHeight(windowHeight: number): number {
  return Math.min(430, Math.max(340, Math.round(windowHeight * 0.48)));
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
// Exported: VenueCard2 reuses closesAtText() for its "Open till X" row.
export function closesAtText(venue: Venue): string | null {
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
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, '0')}${period}`;
}

function openUntilText(venue: Venue): string | null {
  const time = closesAtText(venue);
  return time != null ? `Open now · till ${time}` : null;
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
  const { tokens, accent } = useAppTheme();
  const { height: windowHeight } = useWindowDimensions();
  const cardHeight = getFeaturedCardHeight(windowHeight);
  const categorySlug = venue.category?.slug ?? null;
  const meta = getCategoryMeta(categorySlug);

  const pricePill = pricePillText(venue);
  const openPill = openUntilText(venue);
  const distance = formatDistance(venue.distance_km);
  const hasRating = (venue.review_count ?? 0) > 0;
  // Honest "why" pills: curation reasons first, then recommendation reasons
  // (deduped). Never fabricated — all derive from real venue data. Capped at
  // 2 on compact cards (<380dp) so the bottom stack never crowds the name.
  const whyReasons = Array.from(
    new Set([...contextReasons, ...generateRecommendationReasons(venue)]),
  ).slice(0, cardHeight < 380 ? 2 : 3);

  return (
    // Plain, static, in-flow card — NO Animated/reanimated wrapper. The root
    // Pressable itself owns the fixed height + overflow clip, so the column
    // layout always reserves a 440px box and the absolute children
    // (image/gradient/pills/overlay) are clipped inside it and can never escape
    // upward over the "Good for today" heading or age chips.
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${venue.name}`}
      style={({ pressed }) => ({
        height: cardHeight,
        width: '100%',
        position: 'relative',
        borderRadius: BorderRadius.featured,
        overflow: 'hidden',
        // Reconciled with the theme's single hero-shadow recipe (Shadow.featured)
        // rather than a bespoke shadow — the previous orphaned variant of this
        // component and the tab bar's own hero styling had drifted onto two
        // different shadow recipes for the same card type.
        ...Shadow.featured,
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
        <View style={{ width: '100%', height: '100%' }}>
          {venue.cover_photo_url ? (
            <Image
              source={{ uri: venue.cover_photo_url }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              accessibilityLabel={`Photo of ${venue.name}`}
            />
          ) : (
            <CategoryPlaceholder categorySlug={categorySlug} fill iconSize={60} borderRadius={0} variant="dark" />
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

        {/* ── Top-left: price / "Free entry" dark-glass pill ── */}
        {pricePill != null && (
          <GlassSurface
            intensity={24}
            tintColor="rgba(20,18,24,0.7)"
            style={{
              position: 'absolute',
              top: 16,
              left: 16,
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
          </GlassSurface>
        )}

        {/* ── Top-right: save heart (dark glass circle) ── */}
        {onToggleSave != null && (
          <Pressable
            onPress={onToggleSave}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={saved ? 'Remove from saved' : 'Save venue'}
            style={{ position: 'absolute', top: 16, right: 16 }}
          >
            <GlassSurface
              intensity={24}
              tintColor="rgba(20,18,24,0.55)"
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.12)',
              }}
            >
              <Icon name={saved ? 'heartFill' : 'heart'} size={20} color={saved ? Colors.coral : '#FFFFFF'} />
            </GlassSurface>
          </Pressable>
        )}

        {/* ── Bottom content stack — magazine cover: open pill, big name, one
            honest editorial reason, large soft Explore pill. ── */}
        <View style={{ position: 'absolute', left: 18, right: 18, bottom: 16 }}>
          {openPill != null && (
            <GlassSurface
              intensity={16}
              tint="light"
              tintColor="rgba(255,255,255,0.14)"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                alignSelf: 'flex-start',
                borderRadius: BorderRadius.pill,
                paddingHorizontal: 11,
                paddingVertical: 5,
                marginBottom: 9,
              }}
            >
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#5BD08A' }} />
              <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 12, color: '#FFFFFF' }}>
                {openPill}
              </Text>
            </GlassSurface>
          )}

          <Text
            style={{
              fontFamily: FontFamily.display,
              fontSize: 22,
              color: '#FFFFFF',
              letterSpacing: -0.4,
              lineHeight: 26,
            }}
            numberOfLines={2}
          >
            {venue.name}
          </Text>

          {/* Rating · type · distance row (real data; pieces hide when absent). */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            {hasRating && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Stars rating={venue.average_rating} size={13} color={tokens.star} />
                <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 14, color: '#FFFFFF' }}>
                  {venue.average_rating.toFixed(1)}
                </Text>
              </View>
            )}
            <Text style={{ fontFamily: FontFamily.body, fontSize: 13.5, color: 'rgba(255,255,255,0.85)' }}>
              {meta.label}
            </Text>
            {distance != null && (
              <Text style={{ fontFamily: FontFamily.body, fontSize: 13.5, color: 'rgba(255,255,255,0.85)' }}>
                · {distance}
              </Text>
            )}
          </View>

          {/* Bottom row: honest "why" glass pills (left, wrapping) + a clear
              go-CTA disc (right) so the card reads as an actionable feature,
              not a mute image. The disc is decorative affordance — the whole
              card is the pressable. */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 10 }}>
            <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {whyReasons.map((reason) => (
                <GlassSurface
                  key={reason}
                  intensity={16}
                  tint="light"
                  tintColor="rgba(255,255,255,0.16)"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
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
                </GlassSurface>
              ))}
            </View>
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                flexShrink: 0,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: accent.accent,
              }}
            >
              <Icon name="arrow" size={17} color="#FFFFFF" />
            </View>
          </View>
        </View>
      </Pressable>
  );
}
