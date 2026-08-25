/**
 * Privacy & data screen — app/profile/privacy-settings.tsx
 *
 * v2 dark restyle (Step 5, feat/exact-v2-design): VISUAL LAYER ONLY. The
 * location-permission read and all navigation targets are byte-identical
 * to the pre-restyle version.
 *
 * This screen had NO `<Stack.Screen options={{title}}>`, so Expo Router
 * rendered the literal route filename ("privacy-settings") as a native
 * header stacked above this screen's own custom header. See
 * app/profile/_layout.tsx (headerShown:false) for the fix.
 *
 * GDPR Art.13 / ICO Children's Code Standard 4 — transparency.
 * This screen shows the user their current OS location permission and links
 * them to the data download screen.
 *
 * IT IS NO LONGER PURELY INFORMATIONAL (PP-018, 2026-08-25). It now also owns
 * PlayPlanner's OWN per-account location consent, which the user can turn on or
 * off here. That is deliberate and required: a decline is persisted per account
 * (tri-state), so without a control here an account that tapped "Not now" on
 * the prompt would have no way back — withdrawal would be easy and re-consent
 * impossible, which is not what GDPR Art.7(3) asks for.
 *
 * The OS permission and PlayPlanner's consent are rendered as SEPARATE cards
 * because they are separate things: the device permission is shared by every
 * account on the phone, while the consent belongs to one data subject.
 *
 * Location status is read via expo-location getPermissionsAsync() — a
 * non-requesting query that reads the OS permission state WITHOUT prompting
 * the user. We deliberately do NOT call useLocation(), which triggers a
 * permission request dialog on mount and would violate ICO Standard 10
 * (geolocation must be off by default; consent only on explicit user action).
 */
import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { useLocationConsent } from '@/hooks/useLocationConsent';
import { Icon } from '@/components/ui/Icon';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { ThemedBackground } from '@/components/ui/ThemedBackground';
import { V2Header } from '@/components/ui/V2Header';
import { useAppTheme } from '@/hooks/useAppTheme';
import { FontFamily, ocean } from '@/constants/theme';

