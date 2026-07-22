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
 * v2 dark restyle (Step 6, feat/exact-v2-design): VISUAL LAYER ONLY. Every
 * field, password rules/validation, the 3 consent controls (marketing
 * opt-in NOT pre-ticked; age-affirmation checkbox; terms checkbox; the
 * `canSubmit` gate requiring BOTH required boxes), the signUp call +
 * marketing_consent metadata, terms_accepted_at profile update,
 * writeAuditLog, migratePendingLocationConsent, submitLocked duplicate-
 * submit guard, the post-signup "Almost there!" confirmation Alert →
 * router.replace('/(auth)/login'), and all error/finally handling are
 * byte-identical to the pre-restyle version. Only the JSX/styling changed:
 * the legacy warm-cream ambient weather wash component is gone,
 * <V2Background/> mounted per the frozen background architecture (see
 * app/(tabs)/profile.tsx), dark inputs, the consent card restyled as a v2
 * glass card, and a password-visibility toggle added (purely presentational).
 */

import { useState, useRef, useMemo } from 'react';
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
  StyleSheet,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '@/lib/supabase';
import { writeAuditLog } from '@/services/audit/gdprAuditLog';
import { migratePendingLocationConsent } from '@/services/consent/locationConsent';
import { Icon } from '@/components/ui/Icon';
import { ThemedBackground } from '@/components/ui/ThemedBackground';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { FontFamily, ocean, type ThemeTokens } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';

const ACCENT = ocean;

function createInputStyle(T: ThemeTokens): TextStyle {
  return {
    height: 54,
    backgroundColor: T.bg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: T.separator,
    paddingHorizontal: 16,
    fontFamily: FontFamily.body,
    fontSize: 15,
    color: T.label,
  };
}

function createLabelStyle(T: ThemeTokens): TextStyle {
  return {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13.5,
    color: T.label2,
    marginBottom: 7,
  };
}

