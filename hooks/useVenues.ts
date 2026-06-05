import { useQuery, keepPreviousData } from '@tanstack/react-query';
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
// NOTE: `status` is included in the venue_photos join because it is required by
// the client-side filter on line ~79:
//   data.photos = data.photos.filter(photo => photo.status === 'approved')
// This is a second line of defence — the RLS policy is the primary control.
// `status` is consumed immediately inside the queryFn and is never surfaced to
// UI components; the Venue type exposed downstream does not include it per-photo.
export const VENUE_SELECT_BASE = `
  id, name, description, city, postcode, address_line1, address_line2,
  phone, website, price_range, min_age, max_age,
  is_published, is_verified, is_premium, review_count, average_rating,
  latitude, longitude, claimed_by, submitted_by,
  image_url, image_source, image_attribution, image_license, image_is_exact,
  category:categories(id, name, slug, icon, color),
  photos:venue_photos(id, url, is_cover, status, caption, sort_order),
  opening_hours(id, day_of_week, opens_at, closes_at, is_closed),
  facilities:venue_facilities(facility:facilities(id, name, slug, icon))
`;

export function useVenue(id: string) {
  return useQuery({
    queryKey: ['venue', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venues')
        .select(VENUE_SELECT_BASE)
        .eq('id', id)
        .eq('is_published', true)
        .eq('moderation_status', 'approved')
        // Hide venues the venue-review system flagged as 'exclude' (spam,
        // adult/gambling, no category). Defaults to true, so normal venues are
        // unaffected — this is an additional gate on top of moderation_status.
        .eq('discovery_approved', true)
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

      // Coerce numeric columns that Supabase serialises as strings.
      // average_rating is `numeric` in the DB — the JS client sends it as a
      // string to preserve exact precision. Callers (StarRating) call .toFixed(1)
      // which throws "toFixed is not a function" when the value is a string.
      return {
        ...data,
        average_rating: data.average_rating == null ? 0 : Number(data.average_rating),
      } as Venue;
    },
    staleTime: 60_000, // treat venue data as fresh for 1 min — prevents refetch on every nav back
    enabled: !!id,
  });
}

/** Fetch venues near a location, with optional filters.
 *  Pass enabled=false to suspend the query until real coordinates are ready
 *  (e.g. while useLocation is still resolving GPS — prevents a wasted London
 *  fallback request that would immediately be overwritten and cause a
 *  "pins flash then disappear" effect on the map). */
