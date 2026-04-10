/**
 * Profile tab — user account, settings, subscription
 *
 * GDPR Art.17 (right to erasure): The "Delete account" button calls the
 * delete_own_account() Postgres function via RPC. We never call the auth API
 * directly from the client — the server-side function handles cascading
 * deletion and writes a GDPR audit log entry before removing the account.
 */
import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfile } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';

interface MenuItemProps {
  icon: string;
  label: string;
  onPress: () => void;
  badge?: string;
}

function MenuItem({ icon, label, onPress, badge }: MenuItemProps) {
  return (
    <TouchableOpacity
      className="flex-row items-center gap-3 bg-white px-4 py-4 border-b border-greyLighter"
      onPress={onPress}
    >
      <Text className="text-xl">{icon}</Text>
      <Text className="flex-1 text-charcoal text-base">{label}</Text>
      {badge && (
        <View className="bg-coral rounded-full px-2 py-0.5">
          <Text className="text-white text-xs font-bold">{badge}</Text>
        </View>
      )}
      <Text className="text-greyLight">›</Text>
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const profile = useProfile();
  const signOut = useAuthStore((s) => s.signOut);

  // Tracks whether the account deletion call is in progress.
  // Prevents the user tapping "Delete" twice and sending two requests.
  const [deleting, setDeleting] = useState(false);

  function confirmSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);
  }

  /**
   * GDPR Art.17 — right to erasure ("right to be forgotten").
   *
   * We call the delete_own_account() Postgres function via RPC rather than
   * deleting directly. The server-side function:
   *   1. Writes a GDPR audit log entry (Art.5(2) accountability).
   *   2. Deletes the auth.users row, which cascades to all related data.
   *
   * On success we clear local auth state and send the user to the Welcome
   * screen so they cannot interact with the app as a deleted account.
   */
  function confirmDeleteAccount() {
    Alert.alert(
      'Delete account?',
      'This will permanently delete your account and all your data. This cannot be undone.',
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
              Alert.alert('Could not delete account. Please try again.');
              return;
            }

            // Clear the local session so Zustand doesn't hold stale user data.
            await signOut();
            // Send the user back to the Welcome screen — the account no longer exists.
            router.replace('/(auth)/welcome');
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-sand" edges={['top']}>
      <ScrollView>
        {/* Header */}
        <View className="bg-coral px-4 pt-4 pb-8 items-center">
          <View className="w-20 h-20 rounded-full bg-white items-center justify-center mb-3">
            <Text className="text-4xl">👤</Text>
          </View>
          <Text className="text-white font-extrabold text-xl">{profile?.full_name ?? 'Parent'}</Text>
          {profile?.subscription_tier === 'premium' && (
            <View className="bg-sun rounded-full px-3 py-1 mt-1">
              <Text className="text-charcoal font-bold text-xs">⭐ Premium</Text>
            </View>
          )}
        </View>

        {/* Account section */}
        <Text className="text-grey text-xs font-bold uppercase px-4 pt-5 pb-2">Account</Text>
        <View className="rounded-2xl overflow-hidden mx-4">
          <MenuItem icon="✏️" label="Edit profile"    onPress={() => {/* TODO */}} />
          <MenuItem icon="🔔" label="Notifications"   onPress={() => {/* TODO */}} />
          <MenuItem icon="🔒" label="Privacy settings" onPress={() => {/* TODO */}} />
        </View>

        {/* Subscription */}
        <Text className="text-grey text-xs font-bold uppercase px-4 pt-5 pb-2">Subscription</Text>
        <View className="rounded-2xl overflow-hidden mx-4">
          {profile?.subscription_tier === 'free' ? (
            <MenuItem
              icon="⭐"
              label="Upgrade to Premium"
              onPress={() => {/* TODO: open upgrade screen */}}
              badge="£2.99/mo"
            />
          ) : (
            <MenuItem icon="⭐" label="Manage subscription" onPress={() => {/* TODO */}} />
          )}
        </View>

        {/* Business */}
        <Text className="text-grey text-xs font-bold uppercase px-4 pt-5 pb-2">Business</Text>
        <View className="rounded-2xl overflow-hidden mx-4">
          <MenuItem icon="🏢" label="Business dashboard" onPress={() => router.push('/business/dashboard')} />
          <MenuItem icon="📍" label="Add a venue"        onPress={() => router.push('/venue/add')} />
        </View>

        {/* Support */}
        <Text className="text-grey text-xs font-bold uppercase px-4 pt-5 pb-2">Support</Text>
        <View className="rounded-2xl overflow-hidden mx-4">
          <MenuItem icon="❓" label="Help & FAQ"     onPress={() => {/* TODO */}} />
          <MenuItem icon="📧" label="Contact us"     onPress={() => {/* TODO */}} />
          <MenuItem icon="📄" label="Privacy policy" onPress={() => {/* TODO */}} />
        </View>

        {/* Sign out */}
        <View className="mx-4 mt-5">
          <TouchableOpacity
            className="border-2 border-error rounded-2xl py-4 items-center"
            onPress={confirmSignOut}
          >
            <Text className="text-error font-bold text-base">Sign out</Text>
          </TouchableOpacity>
        </View>

        {/*
          Delete account — GDPR Art.17 right to erasure.
          Visually separated from Sign out and styled in coral/red so the user
          clearly understands this is a destructive, irreversible action.
          The loading state prevents double-taps from sending two delete requests.
        */}
        <View className="mx-4 mt-3 mb-10">
          <TouchableOpacity
            className="rounded-2xl py-4 items-center"
            style={{ backgroundColor: '#FFF0F0', borderWidth: 1, borderColor: '#FF6B6B' }}
            onPress={confirmDeleteAccount}
            disabled={deleting}
            accessibilityRole="button"
            accessibilityLabel="Permanently delete your account and all your data"
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
          {/* Plain-English warning below the button — ICO Children's Code Standard 4
              (transparency): users must understand what will happen before they act. */}
          <Text
            className="text-xs text-center mt-2"
            style={{ color: '#b0b0b0', fontFamily: 'Nunito-Regular' }}
          >
            Permanently deletes all your data. Cannot be undone.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
