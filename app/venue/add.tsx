/**
 * Add Venue screen — lets any logged-in user submit a new venue.
 * All submissions go into moderation_status='pending' for admin review.
 *
 * v2 dark restyle (Step 5, feat/exact-v2-design): VISUAL LAYER ONLY. The
 * postcode lookup, validation functions (validateWebsiteUrl/validateAgeRange),
 * the supabase.from('venues').insert(...) mutation shape and every field it
 * writes are byte-identical to the pre-restyle version. This screen is
 * presented as a modal by the root Stack (`app/_layout.tsx`,
 * `options={{ presentation: 'modal' }}`) with `headerShown: false` already
 * set globally, so its own "Add a venue" + Cancel row (unchanged structure,
 * just restyled) remains the only header — no duplicate-header bug here.
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
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';
import { Icon } from '@/components/ui/Icon';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { V2Background } from '@/components/ui/V2Background';
import { Themes, FontFamily, ocean } from '@/constants/theme';
import type { Category } from '@/types';

const T = Themes.dark;
const ACCENT = ocean;

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
  const insets = useSafeAreaInsets();

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
    <View style={styles.root}>
      <V2Background />
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top']}>

        {/* Header — "Cancel" text action, not a back chevron: this is a modal
            presentation (root Stack: presentation:'modal'), matching the
            existing behaviour exactly, only restyled dark. */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Add a venue</Text>
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Cancel adding a venue"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={{ paddingBottom: 120 + insets.bottom, gap: 18 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.intro}>
              Know a great family-friendly place? Add it here and help other parents discover it!
            </Text>

            {/* Split into three separate cards (was one monolithic formCard
                spanning almost the whole scroll height) with gaps between —
                a single edge-to-edge card at the default 0.82 tint smothered
                the shared animated background atmosphere across nearly
                the entire viewport. Each card also uses a lighter 0.55 tint,
                matching the value already used for full-bleed surfaces
                elsewhere (see Venue Detail's sheet / SmartFeaturedCard). No
                field, handler or validation logic below has changed — only
                which GlassSurface each block sits inside. */}

            {/* Card 1: what it is */}
            <GlassSurface style={styles.formCard} tintColor="rgba(14,14,20,0.55)">

              {/* Venue name */}
              <View style={styles.field}>
                <Text style={styles.label}>Venue name *</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Sunshine Soft Play"
                  placeholderTextColor={T.label4}
                  maxLength={LIMITS.name}
                />
              </View>

              {/* Category chips */}
              <View style={styles.field}>
                <Text style={styles.label}>Category</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {categories.map((cat) => {
                    const active = categoryId === cat.id;
                    const catColor = cat.color || ACCENT.accent;
                    return (
                      <TouchableOpacity
                        key={cat.id}
                        style={[
                          styles.categoryChip,
                          active
                            ? { backgroundColor: catColor, borderColor: catColor }
                            : styles.categoryChipInactive,
                        ]}
                        onPress={() => setCategoryId(cat.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Category: ${cat.name}`}
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                          {cat.icon} {cat.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Description */}
              <View style={styles.field}>
                <Text style={styles.label}>Description</Text>
                <TextInput
                  style={[styles.input, styles.multilineInput]}
                  value={description}
                  onChangeText={setDesc}
                  placeholder="What makes this place great for families?"
                  placeholderTextColor={T.label4}
                  multiline
                  maxLength={LIMITS.description}
                />
              </View>

            </GlassSurface>

            {/* Card 2: where it is */}
            <GlassSurface style={styles.formCard} tintColor="rgba(14,14,20,0.55)">

              {/* ── Postcode lookup ───────────────────────────────────────────── */}
              <View style={styles.field}>
                <Text style={styles.label}>Postcode *</Text>
                <View style={styles.postcodeRow}>
                  <TextInput
                    style={[styles.input, styles.flex]}
                    value={postcodeInput}
                    onChangeText={handlePostcodeChange}
                    placeholder="e.g. M1 1AE"
                    placeholderTextColor={T.label4}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    style={styles.lookupBtn}
                    onPress={handleLookupPostcode}
                    disabled={postcodeLoading}
                    accessibilityRole="button"
                    accessibilityLabel="Look up postcode"
                  >
                    {postcodeLoading
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={styles.lookupBtnText}>Look up</Text>
                    }
                  </TouchableOpacity>
                </View>

                {postcodeError !== '' && (
                  <Text style={styles.errorText}>{postcodeError}</Text>
                )}

                {postcodeConfirmed && (
                  <View style={styles.confirmedRow}>
                    <Icon name="check" size={16} color="#6EE7B7" />
                    <Text style={styles.confirmedText}>
                      {postcode} — {city}
                    </Text>
                  </View>
                )}
              </View>

              {/* House / building number — shown after postcode confirmed */}
              {postcodeConfirmed && (
                <View style={styles.field}>
                  <Text style={styles.label}>House / building number or name</Text>
                  <TextInput
                    style={styles.input}
                    value={houseNumber}
                    onChangeText={setHouseNumber}
                    placeholder="e.g. 12 or Meadow House (optional)"
                    placeholderTextColor={T.label4}
                    maxLength={LIMITS.houseNumber}
                  />
                </View>
              )}

            </GlassSurface>

            {/* Card 3: contact + suitability */}
            <GlassSurface style={styles.formCard} tintColor="rgba(14,14,20,0.55)">

              {/* Phone */}
              <View style={styles.field}>
                <Text style={styles.label}>Phone number</Text>
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="e.g. 0161 123 4567"
                  placeholderTextColor={T.label4}
                  keyboardType="phone-pad"
                  maxLength={LIMITS.phone}
                />
              </View>

              {/* Website */}
              <View style={styles.field}>
                <Text style={styles.label}>Website</Text>
                <TextInput
                  style={styles.input}
                  value={website}
                  onChangeText={setWebsite}
                  placeholder="e.g. https://example.com"
                  placeholderTextColor={T.label4}
                  keyboardType="url"
                  autoCapitalize="none"
                  maxLength={LIMITS.website}
                />
              </View>

              {/* Age range */}
              <View style={styles.ageRow}>
                <View style={styles.ageField}>
                  <Text style={styles.label}>Min age</Text>
                  <TextInput
                    style={styles.input}
                    value={minAge}
                    onChangeText={setMinAge}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={styles.ageField}>
                  <Text style={styles.label}>Max age</Text>
                  <TextInput
                    style={styles.input}
                    value={maxAge}
                    onChangeText={setMaxAge}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

            </GlassSurface>

          </ScrollView>

          {/* Submit — sticky, safe-area aware above Android nav */}
          <GlassSurface
            style={[styles.stickyBar, { paddingBottom: insets.bottom + 14 }]}
            tintColor="rgba(12,12,17,0.92)"
          >
            <TouchableOpacity
              style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Submit venue"
              accessibilityState={{ disabled: loading, busy: loading }}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.submitBtnText}>Submit venue</Text>
              }
            </TouchableOpacity>
          </GlassSurface>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  safe: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },
  scroll: { flex: 1, paddingHorizontal: 20 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    fontFamily: FontFamily.display,
    fontSize: 20,
    color: T.label,
    letterSpacing: -0.4,
  },
  cancelText: {
    fontFamily: FontFamily.body,
    fontSize: 15,
    color: T.label3,
  },

  intro: {
    fontFamily: FontFamily.body,
    fontSize: 14,
    color: T.label3,
    // Spacing to the first card now comes from the ScrollView's
    // contentContainerStyle gap (18), not a local margin, so it stays
    // consistent with the gap between the three form cards below.
    lineHeight: 20,
  },

  formCard: {
    borderRadius: 20,
    padding: 16,
    gap: 16,
  },
  field: { gap: 6 },
  label: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13,
    color: T.label2,
  },
  input: {
    backgroundColor: T.bg,
    borderWidth: 1,
    borderColor: T.separator,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: FontFamily.body,
    fontSize: 15,
    color: T.label,
  },
  multilineInput: {
    height: 90,
    textAlignVertical: 'top',
    paddingTop: 12,
  },

  categoryChip: {
    marginRight: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  categoryChipInactive: {
    backgroundColor: T.surface,
    borderColor: T.separator,
  },
  categoryChipText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13,
    color: T.label,
  },
  categoryChipTextActive: {
    color: '#FFFFFF',
  },

  postcodeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  lookupBtn: {
    backgroundColor: ACCENT.accent,
    borderRadius: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  lookupBtnText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 14,
    color: '#FFFFFF',
  },
  errorText: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    color: '#FF8A80',
    marginTop: 4,
  },
  confirmedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  confirmedText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13,
    color: '#6EE7B7',
  },

  ageRow: {
    flexDirection: 'row',
    gap: 12,
  },
  ageField: {
    flex: 1,
    gap: 6,
  },

  // Sticky submit bar
  stickyBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  submitBtn: {
    height: 54,
    borderRadius: 16,
    backgroundColor: ACCENT.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.7,
  },
  submitBtnText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 16,
    color: '#FFFFFF',
  },
});
