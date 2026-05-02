import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';

export default function ClaimScreen() {
  const { venueId, venueName } = useLocalSearchParams<{ venueId: string; venueName: string }>();
  const [phone, setPhone] = useState('+44');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const normalised = phone.replace(/\s/g, '');
  const isPhoneValid = /^\+[1-9]\d{7,14}$/.test(normalised);

  const handlePhoneChange = (text: string) => {
    setPhoneError(null);
    setPhone(text.startsWith('+') ? text : '+' + text.replace(/^\++/, ''));
  };

  const handleSendCode = async () => {
    if (!isPhoneValid) {
      setPhoneError('Enter a valid phone number, e.g. +44 7700 900000');
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/send-otp`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: normalised }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setPhoneError(body.error ?? 'Could not send code. Please try again.');
        return;
      }
      router.push({
        pathname: '/venue/claim-verify',
        params: { venueId, venueName, phone: normalised, notes },
      });
    } catch {
      setPhoneError('Network error. Please check your connection.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-5 pb-10"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="flex-row items-center pt-4 pb-8">
            <TouchableOpacity
              onPress={() => router.back()}
              className="w-10 h-10 items-center justify-center rounded-full bg-sandDark mr-3"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text className="text-charcoal font-bold text-base">←</Text>
            </TouchableOpacity>
            <Text className="text-xl font-extrabold text-charcoal">Claim this business</Text>
          </View>

          <View className="bg-sand rounded-2xl px-4 py-4 mb-8 border border-greyLighter">
            <Text className="text-grey text-xs font-bold uppercase mb-1">Claiming</Text>
            <Text className="text-charcoal font-extrabold text-base" numberOfLines={2}>
              {venueName ?? 'This venue'}
            </Text>
          </View>

          <Text className="text-charcoal font-extrabold text-2xl mb-2 leading-tight">
            Verify your ownership
          </Text>
          <Text className="text-grey text-base leading-6 mb-8">
            We'll send a 6-digit code to your business phone. Once verified, your claim goes to our team for review.
          </Text>

          <View className="mb-2">
            <Text className="text-charcoal font-bold text-sm mb-2">Business phone number</Text>
            <TextInput
              className={`bg-white border rounded-2xl px-4 py-4 text-charcoal text-base ${
                phoneError ? 'border-error' : 'border-greyLighter'
              }`}
              value={phone}
              onChangeText={handlePhoneChange}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              placeholder="+44 7700 900000"
              placeholderTextColor="#B2BEC3"
              returnKeyType="next"
            />
            {!phoneError && (
              <Text className="text-grey text-xs mt-2 leading-4">
                Your phone number is only used to verify this claim. It will not be shared publicly.
              </Text>
            )}
            {phoneError && (
              <Text className="text-error text-xs mt-2 leading-4">{phoneError}</Text>
            )}
          </View>

          <View className="mt-6 mb-8">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-charcoal font-bold text-sm">Supporting notes</Text>
              <Text className="text-grey text-xs">Optional</Text>
            </View>
            <TextInput
              className="bg-white border border-greyLighter rounded-2xl px-4 py-4 text-charcoal text-base"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={4}
              placeholder="e.g. I am the manager and have been running this venue since 2019..."
              placeholderTextColor="#B2BEC3"
              textAlignVertical="top"
              maxLength={500}
              style={{ minHeight: 100 }}
            />
            <Text className="text-grey text-xs mt-2 text-right">{notes.length}/500</Text>
          </View>

          <TouchableOpacity
            className={`rounded-2xl py-4 items-center justify-center ${
              isPhoneValid && !isLoading ? 'bg-sky' : 'bg-sky/50'
            }`}
            onPress={handleSendCode}
            disabled={!isPhoneValid || isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text className="text-white font-extrabold text-base">Send verification code</Text>
            )}
          </TouchableOpacity>

          <Text className="text-grey text-xs text-center mt-6 leading-5">
            By claiming this venue, you confirm you have authority to represent this business. False claims may result in account suspension.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
