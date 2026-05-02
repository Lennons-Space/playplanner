/**
 * Add Venue screen — lets any logged-in user submit a new venue.
 * All submissions go into moderation_status='pending' for admin review.
 *
 * Address flow:
 *   1. User enters postcode → validated via postcodes.io (free, no API key)
 *   2. lat/lng + city are populated automatically from the postcodes.io response
 *   3. User enters house/building number or name separately
 *
 * Raw coordinates are NEVER shown to the user and are not logged
 * (UK GDPR data minimisation).
 */
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';
import { Colors } from '@/constants/theme';
import type { Category } from '@/types';

const LIMITS = {
  name:        100,
  description: 1000,
  phone:       20,
  website:     300,
  houseNumber: 60,
};

function validateWebsiteUrl(value: string): string | null {
  if (!value) return null;
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

function validateAgeRange(minAge: string, maxAge: string): string | null {
  const min = parseInt(minAge, 10);
  const max = parseInt(maxAge, 10);
  if (isNaN(min) || isNaN(max)) return 'Please enter valid ages (numbers only)';
  if (min < 0 || max < 0)       return 'Ages cannot be negative';
  if (min > 18 || max > 18)     return 'Maximum age cannot exceed 18';
  if (min > max)                 return 'Minimum age cannot be greater than maximum age';
  return null;
}

interface PostcodeResult {
  latitude: number;
  longitude: number;
  city: string;
}

async function lookupPostcode(raw: string): Promise<PostcodeResult | null> {
  const postcode = raw.trim().toUpperCase().replace(/\s+/g, '');
  const res = await supabase.functions.invoke('geocode-postcode', {
    body: { postcode },
  });
  if (res.error || res.data?.error) {
    return null; // postcode not found or service unavailable
  }
  return {
    latitude:  res.data.latitude  as number,
    longitude: res.data.longitude as number,
    city:      res.data.city      as string,
  };
}

export default function AddVenueScreen() {
  const user = useUser();

  const [loading, setLoading]             = useState(false);
  const [name, setName]                   = useState('');
  const [description, setDesc]            = useState('');
  const [categoryId, setCategoryId]       = useState('');
  const [phone, setPhone]                 = useState('');
  const [website, setWebsite]             = useState('');
  const [minAge, setMinAge]               = useState('0');
  const [maxAge, setMaxAge]               = useState('12');

  const [postcodeInput, setPostcodeInput] = useState('');
  const [houseNumber, setHouseNumber]     = useState('');
  const [city, setCity]                   = useState('');
  const [postcode, setPostcode]           = useState('');
  const [latitude, setLatitude]           = useState<number | null>(null);
  const [longitude, setLongitude]         = useState<number | null>(null);

  const [postcodeLoading, setPostcodeLoading] = useState(false);
  const [postcodeError, setPostcodeError]     = useState('');
  const [postcodeConfirmed, setPostcodeConfirmed] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await supabase.from('categories').select('*').order('name');
      return (data ?? []) as Category[];
    },
  });

  async function handleLookupPostcode() {
    const raw = postcodeInput.trim();
    if (!raw) {
      setPostcodeError('Please enter a postcode');
      return;
    }
    setPostcodeLoading(true);
    setPostcodeError('');
    setPostcodeConfirmed(false);
    try {
      const result = await lookupPostcode(raw);
      if (!result) {
        setPostcodeError('Postcode not found. Please check and try again.');
        return;
      }
      setLatitude(result.latitude);
      setLongitude(result.longitude);
      setCity(result.city);
      // Use the normalised version of what the user entered as the stored postcode.
      setPostcode(raw.trim().toUpperCase());
      setPostcodeConfirmed(true);
    } catch {
      setPostcodeError('Postcode lookup failed. Please try again.');
    } finally {
      setPostcodeLoading(false);
    }
  }

  function handlePostcodeChange(val: string) {
    setPostcodeInput(val);
    if (postcodeConfirmed) {
      setPostcodeConfirmed(false);
      setLatitude(null);
      setLongitude(null);
      setCity('');
      setPostcode('');
    }
    setPostcodeError('');
  }

  async function handleSubmit() {
    // Guard: session may have expired while the user was filling in the form.
    // Using user!.id below would crash with TypeError if user is null.
    if (!user?.id) {
      Alert.alert('Session expired', 'Please sign in again to submit a venue.');
      return;
    }

    if (latitude === null || longitude === null) {
      setPostcodeError('Please look up your postcode first');
      return;
    }

    if (!name.trim()) {
      Alert.alert('Missing details', 'Please fill in the venue name.');
      return;
    }
    if (name.trim().length > LIMITS.name) {
      Alert.alert('Name too long', `Venue name must be ${LIMITS.name} characters or fewer.`);
      return;
    }
    if (description.trim().length > LIMITS.description) {
      Alert.alert('Description too long', `Description must be ${LIMITS.description} characters or fewer.`);
      return;
    }
    if (phone.trim().length > LIMITS.phone) {
      Alert.alert('Phone number too long', 'Please enter a valid phone number.');
      return;
    }

    const websiteError = validateWebsiteUrl(website.trim());
    if (websiteError) {
      Alert.alert('Invalid website', websiteError);
      return;
    }

    const ageError = validateAgeRange(minAge, maxAge);
    if (ageError) {
      Alert.alert('Invalid age range', ageError);
      return;
    }

    setLoading(true);

    const addressLine1 = houseNumber.trim()
      ? `${houseNumber.trim()}, ${postcode}`
      : postcode;

    const { error } = await supabase.from('venues').insert({
      name:              name.trim(),
      description:       description.trim() || null,
      category_id:       categoryId || null,
      address_line1:     addressLine1,
      city:              city.trim(),
      postcode:          postcode,
      latitude,
      longitude,
      phone:             phone.trim() || null,
      website:           website.trim() || null,
      min_age:           parseInt(minAge, 10),
      max_age:           parseInt(maxAge, 10),
      submitted_by:      user.id,
      moderation_status: 'pending',
      is_published:      false,
    });

    setLoading(false);

    if (error) {
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
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.sand }}>
      <ScrollView
        style={{ paddingHorizontal: 16 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16, paddingBottom: 8 }}>
          <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 22, color: Colors.charcoal }}>
            Add a venue
          </Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 15, color: Colors.grey }}>Cancel</Text>
          </TouchableOpacity>
        </View>
        <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 14, color: Colors.grey, marginBottom: 20 }}>
          Know a great family-friendly place? Add it here and help other parents discover it!
        </Text>

        <View style={{ gap: 16 }}>

          {/* Venue name */}
          <View>
            <Text style={label}>Venue name *</Text>
            <TextInput
              style={input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Sunshine Soft Play"
              placeholderTextColor={Colors.greyLight}
              maxLength={LIMITS.name}
            />
          </View>

          {/* Category chips */}
          <View>
            <Text style={label}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {categories.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  style={{
                    marginRight: 8,
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 999,
                    borderWidth: 2,
                    borderColor: categoryId === cat.id ? Colors.sky : Colors.greyLighter,
                    backgroundColor: categoryId === cat.id ? Colors.sky : '#fff',
                  }}
                  onPress={() => setCategoryId(cat.id)}
                >
                  <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 13, color: categoryId === cat.id ? '#fff' : Colors.charcoal }}>
                    {cat.icon} {cat.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Description */}
          <View>
            <Text style={label}>Description</Text>
            <TextInput
              style={[input, { height: 90, textAlignVertical: 'top', paddingTop: 12 }]}
              value={description}
              onChangeText={setDesc}
              placeholder="What makes this place great for families?"
              placeholderTextColor={Colors.greyLight}
              multiline
              maxLength={LIMITS.description}
            />
          </View>

          {/* ── Postcode lookup ───────────────────────────────────────────── */}
          <View>
            <Text style={label}>Postcode *</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                style={[input, { flex: 1 }]}
                value={postcodeInput}
                onChangeText={handlePostcodeChange}
                placeholder="e.g. M1 1AE"
                placeholderTextColor={Colors.greyLight}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={{
                  backgroundColor: Colors.sky,
                  borderRadius: 12,
                  paddingHorizontal: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 80,
                }}
                onPress={handleLookupPostcode}
                disabled={postcodeLoading}
              >
                {postcodeLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ fontFamily: 'Nunito-Bold', fontSize: 14, color: '#fff' }}>Look up</Text>
                }
              </TouchableOpacity>
            </View>

            {postcodeError !== '' && (
              <Text style={{ fontFamily: 'Nunito-Regular', fontSize: 13, color: Colors.error, marginTop: 4 }}>
                {postcodeError}
              </Text>
            )}

            {postcodeConfirmed && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <Ionicons name="checkmark-circle" size={16} color={Colors.mint} />
                <Text style={{ fontFamily: 'Nunito-Medium', fontSize: 13, color: Colors.mint }}>
                  {postcode} — {city}
                </Text>
              </View>
            )}
          </View>

          {/* House / building number — shown after postcode confirmed */}
          {postcodeConfirmed && (
            <View>
              <Text style={label}>House / building number or name</Text>
              <TextInput
                style={input}
                value={houseNumber}
                onChangeText={setHouseNumber}
                placeholder="e.g. 12 or Meadow House (optional)"
                placeholderTextColor={Colors.greyLight}
                maxLength={LIMITS.houseNumber}
              />
            </View>
          )}

          {/* Phone */}
          <View>
            <Text style={label}>Phone number</Text>
            <TextInput
              style={input}
              value={phone}
              onChangeText={setPhone}
              placeholder="e.g. 0161 123 4567"
              placeholderTextColor={Colors.greyLight}
              keyboardType="phone-pad"
              maxLength={LIMITS.phone}
            />
          </View>

          {/* Website */}
          <View>
            <Text style={label}>Website</Text>
            <TextInput
              style={input}
              value={website}
              onChangeText={setWebsite}
              placeholder="e.g. https://example.com"
              placeholderTextColor={Colors.greyLight}
              keyboardType="url"
              autoCapitalize="none"
              maxLength={LIMITS.website}
            />
          </View>

          {/* Age range */}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={label}>Min age</Text>
              <TextInput
                style={input}
                value={minAge}
                onChangeText={setMinAge}
                keyboardType="number-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={label}>Max age</Text>
              <TextInput
                style={input}
                value={maxAge}
                onChangeText={setMaxAge}
                keyboardType="number-pad"
              />
            </View>
          </View>

          <TouchableOpacity
            style={{
              backgroundColor: Colors.sky,
              borderRadius: 16,
              paddingVertical: 16,
              alignItems: 'center',
              marginTop: 8,
              marginBottom: 40,
              opacity: loading ? 0.7 : 1,
            }}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ fontFamily: 'Nunito-ExtraBold', fontSize: 16, color: '#fff' }}>Submit venue</Text>
            }
          </TouchableOpacity>

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const label: object = {
  fontFamily: 'Nunito-Bold',
  fontSize: 14,
  color: Colors.charcoal,
  marginBottom: 4,
};

const input: object = {
  backgroundColor: '#fff',
  borderWidth: 1,
  borderColor: Colors.greyLighter,
  borderRadius: 12,
  paddingHorizontal: 16,
  paddingVertical: 12,
  fontFamily: 'Nunito-Regular',
  fontSize: 15,
  color: Colors.charcoal,
};
