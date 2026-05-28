/**
 * Map / Explore tab — Phase 2 re-skin.
 *
 * ARCHITECTURE:
 * The screen has two modes, controlled by `viewMode` state in ExploreScreen:
 *
 *   map mode  — Sand-background scrollable feed. Top to bottom:
 *               greeting header → search pill → location row → 240px mini-map
 *               preview → category chips → "Open right now" section → VenueCard list.
 *               The mini-map reuses the full ClusterMapView at a constrained height
 *               so real pins, clustering, and permissions logic are all preserved.
 *
 *   list mode — Full-screen white venue list (unchanged from pre-Phase-2).
 *
 * CONSENT / PERMISSION FLOW (unchanged):
 *   State 1: consentChecked=false   → blank splash guard (no flash of consent prompt)
 *   State 2: !consented && !declined → LocationConsentPrompt
 *   State 3: consented=true          → MapWithLocation (live GPS)
 *   State 4: declined=true           → LocationFallbackMap (London fallback, no GPS)
 *
 * ICO Children's Code Standard 10: geolocation is OFF until the user
 * explicitly accepts the LocationConsentPrompt. useLocation() is isolated
 * inside MapWithLocation so the OS dialog is never triggered before consent.
 *
 * CLUSTERING / BOTTOM SHEET (map mode only, within the mini-map):
 * react-native-map-clustering wraps MapView and handles supercluster internally.
 * In map mode the ClusterMapView is constrained to 240px height inside a
 * rounded container — it behaves identically to before, just smaller.
 *
 * VIEWPORT FETCHING: onRegionChangeComplete still updates mapCenter with a
 * 500ms debounce. Venue query re-fires on the new center as the user pans.
 *
 * LIST MODE: ClusterMapView fully unmounts to reclaim memory and battery.
 */

import { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Animated,
  StyleSheet,
  useWindowDimensions,
  TextInput,
  ActivityIndicator,
  Keyboard,
  Image,
  Pressable,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ClusterMapView from 'react-native-map-clustering';
import { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import Svg, { Circle as SvgCircle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';

import { useLocation } from '@/hooks/location';
import { useNearbyVenues } from '@/hooks/useVenues';
import { useWeather } from '@/hooks/useWeather';
import { getWeatherBadge, getWeatherBanner, scoreVenueForWeather } from '@/lib/weather';
import { useFilterStore } from '@/store/filterStore';
import { useShallow } from 'zustand/react/shallow';
import { LocationConsentPrompt } from '@/components/consent';
import FilterSheet from '@/components/filters/FilterSheet';
import { VenueRowSkeleton } from '@/components/ui/SkeletonLoader';
import { VenueCard, Icon, IconBtn, Chip } from '@/components/ui';
import { useLocationConsent } from '@/hooks/useLocationConsent';
import { FALLBACK_LOCATION } from '@/constants/location';
import { Colors } from '@/constants/theme';
import { useMapStore } from '@/store/mapStore';
import { supabase } from '@/lib/supabase';
import type { Venue, Coordinates } from '@/types';

// ── Design tokens (from tokens.jsx, mirrored here for inline styles) ──────────
// We use inline styles throughout this file because dynamic colour values
// (e.g. category chip colours) cannot be expressed as static Tailwind classes.
// Static values reference the pp- token hex values directly from tailwind.config.js.
const T = {
  sand:     '#FBF6EC',
  paper:    '#FFFFFF',
  ink:      '#1D2630',
  inkSoft:  '#4A5560',
  mute:     '#7B8794',
  line:     '#E6E2DB',
  lineSoft: '#F1ECE2',
  sky:      '#2FB8B0',
  skyDeep:  '#1B8A85',
  skySoft:  '#D4F0EE',
  star:     '#F5A524',
  leaf:     '#5BC08A',
  leafSoft: '#DCF4E4',
} as const;

// Height of the bottom sheet peek bar (handle + header row).
const PEEK_HEIGHT = 84;

// ─── renderCluster ─────────────────────────────────────────────────────────
// Layered ring design: outer ring at 30% opacity + solid inner circle.
function renderCluster(cluster: {
  onPress: () => void;
  id: number;
  geometry: { coordinates: [number, number] };
  properties: { point_count: number };
}) {
  const { id, geometry, properties, onPress } = cluster;
  const count = properties.point_count;
  const inner = count < 5 ? 36 : count < 25 ? 44 : count < 100 ? 52 : 60;
  const outer = inner + 14;

  return (
    <Marker
      key={`cluster-${id}`}
      coordinate={{ longitude: geometry.coordinates[0], latitude: geometry.coordinates[1] }}
      onPress={onPress}
      tracksViewChanges={false}
    >
      <View style={{
        width: outer, height: outer, borderRadius: outer / 2,
        backgroundColor: Colors.sky + '30',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <View style={{
          width: inner, height: inner, borderRadius: inner / 2,
          backgroundColor: Colors.sky,
          alignItems: 'center', justifyContent: 'center',
          shadowColor: Colors.sky, shadowOpacity: 0.45, shadowRadius: 6,
          shadowOffset: { width: 0, height: 3 }, elevation: 6,
        }}>
          <Text style={{
            color: '#fff', fontFamily: 'Nunito-Bold',
            fontSize: count < 10 ? 15 : count < 100 ? 13 : 11,
          }}>
            {count > 99 ? '99+' : String(count)}
          </Text>
        </View>
      </View>
    </Marker>
  );
}

// ─── VenueRow ─────────────────────────────────────────────────────────────
// Compact row used in list mode and inside the bottom sheet in map mode.
const VenueRow = memo(function VenueRow({
  venue,
  selected,
  onPress,
}: {
  venue: Venue;
  selected: boolean;
  onPress: (venue: Venue) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const photoUrl = !imgError ? (venue.cover_photo_url ?? null) : null;

  return (
    <TouchableOpacity
      style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingVertical: 11,
        backgroundColor: selected ? Colors.sky + '0F' : 'transparent',
        borderLeftWidth: selected ? 3 : 0,
        borderLeftColor: Colors.sky,
      }}
      onPress={() => onPress(venue)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${venue.name}, ${venue.category?.name ?? 'Venue'}`}
    >
      {photoUrl ? (
        <Image
          source={{ uri: photoUrl }}
          style={{ width: 52, height: 52, borderRadius: 12, marginRight: 12 }}
          resizeMode="cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <View style={{
          width: 44, height: 44, borderRadius: 12,
          backgroundColor: venue.is_premium ? Colors.sun + '55' : Colors.sky + '20',
          alignItems: 'center', justifyContent: 'center', marginRight: 12,
        }}>
          <Text style={{ fontSize: 20 }}>{venue.category?.icon ?? '📍'}</Text>
        </View>
      )}

      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 14, color: Colors.charcoal, flexShrink: 1 }}
            numberOfLines={1}>
            {venue.name}
          </Text>
          {venue.is_premium && (
            <View style={{ backgroundColor: Colors.sun, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 }}>
              <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 9, color: '#7A5800' }}>FEATURED</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
          <Ionicons name="star" size={11} color={Colors.coral} />
          <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 12, color: Colors.coral }}>
            {(venue.average_rating ?? 0).toFixed(1)}
          </Text>
          <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 12, color: Colors.grey }}>
            · {venue.category?.name ?? 'Venue'}
          </Text>
        </View>
      </View>

      <Ionicons name="chevron-forward" size={18} color={Colors.greyLighter} />
    </TouchableOpacity>
  );
});

// Stable separator — module-level so FlatList never sees it as changed.
function VenueRowSeparator() {
  return <View style={{ height: 1, backgroundColor: Colors.greyLighter, marginLeft: 72 }} />;
}

// ─── VenueMarker ──────────────────────────────────────────────────────────
// Category-tinted pin. tracksViewChanges={isSelected} — only the selected
// pin redraws on the native map layer, keeping rendering smooth at density.
const VenueMarker = memo(function VenueMarker({
  venue,
  isSelected,
  onPress,
}: {
  venue: Venue;
  isSelected: boolean;
  onPress: (venue: Venue) => void;
}) {
  // Android/PROVIDER_GOOGLE: custom View markers snapshot on mount. If
  // tracksViewChanges is already false at mount, the snapshot is blank.
  // Stay true for 300ms to let the native renderer capture the View.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 300);
    return () => clearTimeout(t);
  }, []);

  const lat = Number(venue.latitude);
  const lng = Number(venue.longitude);
  const validCoords = Number.isFinite(lat) && Number.isFinite(lng);

  const coordinate = useMemo(
    () => ({ latitude: lat, longitude: lng }),
    [lat, lng],
  );

  const handlePress = useCallback(() => onPress(venue), [onPress, venue]);

  if (!validCoords) return null;

  const categoryColor = venue.category?.color ?? Colors.sky;

  return (
    <Marker coordinate={coordinate} tracksViewChanges={!ready || isSelected} onPress={handlePress} anchor={{ x: 0.5, y: 0.5 }}>
      {isSelected ? (
        <View style={markerStyles.selectedOuter}>
          <View style={[markerStyles.selectedInner, { backgroundColor: categoryColor + '22' }]}>
            <Text style={markerStyles.icon}>{venue.category?.icon ?? '📍'}</Text>
          </View>
        </View>
      ) : (
        <View style={[markerStyles.base, { backgroundColor: categoryColor + '22', borderColor: categoryColor }]}>
          <Text style={markerStyles.icon}>{venue.category?.icon ?? '📍'}</Text>
        </View>
      )}
    </Marker>
  );
});

const markerStyles = StyleSheet.create({
  base: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2,
    shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
  selectedOuter: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.coral + '28',
    alignItems: 'center', justifyContent: 'center',
  },
  selectedInner: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.coral,
    shadowColor: Colors.coral, shadowOpacity: 0.4, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 6,
  },
  icon: { fontSize: 15 },
});

// ─── Greeting helper ───────────────────────────────────────────────────────
// "Morning / Afternoon / Evening" based on the current local hour.
function getGreetingWord(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Morning';
  if (h < 18) return 'Afternoon';
  return 'Evening';
}

// ─── MapScreen ─────────────────────────────────────────────────────────────
// Shared rendering component used by both MapWithLocation and LocationFallbackMap.
// Phase 2 re-skin: map mode now renders a sand-background scrollable feed
// with a 240px mini-map preview, category chips, and VenueCard list.
// List mode is unchanged from the previous version.
interface MapScreenProps {
  initialCoords: Coordinates;
  liveCoords?: Coordinates;
  locLoading?: boolean;
  trackLocation: boolean;
  onFiltersPress: () => void;
  viewMode: 'map' | 'list';
  onViewModeChange: (mode: 'map' | 'list') => void;
}

function MapScreen({
  initialCoords,
  liveCoords,
  locLoading = false,
  trackLocation,
  onFiltersPress,
  viewMode,
  onViewModeChange,
}: MapScreenProps) {
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const EXPANDED_HEIGHT = Math.round(screenHeight * 0.52);
  const COLLAPSED_OFFSET = EXPANDED_HEIGHT - PEEK_HEIGHT;

  // react-native-map-clustering extends MapView so we type the ref as any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // cancelledRef guards animation .start() calls after unmount.
  const cancelledRef = useRef(false);

  // markerPressedRef: set true for ~100ms after a Marker onPress fires.
  // Prevents the map's own onPress (dismissVenue) from clearing the just-selected
  // venue on Android, where the map onPress bubbles even when a child Marker fires.
  const markerPressedRef = useRef(false);
  const markerPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // suppressRegionUpdate: set true before any programmatic animateToRegion call,
  // cleared after the debounce window. Prevents camera-driven region changes from
  // triggering a new React Query fetch key and the entrance bounce animation.
  const suppressRegionUpdate = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // initialLoadDoneRef: ensures the entrance bounce animation fires only once
  // per mount. Without this, every pan → fetch → load cycle fires the bounce.
  const initialLoadDoneRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (markerPressTimerRef.current) clearTimeout(markerPressTimerRef.current);
      if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    };
  }, []);

  // Derive a display location label.
  // We avoid reverse-geocoding live coordinates — that would process location
  // data beyond what is needed (GDPR Art.5(1)(c) data minimisation).
  // The location label shown is the radius setting only, which is non-personal.
  const locationLabel = useMemo(() => {
    if (trackLocation && locLoading) return null; // show "Getting location…" spinner state
    return null; // no postcode label without profile access in this phase
  }, [trackLocation, locLoading]);

  // Single subscription instead of two — avoids a redundant re-render when filters change.
  const { filters, activeFilterCount } = useFilterStore(
    useShallow((s) => ({ filters: s.filters, activeFilterCount: s.activeFilterCount() }))
  );

  const [mapCenter, setMapCenter] = useState<Coordinates>(initialCoords);
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  // suppressedAnimateTo: wraps animateToRegion with the suppress-region-update
  // guard so programmatic camera moves don't trigger a new fetch query cycle.
  const suppressedAnimateTo = useCallback(
    (region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }, duration: number) => {
      suppressRegionUpdate.current = true;
      if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = setTimeout(() => {
        suppressRegionUpdate.current = false;
      }, duration + 800);
      mapRef.current?.animateToRegion(region, duration);
    },
    [],
  );

  // Cross-tab postcode jump: search tab sets pendingPostcode, consumed here.
  const { pendingPostcode, setPendingPostcode } = useMapStore();
  useEffect(() => {
    if (!pendingPostcode) return;
    (async () => {
      const coords = await geocodePostcode(pendingPostcode);
      setPendingPostcode(null);
      if (!coords || cancelledRef.current) return;
      setMapCenter(coords);
      suppressedAnimateTo({ ...coords, latitudeDelta: 0.12, longitudeDelta: 0.12 }, 600);
    })();
  // geocodePostcode is stable (defined outside component)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPostcode, suppressedAnimateTo]);

  // translateY: 0 = fully expanded, COLLAPSED_OFFSET = collapsed (peeking).
  // useNativeDriver: true keeps animation on the native thread for 60fps.
  const translateY = useRef(new Animated.Value(COLLAPSED_OFFSET)).current;
  const hintOpacity = useRef(new Animated.Value(0)).current;

  // Sync animation position when screen dimensions change (orientation flip).
  useEffect(() => {
    translateY.setValue(sheetExpanded ? 0 : COLLAPSED_OFFSET);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [COLLAPSED_OFFSET]);

  // Once GPS resolves, animate the map to the real fix.
  useEffect(() => {
    if (!trackLocation || locLoading || !liveCoords) return;
    if (!Number.isFinite(liveCoords.latitude) || !Number.isFinite(liveCoords.longitude)) return;
    suppressedAnimateTo(
      { latitude: liveCoords.latitude, longitude: liveCoords.longitude, latitudeDelta: 0.12, longitudeDelta: 0.12 },
      700,
    );
    setMapCenter(liveCoords);
  // Comparing primitives — avoids re-firing on reference changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveCoords?.latitude, liveCoords?.longitude, locLoading, trackLocation, suppressedAnimateTo]);

  // Pass enabled=false while GPS is still loading — prevents a wasted London
  // fallback request that would flash pins before real results arrive.
  const { data: venues = [], isLoading: venuesLoading, isFetching: venuesFetching, error: venuesError } = useNearbyVenues(
    mapCenter,
    filters,
    trackLocation ? !locLoading : true,
  );

  // Preserve venue object references when the same IDs come back in the same order.
  // Prevents all VenueMarkers re-rendering on every 2-minute background refetch.
  const prevVenuesRef = useRef<typeof venues>([]);
  const stableVenues = useMemo(() => {
    const prev = prevVenuesRef.current;
    if (
      venues.length === prev.length &&
      venues.every((v, i) => v.id === prev[i]?.id)
    ) {
      return prev;
    }
    prevVenuesRef.current = venues;
    return venues;
  }, [venues]);

  // Unique categories present in the current result set — drives the chip row.
  // We derive this from the joined `category` object on each venue rather than
  // calling useCategories() separately. This avoids an extra query and keeps the
  // test mock surface minimal (only useNearbyVenues needs to be mocked).
  const availableCategories = useMemo(() => {
    const seen = new Set<string>();
    const cats: { id: string; name: string; icon: string; color: string }[] = [];
    for (const v of stableVenues) {
      const cat = v.category;
      if (cat && !seen.has(cat.id)) {
        seen.add(cat.id);
        cats.push({ id: cat.id, name: cat.name, icon: cat.icon, color: cat.color ?? T.sky });
      }
    }
    return cats;
  }, [stableVenues]);

  // Reset category filter when the map center changes (new area = new results).
  useEffect(() => {
    setSelectedCategoryId(null);
  }, [mapCenter.latitude, mapCenter.longitude]);

  const filteredVenues = useMemo(
    () => selectedCategoryId
      // Filter using the joined category object (v.category?.id) rather than
      // v.category_id, which is not returned by the get_nearby_venues RPC.
      // Without this fix, every chip press produces an empty list.
      ? stableVenues.filter((v) => (v.category?.id ?? v.category_id) === selectedCategoryId)
      : stableVenues,
    [stableVenues, selectedCategoryId],
  );

  // Clear debounce on unmount — prevents stale setMapCenter after unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ── Bottom sheet entrance hint ──────────────────────────────────────────
  // Fires ONCE on the very first load after mount. initialLoadDoneRef prevents
  // it from re-firing on every pan → fetch → load cycle.
  const prevLoadingRef = useRef<boolean>(true);
  useEffect(() => {
    if (prevLoadingRef.current && !venuesLoading && stableVenues.length > 0) {
      if (!cancelledRef.current && !initialLoadDoneRef.current) {
        initialLoadDoneRef.current = true;
        translateY.stopAnimation();
        hintOpacity.stopAnimation();
        Animated.sequence([
          Animated.spring(translateY, { toValue: COLLAPSED_OFFSET - 60, useNativeDriver: true, bounciness: 6, speed: 14 }),
          Animated.delay(600),
          Animated.spring(translateY, { toValue: COLLAPSED_OFFSET, useNativeDriver: true, bounciness: 4, speed: 16 }),
        ]).start();

        Animated.sequence([
          Animated.timing(hintOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.delay(2400),
          Animated.timing(hintOpacity, { toValue: 0, duration: 600, useNativeDriver: true }),
        ]).start();
      }
    }
    prevLoadingRef.current = venuesLoading;
  // stableVenues.length as primitive dependency avoids array reference churn.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venuesLoading, stableVenues.length]);

  // Debounced region change — updates query center as user pans.
  // Skips the update when suppressRegionUpdate is set (programmatic moves).
  const handleRegionChangeComplete = useCallback((region: { latitude: number; longitude: number }) => {
    if (suppressRegionUpdate.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!cancelledRef.current && !suppressRegionUpdate.current) {
        setMapCenter({ latitude: region.latitude, longitude: region.longitude });
      }
    }, 500);
  }, []);

  const expandSheet = useCallback(() => {
    translateY.stopAnimation();
    Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 3, speed: 16 }).start();
    setSheetExpanded(true);
  }, [translateY]);

  const collapseSheet = useCallback(() => {
    translateY.stopAnimation();
    Animated.spring(translateY, { toValue: COLLAPSED_OFFSET, useNativeDriver: true, bounciness: 0, speed: 18 }).start();
    setSheetExpanded(false);
  }, [translateY, COLLAPSED_OFFSET]);

  // toggleSheet is defined for potential future use (e.g. if the mini-map
  // is later upgraded to include an expandable venue list overlay).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const toggleSheet = useCallback(() => {
    if (sheetExpanded) collapseSheet(); else expandSheet();
  }, [sheetExpanded, expandSheet, collapseSheet]);

  const handleMarkerPress = useCallback((venue: Venue) => {
    markerPressedRef.current = true;
    if (markerPressTimerRef.current) clearTimeout(markerPressTimerRef.current);
    markerPressTimerRef.current = setTimeout(() => { markerPressedRef.current = false; }, 150);
    setSelectedVenue(venue);
    collapseSheet();
  }, [collapseSheet]);

  // Stable renderItem for FlatList in the bottom sheet / list mode.
  const handleVenueRowPress = useCallback((item: Venue) => {
    // Always set the selected venue and collapse the sheet, regardless of coordinates.
    setSelectedVenue(item);
    if (viewMode === 'map') collapseSheet();
    // Guard against null/undefined coordinates before animating.
    // Number(null) = 0 and Number(undefined) = NaN — passing NaN to animateToRegion
    // can crash the iOS map renderer. Only animate when both values are valid finite numbers.
    const lat = Number(item.latitude);
    const lng = Number(item.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      suppressedAnimateTo(
        { latitude: lat, longitude: lng, latitudeDelta: 0.04, longitudeDelta: 0.04 },
        400,
      );
    }
  }, [collapseSheet, viewMode, suppressedAnimateTo]);

  const renderVenueRow = useCallback(({ item }: { item: Venue }) => (
    <VenueRow
      venue={item}
      selected={selectedVenue?.id === item.id}
      onPress={handleVenueRowPress}
    />
  ), [selectedVenue?.id, handleVenueRowPress]);

  const dismissVenue = useCallback(() => {
    if (markerPressedRef.current) return;
    setSelectedVenue(null);
  }, []);

  const recenter = useCallback(() => {
    const target = trackLocation && liveCoords && Number.isFinite(liveCoords.latitude)
      ? liveCoords
      : initialCoords;
    suppressedAnimateTo({ ...target, latitudeDelta: 0.12, longitudeDelta: 0.12 }, 500);
    setMapCenter(target);
  }, [trackLocation, liveCoords, initialCoords, suppressedAnimateTo]);

  // Zoom out enough for the full radius circle to fit with 30% padding.
  // e.g. 20 miles (32.2km) → latitudeDelta ≈ 0.83
  const initialRegion = useMemo(() => {
    const radiusDelta = (filters.maxDistanceKm * 2 / 111) * 1.3;
    return {
      latitude: initialCoords.latitude,
      longitude: initialCoords.longitude,
      latitudeDelta: Math.max(0.5, radiusDelta),
      longitudeDelta: Math.max(0.5, radiusDelta),
    };
  }, [initialCoords.latitude, initialCoords.longitude, filters.maxDistanceKm]);

  // ── Distance filter → map zoom ──────────────────────────────────────────
  // When the user changes the radius filter AFTER mount, `initialRegion` is
  // stale — it is a mount-time prop and MapView ignores changes to it.
  // This effect calls suppressedAnimateTo to re-zoom the camera to match the
  // newly chosen radius. It skips the first invocation (mount) because the
  // initialRegion prop already positions the camera correctly on first render;
  // re-firing here would race against that and produce a visible double-zoom.
  const filterZoomInitRef = useRef(false);
  useEffect(() => {
    if (!filterZoomInitRef.current) {
      filterZoomInitRef.current = true;
      return;
    }
    const radiusDelta = (filters.maxDistanceKm * 2 / 111) * 1.3;
    const delta = Math.max(0.5, radiusDelta);
    suppressedAnimateTo(
      { latitude: mapCenter.latitude, longitude: mapCenter.longitude, latitudeDelta: delta, longitudeDelta: delta },
      400,
    );
  // mapCenter and suppressedAnimateTo are intentionally omitted from the dependency
  // array. mapCenter updates on every pan (via handleRegionChangeComplete) and
  // suppressedAnimateTo is recreated on each render cycle — including either would
  // cause the zoom effect to fire on every pan rather than only on radius changes.
  // The values captured at the moment filters.maxDistanceKm changes are correct
  // for a re-zoom because the pan has already settled before the user opens and
  // applies the filter sheet.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.maxDistanceKm]);

  // ── Postcode search ─────────────────────────────────────────────────────
  const [postcodeInput, setPostcodeInput] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [postcodeError, setPostcodeError] = useState<string | null>(null);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
    };
  }, []);

  async function geocodePostcode(input: string): Promise<{ latitude: number; longitude: number } | null> {
    const q = input.replace(/\s+/g, '').toUpperCase();
    try {
      const res = await supabase.functions.invoke('geocode-postcode', {
        body: { postcode: q },
      });
      if (res.error) return null;
      const { latitude, longitude } = res.data as { latitude: number; longitude: number; city: string };
      if (typeof latitude === 'number' && typeof longitude === 'number') {
        return { latitude, longitude };
      }
      return null;
    } catch {
      return null;
    }
  }

  const handlePostcodeSubmit = useCallback(async () => {
    const trimmed = postcodeInput.trim();
    if (!trimmed) return;
    setGeocoding(true);
    setPostcodeError(null);
    const coords = await geocodePostcode(trimmed);
    // Guard against state updates after unmount — the user may have navigated
    // away while the geocoding request was in-flight.
    if (cancelledRef.current) return;
    setGeocoding(false);
    if (coords) {
      if (viewMode === 'map') {
        suppressedAnimateTo(
          { latitude: coords.latitude, longitude: coords.longitude, latitudeDelta: 0.12, longitudeDelta: 0.12 },
          600,
        );
      }
      setMapCenter({ latitude: coords.latitude, longitude: coords.longitude });
      Keyboard.dismiss();
      setPostcodeInput('');
    } else {
      setPostcodeError('Postcode not found — try SY13 1AB');
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = setTimeout(() => {
        if (!cancelledRef.current) setPostcodeError(null);
      }, 3000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postcodeInput, viewMode, suppressedAnimateTo]);

  // ── Toggle pill ─────────────────────────────────────────────────────────
  // Floats over the top of the screen in both modes (zIndex 20).
  // accessibilityLabel values are tested in app/(tabs)/__tests__/index.test.tsx —
  // do NOT rename them without updating the tests.
  const togglePill = (
    <View
      style={{ position: 'absolute', top: insets.top + 8, left: 0, right: 0, alignItems: 'center', zIndex: 20 }}
      pointerEvents="box-none"
    >
      <View style={{
        flexDirection: 'row', backgroundColor: '#fff', borderRadius: 999, padding: 3,
        shadowColor: '#000', shadowOpacity: 0.13, shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 }, elevation: 6,
      }}>
        <TouchableOpacity
          style={[pillStyles.tab, viewMode === 'map' && pillStyles.tabActive]}
          onPress={() => onViewModeChange('map')}
          accessibilityRole="button"
          accessibilityLabel="Map view"
          accessibilityState={{ selected: viewMode === 'map' }}
        >
          <Text style={viewMode === 'map' ? pillStyles.labelActive : pillStyles.labelInactive}>Map</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[pillStyles.tab, viewMode === 'list' && pillStyles.tabActive]}
          onPress={() => onViewModeChange('list')}
          accessibilityRole="button"
          accessibilityLabel="List view"
          accessibilityState={{ selected: viewMode === 'list' }}
        >
          <Text style={viewMode === 'list' ? pillStyles.labelActive : pillStyles.labelInactive}>List</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── Filter button ────────────────────────────────────────────────────────
  const filterButton = (
    <TouchableOpacity
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: activeFilterCount > 0 ? Colors.sky : Colors.sandDark,
        borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7,
        borderWidth: activeFilterCount > 0 ? 0 : 1.5, borderColor: Colors.greyLighter,
      }}
      onPress={onFiltersPress}
      accessibilityRole="button"
      accessibilityLabel={activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : 'Filters'}
    >
      <Ionicons name="options-outline" size={14} color={activeFilterCount > 0 ? '#fff' : Colors.charcoal} />
      <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 13, color: activeFilterCount > 0 ? '#fff' : Colors.charcoal }}>
        {activeFilterCount > 0 ? `Filters · ${activeFilterCount}` : 'Filters'}
      </Text>
    </TouchableOpacity>
  );

  // ── Category chip row (shared between map feed and bottom sheet) ──────────
  const categoryChipRow = availableCategories.length > 0 ? (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 8, gap: 8, alignItems: 'center' }}
      style={{ flexShrink: 0 }}
    >
      {/* "All" chip */}
      <Chip
        active={selectedCategoryId === null}
        color={T.sky}
        onPress={() => setSelectedCategoryId(null)}
        accessibilityLabel="All categories"
        accessibilityState={{ selected: selectedCategoryId === null }}
      >
        All
      </Chip>

      {availableCategories.map((cat) => {
        const active = selectedCategoryId === cat.id;
        return (
          <Chip
            key={cat.id}
            active={active}
            color={cat.color}
            onPress={() => setSelectedCategoryId(active ? null : cat.id)}
            accessibilityLabel={cat.name}
            accessibilityState={{ selected: active }}
          >
            {cat.icon ? `${cat.icon} ${cat.name}` : cat.name}
          </Chip>
        );
      })}
    </ScrollView>
  ) : null;

  // ── Postcode search bar (used in list mode and mini-map overlay) ──────────
  // In map (feed) mode the search pill in the header navigates to the search tab.
  // In list mode the postcode search bar is retained floating below the toggle.
  const postcodeSearchBar = (
    <View
      style={{ position: 'absolute', top: insets.top + 52, left: 16, right: 16, zIndex: 19 }}
      pointerEvents="box-none"
    >
      <View style={{
        flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
        borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9,
        shadowColor: '#000', shadowOpacity: 0.13, shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 }, elevation: 5, gap: 8,
      }} pointerEvents="auto">
        {geocoding ? (
          <ActivityIndicator size="small" color={Colors.sky} />
        ) : (
          <Ionicons name="location-outline" size={18} color={Colors.sky} />
        )}
        <TextInput
          style={{ flex: 1, fontFamily: 'Nunito-Regular', fontSize: 14, color: Colors.charcoal, paddingVertical: 0 }}
          placeholder="Search by postcode…"
          placeholderTextColor={Colors.grey}
          value={postcodeInput}
          onChangeText={setPostcodeInput}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="characters"
          onSubmitEditing={handlePostcodeSubmit}
          accessibilityLabel="Search by postcode"
          accessibilityRole="search"
          accessibilityHint="Type a UK postcode and press search to move the map"
          editable={!geocoding}
        />
        {postcodeInput.length > 0 && (
          <TouchableOpacity
            onPress={() => { setPostcodeInput(''); setPostcodeError(null); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Clear postcode search"
            accessibilityRole="button"
          >
            <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 14, color: Colors.grey }}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
      {postcodeError && (
        <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 12, color: Colors.coral, marginTop: 6, marginLeft: 14 }}>
          {postcodeError}
        </Text>
      )}
    </View>
  );

  // Must be above the list-mode early return — Rules of Hooks require all hooks
  // to be called unconditionally on every render path.
  const openVenueCount = useMemo(() => filteredVenues.filter((v) => {
    if (!v.opening_hours || v.opening_hours.length === 0) return false;
    const now = new Date();
    const todayRow = v.opening_hours.find((h) => h.day_of_week === now.getDay());
    if (!todayRow || todayRow.is_closed || !todayRow.opens_at || !todayRow.closes_at) return false;
    const toMins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const nowMins   = now.getHours() * 60 + now.getMinutes();
    const openMins  = toMins(todayRow.opens_at);
    const closeMins = toMins(todayRow.closes_at);
    if (closeMins < openMins) return nowMins >= openMins || nowMins < closeMins;
    return nowMins >= openMins && nowMins < closeMins;
  }).length, [filteredVenues]);

  // ── Weather (progressive enhancement) ──────────────────────────────────
  // Non-blocking: if the fetch fails or coords aren't ready, weather is null
  // and all weather-dependent UI is simply hidden. The key uses 2-decimal
  // precision (~1km grid) so nearby pans hit the cache instead of re-fetching.
  const weather = useWeather(mapCenter.latitude, mapCenter.longitude);

  const weatherBanner = useMemo(
    () => (weather ? getWeatherBanner(weather, viewMode) : null),
    [weather, viewMode],
  );

  // Per-venue badge labels — keyed by venue.id for O(1) lookup in render.
  const weatherBadgeMap = useMemo(() => {
    if (!weather) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const v of filteredVenues) {
      const badge = getWeatherBadge(v.category?.slug ?? null, weather.condition);
      if (badge) map.set(v.id, badge);
    }
    return map;
  }, [filteredVenues, weather]);

  // In list mode, weather-boosted sort moves appropriate venues to the top.
  // We sort a copy (stable sort) so distance ordering within the same score
  // tier is preserved — venues that score equally keep their original order.
  const weatherSortedVenues = useMemo(() => {
    if (!weather || viewMode !== 'list') return filteredVenues;
    return [...filteredVenues].sort((a, b) =>
      scoreVenueForWeather(b.category?.slug ?? null, weather.condition) -
      scoreVenueForWeather(a.category?.slug ?? null, weather.condition),
    );
  }, [filteredVenues, weather, viewMode]);

  // ── List mode ─────────────────────────────────────────────────────────────
  // Unchanged from pre-Phase-2. Map fully unmounts — ClusterMapView, bottom
  // sheet, FAB, preview card, and ODbL attribution are all excluded.
  if (viewMode === 'list') {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={{
          paddingTop: insets.top + 52, paddingHorizontal: 16, paddingBottom: 10,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        }}>
          {venuesLoading ? (
            <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 14, color: Colors.grey }}>Finding venues…</Text>
          ) : (
            <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 15, color: Colors.charcoal }}>
              {filteredVenues.length === 0
                ? 'No venues found'
                : `${filteredVenues.length} venue${filteredVenues.length === 1 ? '' : 's'} nearby`}
            </Text>
          )}
          {filterButton}
        </View>

        {weatherBanner && (
          <View style={{
            marginHorizontal: 16, marginBottom: 8,
            paddingHorizontal: 14, paddingVertical: 9,
            borderRadius: 12, backgroundColor: weatherBanner.tint,
          }}>
            <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 13, color: '#1D2630' }}>
              {weatherBanner.text}
            </Text>
          </View>
        )}

        {(availableCategories.length > 0) && (
          <View style={{ opacity: venuesFetching && !venuesLoading ? 0.5 : 1 }}>
            {categoryChipRow}
          </View>
        )}
        <View style={{ height: 1, backgroundColor: Colors.greyLighter }} />

        {venuesLoading ? (
          <View style={{ paddingTop: 4 }}>
            <VenueRowSkeleton /><VenueRowSkeleton /><VenueRowSkeleton />
            <VenueRowSkeleton /><VenueRowSkeleton />
          </View>
        ) : filteredVenues.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            <Ionicons name="map-outline" size={38} color={Colors.greyLighter} />
            <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 15, color: Colors.charcoal, textAlign: 'center', marginTop: 12 }}>
              No venues found
            </Text>
            <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 13, color: Colors.grey, textAlign: 'center', marginTop: 6 }}>
              Adjust your filters or move the map to find venues nearby.
            </Text>
          </View>
        ) : (
          <FlatList
            data={weatherSortedVenues}
            keyExtractor={(v) => v.id}
            renderItem={renderVenueRow}
            ItemSeparatorComponent={VenueRowSeparator}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews
          />
        )}

        {postcodeSearchBar}
        {togglePill}
      </View>
    );
  }


  // ── Map mode — Phase 2 feed layout ─────────────────────────────────────
  // Sand-background ScrollView with: header → search pill → location row
  // → 240px mini-map → category chips → "Open right now" section → VenueCards.
  // The toggle pill still floats over the top via absolute positioning.

  const radiusMiles = Math.round(filters.maxDistanceKm * 0.621371);

  return (
    <View style={{ flex: 1 }}>
      {/* ── Sand-background scrollable feed ─────────────────────────────── */}
      <ScrollView
        style={{ flex: 1, backgroundColor: T.sand }}
        contentContainerStyle={{ paddingTop: insets.top + 56, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header: greeting + bell ─────────────────────────────────── */}
        <View style={{
          paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14,
          flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
        }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 13, color: T.mute }}>
              {getGreetingWord()} 👋
            </Text>
            <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 26, color: T.ink, letterSpacing: -0.5, lineHeight: 30, marginTop: 2 }}>
              Where to today?
            </Text>
          </View>
          <IconBtn
            size={40}
            onPress={() => router.push('/profile/notifications')}
            accessibilityLabel="Notifications"
            shadow
          >
            <Icon name="bell" size={18} color={T.ink} />
          </IconBtn>
        </View>

        {/* ── Search pill: tapping navigates to the Search tab ─────────── */}
        <Pressable
          style={{
            marginHorizontal: 20, marginBottom: 14,
            backgroundColor: T.paper, borderRadius: 9999,
            paddingHorizontal: 16, paddingVertical: 12,
            flexDirection: 'row', alignItems: 'center', gap: 10,
            borderWidth: 1, borderColor: T.line,
            shadowColor: T.ink, shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
          }}
          onPress={() => router.push('/(tabs)/search')}
          accessibilityRole="button"
          accessibilityLabel="Search venues or a postcode"
        >
          <Icon name="search" size={18} color={T.mute} />
          <Text style={{ flex: 1, fontFamily: 'Nunito-Bold', fontSize: 14, color: T.mute }}>
            Search venues or a postcode…
          </Text>
        </Pressable>

        {/* ── Location row ────────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: 20, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="pin" size={14} color={T.skyDeep} />
          {trackLocation && locLoading ? (
            <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 13, color: T.mute }}>
              Getting location…
            </Text>
          ) : locationLabel ? (
            <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 13, color: T.ink }}>
              {locationLabel}{' '}
              <Text style={{ fontFamily: 'Nunito-Regular', color: T.mute }}>
                · within {radiusMiles} mile{radiusMiles === 1 ? '' : 's'}
              </Text>
            </Text>
          ) : (
            <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 13, color: T.mute }}>
              Nearby · within {radiusMiles} mile{radiusMiles === 1 ? '' : 's'}
            </Text>
          )}
        </View>

        {/* ── Mini-map preview (240px, rounded-xl) ────────────────────── */}
        {/* The ClusterMapView is the same component used in full-screen mode,
            just constrained to 240px height. All markers, clustering, and
            permissions are fully operational — this is NOT a fake SVG map.
            Floating controls: locate (top-right), sliders (top-right), See all pill (bottom-right).
            The map itself still handles onRegionChangeComplete and re-fetches venues
            as the user pans — the mini-map is interactive. */}
        <View style={{ marginHorizontal: 20, marginBottom: 18 }}>
          <View style={{
            height: 240, borderRadius: 24,
            overflow: 'hidden',
            borderWidth: 1, borderColor: T.line,
            shadowColor: T.ink, shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
          }}>
            <ClusterMapView
              ref={mapRef}
              provider={PROVIDER_GOOGLE}
              style={{ flex: 1 }}
              initialRegion={initialRegion}
              showsUserLocation={trackLocation}
              showsMyLocationButton={false}
              showsCompass={false}
              showsScale={false}
              renderCluster={renderCluster}
              radius={72}
              minPoints={2}
              maxZoom={16}
              animationEnabled={false}
              onRegionChangeComplete={handleRegionChangeComplete}
              onPress={dismissVenue}
              mapPadding={{ top: 16, right: 16, bottom: 16, left: 16 }}
            >
              {stableVenues.map((venue) => (
                <VenueMarker
                  key={venue.id}
                  venue={venue}
                  isSelected={selectedVenue?.id === venue.id}
                  onPress={handleMarkerPress}
                />
              ))}
            </ClusterMapView>

            {/* Fixed radius ring — stays screen-centred as the map pans. */}
            <View
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              pointerEvents="none"
            >
              <Svg width="100%" height={240} pointerEvents="none">
                <SvgCircle
                  cx="50%"
                  cy={120}
                  r={100}
                  stroke="rgba(45,184,176,0.65)"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                  fill="none"
                />
              </Svg>
              <Text style={{
                position: 'absolute',
                top: 16,
                alignSelf: 'center',
                fontFamily: 'Nunito-Bold',
                fontSize: 10,
                color: 'rgba(45,184,176,0.95)',
                backgroundColor: 'rgba(248,243,234,0.88)',
                paddingHorizontal: 7,
                paddingVertical: 2,
                borderRadius: 8,
              }}>
                {radiusMiles} miles
              </Text>
            </View>

            {/* ODbL attribution — required by OpenStreetMap licence (ODbL 1.0 §4.3) */}
            <View
              style={{ position: 'absolute', bottom: 44, left: 0, right: 0, alignItems: 'center' }}
              pointerEvents="none"
            >
              <Text style={{ fontSize: 9, color: T.ink, opacity: 0.4 }}>
                © OpenStreetMap contributors
              </Text>
            </View>

            {/* Top-right floating controls */}
            <View style={{ position: 'absolute', top: 12, right: 12, gap: 8 }}>
              <IconBtn
                size={38}
                shadow
                onPress={recenter}
                accessibilityLabel="Recenter map to your location"
              >
                <Icon name="locate" size={16} color={T.ink} />
              </IconBtn>
              <IconBtn
                size={38}
                shadow
                onPress={onFiltersPress}
                accessibilityLabel="Open filters"
              >
                <Icon name="sliders" size={16} color={T.ink} />
              </IconBtn>
            </View>

            {/* Selected venue label — bottom-left of mini-map */}
            {selectedVenue && (
              <View style={{
                position: 'absolute', bottom: 12, left: 12,
                backgroundColor: T.paper, borderRadius: 12,
                paddingHorizontal: 12, paddingVertical: 8,
                flexDirection: 'row', alignItems: 'center', gap: 8,
                borderWidth: 1, borderColor: T.line,
                shadowColor: T.ink, shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.12, shadowRadius: 8, elevation: 4,
              }}>
                <View style={{ width: 8, height: 8, borderRadius: 9999, backgroundColor: selectedVenue.category?.color ?? T.sky }} />
                <View>
                  <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 12, color: T.ink }} numberOfLines={1}>
                    {selectedVenue.name}
                  </Text>
                  <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 10, color: T.mute }}>
                    {selectedVenue.category?.name ?? 'Venue'}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={dismissVenue}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  accessibilityLabel="Close venue label"
                >
                  <Icon name="close" size={14} color={T.mute} />
                </TouchableOpacity>
              </View>
            )}

            {/* "See all" pill — bottom-right */}
            {/* Opens the full venue list (list mode). Label updated from "Full map"
                which was misleading — this button switches to list view, not a map. */}
            <TouchableOpacity
              style={{
                position: 'absolute', bottom: 12, right: 12,
                backgroundColor: T.ink, borderRadius: 9999,
                paddingHorizontal: 12, paddingVertical: 8,
                flexDirection: 'row', alignItems: 'center', gap: 6,
                shadowColor: T.ink, shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.25, shadowRadius: 8, elevation: 5,
              }}
              onPress={() => onViewModeChange('list')}
              accessibilityLabel="Browse full venue list"
              accessibilityRole="button"
            >
              <Icon name="map" size={13} color="#fff" />
              <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 12, color: '#fff' }}>
                See all
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Category chips ───────────────────────────────────────────── */}
        {availableCategories.length > 0 && (
          <View style={{ marginBottom: 6, opacity: venuesFetching && !venuesLoading ? 0.5 : 1 }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 6, gap: 8 }}
            >
              <Chip
                active={selectedCategoryId === null}
                color={T.sky}
                onPress={() => setSelectedCategoryId(null)}
                accessibilityLabel="All categories"
                accessibilityState={{ selected: selectedCategoryId === null }}
              >
                All
              </Chip>
              {availableCategories.map((cat) => {
                const active = selectedCategoryId === cat.id;
                return (
                  <Chip
                    key={cat.id}
                    active={active}
                    color={cat.color}
                    onPress={() => setSelectedCategoryId(active ? null : cat.id)}
                    accessibilityLabel={cat.name}
                    accessibilityState={{ selected: active }}
                  >
                    {cat.icon ? `${cat.icon} ${cat.name}` : cat.name}
                  </Chip>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* ── Weather banner (only for notable weather) ───────────────── */}
        {weatherBanner && (
          <View style={{
            marginHorizontal: 20, marginBottom: 4,
            paddingHorizontal: 14, paddingVertical: 10,
            borderRadius: 14, backgroundColor: weatherBanner.tint,
          }}>
            <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 13, color: '#1D2630' }}>
              {weatherBanner.text}
            </Text>
          </View>
        )}

        {/* ── "Open right now" section header ─────────────────────────── */}
        <View style={{
          paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8,
          flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
        }}>
          <View>
            <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 18, color: T.ink, letterSpacing: -0.3 }}>
              Open right now
            </Text>
            {!venuesLoading && (
              <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 12, color: T.mute, marginTop: 1, opacity: venuesFetching ? 0.5 : 1 }}>
                {openVenueCount} place{openVenueCount === 1 ? '' : 's'} within {radiusMiles} mile{radiusMiles === 1 ? '' : 's'}
              </Text>
            )}
          </View>
          {/* Right side: Filters button + See all link */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {filterButton}
            <TouchableOpacity
              onPress={() => onViewModeChange('list')}
              accessibilityRole="button"
              accessibilityLabel="See all venues"
            >
              <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 12, color: T.skyDeep }}>
                See all
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Venue cards / skeleton / empty / error ───────────────────── */}
        <View style={{ paddingHorizontal: 20, gap: 10 }}>
          {venuesLoading ? (
            <>
              <VenueRowSkeleton />
              <VenueRowSkeleton />
              <VenueRowSkeleton />
            </>
          ) : venuesError ? (
            <View style={{ alignItems: 'center', paddingVertical: 32 }}>
              <Ionicons name="cloud-offline-outline" size={38} color={Colors.greyLighter} />
              <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 15, color: Colors.charcoal, marginTop: 12 }}>
                Could not load venues
              </Text>
              <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 13, color: Colors.grey, marginTop: 6, textAlign: 'center' }}>
                Check your connection and pull down to refresh.
              </Text>
            </View>
          ) : filteredVenues.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 32 }}>
              <Ionicons name="map-outline" size={38} color={Colors.greyLighter} />
              <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 15, color: Colors.charcoal, marginTop: 12, textAlign: 'center' }}>
                No venues in this area
              </Text>
              <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 13, color: Colors.grey, marginTop: 6, textAlign: 'center' }}>
                Pan the map or adjust your filters to explore more.
              </Text>
            </View>
          ) : (
            filteredVenues.map((venue) => (
              <VenueCard
                key={venue.id}
                venue={venue}
                onPress={() => router.push(`/venue/${venue.id}`)}
                weatherBadge={weatherBadgeMap.get(venue.id) ?? null}
              />
            ))
          )}
        </View>
      </ScrollView>

      {/* Toggle pill floats over the ScrollView */}
      {togglePill}
    </View>
  );
}

// ─── Pill styles ───────────────────────────────────────────────────────────
const pillStyles = StyleSheet.create({
  tab:           { paddingHorizontal: 20, paddingVertical: 7, borderRadius: 999 },
  tabActive:     { backgroundColor: Colors.sky },
  labelActive:   { fontFamily: 'Nunito-Bold', fontSize: 14, color: '#fff' },
  labelInactive: { fontFamily: 'Nunito-Regular', fontSize: 14, color: Colors.charcoal },
});

// ─── MapWithLocation ───────────────────────────────────────────────────────
// Only rendered when consent is confirmed. Isolates useLocation() so the OS
// permission dialog is never triggered without explicit user consent.
const MapWithLocation = memo(function MapWithLocation({
  onFiltersPress,
  viewMode,
  onViewModeChange,
}: {
  onFiltersPress: () => void;
  viewMode: 'map' | 'list';
  onViewModeChange: (mode: 'map' | 'list') => void;
}) {
  const { coords, isLoading: locLoading } = useLocation();
  return (
    <MapScreen
      initialCoords={FALLBACK_LOCATION}
      liveCoords={coords}
      locLoading={locLoading}
      trackLocation
      onFiltersPress={onFiltersPress}
      viewMode={viewMode}
      onViewModeChange={onViewModeChange}
    />
  );
});

// ─── LocationFallbackMap ────────────────────────────────────────────────────
// Shown when user declines location. Falls back to London — no GPS requested.
const LocationFallbackMap = memo(function LocationFallbackMap({
  onFiltersPress,
  viewMode,
  onViewModeChange,
}: {
  onFiltersPress: () => void;
  viewMode: 'map' | 'list';
  onViewModeChange: (mode: 'map' | 'list') => void;
}) {
  return (
    <MapScreen
      initialCoords={FALLBACK_LOCATION}
      trackLocation={false}
      onFiltersPress={onFiltersPress}
      viewMode={viewMode}
      onViewModeChange={onViewModeChange}
    />
  );
});

// ─── ExploreScreen ──────────────────────────────────────────────────────────
// Consent states come from the shared useLocationConsent hook (single source of
// truth for the location flag — see hooks/useLocationConsent.ts):
//   'checking'  → still reading SecureStore, render a neutral splash
//   'undecided' → show the plain-English consent prompt
//   'declined'  → fallback map (London, no GPS)
//   'granted'   → live map with GPS
export default function ExploreScreen() {
  const { status, grant, decline } = useLocationConsent();
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');

  const handleFiltersPress    = useCallback(() => setFilterSheetVisible(true),  []);
  const handleFilterSheetClose = useCallback(() => setFilterSheetVisible(false), []);
  const handleViewModeChange   = useCallback((mode: 'map' | 'list') => setViewMode(mode), []);

  // State 1: still reading SecureStore — render nothing to avoid consent prompt flash.
  if (status === 'checking') return <View style={{ flex: 1, backgroundColor: Colors.slate }} />;

  // State 2: consent not yet given — show plain-English prompt first.
  if (status === 'undecided') {
    return (
      <LocationConsentPrompt onAccept={grant} onDecline={decline} />
    );
  }

  // States 3 & 4: map is shown — filter sheet shared across both variants.
  return (
    <>
      {status === 'granted' ? (
        <MapWithLocation
          onFiltersPress={handleFiltersPress}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
        />
      ) : (
        <LocationFallbackMap
          onFiltersPress={handleFiltersPress}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
        />
      )}
      <FilterSheet visible={filterSheetVisible} onClose={handleFilterSheetClose} />
    </>
  );
}
