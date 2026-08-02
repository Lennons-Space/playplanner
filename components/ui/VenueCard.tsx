// ─────────────────────────────────────────────────────────────────
// VenueCard.tsx — rich venue card (reskin v2)
//
// Photo rule (user decision):
//   If cover_photo_url is set → show real photo via Image.
//   Otherwise → CategoryPlaceholder (soft tint + category icon).
//   NO VenueIllustration cartoon scenes.
// ─────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { Venue } from '../../types';
import { getCategoryMeta } from '../../constants/categories';
import { computeIsOpenNow } from '../../lib/venueAttributes';
import { Colors, FontFamily, BorderRadius } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';
import type { WeatherTheme } from '@/lib/weatherTheme';
import { CategoryPlaceholder } from './CategoryPlaceholder';
import { Icon } from './Icon';
import { Stars } from './Stars';

// ── Distance formatter ─────────────────────────────────────────────
function formatDistance(km: number | undefined): string | null {
  if (km == null) return null;
  if (km < 1) return `${Math.round(km * 1000)}m`;
  const miles = km * 0.621371;
  return `${miles.toFixed(1)}mi`;
}

// ── Featured badge ─────────────────────────────────────────────────
const FEATURED_UNTIL_THRESHOLD = new Date();

function isFeatured(venue: Venue): boolean {
  if (!venue.featured_until) return false;
  return new Date(venue.featured_until) > FEATURED_UNTIL_THRESHOLD;
}

// ── Primary family badge ────────────────────────────────────────────
// Surfaces the single most contextually useful badge from the array.
// Priority is ordered by what parents most need to know at a glance:
// practical facility needs first, then contextual fit signals.
const BADGE_PRIORITY_SUBSTRINGS = [
  'baby change',
  'toilet',
  'parking',
  'indoor',
  'rainy day',
  'toddler friendly',
  'pushchair friendly',
];

function getPrimaryFamilyBadge(badges: string[] | undefined): string | null {
  if (!badges || badges.length === 0) return null;
  for (const needle of BADGE_PRIORITY_SUBSTRINGS) {
    const match = badges.find((b) => b.toLowerCase().includes(needle));
    if (match) return match;
  }
  return badges[0];
}

// ── Component ──────────────────────────────────────────────────────

export interface VenueCardProps {
  venue: Venue;
  /** Whether this venue is in the user's saved list. */
  saved?: boolean;
  /** Called when the heart icon is pressed. */
  onToggleSave?: () => void;
  /** Called when the card body is pressed. */
  onPress?: () => void;
  /**
   * Short weather-context label (e.g. "🌧 Great in rain") rendered as a
   * pill overlay on the photo rail. Pass null/undefined to hide the badge.
   */
  weatherBadge?: string | null;
  /**
   * Family-friendly badges derived from the venue data.
   * The highest-priority badge is shown as a single contextual pill.
   * Derived via generateRecommendationReasons() in
   * lib/recommendations/recommendationReasons.ts.
   */
  familyBadges?: string[];
  /**
   * Optional WeatherTheme. When it's a dark/"glass" theme (rain/night on Home),
   * the card switches from solid white paper to a soft frosted-glass surface
   * with light text so it reads as part of the weather environment. Omitted or
   * a light theme → byte-identical to the original solid card, so every other
   * screen that renders VenueCard is unaffected.
   */
  theme?: WeatherTheme;
}

