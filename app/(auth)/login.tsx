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
 * v2 dark restyle (Step 6, feat/exact-v2-design): VISUAL LAYER ONLY.
 * signInWithPassword flow, EMAIL_REGEX pre-check, getFriendlyAuthError
 * mapping (incl. anti-enumeration neutral credential message), Alert-based
 * error/validation semantics, and handleForgotPassword (no branching on
 * error — same message regardless of whether the account exists) are
 * byte-identical to the pre-restyle version. Only the JSX/styling changed:
 * the legacy warm-cream ambient weather wash component is gone,
 * <V2Background/> mounted per the frozen background architecture (see
 * app/(tabs)/profile.tsx), dark inputs, Ocean accent CTA, and a new
 * password-visibility toggle (purely presentational — does not change
 * validation or submission logic).
 */

import { useState, useMemo } from 'react';
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
  StyleSheet,
  type TextStyle,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';
import { Icon } from '@/components/ui/Icon';
import { ThemedBackground } from '@/components/ui/ThemedBackground';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { FontFamily, ocean, type ThemeTokens } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';

const ACCENT = ocean;

// Shared rounded input (translucent surface + hairline border) — resolved
// per-render via useMemo inside LoginScreen so it follows the app theme mode.
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
  const { tokens: T, mode } = useAppTheme();
  const styles = useMemo(() => createStyles(T), [T]);
  const inputStyle = useMemo(() => createInputStyle(T), [T]);
  const labelStyle = useMemo(() => createLabelStyle(T), [T]);
  const statusBarStyle = mode === 'dark' ? 'light' : 'dark';
  const privacyStripTint = mode === 'dark' ? 'rgba(14,14,20,0.5)' : 'rgba(255,255,255,0.5)';
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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
                Welcome back!
              </Text>
              <Text style={styles.subtitle}>
                Sign in to your Play Planner account
              </Text>
            </View>

            {/* ── Input fields ─────────────────────────────────────────── */}
            <View style={styles.fieldGroup}>
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
                    placeholder="Your password"
                    placeholderTextColor={T.label4}
                    secureTextEntry={!showPassword}
                    autoComplete="password"
                    returnKeyType="done"
                    onSubmitEditing={handleLogin}
                    value={password}
                    onChangeText={setPassword}
                    accessibilityLabel="Password"
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
              </View>

              {/* Forgot password — anti-enumeration: always same response */}
              <TouchableOpacity
                style={styles.forgotBtn}
                onPress={handleForgotPassword}
                accessibilityRole="button"
                accessibilityLabel="Forgot your password — tap to receive a reset link"
              >
                <Text style={styles.forgotText}>
                  Forgot password?
                </Text>
              </TouchableOpacity>
            </View>

            {/* ── Primary CTA ───────────────────────────────────────────── */}
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleLogin}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Sign in to your account"
              accessibilityState={{ disabled: loading }}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.primaryBtnText}>Sign in</Text>
              }
            </TouchableOpacity>

            {/* ── Switch to register ────────────────────────────────────── */}
            <TouchableOpacity
              style={styles.switchBtn}
              onPress={() => router.push('/(auth)/register')}
              accessibilityRole="button"
              accessibilityLabel="Go to the Create Account screen"
            >
              <Text style={styles.switchText}>
                Don't have an account?{' '}
                <Text style={styles.switchTextStrong}>Sign up free</Text>
              </Text>
            </TouchableOpacity>

            {/* ── Privacy reminder strip (ICO Standard 4 — transparency) ── */}
            <GlassSurface style={styles.privacyStrip} tintColor={privacyStripTint}>
              <Text style={styles.privacyEmoji} accessible={false} importantForAccessibility="no-hide-descendants">
                🔒
              </Text>
              <Text style={styles.privacyText}>
                <Text style={styles.privacyTextStrong}>Your privacy matters. </Text>
                Location is <Text style={styles.privacyTextStrong}>off by default</Text>. We never sell your data.
              </Text>
            </GlassSurface>

            {/* ── Legal footer ─────────────────────────────────────────── */}
            <Text style={styles.legalText}>
              By signing in you agree to our{' '}
              <Text
                style={styles.legalLink}
                onPress={() => router.push('/(auth)/terms')}
                accessibilityRole="link"
              >
                Terms of Service
              </Text>
              {' '}and{' '}
              <Text
                style={styles.legalLink}
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

// createStyles(T) — called via useMemo inside LoginScreen so every colour
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

  fieldGroup: { gap: 14 },

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

  forgotBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingLeft: 16,
  },
  forgotText: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 13.5,
    color: ACCENT.accent,
  },

  primaryBtn: {
    height: 54,
    backgroundColor: ACCENT.accent,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
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

  privacyStrip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 24,
  },
  privacyEmoji: {
    fontSize: 18,
    marginTop: 1,
  },
  privacyText: {
    fontFamily: FontFamily.body,
    fontSize: 13.5,
    color: T.label2,
    flex: 1,
    lineHeight: 19,
  },
  privacyTextStrong: {
    fontFamily: FontFamily.bodyStrong,
    color: T.label,
  },

  legalText: {
    fontFamily: FontFamily.body,
    fontSize: 12,
    color: T.label3,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 18,
  },
  legalLink: {
    fontFamily: FontFamily.bodyStrong,
    color: T.label2,
    textDecorationLine: 'underline',
  },
  });
}
