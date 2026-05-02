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
  Pressable,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useVenueSearch, useNearbyVenues } from '@/hooks/useVenues';
import { useFilterStore } from '@/store/filterStore';
import { useMapStore } from '@/store/mapStore';
import FilterSheet from '@/components/filters/FilterSheet';
import { VenueCard, Icon, Chip, ScreenTitle, IconBtn } from '@/components/ui';
import { FALLBACK_LOCATION } from '@/constants/location';
import type { Venue, VenueFilters, PriceRange } from '@/types';

// ── Design tokens (pp- palette) ────────────────────────────────────────────────
// These hex values mirror the pp- tokens in tailwind.config.js.
// Using inline style where Tailwind class would require an arbitrary value.
const pp = {
  ink:      '#1D2630',
  mute:     '#7B8794',
  line:     '#E6E2DB',
  sand:     '#FBF6EC',
  paper:    '#FFFFFF',
  sky:      '#2FB8B0',
  skyWash:  '#EEF9F8',
  skySoft:  '#D4F0EE',
  skyDeep:  '#1B8A85',
};

// Matches full UK postcodes (SW1A 1AA) and outward-only districts (SW1A, M1, B1).
const UK_POSTCODE_RE = /^[A-Z]{1,2}[0-9][A-Z0-9]?(\s*[0-9][A-Z]{2})?$/i;

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
    // Use the joined category object's id when available; fall back to the flat
    // category_id field. The search query may return either shape depending on
    // whether the join was included in the SELECT.
    const vCategoryId = v.category?.id ?? v.category_id;
    if (filters.categoryIds.length && vCategoryId && !filters.categoryIds.includes(vCategoryId)) {
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

// ─── Quick filter chip definitions ────────────────────────────────────────────
const QUICK_FILTERS = [
  { id: 'all',       label: 'All' },
  { id: 'open-now',  label: 'Open now' },
  { id: 'free',      label: 'Free' },
  { id: 'ages-0-3',  label: 'Ages 0–3' },
  { id: 'all-ages',  label: 'All ages' },
] as const;

type QuickFilterId = (typeof QUICK_FILTERS)[number]['id'];

// ─── Suggestion chips ──────────────────────────────────────────────────────────
const SUGGESTIONS = ['Soft play', 'Parks with toilets', 'Free today', 'Rainy day', 'Toddler-friendly'];


// ─── SearchScreen ─────────────────────────────────────────────────────────────
export default function SearchScreen() {
  const [query, setQuery]               = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const debouncedQuery                  = useDebounce(query, 300);

  const [quickFilter, setQuickFilter]   = useState<QuickFilterId>('all');

  const [filterSheetVisible, setFilterSheetVisible] = useState(false);

  const filters            = useFilterStore((s) => s.filters);
  const activeFilterCount  = useFilterStore((s) => s.activeFilterCount());
  const setPendingPostcode = useMapStore((s) => s.setPendingPostcode);

  const looksLikePostcode = UK_POSTCODE_RE.test(query.trim());

  const handleExploreOnMap = useCallback(() => {
    setPendingPostcode(query.trim().toUpperCase());
    router.push('/(tabs)/');
  }, [query, setPendingPostcode]);

  // Derived before queries so both hooks can reference it.
  const isSearchActive = debouncedQuery.length >= 2;

  // Text search — only fires when debouncedQuery.length >= 2 (enforced in the hook).
  const {
    data: searchResults = [],
    isLoading: searchLoading,
  } = useVenueSearch(debouncedQuery, FALLBACK_LOCATION);

  // Venue list shown when the search box is empty.
  // Uses FALLBACK_LOCATION (central London) — the search tab never requests GPS.
  // `enabled: !isSearchActive` avoids firing this query while the user is typing
  // (the text search query runs instead, and we don't need two concurrent fetches).
  const {
    data: recentVenues = [],
    isLoading: recentLoading,
  } = useNearbyVenues(FALLBACK_LOCATION, filters, !isSearchActive);

  // Stable callbacks — prevent child components re-rendering on parent state changes.
  const handleFiltersPress      = useCallback(() => setFilterSheetVisible(true), []);
  const handleFilterSheetClose  = useCallback(() => setFilterSheetVisible(false), []);

  const isLoading = isSearchActive ? searchLoading : recentLoading;

  // Apply quick filter chip on top of the base venue list.
  function applyQuickFilter(venues: Venue[]): Venue[] {
    const now = new Date();
    const todayDow = now.getDay();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const toMins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

    switch (quickFilter) {
      case 'open-now':
        return venues.filter((v) => {
          if (!v.opening_hours?.length) return false;
          const row = v.opening_hours.find((h) => h.day_of_week === todayDow);
          if (!row || row.is_closed || !row.opens_at || !row.closes_at) return false;
          return nowMins >= toMins(row.opens_at) && nowMins < toMins(row.closes_at);
        });
      case 'free':
        return venues.filter((v) => v.price_range === 'free');
      case 'ages-0-3':
        return venues.filter((v) => (v.min_age ?? 0) <= 3);
      case 'all-ages':
        return venues.filter((v) => (v.min_age ?? 0) === 0 && (v.max_age ?? 99) >= 12);
      default:
        return venues;
    }
  }

  // Memoised so the filtered list only recalculates when search results, filters, or chip changes.
  const displayedVenues: Venue[] = useMemo(() => {
    const base = isSearchActive
      ? applyFiltersToResults(searchResults, filters)
      : (recentVenues as Venue[]);
    return applyQuickFilter(base);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSearchActive, searchResults, recentVenues, filters, quickFilter]);

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

  // Derived border colour for the search input — ink when active, muted line when idle.
  const searchBorderColor = inputFocused || query.length > 0 ? pp.ink : pp.line;

  return (
    <SafeAreaView className="flex-1 bg-pp-sand" edges={['top']}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <ScreenTitle
        title="Search"
        trailing={
          <IconBtn
            onPress={handleFiltersPress}
            accessibilityLabel={`Filters${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ''}`}
          >
            <Icon name="sliders" size={18} color={pp.ink} />
          </IconBtn>
        }
      />

      {/* ── Search bar ──────────────────────────────────────────── */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: pp.paper,
            borderRadius: 9999,
            borderWidth: 1.5,
            borderColor: searchBorderColor,
            paddingHorizontal: 16,
            paddingVertical: 12,
            gap: 10,
          }}
        >
          <Icon name="search" size={18} color={pp.mute} />
          <TextInput
            style={{
              flex: 1,
              fontFamily: 'Nunito-SemiBold',
              fontSize: 14,
              color: pp.ink,
              // Remove default padding that React Native adds on Android.
              padding: 0,
            }}
            placeholder="Search venues, postcodes, tags…"
            placeholderTextColor={pp.mute}
            value={query}
            onChangeText={setQuery}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            autoCorrect={false}
            // Prevents capitalising the first letter, which would break search
            // for things like "softplay" typed as "Softplay".
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel="Search for venues"
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => setQuery('')}
              hitSlop={8}
              accessibilityLabel="Clear search"
              accessibilityRole="button"
            >
              <Icon name="close" size={16} color={pp.mute} />
            </Pressable>
          )}
        </View>

        {/* Postcode shortcut — shown when the query looks like a UK postcode */}
        {looksLikePostcode && (
          <TouchableOpacity
            onPress={handleExploreOnMap}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              backgroundColor: pp.skyWash,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: pp.skySoft,
              paddingHorizontal: 14,
              paddingVertical: 11,
              marginTop: 10,
            }}
            accessibilityRole="button"
            accessibilityLabel={`Explore venues near postcode ${query}`}
          >
            <Icon name="map" size={18} color={pp.sky} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 14, color: pp.ink }}>
                Explore venues near {query.trim().toUpperCase()}
              </Text>
              <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 12, color: pp.mute }}>
                Open map and zoom to this area
              </Text>
            </View>
            <Icon name="chevR" size={16} color={pp.sky} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Quick filter chips ───────────────────────────────────── */}
      {/* TODO: wire quick filters to search logic in Phase 4. */}
      <View style={{ height: 52 }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 16 }}
      >
        {QUICK_FILTERS.map((f) => (
          <Chip
            key={f.id}
            active={quickFilter === f.id}
            color={pp.sky}
            onPress={() => setQuickFilter(f.id)}
          >
            {f.label}
          </Chip>
        ))}
      </ScrollView>
      </View>

      {/* ── Empty state (query < 2 chars) ────────────────────────── */}
      {!isSearchActive && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          {/* Try searching — suggestion chips */}
          <View style={{ paddingHorizontal: 20 }}>
            <Text
              style={{
                fontFamily: 'Nunito-ExtraBold',
                fontSize: 14,
                color: pp.ink,
                marginBottom: 8,
              }}
            >
              Try searching
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {SUGGESTIONS.map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setQuery(s)}
                  style={{
                    backgroundColor: pp.skyWash,
                    borderWidth: 1,
                    borderColor: pp.skySoft,
                    borderRadius: 9999,
                    paddingHorizontal: 14,
                    paddingVertical: 9,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Search for ${s}`}
                >
                  <Text
                    style={{
                      fontFamily: 'Nunito-Bold',
                      fontSize: 13,
                      color: pp.skyDeep,
                    }}
                  >
                    {s}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Results header when idle (showing popular venues below) */}
          <View
            style={{
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: 4,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 14, color: pp.ink }}>
              Popular venues
            </Text>
            <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 12, color: pp.mute }}>
              Sort: Nearest
            </Text>
          </View>

          {/* Nearby venues list (idle state) */}
          {recentLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: 24 }}>
              <ActivityIndicator color={pp.sky} size="large" />
            </View>
          ) : recentVenues.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 }}>
              <Text
                style={{
                  fontFamily: 'Nunito-Bold',
                  fontSize: 16,
                  color: pp.ink,
                  textAlign: 'center',
                  marginBottom: 8,
                }}
              >
                No venues available
              </Text>
              <Text
                style={{
                  fontFamily: 'Nunito-Regular',
                  fontSize: 14,
                  color: pp.mute,
                  textAlign: 'center',
                }}
              >
                Check back soon — new venues are added regularly.
              </Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 20, gap: 12, paddingTop: 4 }}>
              {(recentVenues as Venue[]).map((item) => (
                // TODO: wire saved state from useFavourites hook in Phase 4.
                <VenueCard
                  key={item.id}
                  venue={item}
                  saved={false}
                  onPress={() => handleVenuePress(item.id)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Search active state ──────────────────────────────────── */}
      {isSearchActive && (
        <>
          {/* Results header */}
          <View
            style={{
              paddingHorizontal: 20,
              paddingTop: 12,
              paddingBottom: 4,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 14, color: pp.ink }}>
              {displayedVenues.length} result{displayedVenues.length !== 1 ? 's' : ''}
            </Text>
            <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 12, color: pp.mute }}>
              Sort: Nearest
            </Text>
          </View>

          {isLoading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={pp.sky} size="large" />
            </View>
          ) : (
            <FlatList
              data={displayedVenues}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 12 }}
              // removeClippedSubviews: unmounts list items that scroll off-screen,
              // reducing memory use and preventing janky scrolling on long lists.
              removeClippedSubviews
              // Improves scroll performance on long lists — the card height is fixed.
              // If card heights ever become variable (e.g. multi-line names), remove this.
              getItemLayout={(_data, index) => ({ length: 86, offset: 86 * index + 12 * index, index })}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', paddingTop: 80 }}>
                  <Text
                    style={{
                      fontFamily: 'Nunito-Bold',
                      fontSize: 16,
                      color: pp.ink,
                      textAlign: 'center',
                      marginBottom: 8,
                    }}
                  >
                    No venues found
                  </Text>
                  <Text
                    style={{
                      fontFamily: 'Nunito-Regular',
                      fontSize: 14,
                      color: pp.mute,
                      textAlign: 'center',
                    }}
                  >
                    Try a different search term or remove some filters.
                  </Text>
                </View>
              }
              renderItem={({ item }: { item: Venue }) => (
                // TODO: wire saved state from useFavourites hook in Phase 4.
                <VenueCard
                  venue={item}
                  saved={false}
                  onPress={() => handleVenuePress(item.id)}
                />
              )}
            />
          )}
        </>
      )}

      {/* FilterSheet modal — same pattern as the Explore tab */}
      <FilterSheet
        visible={filterSheetVisible}
        onClose={handleFilterSheetClose}
      />
    </SafeAreaView>
  );
}
