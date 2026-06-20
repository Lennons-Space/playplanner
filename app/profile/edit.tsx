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
 *
 * Visual: v2 dark editorial — colours/typography use the shared Colors +
 * FontFamily tokens (layout kept as NativeWind utility classes). Logic unchanged.
 */
import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Image, StyleSheet,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfile, useUser } from '@/hooks/useAuth';
import { useUpdateProfile, useUploadAvatar } from '@/hooks/useProfile';
import { Colors, FontFamily } from '@/constants/theme';

const MAX_BIO_LENGTH = 300;

export default function EditProfileScreen() {
  const user           = useUser();
  const profile        = useProfile();
  const { mutateAsync, isPending }           = useUpdateProfile();
  const { mutateAsync: uploadAvatar, isPending: isUploading } = useUploadAvatar();

  // All hooks must be called unconditionally (React rules of hooks).
  // Initial values are empty strings; useEffect syncs them once profile loads.
  const [fullName,    setFullName]    = useState('');
  const [username,    setUsername]    = useState('');
  const [bio,         setBio]         = useState('');
  const [postcode,    setPostcode]    = useState('');

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name ?? '');
    setUsername(profile.username  ?? '');
    setBio(profile.bio            ?? '');
    setPostcode(profile.postcode  ?? '');
  }, [profile]);

  if (!user) {
    router.replace('/(auth)/login');
    return null;
  }

  if (!profile) return null;

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
      <SafeAreaView className="flex-1" style={{ backgroundColor: Colors.bg }} edges={['bottom']}>
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
                  className="w-20 h-20 rounded-full"
                  style={{ backgroundColor: Colors.surface2 }}
                  accessibilityLabel="Your profile photo"
                />
              ) : (
                <View className="w-20 h-20 rounded-full items-center justify-center" style={{ backgroundColor: Colors.surface2 }}>
                  <Text className="text-4xl">👤</Text>
                </View>
              )}

              {/* Upload spinner overlaid on the avatar while uploading */}
              {isUploading && (
                <View
                  className="absolute inset-0 w-20 h-20 rounded-full items-center justify-center"
                  style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
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
              <Text className="text-sm mt-2" style={s.linkText}>
                {isUploading ? 'Uploading…' : 'Change photo'}
              </Text>
            </TouchableOpacity>
          </View>

          <View className="px-4 gap-4">

            {/* Full name */}
            <View>
              <Text className="text-sm mb-1" style={s.label}>Full name</Text>
              <TextInput
                className="rounded-xl px-4 py-3 text-base"
                style={s.input}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Your name"
                placeholderTextColor={Colors.label3}
                accessibilityLabel="Full name"
                returnKeyType="next"
                autoCorrect={false}
              />
            </View>

            {/* Username */}
            <View>
              <Text className="text-sm mb-1" style={s.label}>Username</Text>
              <View className="flex-row items-center rounded-xl px-4 py-3" style={s.inputWrap}>
                <Text className="text-base" style={s.prefix}>@</Text>
                <TextInput
                  className="flex-1 text-base ml-0.5"
                  style={s.inputInline}
                  value={username}
                  onChangeText={(t) => setUsername(t.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="your_username"
                  placeholderTextColor={Colors.label3}
                  accessibilityLabel="Username"
                  returnKeyType="next"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <Text className="text-xs mt-1" style={s.helper}>Usernames are visible to others</Text>
            </View>

            {/* Bio */}
            <View>
              <Text className="text-sm mb-1" style={s.label}>Bio</Text>
              <TextInput
                className="rounded-xl px-4 py-3 text-base"
                style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
                value={bio}
                onChangeText={(t) => setBio(t.slice(0, MAX_BIO_LENGTH))}
                placeholder="Tell other parents a little about yourself..."
                placeholderTextColor={Colors.label3}
                accessibilityLabel="Bio"
                multiline
                maxLength={MAX_BIO_LENGTH}
              />
              <Text className="text-xs mt-1 text-right" style={s.helper} accessibilityLiveRegion="polite">
                {bio.length} / {MAX_BIO_LENGTH}
              </Text>
            </View>

            {/* Divider */}
            <View className="h-px" style={{ backgroundColor: Colors.separator }} />

            {/* Children's ages — link to dedicated screen */}
            <TouchableOpacity
              className="flex-row items-center justify-between rounded-xl px-4 py-3"
              style={s.inputWrap}
              onPress={() => router.push('/profile/children-ages')}
              accessibilityRole="button"
              accessibilityLabel="Manage children's age ranges"
              accessibilityHint="Opens a screen where you can select the age ranges of your children"
            >
              <View className="flex-row items-center gap-2">
                <Text className="text-lg">🔒</Text>
                <View>
                  <Text className="text-sm" style={s.rowTitle}>Children's ages</Text>
                  <Text className="text-xs" style={s.helper}>
                    {(profile.children_ages ?? []).length > 0
                      ? (profile.children_ages ?? []).join(', ')
                      : 'Not set — only you can see this'}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.label4} />
            </TouchableOpacity>

            {/* Divider */}
            <View className="h-px" style={{ backgroundColor: Colors.separator }} />

            {/* Postcode — private section */}
            <View>
              <View className="flex-row items-center gap-2 mb-1">
                <Text className="text-lg">📍</Text>
                <Text className="text-sm" style={s.rowTitle}>Your postcode</Text>
                <Text className="text-xs italic" style={s.privateNote}>Only you can see this</Text>
              </View>
              <TextInput
                className="rounded-xl px-4 py-3 text-base"
                style={s.input}
                value={postcode}
                onChangeText={(t) => setPostcode(t.toUpperCase())}
                placeholder="e.g. SW1A 1AA"
                placeholderTextColor={Colors.label3}
                accessibilityLabel="Your postcode"
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="done"
              />
              <Text className="text-xs mt-1" style={s.helper}>
                Used to show venues near your area. Never shared with other users.
              </Text>
            </View>

          </View>
        </ScrollView>

        {/* Save button — sticky at bottom */}
        <View className="absolute bottom-0 left-0 right-0 px-4 pb-8 pt-3" style={s.saveBar}>
          <TouchableOpacity
            className="rounded-2xl items-center justify-center"
            style={{ height: 56, backgroundColor: Colors.accent }}
            onPress={handleSave}
            disabled={isPending}
            accessibilityRole="button"
            accessibilityLabel="Save profile changes"
          >
            {isPending ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-lg" style={{ fontFamily: FontFamily.bodyStrong, color: '#FFFFFF' }}>
                Save changes
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  linkText: { fontFamily: FontFamily.bodyStrong, color: Colors.accent },
  label: { fontFamily: FontFamily.bodyStrong, color: Colors.label2 },
  helper: { fontFamily: FontFamily.body, color: Colors.label3 },
  rowTitle: { fontFamily: FontFamily.bodyStrong, color: Colors.label },
  privateNote: { fontFamily: FontFamily.body, color: Colors.accent },
  prefix: { fontFamily: FontFamily.body, color: Colors.label3 },
  input: {
    fontFamily: FontFamily.body,
    color: Colors.label,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.separator,
  },
  inputInline: { fontFamily: FontFamily.body, color: Colors.label },
  inputWrap: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.separator,
  },
  saveBar: {
    backgroundColor: Colors.bg,
    borderTopWidth: 1,
    borderTopColor: Colors.separator,
  },
});
