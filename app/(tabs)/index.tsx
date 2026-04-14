/**
 * Map / Explore tab — the main home screen.
 *
 * ICO Children's Code Standard 10 compliance:
 * Geolocation is OFF by default. We check SecureStore for a previously saved
 * consent decision before doing anything with location. If no consent is
 * recorded, we show LocationConsentPrompt first — the OS permission dialog
 * is only ever triggered AFTER the user taps "Allow location" inside our own
 * prompt. If the user declines, we fall back to London and never request
 * location again in the same session (they can change this in Privacy Settings).
 *
 * Why we split into MapWithLocation + ExploreScreen:
 * React hooks must always be called in the same order — you cannot call
 * useLocation() inside an "if" block. By isolating useLocation() inside
 * MapWithLocation, we ensure the hook only runs when consent is confirmed.
 *
 * Why no BottomSheetModalProvider:
 * FilterSheet now uses React Native's built-in Modal — it does not need any
 * provider wrapper. We replaced the imperative ref.current?.present() pattern
 * with a simple boolean state value: filterSheetVisible.
 */

import { useState, useEffect, useCallback, memo, useRef } from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { router } from 'expo-router';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as SecureStore from 'expo-secure-store';

import { useLocation } from '@/hooks/location';
import { useNearbyVenues } from '@/hooks/useVenues';
import { useFilterStore } from '@/store/filterStore';
import { LocationConsentPrompt } from '@/components/consent';
import FilterSheet from '@/components/filters/FilterSheet';
import { recordLocationConsentGranted } from '@/services/consent/locationConsent';
import { FALLBACK_LOCATION } from '@/constants/location';
import { Colors } from '@/constants/theme';
import type { Venue } from '@/types';

// The SecureStore key that records whether the user has already consented.
// Using a fixed string constant avoids typos in multiple places.
const CONSENT_KEY = 'location_consent_granted';
// The value we write when consent is given.
const CONSENT_VALUE = '1';

