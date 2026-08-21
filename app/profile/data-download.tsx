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
import { logDbError, devErrorLabel } from '@/lib/dbError';
import { Icon } from '@/components/ui/Icon';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { GlassButton } from '@/components/ui/GlassButton';
import { ThemedBackground } from '@/components/ui/ThemedBackground';
import { V2Header } from '@/components/ui/V2Header';
import { useAppTheme } from '@/hooks/useAppTheme';
import { FontFamily, ocean } from '@/constants/theme';

const ACCENT = ocean;

/**
 * The last-export timestamp is PER ACCOUNT.
 *
 * Real-device failure, 2026-08-21: Account A requested an export, signed out,
 * and Account B then opened this screen and was told "You downloaded your data
 * recently. You can request another download after 21 Aug 2026 at 22:53." The
 * key was a single device-global string, so B inherited A's cooldown — and with
 * it the knowledge that a previous account on this device had exported their
 * data, which is exactly the kind of metadata a GDPR export screen must not
 * disclose about another data subject.
 *
 * The user id is appended to the key so one account's export history is
 * unreachable from another. SecureStore keys allow alphanumerics, '.', '-' and
 * '_', so a UUID appends safely.
 */
const STORAGE_KEY_PREFIX = 'playplanner.last_data_export';

/** Per-account SecureStore key for the last-export timestamp. */
export function exportCooldownKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}.${userId}`;
}

/**
 * The stored record — a timestamp PLUS the account it belongs to.
 *
 * Real-device failure, 2026-08-21 (second report): Account B was still shown a
 * cooldown after switching from Account A, even though the per-account key had
 * shipped and its tests passed. Every ordering of the per-account logic is
 * provably sound (see dataDownloadStaleRead.test.tsx), which leaves only one
 * possibility: a value readable under B's key that B never earned.
 *
 * A bare numeric timestamp cannot be attributed to anyone. Any build before the
 * per-account change wrote exactly that, and a value can also land under the
 * wrong key during an account-confusion episode — which is precisely what the
 * session-resurrection bug produced on this device. The screen had no way to
 * tell such a value from one the current user legitimately earned.
 *
 * So the record now names its owner. Anything that does not — a bare number, a
 * malformed value, or a record naming a different account — is unattributable
 * and is discarded rather than displayed. The privacy-safe failure mode is that
 * one user may get one extra export (their right under GDPR Art.15 anyway),
 * never that someone sees another account's export history.
 */
interface CooldownRecord {
  userId: string;
  ts: number;
}

/**
 * Parse a stored value, returning the timestamp ONLY if the record positively
 * identifies itself as belonging to `userId`. Null means "unusable" — the
 * caller deletes it.
 */
export function parseCooldownRecord(raw: string | null, userId: string): number | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as CooldownRecord).userId === userId &&
      typeof (parsed as CooldownRecord).ts === 'number' &&
      Number.isFinite((parsed as CooldownRecord).ts)
    ) {
      return (parsed as CooldownRecord).ts;
    }
  } catch {
    // Not JSON at all — a bare legacy timestamp. Unattributable by definition.
  }
  return null;
}

/** Serialise a self-identifying record for `userId`. */
export function buildCooldownRecord(userId: string, ts: number): string {
  return JSON.stringify({ userId, ts } satisfies CooldownRecord);
}

/**
 * The pre-2026-08-21 device-global key. It holds one account's timestamp and is
 * served to every account, so it is deleted on sight rather than migrated —
 * there is no way to know which account wrote it, and the privacy-safe failure
 * mode is that one user may request one extra export (which is their right
 * under GDPR Art.15 anyway), never that someone sees another account's history.
 */
const LEGACY_GLOBAL_KEY = STORAGE_KEY_PREFIX;

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
  // The cooldown is held together with the identity it belongs to, and is only
  // ever rendered when that identity is still the signed-in one. This makes a
  // cross-account frame structurally impossible rather than merely unlikely:
  // no ordering of renders, effects or late promises can produce state that
  // belongs to somebody else and still be displayed.
  const [lastExport, setLastExport] = useState<CooldownRecord | null>(null);
  const lastExportTs = lastExport && lastExport.userId === userId ? lastExport.ts : null;

  // Read THIS ACCOUNT's last-export timestamp from SecureStore.
  //
  // WHY SecureStore: the cooldown key indirectly signals when a GDPR export was
  // requested — that is sensitive metadata. AsyncStorage is plaintext on-disk;
  // SecureStore encrypts at rest via the device keychain / keystore.
  //
  // Keyed on userId and re-run whenever the signed-in account changes, so an
  // account switch on a shared device can never show the previous account's
  // cooldown. The state is reset to null FIRST — before any await — so there is
  // no frame in which the outgoing account's timestamp is still on screen.
  useEffect(() => {
    let cancelled = false;
    setLastExport(null);

    (async () => {
      // Remove the pre-2026-08-21 device-global entry wherever it is still
      // present, so it can no longer be served to whoever signs in next.
      await SecureStore.deleteItemAsync(LEGACY_GLOBAL_KEY).catch(() => {});

      if (!userId) return;
      const key = exportCooldownKey(userId);
      try {
        const raw = await SecureStore.getItemAsync(key);
        const ts = parseCooldownRecord(raw, userId);

        if (raw !== null && ts === null) {
          // Present but unattributable: a bare legacy timestamp, a malformed
          // value, or a record naming another account. Delete it so it cannot
          // be shown on a later visit either, and show no cooldown now.
          await SecureStore.deleteItemAsync(key).catch(() => {});
          if (__DEV__) {
            console.log('[export-cooldown] discarded an unattributable record');
          }
          return;
        }

        // The identity guard still matters: this resolves asynchronously, and
        // the signed-in account may have changed while it was in flight. The
        // record carries its own owner, so the render guard would catch it too
        // — this simply avoids a pointless state update.
        if (!cancelled && ts !== null) {
          setLastExport({ userId, ts });
        }
      } catch {
        // Non-fatal — user just won't see a cooldown if storage read fails.
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

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
      // Self-identifying record — see parseCooldownRecord. `userId` is the one
      // captured when this handler was created, and it is stamped into both the
      // stored value and the state, so a write that lands after an account
      // switch can neither be read by nor rendered for the new account.
      await SecureStore.setItemAsync(exportCooldownKey(userId), buildCooldownRecord(userId, now));
      setLastExport({ userId, ts: now });
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
