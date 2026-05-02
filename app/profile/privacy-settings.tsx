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
          <Icon name="chevL" size={22} color="#1D2630" />
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
            <View style={[styles.iconBox, { backgroundColor: '#EEF9F8' }]}>
              <Icon name="pin" size={18} color="#1B8A85" />
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
            <View style={[styles.iconBox, { backgroundColor: '#EEF9F8' }]}>
              <Icon name="info" size={18} color="#1B8A85" />
            </View>
            <View style={styles.cardTextBlock}>
              <Text style={styles.cardRowLabel}>Download my data</Text>
              <Text style={styles.cardRowSub}>Export a copy of your personal data</Text>
            </View>
            <Icon name="chevR" size={16} color="#7B8794" />
          </TouchableOpacity>
        </View>

        {/* ── Privacy note ─────────────────────────────────────────────── */}
        <View style={styles.privacyNote}>
          <Icon name="shield" size={16} color="#1B8A85" />
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
// Styles — pp- hex tokens only, no Colors import, no Ionicons
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FBF6EC',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E6E2DB',
    backgroundColor: '#FBF6EC',
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: 'Nunito-ExtraBold',
    fontSize: 18,
    color: '#1D2630',
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
    fontFamily: 'Nunito-Bold',
    fontSize: 11,
    color: '#7B8794',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 4,
  },

  // Card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTextBlock: {
    flex: 1,
  },
  cardRowLabel: {
    fontFamily: 'Nunito-Bold',
    fontSize: 14,
    color: '#1D2630',
  },
  cardRowSub: {
    fontFamily: 'Nunito-Regular',
    fontSize: 12,
    color: '#7B8794',
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
    backgroundColor: '#D4F0EE',
  },
  statusPillOff: {
    backgroundColor: '#F1ECE2',
  },
  statusPillText: {
    fontFamily: 'Nunito-Bold',
    fontSize: 12,
  },
  statusPillTextOn: {
    color: '#1B8A85',
  },
  statusPillTextOff: {
    color: '#7B8794',
  },

  // Privacy note
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#EEF9F8',
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
  },
  privacyNoteText: {
    fontFamily: 'Nunito-Regular',
    fontSize: 13,
    color: '#1D2630',
    flex: 1,
    lineHeight: 20,
  },
  privacyNoteLink: {
    fontFamily: 'Nunito-Bold',
    color: '#1B8A85',
  },
});
