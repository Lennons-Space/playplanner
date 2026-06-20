/**
 * Privacy & data screen — app/profile/privacy-settings.tsx
 *
 * GDPR Art.13 / ICO Children's Code Standard 4 — transparency.
 * This is an informational screen. It shows the user their current location
 * permission status and links them to the data download screen. No mutations
 * happen here — consent changes happen at the OS level (device Settings) or
 * through the explicit in-app consent prompt.
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
import * as Location from 'expo-location';
import { Icon } from '@/components/ui';
import { Colors, FontFamily, BorderRadius } from '@/constants/theme';

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function PrivacySettingsScreen() {
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.backBtn}
        >
          <Icon name="chevL" size={22} color={Colors.label} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy & data</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Location ─────────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>LOCATION</Text>
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={[styles.iconBox, { backgroundColor: Colors.accentLight }]}>
              <Icon name="pin" size={18} color={Colors.accent} />
            </View>
            <View style={styles.cardTextBlock}>
              <Text style={styles.cardRowLabel}>Location access</Text>
              <Text style={styles.cardRowSub}>{locationSubtitle}</Text>
            </View>
            <View style={[
              styles.statusPill,
              locationStatus === 'on' ? styles.statusPillOn : styles.statusPillOff,
            ]}>
              <Text style={[
                styles.statusPillText,
                locationStatus === 'on' ? styles.statusPillTextOn : styles.statusPillTextOff,
              ]}>
                {locationLabel}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Your data ────────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>YOUR DATA</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.cardRow}
            onPress={() => router.push('/profile/data-download')}
            accessibilityRole="button"
            accessibilityLabel="Download my data"
            activeOpacity={0.7}
          >
            <View style={[styles.iconBox, { backgroundColor: Colors.accentLight }]}>
              <Icon name="info" size={18} color={Colors.accent} />
            </View>
            <View style={styles.cardTextBlock}>
              <Text style={styles.cardRowLabel}>Download my data</Text>
              <Text style={styles.cardRowSub}>Export a copy of your personal data</Text>
            </View>
            <Icon name="chevR" size={16} color={Colors.label3} />
          </TouchableOpacity>
        </View>

        {/* ── Privacy note ─────────────────────────────────────────────── */}
        <View style={styles.privacyNote}>
          <Icon name="shield" size={16} color={Colors.accent} />
          <Text style={styles.privacyNoteText}>
            PlayPlanner is built with privacy-first design. Your data is never sold.{' '}
            <Text
              style={styles.privacyNoteLink}
              onPress={() => router.push('/(auth)/privacy')}
              accessibilityRole="link"
            >
              Read our privacy policy.
            </Text>
          </Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles — dark v2 tokens via Colors + FontFamily + BorderRadius
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.bg,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.separator,
    backgroundColor: Colors.bg,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: FontFamily.heading,
    fontSize: 18,
    color: Colors.label,
    flex: 1,
  },

  // Scroll
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 48,
  },

  // Section label
  sectionLabel: {
    fontFamily: FontFamily.caption,
    fontSize: 11,
    color: Colors.label3,
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 4,
  },

  // Card
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.section,
    overflow: 'hidden',
    marginBottom: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.separator,
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
    borderRadius: BorderRadius.iconContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTextBlock: {
    flex: 1,
  },
  cardRowLabel: {
    fontFamily: FontFamily.bodyStrong,
    fontSize: 14,
    color: Colors.label,
  },
  cardRowSub: {
    fontFamily: FontFamily.body,
    fontSize: 12,
    color: Colors.label3,
    marginTop: 2,
    lineHeight: 18,
  },

  // Status pill
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: BorderRadius.pill,
  },
  statusPillOn: {
    backgroundColor: Colors.accentLight,
  },
  statusPillOff: {
    backgroundColor: Colors.fill,
  },
  statusPillText: {
    fontFamily: FontFamily.caption,
    fontSize: 12,
  },
  statusPillTextOn: {
    color: Colors.accent,
  },
  statusPillTextOff: {
    color: Colors.label3,
  },

  // Privacy note
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.accentLight,
    borderRadius: BorderRadius.section,
    padding: 14,
    marginTop: 4,
  },
  privacyNoteText: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    color: Colors.label2,
    flex: 1,
    lineHeight: 20,
  },
  privacyNoteLink: {
    fontFamily: FontFamily.bodyStrong,
    color: Colors.accent,
  },
});