// Checkbox box style — checked uses the Ocean accent (no teal) in BOTH modes.
function checkboxBox(checked: boolean, T: ThemeTokens): ViewStyle {
  return {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    backgroundColor: checked ? ACCENT.accent : T.bg,
    borderColor: checked ? ACCENT.accent : T.separator,
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
  if (score <= 1) return { label: 'Weak',   color: '#FF3B30' };
  if (score === 2) return { label: 'Fair',   color: '#FFB23E' };
  if (score === 3) return { label: 'Good',   color: '#34C77B' };
  return                  { label: 'Strong', color: '#34C77B' };
}

export default function RegisterScreen() {
  const { tokens: T, mode } = useAppTheme();
  const styles = useMemo(() => createStyles(T), [T]);
  const inputStyle = useMemo(() => createInputStyle(T), [T]);
  const labelStyle = useMemo(() => createLabelStyle(T), [T]);
  const statusBarStyle = mode === 'dark' ? 'light' : 'dark';
  const cardTint = mode === 'dark' ? 'rgba(14,14,20,0.5)' : 'rgba(255,255,255,0.5)';
  const [fullName, setFullName]           = useState('');
  const [email, setEmail]                 = useState('');
  const [password, setPassword]           = useState('');
  const [showPassword, setShowPassword]   = useState(false);
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
    <View style={styles.root}>
      <ThemedBackground />
      <StatusBar style={statusBarStyle} />
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Back button ───────────────────────────────────────────── */}
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Go back to the previous screen"
            >
              <Icon name="chevL" size={16} color={ACCENT.accent} />
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>

            {/* ── Heading ──────────────────────────────────────────────── */}
            <View style={styles.headingBlock}>
              <Text style={styles.headline} accessibilityRole="header">
                Create account
              </Text>
              <Text style={styles.subtitle}>
                Join thousands of parents discovering great places
              </Text>
            </View>

            {/* ── Input fields ─────────────────────────────────────────── */}
            <View style={styles.fieldGroup}>
              <View>
                <Text style={labelStyle}>Your name</Text>
                <TextInput
                  style={inputStyle}
                  placeholder="e.g. Sarah"
                  placeholderTextColor={T.label4}
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
                  placeholderTextColor={T.label4}
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
                <View style={styles.passwordWrap}>
                  <TextInput
                    style={[inputStyle, styles.passwordInput]}
                    placeholder="8+ characters, no spaces"
                    placeholderTextColor={T.label4}
                    secureTextEntry={!showPassword}
                    returnKeyType="done"
                    value={password}
                    onChangeText={setPassword}
                    accessibilityLabel="Password — must be at least 8 characters, no spaces"
                  />
                  <TouchableOpacity
                    style={styles.eyeBtn}
                    onPress={() => setShowPassword((v) => !v)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                    accessibilityState={{ selected: showPassword }}
                  >
                    <Icon name={showPassword ? 'eyeOff' : 'eye'} size={19} color={T.label3} />
                  </TouchableOpacity>
                </View>
                {/* Non-blocking strength hint — informational only, never blocks submission */}
                {passwordStrength.label !== '' && (
                  <Text
                    style={[styles.strengthText, { color: passwordStrength.color }]}
                  >
                    Password strength: {passwordStrength.label}
                  </Text>
                )}
              </View>

              {/* ── Consent section ──────────────────────────────────────── */}
              {/* Dark glass card so checkboxes visually stand apart from the
                  form fields — harder for parents to accidentally skip them. */}
              <GlassSurface style={styles.consentCard} tintColor={cardTint}>
                {/* Marketing consent — GDPR opt-in, not pre-checked */}
                <TouchableOpacity
                  style={styles.checkRow}
                  onPress={() => setMarketing(!marketing)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: marketing }}
                  accessibilityLabel="Optional: receive tips and venue recommendations by email"
                >
                  <View style={checkboxBox(marketing, T)}>
                    {marketing && (
                      <Text style={styles.checkMark}>✓</Text>
                    )}
                  </View>
                  <Text style={styles.checkLabel}>
                    I'd like to receive tips and venue recommendations by email{' '}
                    <Text style={styles.checkLabelStrong}>(optional)</Text>
                  </Text>
                </TouchableOpacity>

                <View style={styles.divider} />

                {/* ICO Children's Code Standard 4: age affirmation — must be a positive opt-in */}
                <TouchableOpacity
                  style={styles.checkRow}
                  onPress={() => setAgeAffirmed(!ageAffirmed)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: ageAffirmed }}
                  accessibilityLabel={
                    ageAffirmed
                      ? 'Age confirmed — tap to uncheck'
                      : 'Tap to confirm you are 18 or over, or a parent or guardian'
                  }
                >
                  <View style={[checkboxBox(ageAffirmed, T), styles.checkBoxTopAlign]}>
                    {ageAffirmed && (
                      <Text style={styles.checkMark}>✓</Text>
                    )}
                  </View>
                  <Text style={styles.checkLabel}>
                    I confirm I am 18 or over, or I am a parent/guardian using PlayPlanner for my family.
                  </Text>
                </TouchableOpacity>

                <View style={styles.divider} />

                {/* UK GDPR Art.7: explicit, unambiguous consent — must be a positive opt-in */}
                <TouchableOpacity
                  style={styles.checkRow}
                  onPress={() => setTermsAccepted(!termsAccepted)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: termsAccepted }}
                  accessibilityLabel={
                    termsAccepted
                      ? 'Terms accepted — tap to withdraw consent'
                      : 'Tap to accept the Terms of Service and Privacy Policy'
                  }
                >
                  <View style={[checkboxBox(termsAccepted, T), styles.checkBoxTopAlign]}>
                    {termsAccepted && (
                      <Text style={styles.checkMark}>✓</Text>
                    )}
                  </View>
                  <Text style={styles.checkLabel}>
                    I have read and accept the{' '}
                    <Text
                      style={styles.checkLabelLink}
                      onPress={() => router.push('/(auth)/terms')}
                      accessibilityRole="link"
                    >
                      Terms of Service
                    </Text>
                    {' '}and{' '}
                    <Text
                      style={styles.checkLabelLink}
                      onPress={() => router.push('/(auth)/privacy')}
                      accessibilityRole="link"
                    >
                      Privacy Policy
                    </Text>
                    . We will never share your data without your consent.
                  </Text>
                </TouchableOpacity>
              </GlassSurface>
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
              style={[styles.primaryBtn, !canSubmit && styles.primaryBtnDisabled]}
              onPress={handleRegister}
              disabled={!termsAccepted || !ageAffirmed || loading}
              accessibilityRole="button"
              accessibilityLabel="Create your Play Planner account"
              accessibilityState={{ disabled: !termsAccepted || !ageAffirmed || loading }}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.primaryBtnText}>Create account</Text>
              }
            </TouchableOpacity>

            {/* ── Switch to login ───────────────────────────────────────── */}
            <TouchableOpacity
              style={styles.switchBtn}
              onPress={() => router.push('/(auth)/login')}
              accessibilityRole="button"
            >
              <Text style={styles.switchText}>
                Already have an account?{' '}
                <Text style={styles.switchTextStrong}>Sign in</Text>
              </Text>
            </TouchableOpacity>

            {/* ── Data minimisation notice (GDPR Art.5(1)(c) + ICO Standard 4) ── */}
            <GlassSurface style={styles.noticeCard} tintColor={cardTint}>
              <Text style={styles.noticeEmoji} accessible={false} importantForAccessibility="no-hide-descendants">
                🔒
              </Text>
              <Text style={styles.noticeText}>
                <Text style={styles.noticeTextStrong}>We only ask for what we need. </Text>
                No phone number, no address, no payment details at sign-up.
              </Text>
            </GlassSurface>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// createStyles(T) — called via useMemo inside RegisterScreen so every colour
