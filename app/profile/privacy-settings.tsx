/**
 * Privacy Settings screen — app/profile/privacy-settings.tsx
 *
 * One screen where the user controls all consent and visibility decisions
 * and can exercise their GDPR rights.
 *
 * Compliance notes:
 *   - Location toggle defaults OFF — ICO Children's Code Standard 10
 *   - Profile visibility defaults OFF — ICO Children's Code Standard 9
 *   - Marketing consent defaults OFF — UK PECR (pre-ticked consent is illegal)
 *   - Withdrawal is instant, no friction — UK GDPR Art.7(3)
 *   - Download my data (GDPR Art.15) and Delete account (GDPR Art.17) are
 *     both reachable from here so users can exercise rights in under 3 taps.
 *
 * Auto-save pattern:
 *   Each toggle saves immediately (no Save button). If the mutation fails,
 *   the toggle snaps back to its previous value so the UI stays consistent.
 */
import { useState, useEffect } from 'react';
import {
  View, Text, Switch, TouchableOpacity, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfile, useUser } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import { useUpdateProfile } from '@/hooks/useProfile';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { recordLocationConsentGranted, recordLocationConsentWithdrawn } from '@/services/consent/locationConsent';
import { useLocation } from '@/hooks/location';
import * as LocationLib from 'expo-location';

// Sky teal colour for the switch track when ON (primary colour — Direction 2).
const SWITCH_TRACK_ON  = '#4ECDC4';
const SWITCH_TRACK_OFF = '#E8E8E8';

interface PrivacyRowProps {
  label:     string;
  helper:    string;
  value:     boolean;
  onChange:  (next: boolean) => void;
  disabled?: boolean;
}

function PrivacyRow({ label, helper, value, onChange, disabled }: PrivacyRowProps) {
  return (
    <View className="bg-white px-4 py-4 rounded-xl mb-2">
      <View className="flex-row items-center justify-between gap-4">
        <Text
          className="flex-1 text-charcoal text-base"
          style={{ fontFamily: 'Nunito-Medium' }}
        >
          {label}
        </Text>
        <Switch
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          trackColor={{ false: SWITCH_TRACK_OFF, true: SWITCH_TRACK_ON }}
          thumbColor="white"
          accessibilityRole="switch"
          accessibilityState={{ checked: value, disabled }}
          accessibilityLabel={label}
        />
      </View>
      <Text
        className="text-grey text-xs mt-1"
        style={{ fontFamily: 'Nunito-Regular' }}
      >
        {helper}
      </Text>
    </View>
  );
}

