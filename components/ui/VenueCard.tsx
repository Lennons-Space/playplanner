// ─────────────────────────────────────────────────────────────────
// VenueCard.tsx — rich venue card (reskin v2)
//
// Photo rule (user decision):
//   If cover_photo_url is set → show real photo via Image.
//   Otherwise → CategoryPlaceholder (soft tint + category icon).
//   NO VenueIllustration cartoon scenes.
// ─────────────────────────────────────────────────────────────────

import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { Venue } from '../../types';
import { getCategoryMeta } from '../../constants/categories';
import { computeIsOpenNow } from '../../lib/venueAttributes';
import { Colors, FontFamily, BorderRadius } from '@/constants/theme';
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
}

export function VenueCard({ venue, saved = false, onToggleSave, onPress, weatherBadge, familyBadges }: VenueCardProps) {
  const categorySlug = venue.category?.slug ?? null;
  const meta = getCategoryMeta(categorySlug);

  const openStatus = computeIsOpenNow(venue);
  const distanceText = formatDistance(venue.distance_km);
  const featured = isFeatured(venue);
  const hasRating = venue.review_count > 0;

  const primaryBadge = getPrimaryFamilyBadge(familyBadges);

  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: Colors.surface,
        borderRadius: BorderRadius.card,
        padding: 10,
        flexDirection: 'row',
        gap: 12,
        borderWidth: 1,
        borderColor: Colors.separator,
        // Retain subtle elevation — new design uses border as the primary
        // card boundary, with a lighter shadow underneath for depth on Android.
        shadowColor: Colors.label,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
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

        {featured && (
          <View
            style={{
              position: 'absolute',
              top: 6,
              left: 6,
              paddingHorizontal: 7,
              paddingVertical: 3,
              borderRadius: BorderRadius.pill,
              backgroundColor: Colors.label,
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
              color: Colors.label,
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
                color={saved ? Colors.coral : Colors.label3}
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
            <Text style={{ fontFamily: FontFamily.body, fontSize: 12, color: Colors.label3 }}>
              Ages {venue.min_age}–{venue.max_age}
            </Text>
          )}
        </View>

        {/* Rating + distance */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
          {hasRating ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Stars rating={venue.average_rating} size={12} />
              <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 12, color: Colors.label, marginLeft: 3 }}>
                {venue.average_rating.toFixed(1)}
              </Text>
              <Text style={{ fontFamily: FontFamily.body, fontSize: 12, color: Colors.label3 }}>
                ({venue.review_count})
              </Text>
            </View>
          ) : (
            <Text style={{ fontFamily: FontFamily.body, fontSize: 12, color: Colors.label3 }}>
              No reviews yet
            </Text>
          )}
          {distanceText != null && (
            <>
              <Text style={{ color: Colors.label3 }}>{'·'}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Icon name="walk" size={13} color={Colors.label3} />
                <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 12, color: Colors.label2 }}>
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
                backgroundColor: openStatus ? '#DCF4E4' : Colors.surface2,
              }}
            >
              <View
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: BorderRadius.pill,
                  backgroundColor: openStatus ? '#3CAE6B' : Colors.label3,
                }}
              />
              <Text
                style={{
                  fontFamily: FontFamily.caption,
                  fontSize: 10,
                  letterSpacing: 0.3,
                  color: openStatus ? '#2A7A4C' : Colors.label3,
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
