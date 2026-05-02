/**
 * Register screen — create a new parent account.
 *
 * Design decisions (ICO Children's Code + UK GDPR):
 *  - Minimum data collection: name, email, password only (data minimisation,
 *    UK GDPR Art.5(1)(c)).
 *  - Marketing consent is opt-in, not pre-ticked (UK GDPR Art.7; ICO Standard 7).
 *  - Terms checkbox must be actively ticked before the button works —
 *    valid, unambiguous consent (UK GDPR Art.7).
 *  - Terms and Privacy Policy links are visible and tappable before submit —
 *    ICO Children's Code Standard 4 (transparency).
 *  - No urgency language, no dark patterns (ICO Children's Code Standard 7).
 *  - Consent timestamp is written to profiles.terms_accepted_at and an audit
 *    log entry is created for GDPR Art.5(2) accountability.
 */

import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { writeAuditLog } from '@/services/audit/gdprAuditLog';
import { migratePendingLocationConsent } from '@/services/consent/locationConsent';

// Client-side sanity check — catches obvious typos before hitting the network
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Convert raw Supabase signup errors into safe, user-friendly messages.
 * Never reveal whether a specific email address is already registered
 * (email enumeration is an account-discovery attack vector).
 */
function getFriendlySignUpError(message: string): string {
  const m = message.toLowerCase();
  if (
    m.includes('already registered') ||
    m.includes('already exists') ||
    m.includes('email address is already') ||
    m.includes('user already registered')
  ) {
    return 'Something went wrong. Please try again or sign in instead.';
  }
  if (m.includes('network') || m.includes('fetch')) {
    return 'Could not connect. Please check your internet connection.';
  }
  if (m.includes('password') && m.includes('weak')) {
    return 'Please choose a stronger password.';
  }
  return 'Sign up failed. Please check your details and try again.';
}

/**
 * Simple password strength scorer (0–4).
 * Informational only — never blocks submission. Rewards length, uppercase,
 * numbers, and special characters.
 */
function getPasswordStrength(pwd: string): { label: string; color: string } {
  if (pwd.length === 0) return { label: '', color: '' };
  let score = 0;
  if (pwd.length >= 10)          score++;
  if (/[A-Z]/.test(pwd))         score++;
  if (/[0-9]/.test(pwd))         score++;
  if (/[^A-Za-z0-9]/.test(pwd))  score++;
  if (score <= 1) return { label: 'Weak',   color: '#D63031' };
  if (score === 2) return { label: 'Fair',   color: '#E67E22' };
  if (score === 3) return { label: 'Good',   color: '#2ECC71' };
  return                  { label: 'Strong', color: '#27AE60' };
}

