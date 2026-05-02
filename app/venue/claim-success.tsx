import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';

const NEXT_STEPS = [
  { icon: '✓', title: 'Phone verified', body: 'We confirmed you have access to the business phone number.' },
  { icon: '⧗', title: 'Admin review', body: 'Our team will check your claim against the venue details.' },
  { icon: '✉', title: "You'll be notified", body: "We'll let you know once the review is complete — usually within 2 working days." },
];

export default function ClaimSuccessScreen() {
  const { venueId } = useLocalSearchParams<{ venueId: string }>();

  return (
    <SafeAreaView className="flex-1 bg-slate" edges={['top', 'bottom']}>
      <View className="flex-1 px-5 justify-between pb-8 pt-12">
        <View className="items-center">
          <View className="w-24 h-24 rounded-full bg-sky/15 items-center justify-center mb-6">
            <View className="w-16 h-16 rounded-full bg-sky/25 items-center justify-center">
              <Text className="text-4xl">✓</Text>
            </View>
          </View>
          <Text className="text-3xl font-extrabold text-charcoal text-center mb-3">Claim submitted!</Text>
          <Text className="text-grey text-base text-center leading-6 px-4">
            We've verified your phone number. Your claim is now under review.
          </Text>
        </View>

        <View className="bg-sand rounded-3xl p-5 border border-greyLighter my-8">
          <Text className="text-charcoal font-extrabold text-sm uppercase mb-4 tracking-wide">What happens next</Text>
          <View className="gap-5">
            {NEXT_STEPS.map((step, i) => (
              <View key={i} className="flex-row items-start gap-4">
                <View className="w-9 h-9 rounded-full bg-sky/15 items-center justify-center flex-shrink-0 mt-0.5">
                  <Text className="text-sky font-extrabold text-sm">{step.icon}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-charcoal font-bold text-sm mb-0.5">{step.title}</Text>
                  <Text className="text-grey text-sm leading-5">{step.body}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <TouchableOpacity
          className="bg-sky rounded-2xl py-4 items-center"
          onPress={() => router.replace(`/venue/${venueId}`)}
          activeOpacity={0.8}
        >
          <Text className="text-white font-extrabold text-base">Back to venue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
