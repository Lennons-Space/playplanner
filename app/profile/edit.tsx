/**
 * Edit Profile screen — app/profile/edit.tsx
 *
 * Lets the user update their visible identity (name, username, bio) and
 * private family details (children's age ranges, postcode).
 *
 * GDPR Art.5(1)(c) — data minimisation:
 *   Children's ages are stored as broad ranges only (e.g. '2-4').
 *   Exact dates of birth are never collected.
 *   Postcode is optional and used only to personalise nearby venue suggestions.
 *
 * ICO Children's Code Standard 4 (transparency):
 *   The "Only you can see this" label appears directly beside sensitive fields
 *   so users understand what is private before they save.
 *
 * No email or password fields here — those are auth flows handled separately.
 */
import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Image,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfile, useUser } from '@/hooks/useAuth';
import { useUpdateProfile, useUploadAvatar } from '@/hooks/useProfile';

const MAX_BIO_LENGTH = 300;

export default function EditProfileScreen() {
  const user           = useUser();
  const profile        = useProfile();
  const { mutateAsync, isPending }           = useUpdateProfile();
  const { mutateAsync: uploadAvatar, isPending: isUploading } = useUploadAvatar();

  // Auth guard — redirect unauthenticated users to the login screen.
  // useEffect avoids calling router.replace during render (React rule).
  useEffect(() => {
    if (user === null) {
      router.replace('/(auth)/login');
    }
  }, [user]);

  // Local form state — pre-filled from the stored profile.
  // Changes are held locally until the user presses Save.
  const [fullName,    setFullName]    = useState(profile?.full_name    ?? '');
  const [username,    setUsername]    = useState(profile?.username     ?? '');
  const [bio,         setBio]         = useState(profile?.bio          ?? '');
  const [postcode,    setPostcode]    = useState(profile?.postcode     ?? '');

  async function handleChangePhoto() {
    try {
      await uploadAvatar(profile?.avatar_url ?? null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('permission')) {
        Alert.alert(
          'Permission needed',
          'To change your photo, allow PlayPlanner to access your photo library in Settings.',
        );
      } else {
        Alert.alert('Upload failed', 'Something went wrong uploading your photo. Please try again.');
      }
    }
  }

  async function handleSave() {
    if (!fullName.trim()) {
      Alert.alert('Name required', 'Please enter your name.');
      return;
    }

    try {
      await mutateAsync({
        full_name: fullName.trim(),
        username:  username.trim() || null,
        bio:       bio.trim()      || null,
        postcode:  postcode.trim() || null,
      });
      router.back();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      // Show a friendly error, not a raw DB message.
      if (message.includes('username')) {
        Alert.alert('Username taken', 'That username is already in use. Please try another.');
      } else {
        Alert.alert('Could not save', 'Something went wrong. Please try again.');
      }
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Stack.Screen options={{ title: 'Edit Profile' }} />
      <SafeAreaView className="flex-1 bg-slate" edges={['bottom']}>
        <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>

          {/* Avatar */}
          <View className="items-center pt-6 pb-4">
            <TouchableOpacity
              onPress={handleChangePhoto}
              disabled={isUploading}
              accessibilityRole="button"
              accessibilityLabel="Change profile photo"
              accessibilityHint="Opens your photo library so you can choose a new profile picture"
            >
              {profile?.avatar_url ? (
                <Image
                  source={{ uri: profile.avatar_url }}
                  className="w-20 h-20 rounded-full bg-greyLighter"
                  accessibilityLabel="Your profile photo"
                />
              ) : (
                <View className="w-20 h-20 rounded-full bg-greyLighter items-center justify-center">
                  <Text className="text-4xl">👤</Text>
                </View>
              )}

              {/* Upload spinner overlaid on the avatar while uploading */}
              {isUploading && (
                <View
                  className="absolute inset-0 w-20 h-20 rounded-full bg-black/40 items-center justify-center"
                  accessibilityLabel="Uploading photo"
                >
                  <ActivityIndicator color="white" />
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleChangePhoto}
              disabled={isUploading}
              accessibilityRole="button"
              accessibilityLabel="Change profile photo"
            >
              <Text
                className="text-sky text-sm mt-2"
                style={{ fontFamily: 'Nunito-Medium' }}
              >
                {isUploading ? 'Uploading…' : 'Change photo'}
              </Text>
            </TouchableOpacity>
          </View>

          <View className="px-4 gap-4">

            {/* Full name */}
            <View>
              <Text
                className="text-charcoal text-sm mb-1"
                style={{ fontFamily: 'Nunito-Medium' }}
              >
                Full name
              </Text>
              <TextInput
                className="bg-white rounded-xl px-4 py-3 text-charcoal text-base border border-greyLighter"
                style={{ fontFamily: 'Nunito-Regular' }}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Your name"
                placeholderTextColor="#B0B0B0"
                accessibilityLabel="Full name"
                returnKeyType="next"
                autoCorrect={false}
              />
            </View>

            {/* Username */}
            <View>
              <Text
                className="text-charcoal text-sm mb-1"
                style={{ fontFamily: 'Nunito-Medium' }}
              >
                Username
              </Text>
              <View className="flex-row items-center bg-white rounded-xl px-4 py-3 border border-greyLighter">
                <Text
                  className="text-grey text-base"
                  style={{ fontFamily: 'Nunito-Regular' }}
                >
                  @
                </Text>
                <TextInput
                  className="flex-1 text-charcoal text-base ml-0.5"
                  style={{ fontFamily: 'Nunito-Regular' }}
                  value={username}
                  onChangeText={(t) => setUsername(t.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="your_username"
                  placeholderTextColor="#B0B0B0"
                  accessibilityLabel="Username"
                  returnKeyType="next"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <Text
                className="text-grey text-xs mt-1"
                style={{ fontFamily: 'Nunito-Regular' }}
              >
                Usernames are visible to others
              </Text>
            </View>

            {/* Bio */}
            <View>
              <Text
                className="text-charcoal text-sm mb-1"
                style={{ fontFamily: 'Nunito-Medium' }}
              >
                Bio
              </Text>
              <TextInput
                className="bg-white rounded-xl px-4 py-3 text-charcoal text-base border border-greyLighter"
                style={{ fontFamily: 'Nunito-Regular', minHeight: 80, textAlignVertical: 'top' }}
                value={bio}
                onChangeText={(t) => setBio(t.slice(0, MAX_BIO_LENGTH))}
                placeholder="Tell other parents a little about yourself..."
                placeholderTextColor="#B0B0B0"
                accessibilityLabel="Bio"
                multiline
                maxLength={MAX_BIO_LENGTH}
              />
              <Text
                className="text-grey text-xs mt-1 text-right"
                style={{ fontFamily: 'Nunito-Regular' }}
                accessibilityLiveRegion="polite"
              >
                {bio.length} / {MAX_BIO_LENGTH}
              </Text>
            </View>

            {/* Divider */}
            <View className="h-px bg-greyLighter" />

            {/* Children's ages — link to dedicated screen */}
            <TouchableOpacity
              className="flex-row items-center justify-between bg-white rounded-xl px-4 py-3 border border-greyLighter"
              onPress={() => router.push('/profile/children-ages')}
              accessibilityRole="button"
              accessibilityLabel="Manage children's age ranges"
              accessibilityHint="Opens a screen where you can select the age ranges of your children"
            >
              <View className="flex-row items-center gap-2">
                <Text className="text-lg">🔒</Text>
                <View>
                  <Text
                    className="text-charcoal text-sm"
                    style={{ fontFamily: 'Nunito-Bold' }}
                  >
                    Children's ages
                  </Text>
                  <Text
                    className="text-grey text-xs"
                    style={{ fontFamily: 'Nunito-Regular' }}
                  >
                    {(profile?.children_ages ?? []).length > 0
                      ? (profile!.children_ages as string[]).join(', ')
                      : 'Not set — only you can see this'}
                  </Text>
                </View>
              </View>
              <ChevronRight size={18} color="#B0B0B0" />
            </TouchableOpacity>

            {/* Divider */}
            <View className="h-px bg-greyLighter" />

            {/* Postcode — private section */}
            <View>
              <View className="flex-row items-center gap-2 mb-1">
                <Text className="text-lg">📍</Text>
                <Text
                  className="text-charcoal text-sm font-bold"
                  style={{ fontFamily: 'Nunito-Bold' }}
                >
                  Your postcode
                </Text>
                <Text
                  className="text-sky text-xs italic"
                  style={{ fontFamily: 'Nunito-Regular' }}
                >
                  Only you can see this
                </Text>
              </View>
              <TextInput
                className="bg-white rounded-xl px-4 py-3 text-charcoal text-base border border-greyLighter"
                style={{ fontFamily: 'Nunito-Regular' }}
                value={postcode}
                onChangeText={(t) => setPostcode(t.toUpperCase())}
                placeholder="e.g. SW1A 1AA"
                placeholderTextColor="#B0B0B0"
                accessibilityLabel="Your postcode"
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="done"
              />
              <Text
                className="text-grey text-xs mt-1"
                style={{ fontFamily: 'Nunito-Regular' }}
              >
                Used to show venues near your area. Never shared with other users.
              </Text>
            </View>

          </View>
        </ScrollView>

        {/* Save button — sticky at bottom */}
        <View className="absolute bottom-0 left-0 right-0 bg-sand px-4 pb-8 pt-3 border-t border-greyLighter">
          <TouchableOpacity
            className="bg-sky rounded-2xl items-center justify-center"
            style={{ height: 56 }}
            onPress={handleSave}
            disabled={isPending}
            accessibilityRole="button"
            accessibilityLabel="Save profile changes"
          >
            {isPending ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text
                className="text-white text-lg"
                style={{ fontFamily: 'Nunito-Bold' }}
              >
                Save changes
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
