/**
 * Login screen — email + password sign-in.
 *
 * Design decisions (ICO Children's Code + UK GDPR):
 *  - No location data is requested or used on this screen.
 *  - No data is collected beyond the credentials the user explicitly types.
 *  - Both "Sign in" and "Sign up" paths are equal in visual weight —
 *    no dark patterns or nudge techniques (ICO Children's Code Standard 7).
 *  - Terms and Privacy Policy are linked at the bottom so parents can read
 *    them before signing in (ICO Children's Code Standard 4 — transparency).
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';
import { migratePendingLocationConsent } from '@/services/consent/locationConsent';

// Client-side sanity check only — real validation happens on the server.
// Catches obvious typos before hitting the network.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Convert raw Supabase auth errors into safe, parent-friendly messages.
 *
 * Why: Supabase errors are written for developers. Some phrasing could confuse
 * a parent. We also must never reveal whether a specific email is registered
 * ("email enumeration" is a security risk) — so all credential errors
 * get the same neutral message. Unknown errors get a generic fallback.
 */
function getFriendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials') || m.includes('invalid email or password')) {
    return 'The email or password you entered is incorrect. Please try again.';
  }
  if (m.includes('email not confirmed')) {
    return 'Please check your inbox and confirm your email address before signing in.';
  }
  if (m.includes('too many requests') || m.includes('rate limit')) {
    return 'Too many sign-in attempts. Please wait a few minutes and try again.';
  }
  if (m.includes('network') || m.includes('fetch')) {
    return 'Could not connect. Please check your internet connection.';
  }
  return 'Something went wrong. Please try again or contact support.';
}

