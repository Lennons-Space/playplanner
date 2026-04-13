/**
 * Download My Data screen — app/profile/data-download.tsx
 *
 * GDPR Art.15 (right of access): users can request a portable copy of all
 *   personal data held about them. The export is delivered as a JSON file
 *   via the device share sheet — we never store it server-side.
 *
 * GDPR Art.5(2) (accountability): the export action is recorded in the GDPR
 *   audit log (inside buildDataExport, only after all queries succeed).
 *
 * NOTE: This screen requires expo-file-system and expo-sharing.
 * These packages are not yet in package.json — the developer must install them:
 *   npx expo install expo-file-system expo-sharing
 * After installing, re-run: npm run type-check
 */
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  documentDirectory,
  writeAsStringAsync,
  deleteAsync,
  EncodingType,
} from 'expo-file-system';
// eslint-disable-next-line import/no-unresolved -- expo-sharing not yet installed; run: npx expo install expo-sharing
import { shareAsync } from 'expo-sharing';
import { format } from 'date-fns';
import { useAuthStore } from '@/store/authStore';
import { buildDataExport } from '@/hooks/useDataRights';

const STORAGE_KEY   = 'playplanner.last_data_export';
const COOLDOWN_MS   = 86_400_000; // 24 hours

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function DataDownloadScreen() {
  const userId = useAuthStore((s) => s.user?.id);

  const [isLoading,    setIsLoading]    = useState(false);
  const [success,      setSuccess]      = useState(false);
  const [error,        setError]        = useState(false);
  const [lastExportTs, setLastExportTs] = useState<number | null>(null);

  // On mount: read the last-export timestamp from AsyncStorage.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) setLastExportTs(parseInt(raw, 10));
      })
      .catch(() => {
        // Non-fatal — user just won't see a cooldown if storage read fails.
      });
  }, []);

  const isOnCooldown =
    lastExportTs !== null && Date.now() - lastExportTs < COOLDOWN_MS;

  const nextAllowedTime =
    lastExportTs !== null
      ? format(new Date(lastExportTs + COOLDOWN_MS), "d MMM yyyy 'at' HH:mm")
      : null;

  // ---------------------------------------------------------------------------
  // Export handler
  // ---------------------------------------------------------------------------

  async function handleExport() {
    if (!userId) return;

    setIsLoading(true);
    setError(false);
    setSuccess(false);

    let fileUri: string | null = null;

    try {
      const jsonStr = await buildDataExport(userId);

      fileUri =
        (documentDirectory ?? '') +
        'playplanner_data_export.json';

      await writeAsStringAsync(fileUri, jsonStr, {
        encoding: EncodingType.UTF8,
      });

      await shareAsync(fileUri, {
        mimeType:    'application/json',
        dialogTitle: 'Save your PlayPlanner data',
      });

      const now = Date.now();
      await AsyncStorage.setItem(STORAGE_KEY, now.toString());
      setLastExportTs(now);
      setSuccess(true);
    } catch {
      setError(true);
    } finally {
      // Always delete the temp file — GDPR data minimisation.
      if (fileUri) {
        await deleteAsync(fileUri, { idempotent: true }).catch(() => {});
      }
      setIsLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const buttonDisabled = isLoading || isOnCooldown;

  return (
    <>
      <Stack.Screen options={{ title: 'Download My Data' }} />
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >

          {/* Info box */}
          <View style={styles.infoBox}>
            <Text style={styles.infoHeading}>What&apos;s included</Text>
            <Text style={styles.infoBody}>
              Your download includes your profile, reviews, saved venues, submitted
              venues, location consent history, and a log of privacy actions. It does
              not include payment information, your profile photo, or data about other
              users.
            </Text>
          </View>

          {/* Cooldown warning */}
          {isOnCooldown && nextAllowedTime && (
            <View style={styles.cooldownBox}>
              <Text style={styles.cooldownText}>
                You downloaded your data recently. You can request another download
                after {nextAllowedTime}.
              </Text>
            </View>
          )}

          {/* Request download button */}
          <TouchableOpacity
            style={[
              styles.button,
              buttonDisabled && styles.buttonDisabled,
            ]}
            onPress={handleExport}
            disabled={buttonDisabled}
            accessibilityRole="button"
            accessibilityLabel="Request data download"
            accessibilityState={{ disabled: buttonDisabled, busy: isLoading }}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>Request download</Text>
            )}
          </TouchableOpacity>

          {/* Success message */}
          {success && (
            <View style={styles.successBox}>
              <Text style={styles.successText}>
                Your data has been prepared and shared. The file has been deleted
                from this device.
              </Text>
            </View>
          )}

          {/* Error message */}
          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>
                Something went wrong preparing your data. Please try again.
              </Text>
            </View>
          )}

        </ScrollView>
      </SafeAreaView>
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFF9F0',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  infoBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  infoHeading: {
    fontFamily: 'Nunito-Bold',
    fontSize: 15,
    color: '#2D3436',
    marginBottom: 8,
  },
  infoBody: {
    fontFamily: 'Nunito-Regular',
    fontSize: 13,
    color: '#636E72',
    lineHeight: 20,
  },
  cooldownBox: {
    backgroundColor: '#FFF3CD',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  cooldownText: {
    fontFamily: 'Nunito-Regular',
    fontSize: 13,
    color: '#856404',
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#FF6B6B',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontFamily: 'Nunito-Bold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  successBox: {
    backgroundColor: '#D4EDDA',
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
  },
  successText: {
    fontFamily: 'Nunito-Regular',
    fontSize: 13,
    color: '#155724',
    lineHeight: 20,
  },
  errorBox: {
    backgroundColor: '#F8D7DA',
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
  },
  errorText: {
    fontFamily: 'Nunito-Regular',
    fontSize: 13,
    color: '#721C24',
    lineHeight: 20,
  },
});
