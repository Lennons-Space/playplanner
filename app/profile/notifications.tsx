/**
 * Notifications stub screen — app/profile/notifications.tsx
 *
 * Phase 1 placeholder. Push notifications will be wired up in Phase 4.
 *
 * Privacy notes (ICO Children's Code Standard 10 — data minimisation by default):
 *   - The toggle is disabled — no notification permission is requested here.
 *   - We will only request permission at the point where the user explicitly
 *     chooses to opt in (Phase 4), never in the background.
 *   - No notification-related data is stored or transmitted in Phase 1.
 *
 * UK PECR compliance:
 *   Under PECR, sending marketing communications requires explicit prior consent.
 *   The copy here makes clear that consent will be required before we send
 *   anything — this is the correct pre-announcement pattern.
 */

import { View, Text, Switch, ScrollView, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

// Colour constants — consistent with the rest of the app.
const SWITCH_TRACK_OFF = '#E8E8E8';
const SWITCH_TRACK_ON  = '#4ECDC4';   // sky — never reached while disabled

export default function NotificationsScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Notifications' }} />
      <SafeAreaView style={styles.root} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scrollContent}>

          {/* Section label */}
          <Text style={styles.sectionLabel}>
            Push Notifications
          </Text>

          {/* Toggle card — disabled until Phase 4 */}
          <View style={styles.toggleCard}>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>
                Enable push notifications
              </Text>
              {/*
                Switch is permanently disabled in Phase 1.
                value is always false — no permission has been requested.
                Phase 4 will replace this with a live opt-in flow that
                requests OS permission only at the point of toggle.
              */}
              <Switch
                value={false}
                onValueChange={undefined}
                disabled
                trackColor={{ false: SWITCH_TRACK_OFF, true: SWITCH_TRACK_ON }}
                thumbColor="#FFFFFF"
                accessibilityRole="switch"
                accessibilityState={{ checked: false, disabled: true }}
                accessibilityLabel="Enable push notifications — coming soon"
              />
            </View>

            {/* Helper text explaining why the toggle is greyed out */}
            <Text style={styles.helperText}>
              Push notifications are coming soon. We will ask for your permission
              when this feature is ready — we will never enable notifications
              without your explicit choice.
            </Text>
          </View>

          {/* Privacy-first copy — required before any notification feature launches */}
          <View style={styles.privacyCard}>
            <Text style={styles.privacyText}>
              We will only send you notifications you explicitly opt in to.
              We never send marketing messages without your consent.
            </Text>
          </View>

          {/* Bottom reassurance note */}
          <Text style={styles.footerText}>
            Your notification preferences are stored privately and never shared.
          </Text>

        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F0F7F7',   // bg-slate
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionLabel: {
    color: '#636E72',              // text-grey
    fontSize: 11,
    fontFamily: 'Nunito-Bold',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  toggleCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  toggleLabel: {
    flex: 1,
    color: '#2D3436',              // text-charcoal
    fontSize: 16,
    fontFamily: 'Nunito-Medium',
  },
  helperText: {
    color: '#636E72',              // text-grey
    fontSize: 12,
    fontFamily: 'Nunito-Regular',
    lineHeight: 18,
    marginTop: 8,
  },
  privacyCard: {
    backgroundColor: '#FFF9F0',   // bg-sand
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 16,
  },
  privacyText: {
    color: '#4ECDC4',              // text-sky
    fontSize: 14,
    fontFamily: 'Nunito-Medium',
    lineHeight: 20,
  },
  footerText: {
    color: '#636E72',              // text-grey
    fontSize: 12,
    fontFamily: 'Nunito-Regular',
    lineHeight: 18,
    textAlign: 'center',
  },
});
