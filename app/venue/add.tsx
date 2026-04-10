/**
 * Add Venue screen — lets any logged-in user submit a new venue.
 * All submissions go into moderation_status='pending' for admin review.
 */
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';
import type { Category } from '@/types';

export default function AddVenueScreen() {
  const user = useUser();
  const [loading, setLoading]     = useState(false);
  const [name, setName]           = useState('');
  const [description, setDesc]    = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [city, setCity]           = useState('');
  const [postcode, setPostcode]   = useState('');
  const [address, setAddress]     = useState('');
  const [phone, setPhone]         = useState('');
  const [website, setWebsite]     = useState('');
  const [minAge, setMinAge]       = useState('0');
  const [maxAge, setMaxAge]       = useState('12');

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await supabase.from('categories').select('*').order('name');
      return (data ?? []) as Category[];
    },
  });

  async function handleSubmit() {
    if (!name || !city || !postcode) {
      Alert.alert('Please fill in the venue name, city and postcode.');
      return;
    }

    setLoading(true);

    // TODO: Use Google Geocoding API to convert address → lat/lng
    // For now we use placeholder coordinates — replace with real geocoding
    const latitude  = 51.5074;
    const longitude = -0.1278;

    const { error } = await supabase.from('venues').insert({
      name:             name.trim(),
      description:      description.trim() || null,
      category_id:      categoryId || null,
      address_line1:    address.trim() || null,
      city:             city.trim(),
      postcode:         postcode.trim().toUpperCase(),
      latitude,
      longitude,
      phone:            phone.trim() || null,
      website:          website.trim() || null,
      min_age:          parseInt(minAge, 10),
      max_age:          parseInt(maxAge, 10),
      submitted_by:     user!.id,
      moderation_status: 'pending',   // goes to admin review first
      is_published:     false,
    });

    setLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert(
        'Venue submitted!',
        'Thanks! Our team will review and approve your submission within 24–48 hours.',
        [{ text: 'Great!', onPress: () => router.back() }]
      );
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-sand">
      <ScrollView className="px-4" keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View className="flex-row items-center justify-between pt-4 pb-2">
          <Text className="text-2xl font-extrabold text-charcoal">Add a venue</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text className="text-grey text-base">Cancel</Text>
          </TouchableOpacity>
        </View>
        <Text className="text-grey mb-6">Know a great family-friendly place? Add it here and help other parents discover it!</Text>

        {/* Form */}
        <View className="gap-4">
          <View>
            <Text className="text-charcoal font-bold mb-1">Venue name *</Text>
            <TextInput className="bg-white border border-greyLighter rounded-xl px-4 py-3 text-charcoal" value={name} onChangeText={setName} placeholder="e.g. Sunshine Soft Play" />
          </View>

          <View>
            <Text className="text-charcoal font-bold mb-1">Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="gap-2">
              {categories.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  className={`mr-2 px-4 py-2 rounded-full border-2 ${categoryId === cat.id ? 'border-coral bg-coral' : 'border-greyLighter bg-white'}`}
                  onPress={() => setCategoryId(cat.id)}
                >
                  <Text className={categoryId === cat.id ? 'text-white font-bold' : 'text-charcoal'}>
                    {cat.icon} {cat.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View>
            <Text className="text-charcoal font-bold mb-1">Description</Text>
            <TextInput className="bg-white border border-greyLighter rounded-xl px-4 py-3 text-charcoal" value={description} onChangeText={setDesc} placeholder="What makes this place great for families?" multiline numberOfLines={3} />
          </View>

          <View>
            <Text className="text-charcoal font-bold mb-1">Street address</Text>
            <TextInput className="bg-white border border-greyLighter rounded-xl px-4 py-3 text-charcoal" value={address} onChangeText={setAddress} placeholder="e.g. 12 High Street" />
          </View>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Text className="text-charcoal font-bold mb-1">City *</Text>
              <TextInput className="bg-white border border-greyLighter rounded-xl px-4 py-3 text-charcoal" value={city} onChangeText={setCity} placeholder="e.g. Manchester" />
            </View>
            <View className="flex-1">
              <Text className="text-charcoal font-bold mb-1">Postcode *</Text>
              <TextInput className="bg-white border border-greyLighter rounded-xl px-4 py-3 text-charcoal" value={postcode} onChangeText={setPostcode} placeholder="e.g. M1 1AA" autoCapitalize="characters" />
            </View>
          </View>

          <View>
            <Text className="text-charcoal font-bold mb-1">Phone number</Text>
            <TextInput className="bg-white border border-greyLighter rounded-xl px-4 py-3 text-charcoal" value={phone} onChangeText={setPhone} placeholder="e.g. 0161 123 4567" keyboardType="phone-pad" />
          </View>

          <View>
            <Text className="text-charcoal font-bold mb-1">Website</Text>
            <TextInput className="bg-white border border-greyLighter rounded-xl px-4 py-3 text-charcoal" value={website} onChangeText={setWebsite} placeholder="e.g. https://example.com" keyboardType="url" autoCapitalize="none" />
          </View>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Text className="text-charcoal font-bold mb-1">Min age</Text>
              <TextInput className="bg-white border border-greyLighter rounded-xl px-4 py-3 text-charcoal" value={minAge} onChangeText={setMinAge} keyboardType="number-pad" />
            </View>
            <View className="flex-1">
              <Text className="text-charcoal font-bold mb-1">Max age</Text>
              <TextInput className="bg-white border border-greyLighter rounded-xl px-4 py-3 text-charcoal" value={maxAge} onChangeText={setMaxAge} keyboardType="number-pad" />
            </View>
          </View>

          <TouchableOpacity
            className="bg-coral rounded-2xl py-4 items-center mt-2 mb-10"
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
