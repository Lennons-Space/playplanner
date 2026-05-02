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
 *
 * Chip trust rules:
 * - null = unknown → a venue is NEVER included in a filter when the relevant
 *   attribute is null (i.e. data not available).
 * - Free filter only passes venues with price_range === 'free'. null price_range
 *   is excluded — we never assume free.
 * - Rainy day filter only passes venues where isRainyDaySuitable === true (known
 *   indoor category). null category → excluded.
 * - Category chips use DB IDs from useCategories() — never hard-coded.
 */

import { useState, useCallback, useMemo } from 'react';
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
import { useEffect } from 'react';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useVenueSearch, useNearbyVenues, useCategories } from '@/hooks/useVenues';
import { useFilterStore } from '@/store/filterStore';
import { useMapStore } from '@/store/mapStore';
import FilterSheet from '@/components/filters/FilterSheet';
import { VenueCard, Icon, Chip, ScreenTitle, IconBtn } from '@/components/ui';
import { FALLBACK_LOCATION } from '@/constants/location';
import { getVenueAttributes } from '@/lib/venueAttributes';
import type { Venue, VenueFilters, PriceRange } from '@/types';

// ── Design tokens (pp- palette) ────────────────────────────────────────────────
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
function applyFiltersToResults(venues: Venue[], filters: VenueFilters): Venue[] {
  return venues.filter((v) => {
    const vCategoryId = v.category?.id ?? v.category_id;
    if (filters.categoryIds.length && vCategoryId && !filters.categoryIds.includes(vCategoryId)) {
      return false;
    }
    // Trust rule: when a price filter is active, exclude venues with null price_range
    // (unknown price). Never assume a venue is free or matches any price tier if the
    // data is missing. The old guard `v.price_range &&` was wrong — it let null-price
    // venues slip through because null is falsy.
    if (filters.priceRange.length) {
      if (!v.price_range || !(filters.priceRange as PriceRange[]).includes(v.price_range)) {
        return false;
      }
    }
    if (filters.minAge !== null && v.max_age < filters.minAge) return false;
    if (filters.maxAge !== null && v.min_age > filters.maxAge) return false;
    return true;
  });
}

// ─── Rainy-day client-side filter ────────────────────────────────────────────
// Only passes venues where isRainyDaySuitable is definitively true.
// null (unknown category) is treated as "does not qualify" — trust rule.
function applyRainyDayFilter(venues: Venue[]): Venue[] {
  return venues.filter((v) => getVenueAttributes(v).isRainyDaySuitable === true);
}

// ─── Quick filter chip definitions ────────────────────────────────────────────
// Category chips carry the slug used to look up the DB category ID at runtime.
const QUICK_FILTERS = [
  { id: 'all',         label: 'All' },
  { id: 'open-now',    label: 'Open now' },
  { id: 'free',        label: 'Free' },
  { id: 'rainy-day',   label: 'Rainy day' },
  { id: 'soft-play',   label: 'Soft play',   categorySlug: 'soft-play'   },
  { id: 'parks',       label: 'Parks',        categorySlug: 'park'        },
  { id: 'indoor-play', label: 'Indoor play',  categorySlug: 'indoor-play' },
  { id: 'swimming',    label: 'Swimming',     categorySlug: 'swimming'    },
  { id: 'farms',       label: 'Farms',        categorySlug: 'farm'        },
  { id: 'libraries',   label: 'Libraries',    categorySlug: 'library'     },
] as const;

type QuickFilterId = (typeof QUICK_FILTERS)[number]['id'];

// ─── Active filter description helper ────────────────────────────────────────
// Builds a short human-readable string for the empty-state message.
function describeActiveFilters(
  filters: VenueFilters,
  isRainyDay: boolean,
  categories: { id: string; slug: string; name: string }[],
): string {
  const parts: string[] = [];

  if (filters.priceRange.includes('free')) parts.push('free');
  if (isRainyDay) return 'rainy day';  // rainy day is mutually exclusive with category chips

  if (filters.categoryIds.length) {
    const cat = categories.find((c) => filters.categoryIds.includes(c.id));
    if (cat) parts.push(cat.name.toLowerCase());
  }

  if (filters.openNow) parts.push('open');

  return parts.length ? parts.join(' ') : 'matching';
}