export default function LoginScreen() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const user = useUser();

  // Migrate any pre-auth location consent (stored locally before account creation)
  // into the database now that we have an authenticated user ID.
  useEffect(() => {
    if (user?.id) {
      migratePendingLocationConsent(user.id).catch(() => {
        // Non-blocking — migration failure must never impact the login experience.
      });
    }
  }, [user?.id]);

  async function handleLogin() {
    if (!email || !password) {
      Alert.alert('Missing details', 'Please fill in both fields.');
      return;
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      Alert.alert('Invalid email', 'Please enter a valid email address (e.g. you@example.com).');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (error) {
      // Sanitised message — never show raw Supabase error text to the user
      Alert.alert('Sign in failed', getFriendlyAuthError(error.message));
    }
    // On success, useAuthListener in _layout.tsx picks up the session and redirects automatically
  }

  /**
   * Forgot password — sends a reset link to the user's inbox.
   *
   * Security: always shows the same "check your inbox" message whether the
   * address exists or not — prevents email enumeration attacks.
   */
  async function handleForgotPassword() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      Alert.alert('Enter your email first', 'Type your email address above, then tap "Forgot password?".');
      return;
    }
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      Alert.alert('Invalid email', 'Please enter a valid email address first.');
      return;
    }
    // Do not branch on the error — same message regardless of whether the address exists
    await supabase.auth.resetPasswordForEmail(trimmedEmail);
    Alert.alert(
      'Check your inbox',
      "If an account exists for that email, we've sent a reset link. It may take a minute to arrive.",
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── Back button ───────────────────────────────────────────── */}
          <TouchableOpacity
            className="mt-4 self-start"
            style={{ paddingVertical: 10, paddingRight: 16 }}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back to the previous screen"
          >
            <Text className="text-sky text-base" style={{ fontFamily: 'Nunito-Bold' }}>
              ← Back
            </Text>
          </TouchableOpacity>

          {/* ── Heading ──────────────────────────────────────────────── */}
          <View className="mt-8 mb-8">
            <Text
              className="text-4xl text-charcoal"
              style={{ fontFamily: 'Nunito-ExtraBold' }}
              accessibilityRole="header"
            >
              Welcome back!
            </Text>
            <Text className="text-base text-grey mt-1" style={{ fontFamily: 'Nunito-Regular' }}>
              Sign in to your Play Planner account
            </Text>
          </View>

          {/* ── Input fields ─────────────────────────────────────────── */}
          <View style={{ gap: 12 }}>

            <View>
              <Text className="text-charcoal text-sm mb-1" style={{ fontFamily: 'Nunito-Medium' }}>
                Email address
              </Text>
              <TextInput
                className="bg-white border border-greyLighter rounded-xl px-4 text-charcoal text-base"
                style={{
                  height: 52,
                  fontFamily: 'Nunito-Regular',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.04,
                  shadowRadius: 3,
                  elevation: 1,
                }}
                placeholder="you@example.com"
                placeholderTextColor="#B2BEC3"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                returnKeyType="next"
                value={email}
                onChangeText={setEmail}
                accessibilityLabel="Email address"
              />
            </View>

            <View>
              <Text className="text-charcoal text-sm mb-1" style={{ fontFamily: 'Nunito-Medium' }}>
                Password
              </Text>
              <TextInput
                className="bg-white border border-greyLighter rounded-xl px-4 text-charcoal text-base"
                style={{
                  height: 52,
                  fontFamily: 'Nunito-Regular',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.04,
                  shadowRadius: 3,
                  elevation: 1,
                }}
                placeholder="Your password"
                placeholderTextColor="#B2BEC3"
                secureTextEntry
                autoComplete="password"
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                value={password}
                onChangeText={setPassword}
                accessibilityLabel="Password"
              />
            </View>

            {/* Forgot password — anti-enumeration: always same response */}
            <TouchableOpacity
              className="self-end"
              style={{ paddingVertical: 8, paddingLeft: 16 }}
              onPress={handleForgotPassword}
              accessibilityRole="button"
              accessibilityLabel="Forgot your password — tap to receive a reset link"
            >
              <Text className="text-grey text-sm" style={{ fontFamily: 'Nunito-Medium' }}>
                Forgot password?
              </Text>
            </TouchableOpacity>

          </View>

          {/* ── Primary CTA ───────────────────────────────────────────── */}
          <TouchableOpacity
            className="w-full bg-sky rounded-2xl items-center justify-center mt-6"
            style={{
              height: 52,
              shadowColor: '#4ECDC4',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.30,
              shadowRadius: 8,
              elevation: 4,
            }}
            onPress={handleLogin}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Sign in to your account"
            accessibilityState={{ disabled: loading }}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text className="text-white text-lg" style={{ fontFamily: 'Nunito-Bold' }}>Sign in</Text>
            }
          </TouchableOpacity>

          {/* ── Switch to register ────────────────────────────────────── */}
          <TouchableOpacity
            className="mt-5 items-center"
            style={{ paddingVertical: 10 }}
            onPress={() => router.push('/(auth)/register')}
            accessibilityRole="button"
            accessibilityLabel="Go to the Create Account screen"
          >
            <Text className="text-grey text-base" style={{ fontFamily: 'Nunito-Regular' }}>
              Don't have an account?{' '}
              <Text className="text-sky" style={{ fontFamily: 'Nunito-Bold' }}>Sign up free</Text>
            </Text>
          </TouchableOpacity>

          {/* ── Privacy reminder strip (ICO Standard 4 — transparency) ── */}
          <View
            className="flex-row items-start bg-mint rounded-2xl px-4 py-3 mt-6"
            style={{ gap: 10 }}
          >
            <Text style={{ fontSize: 18, marginTop: 1 }} accessible={false} importantForAccessibility="no-hide-descendants">
              🔒
            </Text>
            <Text className="text-charcoal text-sm flex-1" style={{ fontFamily: 'Nunito-Regular' }}>
              <Text style={{ fontFamily: 'Nunito-Bold' }}>Your privacy matters. </Text>
              Location is <Text style={{ fontFamily: 'Nunito-Bold' }}>off by default</Text>. We never sell your data.
            </Text>
          </View>

          {/* ── Legal footer ─────────────────────────────────────────── */}
          <Text className="text-grey text-xs text-center mt-5" style={{ fontFamily: 'Nunito-Regular' }}>
            By signing in you agree to our{' '}
            <Text
              className="underline"
              style={{ fontFamily: 'Nunito-Bold', color: '#636E72' }}
              onPress={() => router.push('/(auth)/terms')}
              accessibilityRole="link"
            >
              Terms of Service
            </Text>
            {' '}and{' '}
            <Text
              className="underline"
              style={{ fontFamily: 'Nunito-Bold', color: '#636E72' }}
              onPress={() => router.push('/(auth)/privacy')}
              accessibilityRole="link"
            >
              Privacy Policy
            </Text>
            .
          </Text>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
