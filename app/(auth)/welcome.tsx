/**
 * Welcome screen — the very first screen a new user sees.
 *
 * Design decisions (ICO Children's Code + UK GDPR):
 *  - No location permission is requested here. Location is opt-in and comes later.
 *  - No data is collected or sent on this screen.
 *  - Privacy reassurance is shown before the user creates an account.
 *  - Both CTAs (create account / sign in) are clear and equal in size — no dark patterns.
 *  - Terms and Privacy Policy are linked so parents can read them before signing up.
 *  - Google OAuth button is intentionally omitted until the OAuth flow is fully wired.
 */

import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HeroIllustration } from '@/components/HeroIllustration';

// ─── Feature bullet data ────────────────────────────────────────────────────
const FEATURES = [
  { id: '1', icon: '📍', label: 'Find soft plays, parks, cafes and more near you' },
  { id: '2', icon: '⭐', label: 'Read honest reviews written by real parents' },
  { id: '3', icon: '❤️', label: 'Save your favourite family-friendly spots' },
] as const;

// ─── Component ───────────────────────────────────────────────────────────────
export default function WelcomeScreen() {

  // ── TODO (future): Google OAuth via Supabase ──────────────────────────────
  // When the OAuth flow is ready, uncomment this and add the button below.
  //
  // import { supabase } from '@/lib/supabase';
  //
  // async function handleGoogleSignIn() {
  //   const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
  //   if (error) console.error('Google sign-in error:', error.message);
  // }
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView className="flex-1 bg-slate">

      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingVertical: 32 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── App name / wordmark ─────────────────────────────────────────── */}
        <View className="items-center mt-4 mb-2">
          <Text
            className="text-5xl text-sky"
            style={{ fontFamily: 'Nunito-ExtraBold' }}
            accessibilityRole="header"
          >
            Play Planner
          </Text>
          <Text
            className="text-base text-grey text-center mt-1"
            style={{ fontFamily: 'Nunito-Regular' }}
          >
            Family days out, sorted.
          </Text>
        </View>

        {/* ── Hero illustration ────────────────────────────────────────────── */}
        {/* SVG scene: sunny park with soft-play building and trees */}
        <View
          className="w-full rounded-3xl my-6 overflow-hidden"
          style={{ height: 200 }}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        >
          <HeroIllustration />
        </View>

        {/* ── Headline + sub-headline ─────────────────────────────────────── */}
        <View className="mb-6">
          <Text
            className="text-3xl text-charcoal text-center"
            style={{ fontFamily: 'Nunito-ExtraBold' }}
          >
            Find amazing days out{'\n'}for your family
          </Text>
          <Text
            className="text-base text-grey text-center mt-2"
            style={{ fontFamily: 'Nunito-Regular' }}
          >
            Discover soft plays, parks, family cafes and more —
            all reviewed by parents just like you.
          </Text>
        </View>

        {/* ── Feature bullets ─────────────────────────────────────────────── */}
        <View className="mb-6" style={{ gap: 12 }}>
          {FEATURES.map((feature) => (
            <View
              key={feature.id}
              className="flex-row items-center bg-white rounded-2xl px-4 py-3"
              style={{
                gap: 12,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.06,
                shadowRadius: 4,
                elevation: 2,
              }}
            >
              <Text
                style={{ fontSize: 22, width: 30 }}
                importantForAccessibility="no-hide-descendants"
                accessible={false}
              >
                {feature.icon}
              </Text>
              <Text
                className="text-charcoal flex-1 text-base"
                style={{ fontFamily: 'Nunito-Medium' }}
              >
                {feature.label}
              </Text>
            </View>
          ))}
        </View>

        {/* ── Privacy reassurance strip ────────────────────────────────────── */}
        {/* ICO Children's Code Standards 4 (transparency) + 10 (geolocation off by default) */}
        <View
          className="flex-row items-start bg-mint rounded-2xl px-4 py-3 mb-8"
          style={{ gap: 12 }}
        >
          <Text
            style={{ fontSize: 20, marginTop: 1 }}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
          >
            🔒
          </Text>
          <Text
            className="text-charcoal text-sm flex-1"
            style={{ fontFamily: 'Nunito-Regular' }}
          >
            <Text style={{ fontFamily: 'Nunito-Bold' }}>Your privacy matters. </Text>
            Your location is{' '}
            <Text style={{ fontFamily: 'Nunito-Bold' }}>off by default</Text>
            {' '}and only shared when you choose to. We never sell your data.{' '}
            <Text
              className="underline"
              style={{ fontFamily: 'Nunito-Bold', color: '#2D3436' }}
              onPress={() => router.push('/(auth)/privacy')}
              accessibilityRole="link"
              accessibilityLabel="Read our Privacy Policy"
            >
              Read our Privacy Policy.
            </Text>
          </Text>
        </View>

        {/* ── Call-to-action buttons ───────────────────────────────────────── */}
        {/* Both buttons same size — no nudge techniques (ICO Children's Code Standard 7) */}
        <View style={{ gap: 12 }}>

          {/* PRIMARY: Create account */}
          <TouchableOpacity
            className="w-full bg-sky rounded-2xl items-center justify-center"
            style={{ height: 52 }}
            onPress={() => router.push('/(auth)/register')}
            accessibilityRole="button"
            accessibilityLabel="Create a free account"
          >
            <Text
              className="text-white text-lg"
              style={{ fontFamily: 'Nunito-Bold' }}
            >
              Create free account
            </Text>
          </TouchableOpacity>

          {/* SECONDARY: Sign in */}
          <TouchableOpacity
            className="w-full border-2 border-sky rounded-2xl items-center justify-center"
            style={{ height: 52 }}
            onPress={() => router.push('/(auth)/login')}
            accessibilityRole="button"
            accessibilityLabel="Sign in to your existing account"
          >
            <Text
              className="text-sky text-lg"
              style={{ fontFamily: 'Nunito-Bold' }}
            >
              Sign in
            </Text>
          </TouchableOpacity>

          {/*
            ── TODO: Google OAuth button ─────────────────────────────────────
            Uncomment when Supabase Google OAuth is fully wired up.

            <TouchableOpacity
              className="w-full bg-white border border-greyLighter rounded-2xl items-center justify-center"
              style={{ height: 52 }}
              onPress={handleGoogleSignIn}
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
            >
              <Text
                className="text-charcoal text-base"
                style={{ fontFamily: 'Nunito-Medium' }}
              >
                Continue with Google
              </Text>
            </TouchableOpacity>
            ──────────────────────────────────────────────────────────────────
          */}

        </View>

        {/* ── Legal footer ─────────────────────────────────────────────────── */}
        {/* Passive notice only — NOT a pre-ticked checkbox (which would be invalid consent) */}
        <Text
          className="text-grey text-xs text-center mt-5 mb-2"
          style={{ fontFamily: 'Nunito-Regular' }}
        >
          By continuing you agree to our{' '}
          <Text
            className="underline"
            style={{ fontFamily: 'Nunito-Bold', color: '#636E72' }}
            onPress={() => router.push('/(auth)/terms')}
            accessibilityRole="link"
            accessibilityLabel="Read Terms of Service"
          >
            Terms of Service
          </Text>
          {' '}and{' '}
          <Text
            className="underline"
            style={{ fontFamily: 'Nunito-Bold', color: '#636E72' }}
            onPress={() => router.push('/(auth)/privacy')}
            accessibilityRole="link"
            accessibilityLabel="Read Privacy Policy"
          >
            Privacy Policy
          </Text>
          .
        </Text>

      </ScrollView>
    </SafeAreaView>
  );
}
