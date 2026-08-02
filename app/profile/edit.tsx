/**
 * Edit Profile screen — app/profile/edit.tsx
 *
 * v2 dark restyle (Step 5, feat/exact-v2-design): VISUAL LAYER ONLY. All
 * hooks, mutation calls, error-handling branches and validation are
 * byte-identical to the pre-restyle version — only JSX/styles/header
 * changed, same rule as Venue Detail/Map.
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
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useProfile, useUser } from '@/hooks/useAuth';
import { useUpdateProfile, useUploadAvatar } from '@/hooks/useProfile';
import { Icon } from '@/components/ui/Icon';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { GlassButton } from '@/components/ui/GlassButton';
import { ThemedBackground } from '@/components/ui/ThemedBackground';
import { V2Header } from '@/components/ui/V2Header';
import { useAppTheme } from '@/hooks/useAppTheme';
import { FontFamily, ocean } from '@/constants/theme';

const ACCENT = ocean;
const MAX_BIO_LENGTH = 300;

// Sticky save-bar sizing (Phase 5C, UI repair sprint) — kept as named
// constants so the ScrollView's bottom clearance always matches the bar's
// real rendered height. Previously the ScrollView reserved a flat, guessed
// 140px while the bar itself only ever needed ~82px (+ safe-area inset),
// producing a ~60px dead gap above a near-opaque footer (light mode reads as
// solid white) — together those read as one oversized white block. Deriving
// both from the same numbers removes the mismatch instead of re-guessing it.
const SAVE_BUTTON_HEIGHT      = 54; // must match styles.saveBtnLayout.height
const SAVE_BAR_PADDING_TOP    = 12;
const SAVE_BAR_PADDING_BOTTOM = 12; // + insets.bottom, added where used
const SAVE_BAR_SCROLL_GAP     = 16; // breathing room between last card and the bar

export default function EditProfileScreen() {
  const { tokens: T, mode } = useAppTheme();
  const statusBarStyle = mode === 'dark' ? 'light' : 'dark';
  // See app/profile/my-venues.tsx for why cards are lighter than
  // GlassSurface's mode default; the sticky bar stays close to opaque.
  const cardTint = mode === 'dark' ? 'rgba(14,14,20,0.55)' : 'rgba(255,255,255,0.55)';
  const stickyBarTint = mode === 'dark' ? 'rgba(12,12,17,0.92)' : 'rgba(255,255,255,0.92)';
  const user           = useUser();
  const profile        = useProfile();
  const { mutateAsync, isPending }           = useUpdateProfile();
  const { mutateAsync: uploadAvatar, isPending: isUploading } = useUploadAvatar();
  const insets = useSafeAreaInsets();
  // Real rendered height of the sticky save bar (padding + button + safe
  // area) — the ScrollView clears exactly this much, plus a small visual
  // gap, instead of an unrelated flat guess. See constants above.
  const saveBarHeight = SAVE_BAR_PADDING_TOP + SAVE_BUTTON_HEIGHT + SAVE_BAR_PADDING_BOTTOM + insets.bottom;

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

  const initials = (profile.full_name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <View style={styles.root}>
      <ThemedBackground />
      <StatusBar style={statusBarStyle} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <V2Header title="Edit Profile" />

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={[styles.scrollContent, { paddingBottom: saveBarHeight + SAVE_BAR_SCROLL_GAP }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >

            {/* Avatar */}
            <View style={styles.avatarSection}>
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
                    style={[styles.avatarImg, { backgroundColor: T.fill }]}
                    accessibilityLabel="Your profile photo"
                  />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    {initials.length > 0 ? (
                      <Text style={styles.avatarInitials}>{initials}</Text>
                    ) : (
                      <Icon name="user" size={30} color="#FFFFFF" />
                    )}
                  </View>
                )}

                {isUploading && (
                  <View style={styles.avatarUploading} accessibilityLabel="Uploading photo">
                    <ActivityIndicator color="#FFFFFF" />
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleChangePhoto}
                disabled={isUploading}
                accessibilityRole="button"
                accessibilityLabel="Change profile photo"
              >
                <Text style={styles.changePhotoText}>
                  {isUploading ? 'Uploading…' : 'Change photo'}
                </Text>
              </TouchableOpacity>
            </View>

            <GlassSurface style={styles.card} tintColor={cardTint}>
              {/* Full name */}
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: T.label2 }]}>Full name</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: T.bg, borderColor: T.separator, color: T.label }]}
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="Your name"
                  placeholderTextColor={T.label4}
                  accessibilityLabel="Full name"
                  returnKeyType="next"
                  autoCorrect={false}
                />
              </View>

              {/* Username */}
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: T.label2 }]}>Username</Text>
                <View style={[styles.usernameRow, { backgroundColor: T.bg, borderColor: T.separator }]}>
                  <Text style={[styles.usernameAt, { color: T.label3 }]}>@</Text>
                  <TextInput
                    style={[styles.usernameInput, { color: T.label }]}
                    value={username}
                    onChangeText={(t) => setUsername(t.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    placeholder="your_username"
                    placeholderTextColor={T.label4}
                    accessibilityLabel="Username"
                    returnKeyType="next"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                <Text style={[styles.fieldHint, { color: T.label3 }]}>Usernames are visible to others</Text>
              </View>

              {/* Bio */}
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: T.label2 }]}>Bio</Text>
                <TextInput
                  style={[
                    styles.input,
                    styles.bioInput,
                    { backgroundColor: T.bg, borderColor: T.separator, color: T.label },
                  ]}
                  value={bio}
                  onChangeText={(t) => setBio(t.slice(0, MAX_BIO_LENGTH))}
                  placeholder="Tell other parents a little about yourself..."
                  placeholderTextColor={T.label4}
                  accessibilityLabel="Bio"
                  multiline
                  maxLength={MAX_BIO_LENGTH}
                />
                <Text style={[styles.bioCounter, { color: T.label3 }]} accessibilityLiveRegion="polite">
                  {bio.length} / {MAX_BIO_LENGTH}
                </Text>
              </View>
            </GlassSurface>

            {/* Children's ages — link to dedicated screen */}
            <GlassSurface style={styles.card} tintColor={cardTint}>
              <TouchableOpacity
                style={styles.linkRow}
                onPress={() => router.push('/profile/children-ages')}
                accessibilityRole="button"
                accessibilityLabel="Manage children's age ranges"
                accessibilityHint="Opens a screen where you can select the age ranges of your children"
              >
                <View style={styles.linkIconBox}>
                  <Icon name="stroller" size={18} color={ACCENT.accent} />
                </View>
                <View style={styles.flex}>
                  <Text style={[styles.linkLabel, { color: T.label }]}>Children&apos;s ages</Text>
                  <Text style={[styles.linkSub, { color: T.label3 }]}>
                    {(profile.children_ages ?? []).length > 0
                      ? (profile.children_ages ?? []).join(', ')
                      : 'Not set — only you can see this'}
                  </Text>
                </View>
                <Icon name="chevR" size={16} color={T.label3} />
              </TouchableOpacity>
            </GlassSurface>

            {/* Postcode — private section */}
            <GlassSurface style={styles.card} tintColor={cardTint}>
              <View style={styles.field}>
                <View style={styles.privateLabelRow}>
                  <Icon name="pin" size={15} color={T.label3} />
                  <Text style={[styles.fieldLabel, { color: T.label2 }]}>Your postcode</Text>
                  <Text style={styles.privateTag}>Only you can see this</Text>
                </View>
                <TextInput
                  style={[styles.input, { backgroundColor: T.bg, borderColor: T.separator, color: T.label }]}
                  value={postcode}
                  onChangeText={(t) => setPostcode(t.toUpperCase())}
                  placeholder="e.g. SW1A 1AA"
                  placeholderTextColor={T.label4}
                  accessibilityLabel="Your postcode"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="done"
                />
                <Text style={[styles.fieldHint, { color: T.label3 }]}>
                  Used to show venues near your area. Never shared with other users.
                </Text>
              </View>
            </GlassSurface>

          </ScrollView>

          {/* Save button — sticky, safe-area aware above Android nav.
              Phase 5C: paddingTop/paddingBottom now come from the same
              SAVE_BAR_* constants the ScrollView clearance above uses, so
              the bar is exactly as tall as its content (button + minimal
              padding + real safe-area inset) and never a large guessed block. */}
          <GlassSurface
            style={[
              styles.stickyBar,
              { paddingTop: SAVE_BAR_PADDING_TOP, paddingBottom: SAVE_BAR_PADDING_BOTTOM + insets.bottom },
            ]}
            tintColor={stickyBarTint}
          >
            <GlassButton
              onPress={handleSave}
              disabled={isPending}
              loading={isPending}
              accessibilityLabel="Save profile changes"
              accessibilityState={{ disabled: isPending }}
              label="Save changes"
              style={styles.saveBtnLayout}
            />
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
  scrollContent: {
    paddingHorizontal: 20,
    // Slightly wider than the design system's default 16px card gap so the
    // shared animated background layer reads clearly between each
    // translucent card, matching the "open canvas" density of Home/Venue
    // Detail rather than the tightly-stacked look this screen shipped with.
    gap: 20,
  },

  // Avatar
  avatarSection: {
    alignItems: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  avatarImg: {
    width: 88,
    height: 88,
    borderRadius: 44,
    // backgroundColor: mode-aware, applied inline (T.fill).
  },
  avatarPlaceholder: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: ACCENT.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily: FontFamily.display,
    fontSize: 28,
    color: '#FFFFFF',
  },
  avatarUploading: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 44,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  changePhotoText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 14,
    color: ACCENT.accent,
    marginTop: 2,
  },

  // Cards
  card: {
    borderRadius: 20,
    padding: 16,
    gap: 14,
  },
  field: { gap: 6 },
  fieldLabel: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13,
  },
  fieldHint: {
    fontFamily: FontFamily.body,
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: FontFamily.body,
    fontSize: 15,
    // backgroundColor / borderColor / color: mode-aware, applied inline.
  },
  bioInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  bioCounter: {
    fontFamily: FontFamily.body,
    fontSize: 11,
    textAlign: 'right',
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    // backgroundColor / borderColor: mode-aware, applied inline.
  },
  usernameAt: {
    fontFamily: FontFamily.body,
    fontSize: 15,
    marginRight: 2,
  },
  usernameInput: {
    flex: 1,
    fontFamily: FontFamily.body,
    fontSize: 15,
    padding: 0,
    // color: mode-aware, applied inline (T.label).
  },

  // Children's ages link row
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  linkIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: ACCENT.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkLabel: {
    fontFamily: FontFamily.heading,
    fontSize: 15,
  },
  linkSub: {
    fontFamily: FontFamily.body,
    fontSize: 12,
    marginTop: 2,
  },

  // Postcode private label
  privateLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  privateTag: {
    fontFamily: FontFamily.body,
    fontSize: 11,
    color: ACCENT.accent,
    fontStyle: 'italic',
    marginLeft: 4,
  },

  // Sticky save bar
  // paddingTop/paddingBottom are set inline from the SAVE_BAR_* constants
  // (Phase 5C) so this container is only ever as tall as button + minimal
  // padding + real safe-area inset — never a guessed/oversized block.
  stickyBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  // Phase 3 (glass button system): "Save changes" is now a <GlassButton/>;
  // only layout survives here. Height must match SAVE_BUTTON_HEIGHT above.
  saveBtnLayout: {
    height: SAVE_BUTTON_HEIGHT,
    borderRadius: 16,
  },
});
