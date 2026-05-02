import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform,
  NativeSyntheticEvent, TextInputKeyPressEventData,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60;

function maskPhone(phone: string): string {
  return phone.replace(/(\+\d{2})(\d+)(\d{4})$/, (_m, prefix, mid, last) =>
    `${prefix} ${'*'.repeat(mid.length).replace(/(.{3})/g, '$1 ').trim()} ${last}`
  );
}

export default function ClaimVerifyScreen() {
  const { venueId, venueName, phone, notes } = useLocalSearchParams<{
    venueId: string; venueName: string; phone: string; notes: string;
  }>();
  const user = useAuthStore((s) => s.user);

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(TextInput | null)[]>(Array(OTP_LENGTH).fill(null));

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? (clearInterval(timer), 0) : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const isComplete = digits.every((d) => d !== '');

  const handleDigitChange = useCallback((text: string, index: number) => {
    const cleaned = text.replace(/[^0-9]/g, '').slice(-1);
    setError(null);
    const next = [...digits];
    next[index] = cleaned;
    setDigits(next);
    if (cleaned && index < OTP_LENGTH - 1) inputRefs.current[index + 1]?.focus();
  }, [digits]);

  const handleKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>, index: number) => {
      if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    },
    [digits]
  );

  const handleVerify = async () => {
    if (!isComplete || isVerifying) return;
    setIsVerifying(true);
    setError(null);
    try {
      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/verify-otp`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, code: digits.join('') }),
        }
      );
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setDigits(Array(OTP_LENGTH).fill(''));
        inputRefs.current[0]?.focus();
        setError(
          body.attemptsLeft === 0
            ? 'Too many incorrect attempts. Please request a new code.'
            : `Incorrect code.${body.attemptsLeft != null ? ` ${body.attemptsLeft} attempt${body.attemptsLeft !== 1 ? 's' : ''} remaining.` : ''}`
        );
        return;
      }

      // Guard: session may have expired while the user was on this screen.
      if (!user) {
        setError('Your session has expired. Please sign in again to complete your claim.');
        return;
      }

      const { error: insertError } = await supabase.from('venue_claims').insert({
        venue_id: venueId,
        user_id: user.id,
        verified_phone: phone,
        verified_phone_token: body.token,
        status: 'pending',
        notes: notes?.trim() || null,
      });

      if (insertError) {
        setError(
          insertError.code === '23505'
            ? 'A claim for this venue is already pending or approved.'
            : 'Could not submit your claim. Please try again.'
        );
        return;
      }

      router.replace({ pathname: '/venue/claim-success', params: { venueId, venueName } });
    } catch {
      setError('Network error. Please check your connection.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || isResending) return;
    setIsResending(true);
    setError(null);
    try {
      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/send-otp`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone }),
        }
      );
      if (res.ok) {
        setResendCooldown(RESEND_COOLDOWN);
        setDigits(Array(OTP_LENGTH).fill(''));
        inputRefs.current[0]?.focus();
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Could not resend. Please try again.');
      }
    } catch {
      setError('Network error.');
    } finally {
      setIsResending(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View className="flex-1 px-5">
          <View className="flex-row items-center pt-4 pb-8">
            <TouchableOpacity
              onPress={() => router.back()}
              className="w-10 h-10 items-center justify-center rounded-full bg-sandDark mr-3"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text className="text-charcoal font-bold text-base">←</Text>
            </TouchableOpacity>
            <Text className="text-xl font-extrabold text-charcoal">Enter verification code</Text>
          </View>

          <Text className="text-grey text-base leading-6 mb-8">
            We sent a 6-digit code to{' '}
            <Text className="text-charcoal font-bold">{maskPhone(phone ?? '')}</Text>
          </Text>

          <View className="flex-row justify-between mb-4">
            {digits.map((digit, i) => (
              <TextInput
                key={i}
                ref={(ref) => { inputRefs.current[i] = ref; }}
                className={`w-12 h-14 rounded-2xl text-center text-xl font-extrabold border bg-white ${
                  error ? 'border-error' : digit ? 'border-sky' : 'border-greyLighter'
                }`}
                value={digit}
                onChangeText={(text) => handleDigitChange(text, i)}
                onKeyPress={(e) => handleKeyPress(e, i)}
                keyboardType="number-pad"
                maxLength={1}
                selectTextOnFocus
              />
            ))}
          </View>

          {error && (
            <View className="bg-error/10 rounded-xl px-4 py-3 mb-4">
              <Text className="text-error text-sm font-bold">{error}</Text>
            </View>
          )}

          <Text className="text-grey text-xs text-center mb-8">Code expires in 10 minutes</Text>

          <TouchableOpacity
            className={`rounded-2xl py-4 items-center justify-center mb-6 ${
              isComplete && !isVerifying ? 'bg-sky' : 'bg-sky/40'
            }`}
            onPress={handleVerify}
            disabled={!isComplete || isVerifying}
            activeOpacity={0.8}
          >
            {isVerifying ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text className="text-white font-extrabold text-base">Verify</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleResend}
            disabled={resendCooldown > 0 || isResending}
            className="items-center py-2"
            activeOpacity={0.6}
          >
            {isResending ? (
              <ActivityIndicator color="#4ECDC4" size="small" />
            ) : resendCooldown > 0 ? (
              <Text className="text-grey text-sm">
                Resend in <Text className="text-charcoal font-bold">{resendCooldown}s</Text>
              </Text>
            ) : (
              <Text className="text-sky font-bold text-sm">Didn't receive a code? Resend</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