// ─── SearchScreen ─────────────────────────────────────────────────────────────
export default function SearchScreen() {
  const [query, setQuery]               = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const debouncedQuery                  = useDebounce(query, 300);

  // Local rainy-day state — applied client-side only.
  const [isRainyDay, setIsRainyDay] = useState(false);

  const [filterSheetVisible, setFilterSheetVisible] = useState(false);

  const filters            = useFilterStore((s) => s.filters);
  const setFilters         = useFilterStore((s) => s.setFilters);
  const resetFilters       = useFilterStore((s) => s.resetFilters);
  const activeFilterCount  = useFilterStore((s) => s.activeFilterCount());
  const setPendingPostcode = useMapStore((s) => s.setPendingPostcode);

  // useCategories is cached for 24h — very cheap to call here.
  const { data: dbCategories = [] } = useCategories();

  const looksLikePostcode = UK_POSTCODE_RE.test(query.trim());

  const handleExploreOnMap = useCallback(() => {
    setPendingPostcode(query.trim().toUpperCase());
    router.push('/(tabs)/');
  }, [query, setPendingPostcode]);

  const isSearchActive = debouncedQuery.length >= 2;

  const {
    data: searchResults = [],
    isLoading: searchLoading,
  } = useVenueSearch(debouncedQuery, FALLBACK_LOCATION);

  const {
    data: recentVenues = [],
    isLoading: recentLoading,
  } = useNearbyVenues(FALLBACK_LOCATION, filters, !isSearchActive);

  const handleFiltersPress      = useCallback(() => setFilterSheetVisible(true), []);
  const handleFilterSheetClose  = useCallback(() => setFilterSheetVisible(false), []);

  const isLoading = isSearchActive ? searchLoading : recentLoading;

  // ── Chip active-state derivation ────────────────────────────────────────────
  function isChipActive(id: QuickFilterId): boolean {
    switch (id) {
      case 'all':
        return (
          !isRainyDay &&
          !filters.openNow &&
          !filters.priceRange.includes('free') &&
          filters.categoryIds.length === 0
        );
      case 'open-now':
        return filters.openNow === true;
      case 'free':
        return filters.priceRange.includes('free');
      case 'rainy-day':
        return isRainyDay;
      default: {
        // Category chip — check if the DB category ID for this slug is selected.
        const filter = QUICK_FILTERS.find((f) => f.id === id);
        if (!filter || !('categorySlug' in filter)) return false;
        const cat = dbCategories.find((c) => c.slug === filter.categorySlug);
        if (!cat) return false;
        return filters.categoryIds.includes(cat.id);
      }
    }
  }

  // ── Chip press handlers ─────────────────────────────────────────────────────

  // Look up a DB category ID by slug. Returns null if categories not yet loaded.
  const getCategoryId = useCallback(
    (slug: string): string | null => {
      return dbCategories.find((c) => c.slug === slug)?.id ?? null;
    },
    [dbCategories],
  );

  // Activates a category chip by slug. Used by both chip presses and SUGGESTIONS.
  const activateCategoryChip = useCallback(
    (slug: string) => {
      const id = getCategoryId(slug);
      if (!id) return; // categories not loaded yet — safe to no-op
      const alreadySelected = filters.categoryIds.includes(id);
      setIsRainyDay(false);
      setFilters({ categoryIds: alreadySelected ? [] : [id] });
    },
    [getCategoryId, filters.categoryIds, setFilters],
  );

  const activateRainyDay = useCallback(() => {
    setIsRainyDay((prev) => {
      const next = !prev;
      if (next) {
        // Clear category selection when entering rainy-day mode.
        setFilters({ categoryIds: [] });
      }
      return next;
    });
  }, [setFilters]);

  const activateFreeFilter = useCallback(() => {
    const isFreeActive = filters.priceRange.includes('free');
    setFilters({ priceRange: isFreeActive ? [] : ['free'] });
  }, [filters.priceRange, setFilters]);

  const handleChipPress = useCallback(
    (id: QuickFilterId) => {
      switch (id) {
        case 'all':
          resetFilters();
          setIsRainyDay(false);
          break;
        case 'open-now':
          setFilters({ openNow: !filters.openNow });
          break;
        case 'free':
          activateFreeFilter();
          break;
        case 'rainy-day':
          activateRainyDay();
          break;
        default: {
          const filter = QUICK_FILTERS.find((f) => f.id === id);
          if (filter && 'categorySlug' in filter) {
            activateCategoryChip(filter.categorySlug);
          }
        }
      }
    },
    [filters.openNow, resetFilters, setFilters, activateFreeFilter, activateRainyDay, activateCategoryChip],
  );

  // ─── Suggestion chips ──────────────────────────────────────────────────────
  // Each suggestion triggers a REAL filter action, not just a setQuery call.
  const SUGGESTIONS = useMemo(
    () => [
      { label: 'Soft play', action: () => activateCategoryChip('soft-play') },
      { label: 'Rainy day', action: () => activateRainyDay()                },
      { label: 'Free',      action: () => activateFreeFilter()               },
      { label: 'Parks',     action: () => activateCategoryChip('park')       },
      { label: 'Libraries', action: () => activateCategoryChip('library')    },
    ],
    [activateCategoryChip, activateRainyDay, activateFreeFilter],
  );

  // ── Display venues pipeline ────────────────────────────────────────────────
  const displayedVenues: Venue[] = useMemo(() => {
    // Step 1: pick base list (search results or nearby).
    let base: Venue[] = isSearchActive
      ? applyFiltersToResults(searchResults, filters)
      : (recentVenues as Venue[]);

    // Step 2: apply rainy-day client-side post-filter if active.
    if (isRainyDay) {
      base = applyRainyDayFilter(base);
    }

    return base;
  }, [isSearchActive, searchResults, recentVenues, filters, isRainyDay]);

  // ── Active filter presence (for empty state and clear button) ─────────────
  const hasActiveFilters =
    isRainyDay ||
    filters.openNow ||
    filters.priceRange.length > 0 ||
    filters.categoryIds.length > 0;

  // ── Navigation ─────────────────────────────────────────────────────────────
  const handleVenuePress = useCallback((id: string) => {
    router.push(`/venue/${id}`);
  }, []);

  // ── Search input border ────────────────────────────────────────────────────
  const searchBorderColor = inputFocused || query.length > 0 ? pp.ink : pp.line;

  // ── Empty-state message ────────────────────────────────────────────────────
  const filterDescription = hasActiveFilters
    ? describeActiveFilters(
        filters,
        isRainyDay,
        dbCategories as { id: string; slug: string; name: string }[],
      )
    : null;

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
              padding: 0,
            }}
            placeholder="Search venues, postcodes, tags…"
            placeholderTextColor={pp.mute}
            value={query}
            onChangeText={setQuery}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            autoCorrect={false}
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

        {/* Postcode shortcut */}
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
      <View style={{ height: 52 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 16 }}
        >
          {QUICK_FILTERS.map((f) => (
            <Chip
              key={f.id}
              active={isChipActive(f.id)}
              color={pp.sky}
              onPress={() => handleChipPress(f.id)}
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
          {/* Try searching — suggestion chips (each triggers a real filter) */}
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
                  key={s.label}
                  onPress={s.action}
                  style={{
                    backgroundColor: pp.skyWash,
                    borderWidth: 1,
                    borderColor: pp.skySoft,
                    borderRadius: 9999,
                    paddingHorizontal: 14,
                    paddingVertical: 9,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter by ${s.label}`}
                >
                  <Text
                    style={{
                      fontFamily: 'Nunito-Bold',
                      fontSize: 13,
                      color: pp.skyDeep,
                    }}
                  >
                    {s.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Results header when idle */}
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
              Nearby venues
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
          ) : displayedVenues.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 }}>
              {hasActiveFilters ? (
                <>
                  <Text
                    style={{
                      fontFamily: 'Nunito-Bold',
                      fontSize: 16,
                      color: pp.ink,
                      textAlign: 'center',
                      marginBottom: 8,
                    }}
                  >
                    No {filterDescription} venues found nearby.
                  </Text>
                  <TouchableOpacity
                    onPress={() => { resetFilters(); setIsRainyDay(false); }}
                    style={{
                      backgroundColor: pp.sky,
                      borderRadius: 9999,
                      paddingHorizontal: 20,
                      paddingVertical: 10,
                      marginTop: 4,
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Clear all filters"
                  >
                    <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 14, color: pp.paper }}>
                      Clear filters
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
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
                </>
              )}
            </View>
          ) : (
            <View style={{ paddingHorizontal: 20, gap: 12, paddingTop: 4 }}>
              {displayedVenues.map((item) => (
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
              removeClippedSubviews
              getItemLayout={(_data, index) => ({ length: 86, offset: 86 * index + 12 * index, index })}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', paddingTop: 80 }}>
                  {hasActiveFilters ? (
                    <>
                      <Text
                        style={{
                          fontFamily: 'Nunito-Bold',
                          fontSize: 16,
                          color: pp.ink,
                          textAlign: 'center',
                          marginBottom: 8,
                        }}
                      >
                        No {filterDescription} venues found for "{debouncedQuery}".
                      </Text>
                      <TouchableOpacity
                        onPress={() => { resetFilters(); setIsRainyDay(false); }}
                        style={{
                          backgroundColor: pp.sky,
                          borderRadius: 9999,
                          paddingHorizontal: 20,
                          paddingVertical: 10,
                          marginTop: 4,
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Clear all filters"
                      >
                        <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 14, color: pp.paper }}>
                          Clear filters
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </View>
              }
              renderItem={({ item }: { item: Venue }) => (
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

      {/* FilterSheet modal */}
      <FilterSheet
        visible={filterSheetVisible}
        onClose={handleFilterSheetClose}
      />
    </SafeAreaView>
  );
}