export function useNearbyVenues(coords: Coordinates, filters: VenueFilters, enabled = true) {
  return useQuery({
    // WHY we stringify filters into the key rather than spreading them:
    // React Query uses structural equality on the key, so a new filters object
    // with identical contents does NOT re-fetch. But FilterSheet writes back a
    // fresh object on every setFilters call — stringify gives us a stable
    // primitive that changes only when the filter VALUES change. This stops
    // spurious refetches that were causing the "pins flash then disappear"
    // symptom when other parts of the app touched the filter store.
    queryKey: [
      'venues',
      'nearby',
      coords.latitude,
      coords.longitude,
      filters.maxDistanceKm,
      filters.minAge,
      filters.maxAge,
      filters.openNow,
      filters.premiumOnly,
      filters.categoryIds.join(','),
      filters.facilityIds.join(','),
      filters.priceRange.join(','),
    ],
    // Also guard at runtime: useQuery's `enabled` accepts a boolean, but if
    // coords are ever accidentally passed as strings/NaN we must refuse the
    // query rather than send garbage to PostGIS.
    enabled:
      enabled &&
      Number.isFinite(coords.latitude) &&
      Number.isFinite(coords.longitude),
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

      // CRITICAL: the RPC declares latitude/longitude as PostgreSQL `numeric`,
      // which the Supabase JS client serialises as *strings* to preserve exact
      // precision. react-native-maps requires numeric coordinates — it will
      // render a marker once with string coords (the type coercion works for
      // the initial native bridge call) but silently drops that marker on any
      // subsequent re-render or region change. That is the exact "pins appear
      // briefly then disappear" bug.
      //
      // We coerce on the way out of the hook so every downstream consumer
      // (markers, list rows, detail links) sees real JS numbers. We also
      // reject any row where the cast produced NaN — that protects against
      // a row with genuinely corrupt lat/lng reaching the map.
      const rows = (data ?? []) as (Omit<Venue, 'latitude' | 'longitude' | 'average_rating'> & {
        latitude:         number | string | null | undefined;
        longitude:        number | string | null | undefined;
        average_rating:   number | string | null | undefined;
        has_hours:        boolean;
        distance_km:      number;
        cover_photo_url:  string | null | undefined;
      })[];

      // Helper: coerce to a finite number, or return NaN to signal "reject".
      // We must NOT use plain Number() because Number(null) === 0 and
      // Number('') === 0 — those would let a row with missing coordinates
      // survive the filter as coordinates (0, 0), placing ghost pins in the
      // Gulf of Guinea.
      function coerceCoord(raw: unknown): number {
        if (raw === null || raw === undefined || raw === '') return Number.NaN;
        const n = typeof raw === 'number' ? raw : Number(raw);
        return Number.isFinite(n) ? n : Number.NaN;
      }

      // IMPORTANT — migration 019 must be applied to the DB before this hook
      // works correctly. That migration:
      //   1. Adds p_facility_ids and p_premium_only parameters (this hook sends
      //      those — without migration 019 the RPC call will error or be ignored,
      //      returning zero results).
      //   2. Changes latitude/longitude from numeric → float8 so they arrive as
      //      JS numbers rather than strings.
      // If you see zero pins and no error, apply:
      //   supabase/migrations/019_nearby_venues_coord_types.sql
      // to your Supabase project via the SQL editor or `supabase db push`.

      return rows
        .map((row) => ({
          ...row,
          latitude:  coerceCoord(row.latitude),
          longitude: coerceCoord(row.longitude),
          // average_rating is declared as `numeric` in the RPC RETURNS TABLE
          // (migration 019 does not change it). The Supabase JS client may
          // serialise `numeric` as a string — coerce to a real number here so
          // callers can safely call .toFixed() without a runtime crash.
          average_rating: row.average_rating == null ? 0 : Number(row.average_rating),
        }))
        .filter(
          (row) =>
            Number.isFinite(row.latitude) && Number.isFinite(row.longitude),
        ) as (Venue & { has_hours: boolean; distance_km: number })[];
    },
    staleTime: 1000 * 60 * 2, // re-fetch after 2 minutes
    placeholderData: keepPreviousData,
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
          category:categories(id, name, slug, icon, color),
          photos:venue_photos(url, is_cover, status),
          opening_hours(id, day_of_week, opens_at, closes_at, is_closed)
        `)
        .eq('is_published', true)
        .eq('moderation_status', 'approved')
        // Same discovery gate as useVenue / get_nearby_venues — keep search
        // results consistent with what appears on the map and venue detail.
        .eq('discovery_approved', true)
        .ilike('name', `%${escapeLikePattern(query)}%`)
        .limit(30);

      if (error) throw error;
      // average_rating is a Postgres `numeric` column — Supabase JS serialises it
      // as a string to preserve precision. Coerce to a JS number here so callers
      // (VenueCard, accessibilityLabel) can call .toFixed(1) without crashing.
      return (data ?? []).map((row) => ({
        ...row,
        average_rating: row.average_rating == null ? 0 : Number(row.average_rating),
        // Second line of defence: filter out any unapproved photos so search
        // results cannot surface pending/rejected images via VenueCard.
        // The primary control is the RLS policy on venue_photos — this mirrors
        // the same client-side guard that useVenue applies (see VENUE_SELECT_BASE).
        photos: row.photos
          ? (row.photos as { url: string; is_cover: boolean; status: string }[]).filter(
              (p) => p.status === 'approved'
            )
          : [],
      })) as Venue[];
    },
    enabled: query.length >= 2,
    staleTime: 1000 * 60 * 5, // 5 min — search results don't change by the second
  });
}

/** Fetch all categories. Small table (~15 rows) — cached for 24h. */
export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, slug, icon, color')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 60 * 24,
  });
}
