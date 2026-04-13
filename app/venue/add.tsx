/**
 * Add Venue screen — lets any logged-in user submit a new venue.
 * All submissions go into moderation_status='pending' for admin review.
 *
 * Address flow: GooglePlacesAutocomplete → extracts lat/lng + city + postcode
 * from the Google Places Details response. Raw coordinates are NEVER shown
 * to the user and are not logged (UK GDPR data minimisation).
 *
 * UK GDPR Art.13 transparency: a disclosure note is shown beneath the search
 * field explaining that the search query is sent to Google Maps.
 */
import { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import {
  GooglePlacesAutocomplete,
  GooglePlacesAutocompleteRef,
} from 'react-native-google-places-autocomplete';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';
import type { Category } from '@/types';

// UK bounding box — used to reject coordinates that fall outside Great Britain.
// lat: 49.9 (south tip) – 60.9 (north tip of mainland Scotland)
// lng: -8.2 (west Ireland coast) – 1.8 (east coast of England)
const UK_BOUNDS = { minLat: 49.9, maxLat: 60.9, minLng: -8.2, maxLng: 1.8 };

// Input length limits — prevents oversized payloads reaching the database.
// These match the varchar() constraints in the DB schema (or sensible defaults
// where the column is text-unbounded, to limit UI abuse).
const LIMITS = {
  name:        100,
  description: 1000,
  phone:       20,
  website:     300,
};

// Validates a URL is well-formed and uses http:// or https://.
// Returns null if valid, or an error string to show the user.
function validateWebsiteUrl(value: string): string | null {
  if (!value) return null; // empty is fine — website is optional
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'Website must start with http:// or https://';
    }
    return null;
  } catch {
    return 'Please enter a valid website URL (e.g. https://example.com)';
  }
}

// Validates the age range fields.
// Returns null if valid, or an error string to show the user.
function validateAgeRange(minAge: string, maxAge: string): string | null {
  const min = parseInt(minAge, 10);
  const max = parseInt(maxAge, 10);
  if (isNaN(min) || isNaN(max)) return 'Please enter valid ages (numbers only)';
  if (min < 0 || max < 0)       return 'Ages cannot be negative';
  if (min > 18 || max > 18)     return 'Maximum age cannot exceed 18';
  if (min > max)                 return 'Minimum age cannot be greater than maximum age';
  return null;
}

function isInsideUK(lat: number, lng: number): boolean {
  return (
    lat >= UK_BOUNDS.minLat &&
    lat <= UK_BOUNDS.maxLat &&
    lng >= UK_BOUNDS.minLng &&
    lng <= UK_BOUNDS.maxLng
  );
}