export default function RegisterScreen() {
  const [fullName, setFullName]           = useState('');
  const [email, setEmail]                 = useState('');
  const [password, setPassword]           = useState('');
  const [marketing, setMarketing]         = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading]             = useState(false);

  // Rate-limit guard: prevents rapid double-taps firing multiple signUp calls.
  // useRef (not useState) because changing it must not trigger a re-render.
  const submitLocked = useRef(false);

  const passwordStrength = getPasswordStrength(password);

  async function handleRegister() {
    // Synchronous lock — ignore taps if a submission is already in flight
    if (submitLocked.current) return;

    if (!fullName || !email || !password) {
      Alert.alert('Missing details', 'Please fill in all fields.');
      return;
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      Alert.alert('Invalid email', 'Please enter a valid email address (e.g. you@example.com).');
      return;
    }
    // Passwords with spaces cause silent failures on some backends
    if (password.includes(' ')) {
      Alert.alert('Invalid password', 'Your password cannot contain spaces.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Password too short', 'Password must be at least 8 characters.');
      return;
    }
    if (!termsAccepted) {
      Alert.alert('Terms required', 'Please accept the Terms of Service and Privacy Policy to continue.');
      return;
    }

    submitLocked.current = true;
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            marketing_consent: marketing,
          },
        },
      });

      if (error) {
        Alert.alert('Sign up failed', getFriendlySignUpError(error.message));
        return;
      }

      if (data.user?.id) {
        const consentTimestamp = new Date().toISOString();

        // UK GDPR Art.7: record the exact moment the user accepted Terms of Service
        const { error: consentError } = await supabase
          .from('profiles')
          .update({ terms_accepted_at: consentTimestamp })
          .eq('id', data.user.id);

        if (consentError) {
          // Log but do NOT block registration — the user already signed up successfully
          console.error('Failed to record terms consent timestamp:', consentError);
        }

        // GDPR Art.5(2) accountability: write an audit log entry.
        // In try/catch so a broken audit log never crashes the registration flow.
        try {
          await writeAuditLog(data.user.id, 'terms_accepted', 'profiles', data.user.id);
        } catch (auditError) {
          console.error('Audit log write failed (non-blocking):', auditError);
        }

        // Migrate any pre-auth location consent stored locally before account creation.
        // useAuthListener handles this on SIGNED_IN, but the session may not fire
        // until after email confirmation — we do it here too as a belt-and-braces.
        try {
          await migratePendingLocationConsent(data.user.id);
        } catch {
          // Non-blocking — migration will be retried on next login.
        }
      }

      // data.session is null here — email confirmation is required before the user is active
      Alert.alert(
        'Almost there!',
        'We sent a confirmation email — click the link in it to activate your account.',
        [{ text: 'OK', onPress: () => router.replace('/(auth)/login') }]
      );
    } catch {
      // Handles unexpected throws (e.g. network errors) that bypass the { data, error }
      // pattern. Without this, setLoading and submitLocked are never reset, permanently
      // disabling the form for the rest of the session.
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      // Always release the lock and loading state — whether the call succeeded,
      // returned a Supabase error, or threw an exception.
      setLoading(false);
      submitLocked.current = false;
    }
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
              Create account
            </Text>
            <Text className="text-base text-grey mt-1" style={{ fontFamily: 'Nunito-Regular' }}>
              Join thousands of parents discovering great places
            </Text>
          </View>

          {/* ── Input fields ─────────────────────────────────────────── */}
          <View style={{ gap: 12 }}>

            <View>
              <Text className="text-charcoal text-sm mb-1" style={{ fontFamily: 'Nunito-Medium' }}>
                Your name
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
                placeholder="e.g. Sarah"
                placeholderTextColor="#B2BEC3"
                autoComplete="name"
                autoCorrect={false}
                returnKeyType="next"
                value={fullName}
                onChangeText={setFullName}
                accessibilityLabel="Your name"
              />
            </View>

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
                placeholder="8+ characters, no spaces"
                placeholderTextColor="#B2BEC3"
                secureTextEntry
                returnKeyType="done"
                value={password}
                onChangeText={setPassword}
                accessibilityLabel="Password — must be at least 8 characters, no spaces"
              />
              {/* Non-blocking strength hint — informational only, never blocks submission */}
              {passwordStrength.label !== '' && (
                <Text
                  className="text-xs mt-1 ml-1"
                  style={{ color: passwordStrength.color, fontFamily: 'Nunito-Medium' }}
                >
                  Password strength: {passwordStrength.label}
                </Text>
              )}
            </View>

            {/* ── Consent section ──────────────────────────────────────── */}
            {/*
              Wrapped in a sandDark card so checkboxes visually stand apart
              from form fields — harder for parents to accidentally skip them.
            */}
            <View className="bg-sandDark rounded-2xl px-4 py-4 mt-2" style={{ gap: 14 }}>

              {/* Marketing consent — GDPR opt-in, not pre-checked */}
              <TouchableOpacity
                className="flex-row items-center"
                style={{ gap: 12 }}
                onPress={() => setMarketing(!marketing)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: marketing }}
                accessibilityLabel="Optional: receive tips and venue recommendations by email"
              >
                <View
                  className={`rounded border-2 items-center justify-center flex-shrink-0 ${
                    marketing ? 'bg-sky border-sky' : 'bg-white border-greyLighter'
                  }`}
                  style={{ width: 24, height: 24 }}
                >
                  {marketing && (
                    <Text className="text-white" style={{ fontSize: 13, fontFamily: 'Nunito-Bold', lineHeight: 16 }}>
                      ✓
                    </Text>
                  )}
                </View>
                <Text className="text-grey text-sm flex-1" style={{ fontFamily: 'Nunito-Regular' }}>
                  I'd like to receive tips and venue recommendations by email{' '}
                  <Text style={{ fontFamily: 'Nunito-Medium' }}>(optional)</Text>
                </Text>
              </TouchableOpacity>

              <View className="border-t border-greyLighter" />

              {/* UK GDPR Art.7: explicit, unambiguous consent — must be a positive opt-in */}
              <TouchableOpacity
                className="flex-row items-start"
                style={{ gap: 12 }}
                onPress={() => setTermsAccepted(!termsAccepted)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: termsAccepted }}
                accessibilityLabel={
                  termsAccepted
                    ? 'Terms accepted — tap to withdraw consent'
                    : 'Tap to accept the Terms of Service and Privacy Policy'
                }
              >
                <View
                  className={`rounded border-2 items-center justify-center flex-shrink-0 ${
                    termsAccepted ? 'bg-sky border-sky' : 'bg-white border-greyLighter'
                  }`}
                  style={{ width: 24, height: 24, marginTop: 1 }}
                >
                  {termsAccepted && (
                    <Text className="text-white" style={{ fontSize: 13, fontFamily: 'Nunito-Bold', lineHeight: 16 }}>
                      ✓
                    </Text>
                  )}
                </View>
                <Text className="text-grey text-sm flex-1" style={{ fontFamily: 'Nunito-Regular' }}>
                  I have read and accept the{' '}
                  <Text
                    className="text-sky"
                    style={{ fontFamily: 'Nunito-Bold' }}
                    onPress={() => router.push('/(auth)/terms')}
                    accessibilityRole="link"
                  >
                    Terms of Service
                  </Text>
                  {' '}and{' '}
                  <Text
                    className="text-sky"
                    style={{ fontFamily: 'Nunito-Bold' }}
                    onPress={() => router.push('/(auth)/privacy')}
                    accessibilityRole="link"
                  >
                    Privacy Policy
                  </Text>
                  . We will never share your data without your consent.
                </Text>
              </TouchableOpacity>

            </View>

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
            onPress={handleRegister}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Create your Play Planner account"
            accessibilityState={{ disabled: loading }}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text className="text-white text-lg" style={{ fontFamily: 'Nunito-Bold' }}>Create account</Text>
            }
          </TouchableOpacity>

          {/* ── Switch to login ───────────────────────────────────────── */}
          <TouchableOpacity
            className="mt-5 items-center"
            style={{ paddingVertical: 10 }}
            onPress={() => router.push('/(auth)/login')}
            accessibilityRole="button"
          >
            <Text className="text-grey text-base" style={{ fontFamily: 'Nunito-Regular' }}>
              Already have an account?{' '}
              <Text className="text-sky" style={{ fontFamily: 'Nunito-Bold' }}>Sign in</Text>
            </Text>
          </TouchableOpacity>

          {/* ── Data minimisation notice (GDPR Art.5(1)(c) + ICO Standard 4) ── */}
          <View
            className="flex-row items-start bg-mint rounded-2xl px-4 py-3 mt-6"
            style={{ gap: 10 }}
          >
            <Text style={{ fontSize: 18, marginTop: 1 }} accessible={false} importantForAccessibility="no-hide-descendants">
              🔒
            </Text>
            <Text className="text-charcoal text-sm flex-1" style={{ fontFamily: 'Nunito-Regular' }}>
              <Text style={{ fontFamily: 'Nunito-Bold' }}>We only ask for what we need. </Text>
              No phone number, no address, no payment details at sign-up.
            </Text>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
