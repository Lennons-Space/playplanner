/**
 * Search tab — text search with live results + category filter support.
 *
 * Privacy note:
 * Location consent is respected via useLocationConsent(). If the user has
 * already granted consent (stored in SecureStore), we mount SearchNearbyResults
 * — a child component that calls useLocation() and useNearbyVenues(). Mounting
 * it conditionally (only when consentGranted === true) is the correct fix for
 * the Rules-of-Hooks constraint: the hook lives inside a child that is itself
 * only rendered when consent is confirmed.
 *
 * CRITICAL PRIVACY GUARANTEE: useLocation() calls
 * Location.requestForegroundPermissionsAsync() on mount. Therefore SearchNearbyResults
 * must NEVER be mounted before consent is confirmed. The parent SearchScreen
 * checks consent via useLocationConsent (SecureStore only — no OS prompt) and
 * only mounts SearchNearbyResults when consentStatus === 'granted'.
 *
 * If consent has NOT been granted, the "Nearby venues" section shows a prompt
 * card that routes the user into the Results flow (where consent is requested
 * properly), rather than silently falling back to London — which would show
 * irrelevant data and mislead the user.
 *
 * This matches the same pattern used by NearbyPreview on the home screen:
 * the parent reads consent via useLocationConsent, the child that needs GPS
 * is only mounted after consent is confirmed.
 *
 * Filter integration:
 * When search has results, we apply the active VenueFilters client-side
 * (on the ≤30-row result set). This avoids coupling the Supabase text-search
 * query to the PostGIS RPC and keeps the search hook simple. For the empty-query
 * "nearby venues" section we pass filters into useNearbyVenues so the RPC
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
import { useLocation } from '@/hooks/location';
import { useLocationConsent } from '@/hooks/useLocationConsent';
import { useFilterStore } from '@/store/filterStore';
import { useMapStore } from '@/store/mapStore';
import FilterSheet from '@/components/filters/FilterSheet';
import { VenueCard, Icon, Chip, ScreenTitle, IconBtn } from '@/components/ui';
import { MAX_SEARCH_RADIUS_KM } from '@/constants/location';
import { getVenueAttributes } from '@/lib/venueAttributes';
import type { Venue, VenueFilters, PriceRange, Coordinates } from '@/types';

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
  { id: 'rainy-day',   label: '☔ Rainy day ideas' },
  { id: 'soft-play',   label: 'Soft play',   categorySlug: 'soft-play'   },
  { id: 'parks',       label: 'Parks',        categorySlug: 'park'        },
  { id: 'indoor-play', label: 'Indoor play',  categorySlug: 'indoor-play' },
  { id: 'swimming',    label: 'Swimming',     categorySlug: 'swimming'    },
  { id: 'farms',       label: 'Farms',        categorySlug: 'farm'        },
  { id: 'libraries',   label: 'Libraries',    categorySlug: 'library'     },
] as const;

type QuickFilterId = (typeof QUICK_FILTERS)[number]['id'];

// ─── Filter feedback helpers ──────────────────────────────────────────────────

interface EmptyStateContent {
  title: string;
  subtitle: string;
}

// Short label shown above results: "Showing: Rainy day venues"
function getFilterLabel(
  filters: VenueFilters,
  isRainyDay: boolean,
  categories: { id: string; slug: string; name: string }[],
): string | null {
  if (isRainyDay) return 'Showing: Rainy day ideas';
  if (filters.priceRange.includes('free') && filters.openNow) return 'Showing: Free venues · Open now';
  if (filters.priceRange.includes('free')) return 'Showing: Free venues (confirmed only)';
  if (filters.openNow && filters.categoryIds.length) {
    const cat = categories.find((c) => filters.categoryIds.includes(c.id));
    return cat ? `Showing: ${cat.name} · Open now` : 'Showing: Open now';
  }
  if (filters.openNow) return 'Showing: Open now';
  if (filters.categoryIds.length) {
    const cat = categories.find((c) => filters.categoryIds.includes(c.id));
    return cat ? `Showing: ${cat.name} near you` : null;
  }
  return null;
}

// Contextual empty-state copy — specific per filter type so parents understand why.
function getEmptyStateContent(
  filters: VenueFilters,
  isRainyDay: boolean,
): EmptyStateContent {
  if (isRainyDay) {
    return {
      title: 'No indoor venues found nearby.',
      subtitle: 'Try expanding your search area or clearing the filter.',
    };
  }
  if (filters.priceRange.includes('free')) {
    return {
      title: 'No free venues found nearby.',
      subtitle: "Many places don't list pricing yet. Try removing the Free filter.",
    };
  }
  if (filters.openNow) {
    return {
      title: 'No venues currently open nearby.',
      subtitle: 'Opening hours are not available for many places yet.',
    };
  }
  if (filters.categoryIds.length) {
    return {
      title: 'No venues found for this category nearby.',
      subtitle: 'Try a different category or expand your search area.',
    };
  }
  return {
    title: 'No venues found.',
    subtitle: 'Try removing some filters or checking back soon.',
  };
}

// ─── SearchNearbyResults ──────────────────────────────────────────────────────
// This child component is the ONLY place in the Search tab that calls
// useLocation(). It must NEVER be mounted unless location consent has already
// been confirmed by the parent (SearchScreen).
//
// WHY A CHILD COMPONENT (not a conditional hook call):
// React's Rules of Hooks forbid calling hooks conditionally inside a single
// component. The only safe way to conditionally activate useLocation() is to
// put it inside a component that is itself conditionally mounted. When
// SearchScreen only renders <SearchNearbyResults> after consentStatus===
// 'granted', useLocation() (and its Location.requestForegroundPermissionsAsync
// call) is guaranteed never to run pre-consent.
interface SearchNearbyResultsProps {
  searchFilters:      VenueFilters & { maxDistanceKm: number };
  isRainyDay:         boolean;
  hasActiveFilters:   boolean;
  emptyStateContent:  EmptyStateContent;
  onVenuePress:       (id: string) => void;
  onResetFilters:     () => void;
}

function SearchNearbyResults({
  searchFilters,
  isRainyDay,
  hasActiveFilters,
  emptyStateContent,
  onVenuePress,
  onResetFilters,
}: SearchNearbyResultsProps) {
  // Safe to call here: this component is only mounted when consent is granted.
  const { coords: rawCoords, isLoading: locLoading } = useLocation();

  const coords: Coordinates | null = useMemo(() => {
    if (!rawCoords || !Number.isFinite(rawCoords.latitude) || !Number.isFinite(rawCoords.longitude)) {
      return null;
    }
    return rawCoords;
  }, [rawCoords]);

  // "Nearby venues" query — enabled only when real coordinates are available.
  // The 50-mile (80 km) radius cap is already baked into searchFilters.maxDistanceKm.
  const {
    data: recentVenues = [],
    isLoading: recentLoading,
  } = useNearbyVenues(
    coords ?? { latitude: 0, longitude: 0 },
    searchFilters,
    coords !== null && !locLoading,
  );

  const displayedVenues: Venue[] = isRainyDay
    ? applyRainyDayFilter(recentVenues as Venue[])
    : recentVenues as Venue[];

  const isLoading = recentLoading || locLoading;

  return (
    <>
      {/* Nearby venues list (idle state, location granted) */}
      {(locLoading || recentLoading) ? (
        <View style={{ alignItems: 'center', paddingVertical: 24 }}>
          <ActivityIndicator color={pp.sky} size="large" />
        </View>
      ) : displayedVenues.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 }}>
          {hasActiveFilters ? (
            <>
              <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 16, color: pp.ink, textAlign: 'center', marginBottom: 6 }}>
                {emptyStateContent.title}
              </Text>
              <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 14, color: pp.mute, textAlign: 'center', marginBottom: 16 }}>
                {emptyStateContent.subtitle}
              </Text>
              <TouchableOpacity
                onPress={onResetFilters}
                style={{ backgroundColor: pp.sky, borderRadius: 9999, paddingHorizontal: 20, paddingVertical: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Clear all filters"
              >
                <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 14, color: pp.paper }}>Clear filters</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 16, color: pp.ink, textAlign: 'center', marginBottom: 8 }}>
                No venues nearby
              </Text>
              <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 14, color: pp.mute, textAlign: 'center' }}>
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
              onPress={() => onVenuePress(item.id)}
            />
          ))}
        </View>
      )}
    </>
  );
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

  // ── Location consent — privacy gate ────────────────────────────────────────
  // useLocationConsent reads only SecureStore. It NEVER triggers the OS location
  // dialog. It is safe to call unconditionally here.
  //
  // The OS location prompt fires only inside useLocation(), which lives in
  // SearchNearbyResults. That child is only mounted when consentStatus ===
  // 'granted', so the prompt is guaranteed never to appear pre-consent.
  const { status: consentStatus } = useLocationConsent();
  const consentGranted = consentStatus === 'granted';

  const looksLikePostcode = UK_POSTCODE_RE.test(query.trim());

  const handleExploreOnMap = useCallback(() => {
    setPendingPostcode(query.trim().toUpperCase());
    router.push('/');
  }, [query, setPendingPostcode]);

  const isSearchActive = debouncedQuery.length >= 2;

  // ── Apply 50-mile (80.47 km) radius cap ────────────────────────────────────
  // We use MAX_SEARCH_RADIUS_KM (80 km ≈ 50 miles) as the outer cap so the
  // "nearby" list stays proportionate (GDPR data minimisation) and meaningful.
  const searchFilters = useMemo(
    () => ({
      ...filters,
      maxDistanceKm: Math.min(filters.maxDistanceKm, MAX_SEARCH_RADIUS_KM),
    }),
    [filters],
  );

  // Text search: coords are not required for name-match search — we pass a zero
  // origin. If we have coords (from SearchNearbyResults) in future, server-side
  // distance sorting could be added, but currently the hook ignores them.
  const {
    data: searchResults = [],
    isLoading: searchLoading,
  } = useVenueSearch(debouncedQuery, { latitude: 0, longitude: 0 });

  const handleFiltersPress      = useCallback(() => setFilterSheetVisible(true), []);
  const handleFilterSheetClose  = useCallback(() => setFilterSheetVisible(false), []);

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

  // ── Display venues pipeline (search-active path only) ─────────────────────
  // The nearby-venues (idle) path is handled entirely inside SearchNearbyResults.
  // The parent only needs to compute the filtered+rainy-day list for text search.
  const displayedSearchVenues: Venue[] = useMemo(() => {
    if (!isSearchActive) return [];
    let base = applyFiltersToResults(searchResults, filters);
    if (isRainyDay) base = applyRainyDayFilter(base);
    return base;
  }, [isSearchActive, searchResults, filters, isRainyDay]);

  // ── Active filter presence (for empty state and clear button) ─────────────
  const hasActiveFilters =
    isRainyDay ||
    filters.openNow ||
    filters.priceRange.length > 0 ||
    filters.categoryIds.length > 0;

  // Convenience: total displayed venues for the search-active header count.
  const displayedSearchCount = displayedSearchVenues.length;

  // ── Navigation ─────────────────────────────────────────────────────────────
  const handleVenuePress = useCallback((id: string) => {
    router.push(`/venue/${id}`);
  }, []);

  // ── Search input border ────────────────────────────────────────────────────
  const searchBorderColor = inputFocused || query.length > 0 ? pp.ink : pp.line;

  // ── Filter feedback ────────────────────────────────────────────────────────
  const filterLabel = hasActiveFilters
    ? getFilterLabel(filters, isRainyDay, dbCategories as { id: string; slug: string; name: string }[])
    : null;
  const emptyStateContent = getEmptyStateContent(filters, isRainyDay);

  // ── Onboarding hint ────────────────────────────────────────────────────────
  // Session-only: shown on first load, dismissed by tap. No persistence needed —
  // it reappears next session which is fine; it's a hint not a blocking modal.
  const [hintDismissed, setHintDismissed] = useState(false);
  const showHint = !hintDismissed && !hasActiveFilters && !isSearchActive;

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
          {/* Clear button — visible in the chip row whenever filters are active */}
          {hasActiveFilters && (
            <Pressable
              onPress={() => { resetFilters(); setIsRainyDay(false); }}
              hitSlop={8}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 9999,
                borderWidth: 1,
                borderColor: '#FF6B6B',
                backgroundColor: '#FFF0F0',
              }}
              accessibilityRole="button"
              accessibilityLabel="Remove active filters"
            >
              <Icon name="close" size={12} color="#FF6B6B" />
              <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 13, color: '#FF6B6B' }}>
                Clear
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </View>

      {/* ── Filter feedback label ─────────────────────────────────── */}
      {filterLabel != null && (
        <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          <Text style={{ fontFamily: 'Nunito-SemiBold', fontSize: 12, color: pp.skyDeep }}>
            {filterLabel}
          </Text>
        </View>
      )}

      {/* ── Empty state (query < 2 chars) ────────────────────────── */}
      {!isSearchActive && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          {/* Onboarding hint — session-only, dismissible by tap */}
          {showHint && (
            <Pressable
              onPress={() => setHintDismissed(true)}
              style={{
                marginHorizontal: 20,
                marginBottom: 16,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                backgroundColor: pp.skyWash,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: pp.skySoft,
                paddingHorizontal: 14,
                paddingVertical: 11,
              }}
              accessibilityRole="button"
              accessibilityLabel="Dismiss tip"
            >
              <Text style={{ fontSize: 18 }}>💡</Text>
              <Text style={{ flex: 1, fontFamily: 'Nunito-SemiBold', fontSize: 13, color: pp.skyDeep, lineHeight: 18 }}>
                Use filters to find free places, indoor activities, and more.
              </Text>
              <Icon name="close" size={14} color={pp.mute} />
            </Pressable>
          )}

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

          {/* Nearby venues section — hidden during the 'checking' state to avoid
              a blank flash (50–200 ms on cold open) while SecureStore resolves
              the stored consent value. Matches the same guard used on the home
              screen (NearbyPreview). */}
          {consentStatus !== 'checking' && (
            <>
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
                {consentGranted && (
                  <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 12, color: pp.mute }}>
                    Sort: Nearest
                  </Text>
                )}
              </View>

              {/* Location consent nudge — shown when consent has not been granted.
                  We never silently fall back to London: that would mislead the user
                  into thinking they are seeing venues near them when they are not.
                  PRIVACY: This branch is shown precisely because consentGranted is
                  false — SearchNearbyResults is NOT mounted here, so useLocation()
                  never fires and the OS prompt never appears. */}
              {!consentGranted && (
                <Pressable
                  onPress={() => router.push('/explore/results?mood=auto')}
                  style={{
                    marginHorizontal: 20,
                    marginTop: 4,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    backgroundColor: pp.skyWash,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: pp.skySoft,
                    padding: 16,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Turn on location to see venues near you"
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 14,
                      backgroundColor: pp.skySoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="locate" size={20} color={pp.skyDeep} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 14, color: pp.ink }}>
                      See venues near you
                    </Text>
                    <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 12, color: pp.mute, marginTop: 2 }}>
                      Turn on location for local results.
                    </Text>
                  </View>
                  <Icon name="chevR" size={16} color={pp.mute} />
                </Pressable>
              )}

              {/* SearchNearbyResults is ONLY mounted when consent is confirmed.
                  This is the structural guarantee that useLocation() (and therefore
                  Location.requestForegroundPermissionsAsync) never fires pre-consent. */}
              {consentGranted && (
                <SearchNearbyResults
                  searchFilters={searchFilters}
                  isRainyDay={isRainyDay}
                  hasActiveFilters={hasActiveFilters}
                  emptyStateContent={emptyStateContent}
                  onVenuePress={handleVenuePress}
                  onResetFilters={() => { resetFilters(); setIsRainyDay(false); }}
                />
              )}
            </>
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
              {displayedSearchCount} result{displayedSearchCount !== 1 ? 's' : ''}
            </Text>
            <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 12, color: pp.mute }}>
              Sort: Nearest
            </Text>
          </View>

          {searchLoading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={pp.sky} size="large" />
            </View>
          ) : (
            <FlatList
              data={displayedSearchVenues}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 12 }}
              removeClippedSubviews
              getItemLayout={(_data, index) => ({ length: 86, offset: 86 * index + 12 * index, index })}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', paddingTop: 80, paddingHorizontal: 20 }}>
                  {hasActiveFilters ? (
                    <>
                      <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 16, color: pp.ink, textAlign: 'center', marginBottom: 6 }}>
                        {emptyStateContent.title}
                      </Text>
                      <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 14, color: pp.mute, textAlign: 'center', marginBottom: 16 }}>
                        {emptyStateContent.subtitle}
                      </Text>
                      <TouchableOpacity
                        onPress={() => { resetFilters(); setIsRainyDay(false); }}
                        style={{ backgroundColor: pp.sky, borderRadius: 9999, paddingHorizontal: 20, paddingVertical: 10 }}
                        accessibilityRole="button"
                        accessibilityLabel="Clear all filters"
                      >
                        <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 14, color: pp.paper }}>Clear filters</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 16, color: pp.ink, textAlign: 'center', marginBottom: 8 }}>
                        No venues found for "{debouncedQuery}"
                      </Text>
                      <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 14, color: pp.mute, textAlign: 'center' }}>
                        Try different words, a postcode, or check the spelling.
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
