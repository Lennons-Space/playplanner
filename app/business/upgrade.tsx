/**
 * Business upgrade screen — Stripe subscription flow
 * TODO: Wire up Stripe payment sheet for premium business plan
 */
import { Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PREMIUM_PRICE_MONTHLY } from '@/constants/pricing';

export default function UpgradeScreen() {
  return (
    <SafeAreaView className="flex-1 bg-slate items-center justify-center px-6">
      <Text className="text-3xl font-extrabold text-charcoal text-center">Upgrade to Premium</Text>
      <Text className="text-grey text-center mt-3 text-base">
        Premium listings get featured placement, unlimited photos, and analytics.
      </Text>
      <Text className="text-coral font-bold text-2xl mt-6">{PREMIUM_PRICE_MONTHLY} / month</Text>

      {/* TODO: Replace with Stripe payment sheet */}
      <TouchableOpacity className="w-full bg-sky rounded-2xl py-4 items-center mt-8">
        <Text className="text-white font-bold text-lg">Subscribe — coming soon</Text>
      </TouchableOpacity>

      <TouchableOpacity className="mt-4" onPress={() => router.back()}>
        <Text className="text-grey text-base">← Go back</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}
