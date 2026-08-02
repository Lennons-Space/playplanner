/**
 * Download My Data screen — app/profile/data-download.tsx
 *
 * v2 dark restyle (Step 5, feat/exact-v2-design): VISUAL LAYER ONLY. The
 * export flow (buildDataExport, file write/share/delete, SecureStore
 * cooldown) is byte-identical to the pre-restyle version.
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
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import {
  documentDirectory,
  writeAsStringAsync,
  deleteAsync,
  EncodingType,
} from 'expo-file-system/legacy';
// eslint-disable-next-line import/no-unresolved -- expo-sharing not yet installed; run: npx expo install expo-sharing
import { shareAsync } from 'expo-sharing';
import { format } from 'date-fns';
import { useAuthStore } from '@/store/authStore';
import { buildDataExport } from '@/hooks/useDataRights';
import { Icon } from '@/components/ui/Icon';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { GlassButton } from '@/components/ui/GlassButton';
import { ThemedBackground } from '@/components/ui/ThemedBackground';
import { V2Header } from '@/components/ui/V2Header';
import { useAppTheme } from '@/hooks/useAppTheme';
import { FontFamily, ocean } from '@/constants/theme';

const ACCENT = ocean;

const STORAGE_KEY   = 'playplanner.last_data_export';
const COOLDOWN_MS   = 86_400_000; // 24 hours

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function DataDownloadScreen() {
  const { tokens: T, mode } = useAppTheme();
  const statusBarStyle = mode === 'dark' ? 'light' : 'dark';
  // See app/profile/my-venues.tsx for why the info box is lighter than
  // GlassSurface's mode default.
  const infoBoxTint = mode === 'dark' ? 'rgba(14,14,20,0.55)' : 'rgba(255,255,255,0.55)';
  const userId = useAuthStore((s) => s.user?.id);
  const insets = useSafeAreaInsets();

  const [isLoading,    setIsLoading]    = useState(false);
  const [success,      setSuccess]      = useState(false);
  const [error,        setError]        = useState(false);
  const [lastExportTs, setLastExportTs] = useState<number | null>(null);

  // On mount: read the last-export timestamp from SecureStore.
  // WHY SecureStore: the cooldown key indirectly signals when a GDPR export was
  // requested — that is sensitive metadata. AsyncStorage is plaintext on-disk;
  // SecureStore encrypts at rest via the device keychain / keystore.
  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY)
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
      await SecureStore.setItemAsync(STORAGE_KEY, now.toString());
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
    <View style={styles.root}>
      <ThemedBackground />
      <StatusBar style={statusBarStyle} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <V2Header title="Download My Data" />

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >

          {/* Info box */}
          <GlassSurface style={styles.infoBox} tintColor={infoBoxTint}>
            <View style={styles.infoIconRow}>
              <Icon name="info" size={18} color={ACCENT.accent} />
              <Text style={[styles.infoHeading, { color: T.label }]}>What&apos;s included</Text>
            </View>
            <Text style={[styles.infoBody, { color: T.label2 }]}>
              Your download includes your profile, reviews, saved venues, submitted
              venues, location consent history, and a log of privacy actions. It does
              not include payment information, your profile photo, or data about other
              users.
            </Text>
          </GlassSurface>

          {/* Cooldown warning */}
          {isOnCooldown && nextAllowedTime && (
            <GlassSurface style={styles.cooldownBox} tintColor="rgba(255,178,62,0.14)">
              <Text style={styles.cooldownText}>
                You downloaded your data recently. You can request another download
                after {nextAllowedTime}.
              </Text>
            </GlassSurface>
          )}

          {/* Request download button */}
          <GlassButton
            onPress={handleExport}
            disabled={buttonDisabled}
            loading={isLoading}
            accessibilityLabel="Request data download"
            accessibilityState={{ disabled: buttonDisabled, busy: isLoading }}
            label="Request download"
            style={styles.buttonLayout}
          />

          {/* Success message */}
          {success && (
            <GlassSurface style={styles.successBox} tintColor="rgba(52,211,153,0.14)">
              <Text style={styles.successText}>
                Your data has been prepared and shared. The file has been deleted
                from this device.
              </Text>
            </GlassSurface>
          )}

          {/* Error message */}
          {error && (
            <GlassSurface style={styles.errorBox} tintColor="rgba(255,59,48,0.14)">
              <Text style={styles.errorText}>
                Something went wrong preparing your data. Please try again.
              </Text>
            </GlassSurface>
          )}

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
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  infoBox: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  infoIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  infoHeading: {
    fontFamily: FontFamily.heading,
    fontSize: 15,
  },
  infoBody: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    lineHeight: 20,
  },
  cooldownBox: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  cooldownText: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    color: '#FFC976',
    lineHeight: 20,
  },
  // Phase 3 (glass button system): "Request download" is now a
  // <GlassButton/>; only layout survives here.
  buttonLayout: {
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 8,
  },
  successBox: {
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
  },
  successText: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    color: '#6EE7B7',
    lineHeight: 20,
  },
  errorBox: {
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
  },
  errorText: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    color: '#FF8A80',
    lineHeight: 20,
  },
});