export default function AddVenueScreen() {
  const user = useUser();

  // Ref lets us programmatically clear the autocomplete input if needed
  const placesRef = useRef<GooglePlacesAutocompleteRef>(null);

  const [loading, setLoading]       = useState(false);
  const [name, setName]             = useState('');
  const [description, setDesc]      = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [phone, setPhone]           = useState('');
  const [website, setWebsite]       = useState('');
  const [minAge, setMinAge]         = useState('0');
  const [maxAge, setMaxAge]         = useState('12');

  // Address fields — populated automatically when user picks a Places result
  const [address, setAddress]       = useState('');   // full address string
  const [city, setCity]             = useState('');   // auto-filled, read-only
  const [postcode, setPostcode]     = useState('');   // auto-filled, read-only

  // Coordinates — null until a valid Places result is selected.
  // We store them in state but NEVER display them to the user.
  const [latitude, setLatitude]     = useState<number | null>(null);
  const [longitude, setLongitude]   = useState<number | null>(null);

  // Inline error shown if user tries to submit without selecting an address
  const [addressError, setAddressError] = useState('');

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await supabase.from('categories').select('*').order('name');
      return (data ?? []) as Category[];
    },
  });

  // Called when the user taps a result in the Places dropdown.
  // 'details' contains the full place data including geometry + address_components.
  function handlePlaceSelected(
    data: { description: string },
    details: {
      geometry: { location: { lat: number; lng: number } };
      address_components: { long_name: string; types: string[] }[];
    } | null
  ) {
    if (!details) return;

    const lat = details.geometry.location.lat;
    const lng = details.geometry.location.lng;

    // Validate the coordinate falls within the UK before accepting it
    if (!isInsideUK(lat, lng)) {
      setAddressError('Please enter a UK address');
      return;
    }

    // Extract city: Google uses 'postal_town' for UK towns/cities, falling back to 'locality'
    const cityComponent = details.address_components.find((c) =>
      c.types.includes('postal_town') || c.types.includes('locality')
    );

    // Extract postcode
    const postcodeComponent = details.address_components.find((c) =>
      c.types.includes('postal_code')
    );

    setLatitude(lat);
    setLongitude(lng);
    setAddress(data.description);
    setCity(cityComponent?.long_name ?? '');
    setPostcode(postcodeComponent?.long_name ?? '');
    setAddressError(''); // clear any previous error
  }

  async function handleSubmit() {
    // Validate: address must have been selected from the dropdown
    if (latitude === null || longitude === null) {
      setAddressError('Please search for and select an address');
      return;
    }

    // Double-check UK bounds (guards against state manipulation)
    if (!isInsideUK(latitude, longitude)) {
      setAddressError('Please enter a UK address');
      return;
    }

    // Venue name is required
    if (!name.trim()) {
      // Two-argument form: Alert.alert(title, message) — single-arg form silently
      // fails on Android in some Expo versions.
      Alert.alert('Missing details', 'Please fill in the venue name.');
      return;
    }

    // Length limit checks — prevents oversized strings reaching the database.
    if (name.trim().length > LIMITS.name) {
      Alert.alert('Name too long', `Venue name must be ${LIMITS.name} characters or fewer.`);
      return;
    }
    if (description.trim().length > LIMITS.description) {
      Alert.alert('Description too long', `Description must be ${LIMITS.description} characters or fewer.`);
      return;
    }
    if (phone.trim().length > LIMITS.phone) {
      Alert.alert('Phone number too long', `Please enter a valid phone number.`);
      return;
    }

    // URL validation — must be http(s) if provided
    const websiteError = validateWebsiteUrl(website.trim());
    if (websiteError) {
      Alert.alert('Invalid website', websiteError);
      return;
    }

    // Age range validation
    const ageError = validateAgeRange(minAge, maxAge);
    if (ageError) {
      Alert.alert('Invalid age range', ageError);
      return;
    }

    setLoading(true);

    const { error } = await supabase.from('venues').insert({
      name:              name.trim(),
      description:       description.trim() || null,
      category_id:       categoryId || null,
      address_line1:     address.trim() || null,
      city:              city.trim(),
      postcode:          postcode.trim().toUpperCase(),
      latitude,           // real coordinates from Places API (never hardcoded)
      longitude,
      phone:             phone.trim() || null,
      // website.trim() has already been validated above — safe to insert
      website:           website.trim() || null,
      min_age:           parseInt(minAge, 10),
      max_age:           parseInt(maxAge, 10),
      submitted_by:      user!.id,
      moderation_status: 'pending',   // goes to admin review first
      is_published:      false,
    });

    setLoading(false);

    if (error) {
      // Do NOT expose the raw Supabase error message to the user — it may contain
      // internal schema details (table names, column names, constraint names).
      // Log it for debugging and show a generic user-facing message instead.
      console.error('Venue insert error:', error.code, error.hint);
      Alert.alert('Submission failed', 'Something went wrong. Please check your details and try again.');
    } else {
      Alert.alert(
        'Venue submitted!',
        'Thanks! Our team will review and approve your submission within 24–48 hours.',
        [{ text: 'Great!', onPress: () => router.back() }]
      );
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-slate">
      {/*
        keyboardShouldPersistTaps="handled" is important here — without it,
        tapping a Places dropdown result on iOS dismisses the keyboard
        before the tap is registered, so the selection never fires.
      */}
      <ScrollView className="px-4" keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View className="flex-row items-center justify-between pt-4 pb-2">
          <Text className="text-2xl font-extrabold text-charcoal">Add a venue</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text className="text-grey text-base">Cancel</Text>
          </TouchableOpacity>
        </View>
        <Text className="text-grey mb-6">
          Know a great family-friendly place? Add it here and help other parents discover it!
        </Text>

        {/* Form */}
        <View className="gap-4">

          {/* Venue name */}
          <View>
            <Text className="text-charcoal font-bold mb-1">Venue name *</Text>
            <TextInput
              className="bg-white border border-greyLighter rounded-xl px-4 py-3 text-charcoal"
              value={name}
              onChangeText={setName}
              placeholder="e.g. Sunshine Soft Play"
              maxLength={LIMITS.name}
            />
          </View>

          {/* Category chips */}
          <View>
            <Text className="text-charcoal font-bold mb-1">Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="gap-2">
              {categories.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  className={`mr-2 px-4 py-2 rounded-full border-2 ${
                    categoryId === cat.id
                      ? 'border-sky bg-sky'
                      : 'border-greyLighter bg-white'
                  }`}
                  onPress={() => setCategoryId(cat.id)}
                >
                  <Text className={categoryId === cat.id ? 'text-white font-bold' : 'text-charcoal'}>
                    {cat.icon} {cat.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Description */}
          <View>
            <Text className="text-charcoal font-bold mb-1">Description</Text>
            <TextInput
              className="bg-white border border-greyLighter rounded-xl px-4 py-3 text-charcoal"
              value={description}
              onChangeText={setDesc}
              placeholder="What makes this place great for families?"
              multiline
              numberOfLines={3}
              maxLength={LIMITS.description}
            />
          </View>

          {/* ------------------------------------------------------------------ */}
          {/* Address search — replaces the old plain TextInput                  */}
          {/* GooglePlacesAutocomplete sends the user's typed query to Google     */}
          {/* Maps and returns a list of matching UK addresses to choose from.    */}
          {/* fetchDetails={true} tells it to also fetch lat/lng for the result.  */}
          {/* ------------------------------------------------------------------ */}
          <View>
            <Text className="text-charcoal font-bold mb-1">Street address *</Text>

            {/*
              We wrap the autocomplete in a View with a fixed zIndex so the
              dropdown appears on top of the form fields below it.
              Without this, the dropdown can appear behind other elements.
            */}
            <View style={styles.autocompleteContainer}>
              <GooglePlacesAutocomplete
                ref={placesRef}
                placeholder="Start typing an address…"
                fetchDetails={true}   // required — gives us lat/lng in the callback
                onPress={handlePlaceSelected}
                query={{
                  key: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
                  language: 'en',
                  components: 'country:gb',   // restrict results to the UK
                }}
                styles={{
                  textInputContainer: styles.placesInputContainer,
                  textInput:          styles.placesTextInput,
                  listView:           styles.placesListView,
                  row:                styles.placesRow,
                  description:        styles.placesDescription,
                }}
                enablePoweredByContainer={false}  // hides the "Powered by Google" logo
                debounce={300}   // wait 300 ms after the user stops typing before searching
                minLength={3}    // don't search until at least 3 characters are typed
              />
            </View>

            {/* UK GDPR Art.13 transparency disclosure — required because we send
                user input to a third-party service (Google Maps). */}
            <Text style={styles.privacyNote}>
              Address search is powered by Google Maps. Your search is sent to Google to find results.
            </Text>

            {/* Inline validation error — shown if user submits without selecting */}
            {addressError !== '' && (
              <Text className="text-red-500 text-sm mt-1">{addressError}</Text>
            )}
          </View>

          {/* City & Postcode — read-only, auto-filled from the Places selection */}
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Text className="text-charcoal font-bold mb-1">City</Text>
              {/*
                editable={false} makes this read-only so the user can see the
                auto-filled value but cannot accidentally change it.
                The slightly darker background (sandDark) signals it's not editable.
              */}
              <TextInput
                style={styles.readOnlyInput}
                value={city}
                editable={false}
                placeholder="Auto-filled"
                placeholderTextColor="#B2BEC3"
              />
            </View>
            <View className="flex-1">
              <Text className="text-charcoal font-bold mb-1">Postcode</Text>
              <TextInput
                style={styles.readOnlyInput}
                value={postcode}
                editable={false}
                placeholder="Auto-filled"
                placeholderTextColor="#B2BEC3"
              />
            </View>
          </View>

          {/* Phone */}
          <View>
            <Text className="text-charcoal font-bold mb-1">Phone number</Text>
            <TextInput
              className="bg-white border border-greyLighter rounded-xl px-4 py-3 text-charcoal"
              value={phone}
              onChangeText={setPhone}
              placeholder="e.g. 0161 123 4567"
              keyboardType="phone-pad"
            />
          </View>

          {/* Website */}
          <View>
            <Text className="text-charcoal font-bold mb-1">Website</Text>
            <TextInput
              className="bg-white border border-greyLighter rounded-xl px-4 py-3 text-charcoal"
              value={website}
              onChangeText={setWebsite}
              placeholder="e.g. https://example.com"
              keyboardType="url"
              autoCapitalize="none"
              maxLength={LIMITS.website}
            />
          </View>

          {/* Age range */}
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Text className="text-charcoal font-bold mb-1">Min age</Text>
              <TextInput
                className="bg-white border border-greyLighter rounded-xl px-4 py-3 text-charcoal"
                value={minAge}
                onChangeText={setMinAge}
                keyboardType="number-pad"
              />
            </View>
            <View className="flex-1">
              <Text className="text-charcoal font-bold mb-1">Max age</Text>
              <TextInput
                className="bg-white border border-greyLighter rounded-xl px-4 py-3 text-charcoal"
                value={maxAge}
                onChangeText={setMaxAge}
                keyboardType="number-pad"
              />
            </View>
          </View>

          <TouchableOpacity
            className="bg-sky rounded-2xl py-4 items-center mt-2 mb-10"
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text className="text-white font-bold text-lg">Submit venue</Text>}
          </TouchableOpacity>

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// StyleSheet for parts that need precise pixel values or cannot use NativeWind classes
// (GooglePlacesAutocomplete has its own 'styles' prop that expects RN style objects)
const styles = StyleSheet.create({
  // Outer wrapper — zIndex ensures the dropdown floats above fields below it
  autocompleteContainer: {
    zIndex: 10,
    // The autocomplete listView is absolutely positioned by the library.
    // We need overflow visible so it isn't clipped.
    overflow: 'visible',
  },
  placesInputContainer: {
    borderWidth: 1,
    borderColor: '#DFE6E9',   // greyLighter
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 0,
  },
  placesTextInput: {
    color: '#2D3436',          // charcoal
    fontSize: 15,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 0,
    height: 48,
  },
  placesListView: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DFE6E9',
    marginTop: 4,
    // Enough shadow to show above other elements
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  placesRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  placesDescription: {
    color: '#2D3436',   // charcoal
    fontSize: 14,
  },
  // UK GDPR Art.13 disclosure — small, unobtrusive grey note
  privacyNote: {
    color: '#636E72',   // grey
    fontSize: 11,
    marginTop: 6,
    lineHeight: 15,
  },
  // Read-only display fields for auto-filled city and postcode
  readOnlyInput: {
    backgroundColor: '#F5EDE0',  // sandDark — signals non-editable
    borderWidth: 1,
    borderColor: '#DFE6E9',      // greyLighter
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#2D3436',            // charcoal
    fontSize: 15,
  },
});