export function VenueCard({ venue, saved = false, onToggleSave, onPress, weatherBadge, familyBadges, theme }: VenueCardProps) {
  const { tokens } = useAppTheme();
  const categorySlug = venue.category?.slug ?? null;
  const meta = getCategoryMeta(categorySlug);
  // A cover_photo_url that fails to actually load (broken link, deleted
  // storage object, transient network error) must fall back to the same
  // designed CategoryPlaceholder used when there's no photo at all — never a
  // blank/broken image box. Same pattern already established in
  // app/(tabs)/favourites.tsx's FavCard and app/explore/map.tsx's VenueRow.
  const [imgError, setImgError] = useState(false);
  const hasPhoto = !!venue.cover_photo_url && !imgError;

  // ── Solid-card theming ────────────────────────────────────────────────────
  // The solid ("paper") card now resolves its colours from the SAME
  // useAppTheme() tokens every other v2 screen uses (VenueCard2, Discover,
  // the collection page, Profile, Map — see hooks/useAppTheme.ts), instead of
  // the legacy light-only `Colors` export. In light mode these tokens are
  // byte-identical to the old Colors.* values (Themes.light.surface ===
  // Colors.surface === '#FFFFFF', etc. — see constants/theme.ts), so every
  // existing light-mode screen is visually unchanged. In dark mode the card
  // now correctly renders the v2 dark surface instead of a white "paper"
  // card with dark-on-light text (the bug this fixes).
  //
  // ── Glass theming (rain/night on Home only) ──────────────────────────────
  // Every override is gated on `glass`; when false we use the resolved
  // tokens above so the solid card matches the rest of the app's theme.
  const glass = theme?.card.style === 'glass';
  const cardBg = glass ? theme!.card.background : tokens.surface;
  const cardBorder = glass ? theme!.card.border : tokens.separator;
  const nameColor = glass ? theme!.text.primary : tokens.label; // card title
  const strongColor = glass ? theme!.text.primary : tokens.label; // rating value
  const secondaryColor = glass ? theme!.text.secondary : tokens.label2; // distance
  const mutedColor = glass ? theme!.text.tertiary : tokens.label3; // ages / dots / "no reviews"

  const openStatus = computeIsOpenNow(venue);
  const distanceText = formatDistance(venue.distance_km);
  const featured = isFeatured(venue);
  const hasRating = venue.review_count > 0;

  const primaryBadge = getPrimaryFamilyBadge(familyBadges);

  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: cardBg,
        borderRadius: BorderRadius.card,
        padding: 10,
        flexDirection: 'row',
        gap: 12,
        borderWidth: 1,
        borderColor: cardBorder,
        // Solid cards keep the crisp border + tight shadow. Glass cards use a
        // softer, more diffuse drop and no Android elevation (elevation on a
        // translucent surface reads as a hard grey slab). Shadow colour is a
        // fixed black in both cases — using a theme text token here would
        // paint a white shadow in dark mode, which is wrong regardless of
        // theme.
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: glass ? 8 : 2 },
        shadowOpacity: glass ? 0.18 : 0.05,
        shadowRadius: glass ? 18 : 8,
        elevation: glass ? 0 : 2,
      }}
    >
      {/* ── Photo rail ── */}
      <View
        style={{
          width: 92,
          height: 92,
          borderRadius: 15,
          overflow: 'hidden',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        {hasPhoto ? (
          <Image
            source={{ uri: venue.cover_photo_url! }}
            style={{ width: 92, height: 92 }}
            resizeMode="cover"
            accessibilityLabel={`Photo of ${venue.name}`}
            onError={() => setImgError(true)}
          />
        ) : (
          <CategoryPlaceholder categorySlug={categorySlug} size={92} borderRadius={0} />
        )}

        {featured && (
          <View
            style={{
              position: 'absolute',
              top: 6,
              left: 6,
              paddingHorizontal: 7,
              paddingVertical: 3,
              borderRadius: BorderRadius.pill,
              // Fixed dark scrim (not a theme token) — this badge overlays a
              // photo, so it needs stable contrast against white text in
              // both app themes, the same treatment as the weatherBadge
              // pill below rather than a mode-flipping label colour.
              backgroundColor: 'rgba(16,16,22,0.82)',
            }}
          >
            <Text
              style={{
                fontFamily: FontFamily.caption,
                fontSize: 9,
                color: '#FFFFFF',
                letterSpacing: 0.4,
              }}
            >
              FEATURED
            </Text>
          </View>
        )}

        {weatherBadge != null && (
          <View
            style={{
              position: 'absolute',
              bottom: 6,
              left: 0,
              right: 0,
              alignItems: 'center',
            }}
          >
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 3,
                borderRadius: BorderRadius.pill,
                backgroundColor: 'rgba(20,28,38,0.72)',
              }}
            >
              <Text
                style={{
                  fontFamily: FontFamily.caption,
                  fontSize: 9,
                  color: '#FFFFFF',
                  letterSpacing: 0.2,
                }}
                numberOfLines={1}
              >
                {weatherBadge}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* ── Detail stack ── */}
      <View style={{ flex: 1, minWidth: 0, justifyContent: 'space-between', paddingVertical: 2 }}>
        {/* Top row: name + save button */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <Text
            style={{
              fontFamily: FontFamily.display,
              fontSize: 17,
              color: nameColor,
              lineHeight: 20,
              flexShrink: 1,
            }}
            numberOfLines={2}
          >
            {venue.name}
          </Text>
          {onToggleSave != null && (
            <Pressable
              onPress={() => onToggleSave()}
              hitSlop={8}
              style={{ paddingTop: 2 }}
              accessibilityLabel={saved ? 'Remove from saved' : 'Save venue'}
              accessibilityRole="button"
            >
              <Icon
                name={saved ? 'heartFill' : 'heart'}
                size={20}
                color={saved ? Colors.coral : mutedColor}
              />
            </Pressable>
          )}
        </View>

        {/* Category pill + age range */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: BorderRadius.pill,
              backgroundColor: meta.soft,
            }}
          >
            <Text
              style={{
                fontFamily: FontFamily.caption,
                fontSize: 10,
                color: meta.color,
                letterSpacing: 0.3,
              }}
            >
              {meta.label.toUpperCase()}
            </Text>
          </View>
          {(venue.min_age != null || venue.max_age != null) && (
            <Text style={{ fontFamily: FontFamily.body, fontSize: 12, color: mutedColor }}>
              Ages {venue.min_age}–{venue.max_age}
            </Text>
          )}
        </View>

        {/* Rating + distance */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
          {hasRating ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Stars rating={venue.average_rating} size={12} />
              <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 12, color: strongColor, marginLeft: 3 }}>
                {venue.average_rating.toFixed(1)}
              </Text>
              <Text style={{ fontFamily: FontFamily.body, fontSize: 12, color: mutedColor }}>
                ({venue.review_count})
              </Text>
            </View>
          ) : (
            <Text style={{ fontFamily: FontFamily.body, fontSize: 12, color: mutedColor }}>
              No reviews yet
            </Text>
          )}
          {distanceText != null && (
            <>
              <Text style={{ color: mutedColor }}>{'·'}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Icon name="walk" size={13} color={mutedColor} />
                <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 12, color: secondaryColor }}>
                  {distanceText}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* Open/closed pill */}
        {openStatus != null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: BorderRadius.pill,
                // CLOSED fill uses the resolved fill token (subtle, theme-
                // appropriate tint) instead of the old hardcoded cream
                // (Colors.surface2) — the same flash-of-cream bug as
                // SkeletonLoader, just smaller. OPEN keeps its fixed mint
                // (a semantic status colour, not a surface).
                backgroundColor: openStatus ? '#DCF4E4' : tokens.fill,
              }}
            >
              <View
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: BorderRadius.pill,
                  backgroundColor: openStatus ? '#3CAE6B' : mutedColor,
                }}
              />
              <Text
                style={{
                  fontFamily: FontFamily.caption,
                  fontSize: 10,
                  letterSpacing: 0.3,
                  color: openStatus ? '#2A7A4C' : mutedColor,
                }}
              >
                {openStatus ? 'OPEN NOW' : 'CLOSED'}
              </Text>
            </View>
          </View>
        )}

        {/* Single contextual family badge — highest-priority signal from the array. */}
        {primaryBadge != null && (
          <View style={{ marginTop: 5 }}>
            <View
              style={{
                alignSelf: 'flex-start',
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: BorderRadius.pill,
                backgroundColor: Colors.accentLight,
              }}
            >
              <Text
                style={{
                  fontFamily: FontFamily.caption,
                  fontSize: 10,
                  color: Colors.accentTagText,
                  letterSpacing: 0.2,
                }}
                numberOfLines={1}
              >
                {primaryBadge.toUpperCase()}
              </Text>
            </View>
          </View>
        )}
      </View>
    </Pressable>
  );
}