export default function PrivacySettingsScreen() {
  const user              = useUser();
  const profile           = useProfile();
  const signOut           = useAuthStore((s) => s.signOut);
  const queryClient       = useQueryClient();
  const { mutateAsync }   = useUpdateProfile();
  // Read current location permission state from the hook.
  const { hasPermission: locationEnabled } = useLocation();
  const [deleting,        setDeleting]     = useState(false);

  // Auth guard — redirect unauthenticated users to the login screen.
  useEffect(() => {
    if (user === null) {
      router.replace('/(auth)/login');
    }
  }, [user]);

  // Local mirror of the profile toggles — initialised from the stored profile.
  // These are kept in sync with the DB by auto-saving on each toggle change.
  const [showInSearch,        setShowInSearch]        = useState(profile?.show_in_search        ?? false);
  const [showReviewsPublicly, setShowReviewsPublicly] = useState(profile?.show_reviews_publicly ?? true);
  const [marketingConsent,    setMarketingConsent]    = useState(profile?.marketing_consent     ?? false);

  /** Auto-save a single profile field. Snaps the toggle back on failure. */
  async function saveField(
    field:    'show_in_search' | 'show_reviews_publicly' | 'marketing_consent',
    next:     boolean,
    rollback: (v: boolean) => void,
  ) {
    try {
      await mutateAsync({ [field]: next });
    } catch {
      rollback(!next); // snap back to previous value
      Alert.alert('Could not save', 'Please check your connection and try again.');
    }
  }

  /** Location toggle — requests OS permission on enable, logs withdrawal on disable. */
  async function handleLocationToggle(next: boolean) {
    if (next) {
      // Request the OS permission dialog. If already granted, this is a no-op.
      const { status } = await LocationLib.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        await recordLocationConsentGranted();
      }
      // If denied, the hook's `hasPermission` stays false — no local state to roll back.
    } else {
      // GDPR Art.7(3): withdrawal must be as easy as giving consent.
      await recordLocationConsentWithdrawn();
    }
  }

  /** GDPR Art.17 — right to erasure. */
  function confirmDeleteAccount() {
    Alert.alert(
      'Delete account?',
      'This will permanently delete your account, reviews, and all personal data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            const { error } = await supabase.rpc('delete_own_account');
            setDeleting(false);

            if (error) {
              Alert.alert('Error', 'Could not delete account. Please try again.');
              return;
            }

            queryClient.clear();
            try {
              await signOut();
            } catch (signOutError) {
              console.error('signOut failed after account delete (non-blocking):', signOutError);
            }
            router.replace('/(auth)/welcome');
          },
        },
      ],
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Privacy Settings' }} />
      <SafeAreaView className="flex-1 bg-slate" edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>

          {/* Location */}
          <Text
            className="text-grey text-xs font-bold uppercase mb-2"
            style={{ fontFamily: 'Nunito-Bold' }}
          >
            Location
          </Text>
          <PrivacyRow
            label="Share my location while browsing"
            helper="Helps us show venues near you. Your exact location is never stored or shared."
            value={locationEnabled}
            onChange={handleLocationToggle}
          />
          <TouchableOpacity
            className="mb-4"
            onPress={() => {/* TODO Phase 4: consent history screen */}}
            accessibilityRole="link"
            accessibilityLabel="View location consent history"
          >
            <Text
              className="text-sky text-xs"
              style={{ fontFamily: 'Nunito-Regular' }}
            >
              View consent history →
            </Text>
          </TouchableOpacity>

          {/* Profile visibility */}
          <Text
            className="text-grey text-xs font-bold uppercase mb-2"
            style={{ fontFamily: 'Nunito-Bold' }}
          >
            Profile Visibility
          </Text>
          <PrivacyRow
            label="Show my profile to other parents"
            helper="When off, only you can see your profile. Other parents cannot find or view it."
            value={showInSearch}
            onChange={(next) => {
              setShowInSearch(next);
              saveField('show_in_search', next, setShowInSearch);
            }}
          />
          <PrivacyRow
            label="Show my reviews publicly"
            helper="Your reviews appear with your first name only — never your full name or photo unless you choose."
            value={showReviewsPublicly}
            onChange={(next) => {
              setShowReviewsPublicly(next);
              saveField('show_reviews_publicly', next, setShowReviewsPublicly);
            }}
          />

          {/* Marketing */}
          <Text
            className="text-grey text-xs font-bold uppercase mt-2 mb-2"
            style={{ fontFamily: 'Nunito-Bold' }}
          >
            Emails & Marketing
          </Text>
          <PrivacyRow
            label="Tips and updates from PlayPlanner"
            helper="We will never sell your data or share it with advertisers."
            value={marketingConsent}
            onChange={(next) => {
              setMarketingConsent(next);
              saveField('marketing_consent', next, setMarketingConsent);
            }}
          />

          {/* Data rights */}
          <Text
            className="text-grey text-xs font-bold uppercase mt-2 mb-2"
            style={{ fontFamily: 'Nunito-Bold' }}
          >
            Your Data Rights
          </Text>
          <TouchableOpacity
            className="bg-white rounded-xl flex-row items-center px-4 py-4 mb-2"
            onPress={() => router.push('/profile/data-download')}
            accessibilityRole="button"
            accessibilityLabel="Download my data — GDPR right of access"
          >
            <Text className="text-xl mr-3">⬇️</Text>
            <Text
              className="flex-1 text-charcoal text-base"
              style={{ fontFamily: 'Nunito-Medium' }}
            >
              Download my data
            </Text>
            <Text className="text-greyLight">›</Text>
          </TouchableOpacity>

          {/* Divider */}
          <View className="h-px bg-greyLighter my-4" />

          {/* Delete account — GDPR Art.17 */}
          <TouchableOpacity
            className="rounded-2xl py-4 items-center"
            style={{ backgroundColor: '#FFF0F0', borderWidth: 1, borderColor: '#FF6B6B' }}
            onPress={confirmDeleteAccount}
            disabled={deleting}
            accessibilityRole="button"
            accessibilityLabel="Delete account permanently — this cannot be undone"
            accessibilityState={{ disabled: deleting }}
          >
            {deleting ? (
              <ActivityIndicator color="#FF6B6B" />
            ) : (
              <Text
                className="font-bold text-base"
                style={{ color: '#FF6B6B', fontFamily: 'Nunito-Bold' }}
              >
                Delete account
              </Text>
            )}
          </TouchableOpacity>
          <Text
            className="text-xs text-center mt-2"
            style={{ color: '#B0B0B0', fontFamily: 'Nunito-Regular' }}
          >
            Permanently deletes your account, reviews, and all personal data.{'\n'}
            Cannot be undone.
          </Text>

        </ScrollView>
      </SafeAreaView>
    </>
  );
}
