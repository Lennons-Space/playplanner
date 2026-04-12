/**
 * Search tab — text search with live results + category filter support.
 *
 * Privacy note:
 * useLocation() is intentionally NOT called here. Search is text-based and
 * does not require GPS. Using FALLBACK_LOCATION for the "recent venues"
 * fallback means we never trigger the OS location permission dialog from
 * this screen — which would bypass the LocationConsentPrompt flow required
 * by ICO Children's Code Standard 10.
 *
 * Filter integration:
 * When search has results, we apply the active VenueFilters client-side
 * (on the ≤30-row result set). This avoids coupling the Supabase text-search
 * query to the PostGIS RPC and keeps the search hook simple. For the empty-query
 * "recent venues" fallback we pass filters into useNearbyVenues so the RPC
 * handles them server-side.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useVenueSearch, useNearbyVenues } from '@/hooks/useVenues';
import { useFilterStore } from '@/store/filterStore';
import FilterSheet from '@/components/filters/FilterSheet';
import VenueCard from '@/components/venue/VenueCard';
import { FALLBACK_LOCATION } from '@/constants/location';
import { Colors } from '@/constants/theme';
import type { Venue, VenueFilters, PriceRange } from '@/types';

// ─── Debounce hook ────────────────────────────────────────────────────────────
// Waits until the user stops typing for `delayMs` before updating the value.
// This prevents a database query firing on every single keystroke.
function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

// ─── Client-side filter helper ────────────────────────────────────────────────
// Applies the active VenueFilters to a list of venues returned by text search.
// Text search uses a simple ILIKE query — it doesn't go through the PostGIS RPC
// that handles server-side filters — so we enforce them here instead.
function applyFiltersToResults(venues: Venue[], filters: VenueFilters): Venue[] {
  return venues.filter((v) => {
    if (filters.categoryIds.length && v.category_id && !filters.categoryIds.includes(v.category_id)) {
      return false;
    }
    if (filters.priceRange.length && v.price_range && !(filters.priceRange as PriceRange[]).includes(v.price_range)) {
      return false;
    }
    if (filters.minAge !== null && v.max_age < filters.minAge) return false;
    if (filters.maxAge !== null && v.min_age > filters.maxAge) return false;
    return true;
  });
}

// ─── SearchScreen ─────────────────────────────────────────────────────────────
export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const debouncedQuery    = useDebounce(query, 300);

  const [filterSheetVisible, setFilterSheetVisible] = useState(false);

  const filters           = useFilterStore((s) => s.filters);
  const activeFilterCount = useFilterStore((s) => s.activeFilterCount());

  // Text search — only fires when debouncedQuery.length >= 2 (enforced in the hook).
  const {
    data: searchResults = [],
    isLoading: searchLoading,
  } = useVenueSearch(debouncedQuery, FALLBACK_LOCATION);

  // "Recent / nearby" fallback shown when the search box is empty.
  // Uses FALLBACK_LOCATION (central London) to avoid any GPS access.
  const {
    data: recentVenues = [],
    isLoading: recentLoading,
  } = useNearbyVenues(FALLBACK_LOCATION, filters);

  // Stable callbacks — prevent child components re-rendering on parent state changes.
  const handleFiltersPress = useCallback(() => setFilterSheetVisible(true), []);
  const handleFilterSheetClose = useCallback(() => setFilterSheetVisible(false), []);

  // Decide which data set to show and apply client-side filters to search results.
  const isSearchActive = debouncedQuery.length >= 2;
  const isLoading      = isSearchActive ? searchLoading : recentLoading;

  // Memoised so the filtered list only recalculates when search results or filters change,
  // not on every render triggered by the text input.
  const displayedVenues: Venue[] = useMemo(() => {
    if (!isSearchActive) return recentVenues as Venue[];
    return applyFiltersToResults(searchResults, filters);
  }, [isSearchActive, searchResults, recentVenues, filters]);

  // Navigation handler — takes an id string so it remains stable across renders.
  // renderItem still creates an inline closure `() => handleVenuePress(item.id)`
  // which gives VenueCard a new onPress reference on each parent render. Because
  // the parent only re-renders after the 300ms debounce resolves (not per keystroke)
  // and the list is capped at 30 rows, this is an acceptable tradeoff. If the list
  // grows significantly, extract a memoised VenueCardRow wrapper that closes over
  // the id and passes a stable onPress to VenueCard.
  const handleVenuePress = useCallback((id: string) => {
    router.push(`/venue/${id}`);
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-sand" edges={['top']}>
      {/* ── Header + search bar ─────────────────────────────── */}
      <View className="px-4 pt-4 pb-3">
        <Text
          className="text-2xl text-charcoal mb-3"
          style={{ fontFamily: 'Nunito-ExtraBold' }}
        >
          Search
        </Text>

        <View className="flex-row items-center gap-2">
          {/* Search input */}
          <View className="flex-1 flex-row items-center bg-white rounded-2xl px-4 py-3 gap-2"
            style={{
              borderWidth: 1,
              borderColor: Colors.greyLighter,
            }}
          >
            <Text style={{ color: Colors.grey, fontSize: 16 }}>🔍</Text>
            <TextInput
              className="flex-1 text-charcoal text-base"
              style={{ fontFamily: 'Nunito-Regular' }}
              placeholder="Search venues, parks, soft plays..."
              placeholderTextColor={Colors.greyLight}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              // Prevents capitalising the first letter, which would break search
              // for things like "softplay" typed as "Softplay".
              autoCapitalize="none"
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>

          {/* Filter button */}
          <TouchableOpacity
            className="bg-white rounded-2xl px-4 py-3 flex-row items-center gap-1"
            style={{
              borderWidth: 1,
              borderColor: activeFilterCount > 0 ? Colors.coral : Colors.greyLighter,
            }}
            onPress={handleFiltersPress}
            accessibilityRole="button"
            accessibilityLabel={`Filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ''}`}
          >
            <Text style={{ fontFamily: 'Nunito-Bold', color: Colors.charcoal, fontSize: 14 }}>
              Filters
            </Text>
            {activeFilterCount > 0 && (
              <View
                className="rounded-full w-5 h-5 items-center justify-center"
                style={{ backgroundColor: Colors.coral }}
              >
                <Text
                  style={{ color: Colors.white, fontSize: 11, fontFamily: 'Nunito-Bold' }}
                >
                  {activeFilterCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Section label — changes depending on whether user is searching or browsing */}
        <Text
          className="text-grey text-sm mt-3"
          style={{ fontFamily: 'Nunito-Regular' }}
        >
          {isSearchActive
            ? `${displayedVenues.length} result${displayedVenues.length !== 1 ? 's' : ''} for "${query}"`
            : 'Recently added venues'}
        </Text>
      </View>

      {/* ── Results ──────────────────────────────────────────── */}
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={Colors.coral} size="large" />
        </View>
      ) : (
        <FlatList
          data={displayedVenues}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 12 }}
          // Improves scroll performance on long lists — the card height is fixed.
          // If card heights ever become variable (e.g. multi-line names), remove this.
          getItemLayout={(_data, index) => ({ length: 86, offset: 86 * index + 12 * index, index })}
          ListEmptyComponent={
            <View className="items-center mt-20">
              <Text style={{ fontSize: 48, marginBottom: 12 }}>🔍</Text>
              <Text
                className="text-charcoal text-lg text-center"
                style={{ fontFamily: 'Nunito-Bold' }}
              >
                {isSearchActive ? 'No venues found' : 'No venues available'}
              </Text>
              <Text
                className="text-grey text-sm text-center mt-2"
                style={{ fontFamily: 'Nunito-Regular' }}
              >
                {isSearchActive
                  ? `Try a different search term or remove some filters.`
                  : 'Check back soon — new venues are added regularly.'}
              </Text>
            </View>
          }
          renderItem={({ item }: { item: Venue }) => (
            <VenueCard
              venue={item}
              onPress={() => handleVenuePress(item.id)}
            />
          )}
        />
      )}

      {/* FilterSheet modal — same pattern as the Explore tab */}
      <FilterSheet
        visible={filterSheetVisible}
        onClose={handleFilterSheetClose}
      />
    </SafeAreaView>
  );
}
