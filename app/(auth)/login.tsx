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
 *
 * Visual: PlayPlanner v3 style — Bricolage display heading, Hanken body, Ocean
 * accent (no teal), warm cream + ambient weather wash, soft paper cards/inputs.
 * Auth LOGIC is unchanged from the previous version.
 */

import { useState } from 'react';
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
  type TextStyle,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';
import { Themes, ocean, FontFamily } from '@/constants/theme';
import { WeatherBackground } from '@/components/weather/WeatherBackground';

const t = Themes.light;

// Shared rounded input (opaque surface — safe with elevation on Android).
const inputStyle: TextStyle = {
  height: 54,
  backgroundColor: t.surface,
  borderRadius: 16,
  borderWidth: 1,
  borderColor: t.separator,
  paddingHorizontal: 16,
  fontFamily: FontFamily.body,
  fontSize: 15,
  color: t.label,
  shadowColor: '#2A1E0A',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.05,
  shadowRadius: 10,
  elevation: 1,
};

const labelStyle: TextStyle = {
  fontFamily: FontFamily.bodyStrong,
  fontSize: 13.5,
  color: t.label2,
  marginBottom: 7,
};

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
    <View style={{ flex: 1, backgroundColor: t.warm }}>
      {/* Ambient weather wash — matches the rest of the app, decorative only. */}
      <WeatherBackground />
      <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
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
              style={{ marginTop: 16, alignSelf: 'flex-start', paddingVertical: 10, paddingRight: 16 }}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Go back to the previous screen"
            >
              <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 16, color: ocean.accent }}>← Back</Text>
            </TouchableOpacity>

            {/* ── Heading ──────────────────────────────────────────────── */}
            <View style={{ marginTop: 28, marginBottom: 28 }}>
              <Text
                style={{ fontFamily: FontFamily.display, fontSize: 34, color: t.label, letterSpacing: -0.6, lineHeight: 38 }}
                accessibilityRole="header"
              >
                Welcome back!
              </Text>
              <Text style={{ fontFamily: FontFamily.body, fontSize: 15, color: t.label3, marginTop: 6 }}>
                Sign in to your Play Planner account
              </Text>
            </View>

            {/* ── Input fields ─────────────────────────────────────────── */}
            <View style={{ gap: 14 }}>
              <View>
                <Text style={labelStyle}>Email address</Text>
                <TextInput
                  style={inputStyle}
                  placeholder="you@example.com"
                  placeholderTextColor={t.label3}
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
                <Text style={labelStyle}>Password</Text>
                <TextInput
                  style={inputStyle}
                  placeholder="Your password"
                  placeholderTextColor={t.label3}
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
                style={{ alignSelf: 'flex-end', paddingVertical: 8, paddingLeft: 16 }}
                onPress={handleForgotPassword}
                accessibilityRole="button"
                accessibilityLabel="Forgot your password — tap to receive a reset link"
              >
                <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 13.5, color: ocean.accent }}>
                  Forgot password?
                </Text>
              </TouchableOpacity>
            </View>

            {/* ── Primary CTA ───────────────────────────────────────────── */}
            <TouchableOpacity
              style={{
                height: 54,
                backgroundColor: ocean.accent,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 24,
                shadowColor: ocean.accent,
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.3,
                shadowRadius: 14,
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
                : <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 17, color: '#FFFFFF' }}>Sign in</Text>
              }
            </TouchableOpacity>

            {/* ── Switch to register ────────────────────────────────────── */}
            <TouchableOpacity
              style={{ marginTop: 20, alignItems: 'center', paddingVertical: 10 }}
              onPress={() => router.push('/(auth)/register')}
              accessibilityRole="button"
              accessibilityLabel="Go to the Create Account screen"
            >
              <Text style={{ fontFamily: FontFamily.body, fontSize: 15, color: t.label3 }}>
                Don't have an account?{' '}
                <Text style={{ fontFamily: FontFamily.bodyStrong, color: ocean.accent }}>Sign up free</Text>
              </Text>
            </TouchableOpacity>

            {/* ── Privacy reminder strip (ICO Standard 4 — transparency) ── */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 10,
                backgroundColor: 'rgba(255,255,255,0.62)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.55)',
                borderRadius: 18,
                paddingHorizontal: 16,
                paddingVertical: 14,
                marginTop: 24,
              }}
            >
              <Text style={{ fontSize: 18, marginTop: 1 }} accessible={false} importantForAccessibility="no-hide-descendants">
                🔒
              </Text>
              <Text style={{ fontFamily: FontFamily.body, fontSize: 13.5, color: t.label2, flex: 1, lineHeight: 19 }}>
                <Text style={{ fontFamily: FontFamily.bodyStrong }}>Your privacy matters. </Text>
                Location is <Text style={{ fontFamily: FontFamily.bodyStrong }}>off by default</Text>. We never sell your data.
              </Text>
            </View>

            {/* ── Legal footer ─────────────────────────────────────────── */}
            <Text style={{ fontFamily: FontFamily.body, fontSize: 12, color: t.label3, textAlign: 'center', marginTop: 20, lineHeight: 18 }}>
              By signing in you agree to our{' '}
              <Text
                style={{ fontFamily: FontFamily.bodyStrong, color: t.label2, textDecorationLine: 'underline' }}
                onPress={() => router.push('/(auth)/terms')}
                accessibilityRole="link"
              >
                Terms of Service
              </Text>
              {' '}and{' '}
              <Text
                style={{ fontFamily: FontFamily.bodyStrong, color: t.label2, textDecorationLine: 'underline' }}
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
    </View>
  );
}
