// ─────────────────────────────────────────────────────────────────
// VenueCard.tsx — rich venue card (Phase 1 redesign)
//
// Matches the VenueCard in components.jsx:
//   • 96×96 photo rail on the left
//   • Category pill, age range, rating, distance, open-now pill
//   • Featured badge overlay on the photo
//   • Save/unsave heart button
//
// Photo rule (user decision):
//   If cover_photo_url is set → show real photo via Image.
//   Otherwise → CategoryPlaceholder (soft tint + category icon).
//   NO VenueIllustration cartoon scenes.
//
// Why cover_photo_url?
//   The Venue type has `cover_photo_url?: string | null` which is
//   populated by the useVenues hook from the approved photos array.
//   This is the safest single-field photo source.
// ─────────────────────────────────────────────────────────────────

import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { Venue } from '../../types';
import { getCategoryMeta } from '../../constants/categories';
import { CategoryPlaceholder } from './CategoryPlaceholder';
import { Icon } from './Icon';
import { Stars } from './Stars';

// ── Open-now helper ────────────────────────────────────────────────
// The Venue type does not include a computed `openNow` boolean.
// We derive it from `opening_hours` if present, otherwise show nothing.
// This keeps the component self-contained without adding a new DB call.
function isOpenNow(venue: Venue): boolean | null {
  if (!venue.opening_hours || venue.opening_hours.length === 0) return null;
  const now = new Date();
  // 0 = Sunday in JS — same as the DB convention.
  const todayRow = venue.opening_hours.find((h) => h.day_of_week === now.getDay());
  if (!todayRow || todayRow.is_closed || !todayRow.opens_at || !todayRow.closes_at) return null;

  // Convert "HH:MM" strings to minutes-since-midnight for simple comparison.
  const toMins = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const nowMins = now.getHours() * 60 + now.getMinutes();
  return nowMins >= toMins(todayRow.opens_at) && nowMins < toMins(todayRow.closes_at);
}

// ── Distance formatter ─────────────────────────────────────────────
function formatDistance(km: number | undefined): string | null {
  if (km == null) return null;
  // Show metres below 1 km, miles above — matching UK convention.
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
}

export function VenueCard({ venue, saved = false, onToggleSave, onPress, weatherBadge }: VenueCardProps) {
  // Resolve category slug — the joined `category` object has the slug.
  const categorySlug = venue.category?.slug ?? null;
  const meta = getCategoryMeta(categorySlug);

  const openStatus = isOpenNow(venue);
  const distanceText = formatDistance(venue.distance_km);
  const featured = isFeatured(venue);

  // Rating display — only show if there are reviews.
  const hasRating = venue.review_count > 0;

  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 24,      // r-lg
        padding: 10,
        flexDirection: 'row',
        gap: 12,
        borderWidth: 1,
        borderColor: '#E6E2DB',
        // Subtle card shadow — numbers match design's box-shadow values.
        shadowColor: '#1D2630',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
        elevation: 3,
      }}
    >
      {/* ── Photo rail ── */}
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: 18,    // r-md
          overflow: 'hidden',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        {venue.cover_photo_url ? (
          <Image
            source={{ uri: venue.cover_photo_url }}
            style={{ width: 96, height: 96 }}
            resizeMode="cover"
            // accessibilityLabel keeps screen readers useful without leaking
            // raw URLs or internal IDs.
            accessibilityLabel={`Photo of ${venue.name}`}
          />
        ) : (
          <CategoryPlaceholder categorySlug={categorySlug} size={96} borderRadius={0} />
        )}

        {featured && (
          <View
            style={{
              position: 'absolute',
              top: 6,
              left: 6,
              paddingHorizontal: 7,
              paddingVertical: 3,
              borderRadius: 9999,
              backgroundColor: '#1D2630',
            }}
          >
            <Text
              style={{
                fontFamily: 'Nunito-ExtraBold',
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
                borderRadius: 9999,
                backgroundColor: 'rgba(20,28,38,0.72)',
              }}
            >
              <Text
                style={{
                  fontFamily: 'Nunito-Bold',
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
              fontFamily: 'Nunito-ExtraBold',
              fontSize: 16,
              color: '#1D2630',
              lineHeight: 19,
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
                color={saved ? '#FF6B6B' : '#7B8794'}
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
              borderRadius: 9999,
              backgroundColor: meta.soft,
            }}
          >
            <Text
              style={{
                fontFamily: 'Nunito-ExtraBold',
                fontSize: 10,
                color: meta.color,
                letterSpacing: 0.3,
              }}
            >
              {meta.label.toUpperCase()}
            </Text>
          </View>
          {(venue.min_age != null || venue.max_age != null) && (
            <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 12, color: '#7B8794' }}>
              Ages {venue.min_age}–{venue.max_age}
            </Text>
          )}
        </View>

        {/* Rating + distance */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
          {hasRating ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Stars rating={venue.average_rating} size={12} color="#F5A524" />
              <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 12, color: '#1D2630', marginLeft: 3 }}>
                {venue.average_rating.toFixed(1)}
              </Text>
              <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 12, color: '#7B8794' }}>
                ({venue.review_count})
              </Text>
            </View>
          ) : (
            <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 12, color: '#7B8794' }}>
              No reviews yet
            </Text>
          )}
          {distanceText != null && (
            <>
              <Text style={{ color: '#7B8794' }}>{'·'}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Icon name="walk" size={13} color="#7B8794" />
                <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 12, color: '#4A5560' }}>
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
                borderRadius: 9999,
                backgroundColor: openStatus ? '#DCF4E4' : '#F1ECE2',
              }}
            >
              {/* Dot indicator */}
              <View
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 9999,
                  backgroundColor: openStatus ? '#3CAE6B' : '#7B8794',
                }}
              />
              <Text
                style={{
                  fontFamily: 'Nunito-ExtraBold',
                  fontSize: 10,
                  letterSpacing: 0.3,
                  color: openStatus ? '#2A7A4C' : '#7B8794',
                }}
              >
                {openStatus ? 'OPEN NOW' : 'CLOSED'}
              </Text>
            </View>
          </View>
        )}
      </View>
    </Pressable>
  );
}
