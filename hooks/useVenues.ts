import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Venue, VenueFilters, Coordinates } from '@/types';

/** Fetch a single venue by ID with all related data */
export function useVenue(id: string) {
  return useQuery({
    queryKey: ['venue', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venues')
        .select(`
          *,
          category:categories(*),
          photos:venue_photos(*),
          opening_hours(*),
          facilities:venue_facilities(facility:facilities(*))
        `)
        .eq('id', id)
        .eq('is_published', true)
        .eq('moderation_status', 'approved')
        .single();
      if (error) throw error;
      return data as Venue;
    },
    enabled: !!id,
  });
}

/** Fetch venues near a location, with optional filters */
export function useNearbyVenues(coords: Coordinates, filters: VenueFilters) {
  return useQuery({
    queryKey: ['venues', 'nearby', coords, filters],
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
    queryKey: ['venues', 'search', query, coords],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venues')
        .select('*, category:categories(*), photos:venue_photos(url, is_cover)')
        .eq('is_published', true)
        .eq('moderation_status', 'approved')
        .ilike('name', `%${query}%`)
        .limit(30);
      if (error) throw error;
      return (data ?? []) as Venue[];
    },
    enabled: query.length >= 2,
  });
}
