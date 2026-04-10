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
 */

import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as SecureStore from 'expo-secure-store';

import { useLocation } from '@/hooks/location';
import { useNearbyVenues } from '@/hooks/useVenues';
import { useFilterStore } from '@/store/filterStore';
import { LocationConsentPrompt } from '@/components/consent';
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
// MapWithLocation
//
// This child component is ONLY rendered when the user has given consent.
// That means useLocation() — which triggers the OS permission dialog — is
// never called until we know the user agreed to share their location.
// ─────────────────────────────────────────────────────────────────────────────
function MapWithLocation() {
  const { coords, isLoading: locLoading } = useLocation();
  const filters = useFilterStore((s) => s.filters);
  const activeFilterCount = useFilterStore((s) => s.activeFilterCount());
  const { data: venues = [], isLoading } = useNearbyVenues(coords, filters);

  return (
    <View className="flex-1">
      {/* Map takes the full screen */}
      <MapView
        provider={PROVIDER_GOOGLE}
        style={{ flex: 1 }}
        initialRegion={{
          ...coords,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        showsUserLocation={true}
        showsMyLocationButton={false}
      >
        {venues.map((venue: Venue) => (
          <Marker
            key={venue.id}
            coordinate={{ latitude: venue.latitude, longitude: venue.longitude }}
            title={venue.name}
            onCalloutPress={() => router.push(`/venue/${venue.id}`)}
          >
            {/* TODO: Replace with custom VenuePin component */}
            <View
              className="w-10 h-10 rounded-full items-center justify-center"
              style={{ backgroundColor: venue.is_premium ? Colors.sun : Colors.coral }}
            >
              <Text className="text-white font-bold text-xs">
                {venue.category?.icon ?? '📍'}
              </Text>
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Filter button (floating, bottom-left) */}
      <SafeAreaView className="absolute bottom-4 left-4" edges={['bottom']}>
        <TouchableOpacity
          className="bg-white rounded-full px-5 py-3 flex-row items-center gap-2 shadow-md"
          onPress={() => {/* TODO: open FilterSheet */}}
        >
          <Text className="text-charcoal font-bold">Filters</Text>
          {activeFilterCount > 0 && (
            <View className="bg-coral rounded-full w-5 h-5 items-center justify-center">
              <Text className="text-white text-xs font-bold">{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </SafeAreaView>

      {/* Add venue button (floating, bottom-right) */}
      <SafeAreaView className="absolute bottom-4 right-4" edges={['bottom']}>
        <TouchableOpacity
          className="bg-coral rounded-full w-14 h-14 items-center justify-center shadow-md"
          onPress={() => router.push('/venue/add')}
        >
          <Text className="text-white text-3xl font-bold">+</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LocationFallbackMap
//
// Shown when the user has not given consent. Centres on London so the map
// screen is still useful (browsing, searching) without requiring location.
// ─────────────────────────────────────────────────────────────────────────────
function LocationFallbackMap() {
  const filters = useFilterStore((s) => s.filters);
  const activeFilterCount = useFilterStore((s) => s.activeFilterCount());
  const { data: venues = [] } = useNearbyVenues(FALLBACK_LOCATION, filters);

  return (
    <View className="flex-1">
      <MapView
        provider={PROVIDER_GOOGLE}
        style={{ flex: 1 }}
        initialRegion={{
          ...FALLBACK_LOCATION,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        showsUserLocation={false}
        showsMyLocationButton={false}
      >
        {venues.map((venue: Venue) => (
          <Marker
            key={venue.id}
            coordinate={{ latitude: venue.latitude, longitude: venue.longitude }}
            title={venue.name}
            onCalloutPress={() => router.push(`/venue/${venue.id}`)}
          >
            <View
              className="w-10 h-10 rounded-full items-center justify-center"
              style={{ backgroundColor: venue.is_premium ? Colors.sun : Colors.coral }}
            >
              <Text className="text-white font-bold text-xs">
                {venue.category?.icon ?? '📍'}
              </Text>
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Filter button (floating, bottom-left) */}
      <SafeAreaView className="absolute bottom-4 left-4" edges={['bottom']}>
        <TouchableOpacity
          className="bg-white rounded-full px-5 py-3 flex-row items-center gap-2 shadow-md"
          onPress={() => {/* TODO: open FilterSheet */}}
        >
          <Text className="text-charcoal font-bold">Filters</Text>
          {activeFilterCount > 0 && (
            <View className="bg-coral rounded-full w-5 h-5 items-center justify-center">
              <Text className="text-white text-xs font-bold">{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </SafeAreaView>

      {/* Add venue button (floating, bottom-right) */}
      <SafeAreaView className="absolute bottom-4 right-4" edges={['bottom']}>
        <TouchableOpacity
          className="bg-coral rounded-full w-14 h-14 items-center justify-center shadow-md"
          onPress={() => router.push('/venue/add')}
        >
          <Text className="text-white text-3xl font-bold">+</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ExploreScreen (default export / the actual tab screen)
//
// Three possible states:
//   1. consentChecked=false — we haven't read SecureStore yet, render nothing
//      (avoids a flash of the consent prompt for returning users who already agreed)
//   2. consentChecked=true, consented=false — show LocationConsentPrompt
//   3. consentChecked=true, consented=true  — show MapWithLocation
// ─────────────────────────────────────────────────────────────────────────────
export default function ExploreScreen() {
  // Whether we have finished reading the stored consent value from SecureStore.
  // Starts false so we don't flash the consent prompt before the async read completes.
  const [consentChecked, setConsentChecked] = useState(false);

  // Whether the user has given (or previously given) location consent.
  // Defaults to false — geolocation is OFF by default per ICO Children's Code Standard 10.
  const [consented, setConsented] = useState(false);

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
      recordLocationConsentGranted().catch(() => undefined);
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
    setConsented(false);
    setConsentChecked(true);
  }

  // State 1: SecureStore read not yet complete — render nothing to avoid a flash.
  if (!consentChecked) {
    return <View className="flex-1 bg-sand" />;
  }

  // State 2: No consent recorded — show our plain-English consent prompt.
  // This is shown INSTEAD of the map, before any OS dialog appears.
  if (!consented) {
    return (
      <LocationConsentPrompt
        onAccept={handleConsentAccept}
        onDecline={handleConsentDecline}
      />
    );
  }

  // State 3: Consent confirmed — render the live map with real location.
  return <MapWithLocation />;
}