// ─────────────────────────────────────────────────────────────────────────────
// VenueMarker
//
// Extracted as a memoised component so React Native Maps can compare props
// by reference. Without this, inline arrow functions on onCalloutPress create
// new references every render, causing all native map annotations to re-render
// on every GPS tick or filter update.
// ─────────────────────────────────────────────────────────────────────────────
const VenueMarker = memo(function VenueMarker({ venue }: { venue: Venue }) {
  const handlePress = useCallback(() => {
    router.push(`/venue/${venue.id}`);
  }, [venue.id]);

  return (
    <Marker
      coordinate={{ latitude: venue.latitude, longitude: venue.longitude }}
      title={venue.name}
      onCalloutPress={handlePress}
    >
      <View
        className="w-10 h-10 rounded-full items-center justify-center"
        style={{ backgroundColor: venue.is_premium ? Colors.sun : Colors.sky }}
      >
        <Text className="text-white font-bold text-xs">
          {venue.category?.icon ?? '📍'}
        </Text>
      </View>
    </Marker>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// VenuePanel
//
// The bottom 1/3-screen panel showing a scrollable list of nearby venues.
// Reuses the venues already fetched by the parent map component — no extra
// network call. Tap a row to open the venue detail screen.
// ─────────────────────────────────────────────────────────────────────────────
const VenueRow = memo(function VenueRow({ venue }: { venue: Venue }) {
  return (
    <TouchableOpacity
      className="flex-row items-center px-4 py-3 border-b border-greyLighter"
      onPress={() => router.push(`/venue/${venue.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${venue.name}, ${venue.category?.name ?? 'Venue'}`}
    >
      {/* Category icon bubble */}
      <View
        className="w-10 h-10 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: venue.is_premium ? Colors.sun : Colors.sky + '22' }}
      >
        <Text style={{ fontSize: 18 }}>{venue.category?.icon ?? '📍'}</Text>
      </View>

      {/* Name + meta */}
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text
            className="text-charcoal text-sm flex-shrink"
            style={{ fontFamily: 'Nunito-Bold' }}
            numberOfLines={1}
          >
            {venue.name}
          </Text>
          {venue.is_premium && (
            <View className="bg-sun rounded-full px-2 py-0.5">
              <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 10, color: '#7A5800' }}>
                FEATURED
              </Text>
            </View>
          )}
        </View>
        <Text
          className="text-grey text-xs mt-0.5"
          style={{ fontFamily: 'Nunito-Regular' }}
          numberOfLines={1}
        >
          {venue.category?.name ?? 'Venue'}
          {venue.avg_rating != null && venue.avg_rating > 0
            ? `  ·  ${'★'.repeat(Math.round(venue.avg_rating))} ${venue.avg_rating.toFixed(1)}`
            : ''}
        </Text>
      </View>

      {/* Chevron */}
      <Text className="text-greyLighter text-lg ml-2">›</Text>
    </TouchableOpacity>
  );
});

function VenuePanel({ venues }: { venues: Venue[] }) {
  return (
    <View className="bg-white" style={{ flex: 1, borderTopLeftRadius: 16, borderTopRightRadius: 16, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, elevation: 8 }}>
      {/* Drag handle — decorative */}
      <View className="items-center pt-2 pb-1">
        <View className="w-10 h-1 rounded-full bg-greyLighter" />
      </View>

      {/* Header */}
      <View className="flex-row items-center justify-between px-4 pb-2">
        <Text className="text-charcoal text-base" style={{ fontFamily: 'Nunito-Bold' }}>
          Nearby venues
        </Text>
        <Text className="text-grey text-sm" style={{ fontFamily: 'Nunito-Regular' }}>
          {venues.length} {venues.length === 1 ? 'result' : 'results'}
        </Text>
      </View>

      {venues.length === 0 ? (
        <View className="flex-1 items-center justify-center pb-4">
          <Text className="text-grey text-sm" style={{ fontFamily: 'Nunito-Regular' }}>
            No venues found in this area
          </Text>
        </View>
      ) : (
        <FlatList
          data={venues}
          keyExtractor={(v) => v.id}
          renderItem={({ item }) => <VenueRow venue={item} />}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
        />
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MapWithLocation
//
// This child component is ONLY rendered when the user has given consent.
// That means useLocation() — which triggers the OS permission dialog — is
// never called until we know the user agreed to share their location.
// ─────────────────────────────────────────────────────────────────────────────
// onFiltersPress is passed down from ExploreScreen so the sheet state lives
// in the parent and is shared between both map variants.
const MapWithLocation = memo(function MapWithLocation({ onFiltersPress }: { onFiltersPress: () => void }) {
  const { coords, isLoading: locLoading } = useLocation();
  const mapRef = useRef<MapView>(null);
  const filters = useFilterStore((s) => s.filters);
  const activeFilterCount = useFilterStore((s) => s.activeFilterCount());
  const { data: venues = [] } = useNearbyVenues(coords, filters);

  // Once the GPS fix arrives, smoothly pan the map to the real coordinates.
  // `initialRegion` is only read by MapView at mount time, so a late-arriving
  // location fix has no effect without this explicit animateToRegion call.
  // Intentional: coords.latitude/longitude are the only values that should trigger a pan.
  // Using the full `coords` object would cause an infinite animation loop because a new
  // object reference is created on every render.
  useEffect(() => {
    if (!locLoading && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          ...coords,
          latitudeDelta: 0.35,   // ~20 miles visible radius
          longitudeDelta: 0.35,
        },
        800, // ms — smooth enough to feel intentional, fast enough not to annoy
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords.latitude, coords.longitude, locLoading]);

  return (
    <View className="flex-1">
      {/* Map section — top 2/3 of screen */}
      <View style={{ flex: 2 }}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={{ flex: 1 }}
          initialRegion={{
            ...coords,
            latitudeDelta: 0.35,   // ~20 miles visible radius
            longitudeDelta: 0.35,
          }}
          showsUserLocation={true}
          showsMyLocationButton={false}
        >
          {venues.map((venue: Venue) => (
            <VenueMarker key={venue.id} venue={venue} />
          ))}
        </MapView>

        {/* Filter button — floats over map, anchored bottom-left */}
        <View className="absolute bottom-4 left-4">
          <TouchableOpacity
            className="bg-sky rounded-full px-5 py-3 flex-row items-center gap-2 shadow-md"
            onPress={onFiltersPress}
          >
            <Text className="text-white font-bold">Filters</Text>
            {activeFilterCount > 0 && (
              <View className="bg-coral rounded-full w-5 h-5 items-center justify-center">
                <Text className="text-white text-xs font-bold">{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Add venue button — floats over map, anchored bottom-right */}
        <View className="absolute bottom-4 right-4">
          <TouchableOpacity
            className="bg-sky rounded-full w-14 h-14 items-center justify-center shadow-md"
            onPress={() => router.push('/venue/add')}
          >
            <Text className="text-white text-3xl font-bold">+</Text>
          </TouchableOpacity>
        </View>

        {/* ODbL attribution — required by OpenStreetMap licence (ODbL 1.0 §4.3).
            Must be visible whenever OSM-derived data appears on the map. */}
        <View className="absolute bottom-1 left-0 right-0 items-center" pointerEvents="none">
          <Text className="text-charcoal text-xs opacity-60">
            © OpenStreetMap contributors
          </Text>
        </View>
      </View>

      {/* Venue panel — bottom 1/3 of screen */}
      <VenuePanel venues={venues} />
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// LocationFallbackMap
//
// Shown when the user has not given consent. Centres on London so the map
// screen is still useful (browsing, searching) without requiring location.
// ─────────────────────────────────────────────────────────────────────────────
const LocationFallbackMap = memo(function LocationFallbackMap({ onFiltersPress }: { onFiltersPress: () => void }) {
  const filters = useFilterStore((s) => s.filters);
  const activeFilterCount = useFilterStore((s) => s.activeFilterCount());
  const { data: venues = [] } = useNearbyVenues(FALLBACK_LOCATION, filters);

  return (
    <View className="flex-1">
      {/* Map section — top 2/3 of screen */}
      <View style={{ flex: 2 }}>
        <MapView
          provider={PROVIDER_GOOGLE}
          style={{ flex: 1 }}
          initialRegion={{
            ...FALLBACK_LOCATION,
            latitudeDelta: 0.35,   // ~20 miles visible radius
            longitudeDelta: 0.35,
          }}
          showsUserLocation={false}
          showsMyLocationButton={false}
        >
          {venues.map((venue: Venue) => (
            <VenueMarker key={venue.id} venue={venue} />
          ))}
        </MapView>

        {/* Filter button — floats over map, anchored bottom-left */}
        <View className="absolute bottom-4 left-4">
          <TouchableOpacity
            className="bg-sky rounded-full px-5 py-3 flex-row items-center gap-2 shadow-md"
            onPress={onFiltersPress}
          >
            <Text className="text-white font-bold">Filters</Text>
            {activeFilterCount > 0 && (
              <View className="bg-coral rounded-full w-5 h-5 items-center justify-center">
                <Text className="text-white text-xs font-bold">{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Add venue button — floats over map, anchored bottom-right */}
        <View className="absolute bottom-4 right-4">
          <TouchableOpacity
            className="bg-sky rounded-full w-14 h-14 items-center justify-center shadow-md"
            onPress={() => router.push('/venue/add')}
          >
            <Text className="text-white text-3xl font-bold">+</Text>
          </TouchableOpacity>
        </View>

        {/* ODbL attribution — required by OpenStreetMap licence (ODbL 1.0 §4.3). */}
        <View className="absolute bottom-1 left-0 right-0 items-center" pointerEvents="none">
          <Text className="text-charcoal text-xs opacity-60">
            © OpenStreetMap contributors
          </Text>
        </View>
      </View>

      {/* Venue panel — bottom 1/3 of screen */}
      <VenuePanel venues={venues} />
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ExploreScreen (default export / the actual tab screen)
//
// Four possible states:
//   1. consentChecked=false — we haven't read SecureStore yet, render nothing
//      (avoids a flash of the consent prompt for returning users who already agreed)
//   2. consentChecked=true, consented=false, declined=false — show LocationConsentPrompt
//   3. consentChecked=true, consented=false, declined=true  — show LocationFallbackMap
//      (user tapped "Not now" this session; London fallback, no GPS access)
//   4. consentChecked=true, consented=true  — show MapWithLocation
//
// filterSheetVisible controls the FilterSheet modal. It is hoisted here so
// both MapWithLocation and LocationFallbackMap can open the same single sheet.
// ─────────────────────────────────────────────────────────────────────────────
export default function ExploreScreen() {
  // Whether we have finished reading the stored consent value from SecureStore.
  // Starts false so we don't flash the consent prompt before the async read completes.
  const [consentChecked, setConsentChecked] = useState(false);

  // Whether the user has given (or previously given) location consent.
  // Defaults to false — geolocation is OFF by default per ICO Children's Code Standard 10.
  const [consented, setConsented] = useState(false);

  // Whether the user has actively declined consent in this session.
  // Kept in-memory only (not persisted) so they are asked again on next app open,
  // per ICO guidance that decline should not be treated as permanent.
  const [declined, setDeclined] = useState(false);

  // Controls whether the filter sheet modal is visible.
  // Both map variants call onFiltersPress, which sets this to true.
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);

  // Stable callback so child components don't re-render when nothing changed.
  const handleFiltersPress = useCallback(() => {
    setFilterSheetVisible(true);
  }, []);

  // Stable close callback passed to FilterSheet.
  const handleFilterSheetClose = useCallback(() => {
    setFilterSheetVisible(false);
  }, []);

  useEffect(() => {
    async function checkStoredConsent() {
      try {
        // SecureStore is encrypted on-device storage. We use it (rather than
        // AsyncStorage) for consent flags because it cannot be read by other apps.
        const stored = await SecureStore.getItemAsync(CONSENT_KEY);
        if (stored === CONSENT_VALUE) {
          // User already said yes in a previous session — skip the prompt.
          setConsented(true);
        }
      } catch {
        // If SecureStore fails (e.g. device lock screen not set on some Androids),
        // we simply default to not-consented. The user will see the prompt again.
      } finally {
        // Always mark the check as done, even on error, so the UI doesn't get stuck.
        setConsentChecked(true);
      }
    }
    checkStoredConsent();
  }, []);

  async function handleConsentAccept() {
    try {
      // Persist the consent decision so returning users aren't asked again.
      // This is a UX decision — GDPR consent records are written server-side
      // by recordLocationConsentGranted() inside useLocation().
      await SecureStore.setItemAsync(CONSENT_KEY, CONSENT_VALUE);

      // Write the GDPR Art.7 audit record. Non-blocking — a failure here must
      // never prevent the user from using the app.
      recordLocationConsentGranted().catch((error: unknown) => {
        console.warn('PlayPlanner: Location consent logging failed:', error);
      });
    } catch {
      // If SecureStore write fails, consent still works for this session.
      // The prompt will simply show again next time they open the app.
    }
    setConsented(true);
  }

  function handleConsentDecline() {
    // User chose "Not now". We respect that and show the London fallback map.
    // We deliberately do NOT persist a "declined" flag — the next time they open
    // the app they get asked again, giving them a fresh opportunity to agree.
    // This is the recommended pattern per ICO guidance (do not treat decline as permanent).
    setDeclined(true);
  }

  // State 1: SecureStore read not yet complete — render nothing to avoid a flash.
  if (!consentChecked) {
    return <View className="flex-1 bg-slate" />;
  }

  // State 3: User declined this session — show London fallback map, no GPS.
  if (declined) {
    return (
      <>
        <LocationFallbackMap onFiltersPress={handleFiltersPress} />
        <FilterSheet
          visible={filterSheetVisible}
          onClose={handleFilterSheetClose}
        />
      </>
    );
  }

  // State 2: No consent recorded yet — show our plain-English consent prompt.
  // This is shown INSTEAD of the map, before any OS dialog appears.
  // No filter sheet needed on the consent screen.
  if (!consented) {
    return (
      <LocationConsentPrompt
        onAccept={handleConsentAccept}
        onDecline={handleConsentDecline}
      />
    );
  }

  // State 4: Consent confirmed — render the live map with real location.
  return (
    <>
      <MapWithLocation onFiltersPress={handleFiltersPress} />
      <FilterSheet
        visible={filterSheetVisible}
        onClose={handleFilterSheetClose}
      />
    </>
  );
}
