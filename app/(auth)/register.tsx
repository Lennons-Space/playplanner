/**
 * Register screen — create a new parent account.
 *
 * Design decisions (ICO Children's Code + UK GDPR):
 *  - Minimum data collection: name, email, password only (data minimisation,
 *    UK GDPR Art.5(1)(c)).
 *  - Marketing consent is opt-in, not pre-ticked (UK GDPR Art.7; ICO Standard 7).
 *  - Terms checkbox must be actively ticked before the button works —
 *    valid, unambiguous consent (UK GDPR Art.7).
 *  - Age affirmation checkbox must be actively ticked before the button works —
 *    ICO Children's Code Standard 4 (age assurance). Low-friction approach: a
 *    checkbox declaration that the user is 18+ or a parent/guardian. The timestamp
 *    of acceptance is recorded in profiles.terms_accepted_at (same timestamp as
 *    terms acceptance — both declarations are made simultaneously at signup).
 *    The act of submitting after checking the box is the consent record.
 *  - Terms and Privacy Policy links are visible and tappable before submit —
 *    ICO Children's Code Standard 4 (transparency).
 *  - No urgency language, no dark patterns (ICO Children's Code Standard 7).
 *  - Consent timestamp is written to profiles.terms_accepted_at and an audit
 *    log entry is created for GDPR Art.5(2) accountability.
 *
 * Visual: PlayPlanner v3 style — Bricolage display heading, Hanken body, Ocean
 * accent (no teal), warm cream + ambient weather wash, soft paper cards/inputs.
 * Auth + consent LOGIC is unchanged from the previous version.
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
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { writeAuditLog } from '@/services/audit/gdprAuditLog';
import { migratePendingLocationConsent } from '@/services/consent/locationConsent';
import { Themes, ocean, FontFamily } from '@/constants/theme';
import { WeatherBackground } from '@/components/weather/WeatherBackground';

const t = Themes.dark;

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

// Checkbox box style — checked uses the Ocean accent (no teal).
function checkboxBox(checked: boolean): ViewStyle {
  return {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    backgroundColor: checked ? ocean.accent : t.surface,
    borderColor: checked ? ocean.accent : t.separator,
  };
}

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
  // ICO Children's Code Standard 4: explicit age affirmation — must be ticked
  // before the account can be created. Not pre-ticked per UK GDPR Art.7.
  const [ageAffirmed, setAgeAffirmed]     = useState(false);
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

  const canSubmit = termsAccepted && ageAffirmed && !loading;

  return (
    <View style={{ flex: 1, backgroundColor: t.warm }}>
      {/* Immersive dark weather wash — matches the dark tabs, decorative only. */}
      <WeatherBackground mode="immersive" paletteMode="dark" />
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
                Create account
              </Text>
              <Text style={{ fontFamily: FontFamily.body, fontSize: 15, color: t.label3, marginTop: 6 }}>
                Join thousands of parents discovering great places
              </Text>
            </View>

            {/* ── Input fields ─────────────────────────────────────────── */}
            <View style={{ gap: 14 }}>
              <View>
                <Text style={labelStyle}>Your name</Text>
                <TextInput
                  style={inputStyle}
                  placeholder="e.g. Sarah"
                  placeholderTextColor={t.label3}
                  autoComplete="name"
                  autoCorrect={false}
                  returnKeyType="next"
                  value={fullName}
                  onChangeText={setFullName}
                  accessibilityLabel="Your name"
                />
              </View>

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
                  placeholder="8+ characters, no spaces"
                  placeholderTextColor={t.label3}
                  secureTextEntry
                  returnKeyType="done"
                  value={password}
                  onChangeText={setPassword}
                  accessibilityLabel="Password — must be at least 8 characters, no spaces"
                />
                {/* Non-blocking strength hint — informational only, never blocks submission */}
                {passwordStrength.label !== '' && (
                  <Text
                    style={{ color: passwordStrength.color, fontFamily: FontFamily.bodyStrong, fontSize: 12, marginTop: 5, marginLeft: 4 }}
                  >
                    Password strength: {passwordStrength.label}
                  </Text>
                )}
              </View>

              {/* ── Consent section ──────────────────────────────────────── */}
              {/* Soft paper card so checkboxes visually stand apart from the form
                  fields — harder for parents to accidentally skip them. */}
              <View
                style={{
                  backgroundColor: t.surface2,
                  borderWidth: 1,
                  borderColor: t.separator,
                  borderRadius: 18,
                  paddingHorizontal: 16,
                  paddingVertical: 16,
                  marginTop: 2,
                  gap: 14,
                }}
              >
                {/* Marketing consent — GDPR opt-in, not pre-checked */}
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
                  onPress={() => setMarketing(!marketing)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: marketing }}
                  accessibilityLabel="Optional: receive tips and venue recommendations by email"
                >
                  <View style={checkboxBox(marketing)}>
                    {marketing && (
                      <Text style={{ color: '#FFFFFF', fontSize: 13, fontFamily: FontFamily.bodyStrong, lineHeight: 16 }}>✓</Text>
                    )}
                  </View>
                  <Text style={{ fontFamily: FontFamily.body, fontSize: 14, color: t.label2, flex: 1, lineHeight: 19 }}>
                    I'd like to receive tips and venue recommendations by email{' '}
                    <Text style={{ fontFamily: FontFamily.bodyStrong }}>(optional)</Text>
                  </Text>
                </TouchableOpacity>

                <View style={{ borderTopWidth: 1, borderTopColor: t.separator }} />

                {/* ICO Children's Code Standard 4: age affirmation — must be a positive opt-in */}
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}
                  onPress={() => setAgeAffirmed(!ageAffirmed)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: ageAffirmed }}
                  accessibilityLabel={
                    ageAffirmed
                      ? 'Age confirmed — tap to uncheck'
                      : 'Tap to confirm you are 18 or over, or a parent or guardian'
                  }
                >
                  <View style={[checkboxBox(ageAffirmed), { marginTop: 1 }]}>
                    {ageAffirmed && (
                      <Text style={{ color: '#FFFFFF', fontSize: 13, fontFamily: FontFamily.bodyStrong, lineHeight: 16 }}>✓</Text>
                    )}
                  </View>
                  <Text style={{ fontFamily: FontFamily.body, fontSize: 14, color: t.label2, flex: 1, lineHeight: 19 }}>
                    I confirm I am 18 or over, or I am a parent/guardian using PlayPlanner for my family.
                  </Text>
                </TouchableOpacity>

                <View style={{ borderTopWidth: 1, borderTopColor: t.separator }} />

                {/* UK GDPR Art.7: explicit, unambiguous consent — must be a positive opt-in */}
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}
                  onPress={() => setTermsAccepted(!termsAccepted)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: termsAccepted }}
                  accessibilityLabel={
                    termsAccepted
                      ? 'Terms accepted — tap to withdraw consent'
                      : 'Tap to accept the Terms of Service and Privacy Policy'
                  }
                >
                  <View style={[checkboxBox(termsAccepted), { marginTop: 1 }]}>
                    {termsAccepted && (
                      <Text style={{ color: '#FFFFFF', fontSize: 13, fontFamily: FontFamily.bodyStrong, lineHeight: 16 }}>✓</Text>
                    )}
                  </View>
                  <Text style={{ fontFamily: FontFamily.body, fontSize: 14, color: t.label2, flex: 1, lineHeight: 19 }}>
                    I have read and accept the{' '}
                    <Text
                      style={{ fontFamily: FontFamily.bodyStrong, color: ocean.accent }}
                      onPress={() => router.push('/(auth)/terms')}
                      accessibilityRole="link"
                    >
                      Terms of Service
                    </Text>
                    {' '}and{' '}
                    <Text
                      style={{ fontFamily: FontFamily.bodyStrong, color: ocean.accent }}
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
            {/*
              Disabled until BOTH consent checkboxes are ticked:
              - termsAccepted: UK GDPR Art.7 terms & privacy policy consent
              - ageAffirmed: ICO Children's Code Standard 4 age affirmation
              This enforces the ICO requirement at the UI level — the user cannot
              submit without actively affirming both. Opacity communicates state.
            */}
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
                opacity: canSubmit ? 1 : 0.45,
              }}
              onPress={handleRegister}
              disabled={!termsAccepted || !ageAffirmed || loading}
              accessibilityRole="button"
              accessibilityLabel="Create your Play Planner account"
              accessibilityState={{ disabled: !termsAccepted || !ageAffirmed || loading }}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={{ fontFamily: FontFamily.bodyStrong, fontSize: 17, color: '#FFFFFF' }}>Create account</Text>
              }
            </TouchableOpacity>

            {/* ── Switch to login ───────────────────────────────────────── */}
            <TouchableOpacity
              style={{ marginTop: 20, alignItems: 'center', paddingVertical: 10 }}
              onPress={() => router.push('/(auth)/login')}
              accessibilityRole="button"
            >
              <Text style={{ fontFamily: FontFamily.body, fontSize: 15, color: t.label3 }}>
                Already have an account?{' '}
                <Text style={{ fontFamily: FontFamily.bodyStrong, color: ocean.accent }}>Sign in</Text>
              </Text>
            </TouchableOpacity>

            {/* ── Data minimisation notice (GDPR Art.5(1)(c) + ICO Standard 4) ── */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 10,
                backgroundColor: t.surface2,
                borderWidth: 1,
                borderColor: t.separator,
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
                <Text style={{ fontFamily: FontFamily.bodyStrong }}>We only ask for what we need. </Text>
                No phone number, no address, no payment details at sign-up.
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