const ACCENT = ocean;

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function PrivacySettingsScreen() {
  const { tokens: T, mode } = useAppTheme();
  const statusBarStyle = mode === 'dark' ? 'light' : 'dark';
  // See app/profile/my-venues.tsx for why cards are lighter than
  // GlassSurface's mode default.
  const cardTint = mode === 'dark' ? 'rgba(14,14,20,0.55)' : 'rgba(255,255,255,0.55)';
  // 'unknown' while the async check is in-flight; resolved to 'on' or 'off'.
  const [locationStatus, setLocationStatus] = useState<'on' | 'off' | 'unknown'>('unknown');

  useEffect(() => {
    // getPermissionsAsync reads the current OS permission state without
    // ever showing a dialog. Safe to call on any screen without consent risk.
    Location.getForegroundPermissionsAsync()
      .then(({ status }) => {
        setLocationStatus(status === 'granted' ? 'on' : 'off');
      })
      .catch(() => {
        // Non-fatal — fall back to the safe default (off).
        setLocationStatus('off');
      });
  }, []);

  const locationLabel =
    locationStatus === 'on'  ? 'On'  :
    locationStatus === 'off' ? 'Off' :
    '—';

  const locationSubtitle =
    locationStatus === 'on'
      ? 'Location access is enabled. Change this in your device Settings.'
      : 'Location access is off. PlayPlanner uses a default location for search.';

  // ── PlayPlanner's own, per-account location consent (PP-018) ──────────────
  // Separate from the OS permission above — see the card comment below.
  const { status: consentStatus, grant, revoke } = useLocationConsent();

  // 'checking' is transient; 'unavailable' means nobody is signed in, which
  // cannot normally happen on a profile screen but must not render an
  // actionable control if it somehow does.
  const consentActionable = consentStatus === 'granted'
    || consentStatus === 'declined'
    || consentStatus === 'undecided';

  const consentPillLabel =
    consentStatus === 'granted'  ? 'On'  :
    consentStatus === 'declined' ? 'Off' :
    consentStatus === 'undecided' ? 'Not set' :
    '—';

  const consentSubtitle =
    consentStatus === 'granted'
      ? 'Nearby search uses your location. Tap to turn this off.'
      : consentStatus === 'declined'
        ? 'Nearby search uses a default area. Tap to turn this on.'
        : consentStatus === 'undecided'
          ? 'You have not chosen yet. Tap to turn this on.'
          : 'Sign in to manage this.';

  const consentActionLabel =
    consentStatus === 'granted'
      ? 'Turn off location in PlayPlanner'
      : 'Turn on location in PlayPlanner';

  function handleToggleConsent() {
    if (!consentActionable) return;
    // Both paths are non-blocking and write their own GDPR audit event:
    // grant() logs the consent, revoke() logs the withdrawal (Art.7(3)).
    // Neither touches the OS permission — that stays the device owner's.
    if (consentStatus === 'granted') {
      void revoke();
    } else {
      void grant();
    }
  }

  return (
    <View style={styles.root}>
      <ThemedBackground />
      <StatusBar style={statusBarStyle} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <V2Header title="Privacy & data" />

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >

          {/* ── Location ─────────────────────────────────────────────────── */}
          <Text style={[styles.sectionLabel, { color: T.label3 }]}>LOCATION</Text>
          <GlassSurface style={styles.card} tintColor={cardTint}>
            <View style={styles.cardRow}>
              <View style={styles.iconBox}>
                <Icon name="pin" size={18} color={ACCENT.accent} />
              </View>
              <View style={styles.cardTextBlock}>
                <Text style={[styles.cardRowLabel, { color: T.label }]}>Location access</Text>
                <Text style={[styles.cardRowSub, { color: T.label3 }]}>{locationSubtitle}</Text>
              </View>
              <View style={[
                styles.statusPill,
                locationStatus === 'on' ? styles.statusPillOn : [styles.statusPillOff, { backgroundColor: T.fill }],
              ]}>
                <Text style={[
                  styles.statusPillText,
                  locationStatus === 'on' ? styles.statusPillTextOn : [styles.statusPillTextOff, { color: T.label3 }],
                ]}>
                  {locationLabel}
                </Text>
              </View>
            </View>
          </GlassSurface>

          {/* ── PlayPlanner's own location consent (PP-018) ───────────────
              DELIBERATELY a separate card from the OS permission row above.
              They are different things: the device permission is granted once
              and shared by every account on the phone, whereas this is THIS
              ACCOUNT's decision and is what actually gates precise location in
              PlayPlanner. Showing only the OS row would let a user believe
              location was "On" while their account had never consented.

              This control is also the GDPR Art.7(3) surface, and it now works
              in BOTH directions. That matters because a decline is persisted
              per account (tri-state) — without a way back, an account that
              tapped "Not now" once could never enable location again. */}
          <GlassSurface style={styles.card} tintColor={cardTint}>
            <TouchableOpacity
              style={styles.cardRow}
              onPress={handleToggleConsent}
              disabled={!consentActionable}
              accessibilityRole="button"
              accessibilityState={{ disabled: !consentActionable }}
              accessibilityLabel={consentActionLabel}
              activeOpacity={0.7}
            >
              <View style={styles.iconBox}>
                <Icon name="pin" size={18} color={ACCENT.accent} />
              </View>
              <View style={styles.cardTextBlock}>
                <Text style={[styles.cardRowLabel, { color: T.label }]}>
                  Use my location in PlayPlanner
                </Text>
                <Text style={[styles.cardRowSub, { color: T.label3 }]}>{consentSubtitle}</Text>
              </View>
              <View style={[
                styles.statusPill,
                consentStatus === 'granted'
                  ? styles.statusPillOn
                  : [styles.statusPillOff, { backgroundColor: T.fill }],
              ]}>
                <Text style={[
                  styles.statusPillText,
                  consentStatus === 'granted'
                    ? styles.statusPillTextOn
                    : [styles.statusPillTextOff, { color: T.label3 }],
                ]}>
                  {consentPillLabel}
                </Text>
              </View>
            </TouchableOpacity>
          </GlassSurface>

          {/* ── Your data ────────────────────────────────────────────────── */}
          <Text style={[styles.sectionLabel, { color: T.label3 }]}>YOUR DATA</Text>
          <GlassSurface style={styles.card} tintColor={cardTint}>
            <TouchableOpacity
              style={styles.cardRow}
              onPress={() => router.push('/profile/data-download')}
              accessibilityRole="button"
              accessibilityLabel="Download my data"
              activeOpacity={0.7}
            >
              <View style={styles.iconBox}>
                <Icon name="info" size={18} color={ACCENT.accent} />
              </View>
              <View style={styles.cardTextBlock}>
                <Text style={[styles.cardRowLabel, { color: T.label }]}>Download my data</Text>
                <Text style={[styles.cardRowSub, { color: T.label3 }]}>Export a copy of your personal data</Text>
              </View>
              <Icon name="chevR" size={16} color={T.label3} />
            </TouchableOpacity>
          </GlassSurface>

          {/* ── Privacy note ─────────────────────────────────────────────── */}
          <GlassSurface style={styles.privacyNote} tintColor={ACCENT.light}>
            <Icon name="shield" size={16} color={ACCENT.accent} />
            <Text style={[styles.privacyNoteText, { color: T.label }]}>
              PlayPlanner is built with privacy-first design. Your data is never sold.{' '}
              <Text
                style={styles.privacyNoteLink}
                onPress={() => router.push('/(auth)/privacy')}
                accessibilityRole="link"
              >
                Read our privacy policy.
              </Text>
            </Text>
          </GlassSurface>

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  safe: { flex: 1, backgroundColor: 'transparent' },

  // Scroll
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 48,
  },

  // Section label
  sectionLabel: {
    fontFamily: FontFamily.caption,
    fontSize: 11,
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 4,
  },

  // Card
  card: {
    borderRadius: 16,
    marginBottom: 20,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: ACCENT.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTextBlock: {
    flex: 1,
  },
  cardRowLabel: {
    fontFamily: FontFamily.heading,
    fontSize: 14,
  },
  cardRowSub: {
    fontFamily: FontFamily.body,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 18,
  },

  // Status pill
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusPillOn: {
    backgroundColor: ACCENT.light,
  },
  statusPillOff: {
    // backgroundColor: mode-aware, applied inline (T.fill).
  },
  statusPillText: {
    fontFamily: FontFamily.caption,
    fontSize: 12,
  },
  statusPillTextOn: {
    color: ACCENT.accent,
  },
  statusPillTextOff: {
    // color: mode-aware, applied inline (T.label3).
  },

  // Privacy note
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
  },
  privacyNoteText: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    flex: 1,
    lineHeight: 20,
  },
  privacyNoteLink: {
    fontFamily: FontFamily.bodyStrong,
    color: ACCENT.accent,
  },
});
