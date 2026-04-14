import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Venue, VenueFilters, Coordinates, VenuePhoto } from '@/types';

/**
 * Sanitise a user-typed search string before it is used in a SQL ILIKE pattern.
 *
 * WHY THIS IS NEEDED (SQL wildcard injection):
 * In SQL, ILIKE uses '%' as "match anything" and '_' as "match one character".
 * If a user types "soft%play" or "kids_zone", those characters are treated as
 * wildcards, which can make the query return wrong results — and in some edge
 * cases could be used to probe the database. The backslash tells Postgres to
 * treat the character as a literal rather than a wildcard.
 *
 * Example: "soft%play" → "soft\%play" (matches only the literal string)
 */
function escapeLikePattern(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&');
}

/** Fetch a single venue by ID with all related data */
export function useVenue(id: string) {
  return useQuery({
    queryKey: ['venue', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venues')
        .select(`
          id, name, description, city, postcode, address_line1, address_line2,
          phone, website, price_range, min_age, max_age,
          is_published, is_verified, is_premium, review_count, average_rating,
          latitude, longitude, claimed_by, submitted_by,
          category:categories(id, name, icon, color),
          photos:venue_photos(id, url, is_cover, status, caption, sort_order),
          opening_hours(id, day_of_week, opens_at, closes_at, is_closed),
          facilities:venue_facilities(facility:facilities(id, name, icon))
        `)
        .eq('id', id)
        .eq('is_published', true)
        .eq('moderation_status', 'approved')
        .single();
      if (error) throw error;

      // Security: filter out any photos that have not been approved by a moderator.
      // Without this filter, an attacker who uploads a photo and bypasses the
      // moderation queue could surface unapproved content (e.g. inappropriate images)
      // to all users viewing the venue. We enforce approval client-side here as a
      // second line of defence — the primary control is the RLS policy on venue_photos.
      if (data?.photos) {
        data.photos = (data.photos as VenuePhoto[]).filter(
          (photo) => photo.status === 'approved'
        );
      }

      return data as Venue;
    },
    staleTime: 60_000, // treat venue data as fresh for 1 min — prevents refetch on every nav back
    enabled: !!id,
  });
}

/** Fetch venues near a location, with optional filters */
export function useNearbyVenues(coords: Coordinates, filters: VenueFilters) {
  return useQuery({
    queryKey: ['venues', 'nearby', coords.latitude, coords.longitude, filters],
    queryFn: async () => {
      // Use Supabase RPC (stored function) for PostGIS distance query
      const { data, error } = await supabase.rpc('get_nearby_venues', {
        lat:            coords.latitude,
        lng:            coords.longitude,
        p_radius_km:    filters.maxDistanceKm,   // renamed in SQL function
        category_ids:   filters.categoryIds.length ? filters.categoryIds : null,
        p_min_age:      filters.minAge,           // renamed in SQL function
        p_max_age:      filters.maxAge,           // renamed in SQL function
        price_ranges:   filters.priceRange.length ? filters.priceRange : null,
        open_now:       filters.openNow,
        p_facility_ids: filters.facilityIds.length ? filters.facilityIds : null,
        p_premium_only: filters.premiumOnly,
      });
      if (error) throw error;
      // has_hours is returned alongside each venue.
      // When has_hours = false and the user filtered by "open now", the venue
      // screen should show "Opening hours not confirmed" — the venue is included
      // because its hours are unknown, not because it is confirmed open.
      return (data ?? []) as (Venue & { has_hours: boolean; distance_km: number })[];
    },
    staleTime: 1000 * 60 * 2, // re-fetch after 2 minutes
  });
}

/** Search venues by text query */
export function useVenueSearch(query: string, coords: Coordinates) {
  return useQuery({
    // coords is intentionally excluded from the key — text search is location-agnostic.
    // Including it caused every GPS tick to invalidate the cache and fire a redundant request.
    queryKey: ['venues', 'search', query],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venues')
        .select(`
          id, name, city, postcode,
          average_rating, review_count,
          is_verified, is_premium,
          min_age, max_age, price_range,
          latitude, longitude,
          category:categories(id, name, icon, color),
          photos:venue_photos(url, is_cover, status)
        `)
        .eq('is_published', true)
        .eq('moderation_status', 'approved')
        // escapeLikePattern prevents SQL wildcard injection — see function above.
        .ilike('name', `%${escapeLikePattern(query)}%`)
        .limit(30);
      if (error) throw error;
      return (data ?? []) as Venue[];
    },
    enabled: query.length >= 2,
    staleTime: 1000 * 60 * 5, // 5 min — search results don't change by the second
  });
}