// resolves per the current app theme mode (same pattern as
// app/(tabs)/profile.tsx).
function createStyles(T: ThemeTokens) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  safe: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },

  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingRight: 16,
  },
  backBtnText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 16,
    color: ACCENT.accent,
  },

  headingBlock: {
    marginTop: 28,
    marginBottom: 28,
  },
  headline: {
    fontFamily: FontFamily.display,
    fontSize: 34,
    color: T.label,
    letterSpacing: -0.6,
    lineHeight: 38,
  },
  subtitle: {
    fontFamily: FontFamily.body,
    fontSize: 15,
    color: T.label3,
    marginTop: 6,
  },

  fieldGroup: { gap: 14, marginBottom: 8 },

  passwordWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 48,
  },
  eyeBtn: {
    position: 'absolute',
    right: 14,
    height: 54,
    width: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strengthText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 12,
    marginTop: 5,
    marginLeft: 4,
  },

  consentCard: {
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  checkRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    paddingVertical: 11,
  },
  checkBoxTopAlign: {
    marginTop: 1,
  },
  checkMark: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: FontFamily.bodyStrong,
    lineHeight: 16,
  },
  checkLabel: {
    flex: 1,
    fontFamily: FontFamily.body,
    fontSize: 14,
    color: T.label2,
    lineHeight: 19,
  },
  checkLabelStrong: {
    fontFamily: FontFamily.bodyStrong,
  },
  checkLabelLink: {
    fontFamily: FontFamily.bodyStrong,
    color: ACCENT.accent,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: T.separator,
  },

  primaryBtn: {
    height: 54,
    backgroundColor: ACCENT.accent,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  primaryBtnDisabled: {
    opacity: 0.45,
  },
  primaryBtnText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 17,
    color: '#FFFFFF',
  },

  switchBtn: {
    marginTop: 20,
    alignItems: 'center',
    paddingVertical: 10,
  },
  switchText: {
    fontFamily: FontFamily.body,
    fontSize: 15,
    color: T.label3,
  },
  switchTextStrong: {
    fontFamily: FontFamily.bodyStrong,
    color: ACCENT.accent,
  },

  noticeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 24,
  },
  noticeEmoji: {
    fontSize: 18,
    marginTop: 1,
  },
  noticeText: {
    fontFamily: FontFamily.body,
    fontSize: 13.5,
    color: T.label2,
    flex: 1,
    lineHeight: 19,
  },
  noticeTextStrong: {
    fontFamily: FontFamily.bodyStrong,
    color: T.label,
  },
  });
}
