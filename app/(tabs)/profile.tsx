/**
 * Profile tab — user account, settings, subscription
 */
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfile } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';

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

  function confirmSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);
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
        <View className="mx-4 mt-5 mb-10">
          <TouchableOpacity
            className="border-2 border-error rounded-2xl py-4 items-center"
            onPress={confirmSignOut}
          >
            <Text className="text-error font-bold text-base">Sign out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
