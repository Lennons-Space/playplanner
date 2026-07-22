/**
 * Notifications settings screen.
 *
 * v2 dark restyle (Step 5, feat/exact-v2-design): VISUAL LAYER ONLY. The
 * permission-check/register/unregister logic, the token-existence query and
 * the useFocusEffect re-check are byte-identical to the pre-restyle version.
 *
 * This screen previously supplied its own custom header AND sat under a
 * Stack with no `<Stack.Screen options={{title}}>` — Expo Router rendered
 * the literal route filename ("notifications") as a second native header
 * above this screen's own. See app/profile/_layout.tsx (headerShown:false)
 * for the fix; this screen's header is now the ONLY header rendered.
 *
 * Step 10A Part 2 (dual-theme foundation, proof set): the screen BODY now
 * follows the resolved theme via useAppTheme() and mounts
 * <ThemedBackground/> instead of a direct <V2Background/> (dark path is
 * byte-identical). <V2Header/> itself is INTENTIONALLY left hard-coded dark
 * this phase — it is shared chrome used by the ~28 screens not yet
 * converted, so making it dynamic here would flip it to light while every
 * other screen using it stays dark. Known consequence: in light mode this
 * screen's header text stays dark-styled (near-white) — a scoped, documented
 * gap that a later phase closes once V2Header itself is migrated.
 *
 * GDPR / ICO Children's Code
 * --------------------------
 * Notifications are opt-in only. The user must actively toggle the switch to
 * register. We explain clearly what we'll send and how to turn it off.
 * (ICO Children's Code Standard 3: privacy by default; GDPR Art.7 consent.)
 *
 * When permission is denied at the OS level, we tell the user how to re-enable
 * it in Settings rather than silently failing — this preserves transparency
 * (GDPR Art.5(1)(a) fair and transparent processing).
 */

import { useCallback, useMemo } from 'react';
import { View, Text, Switch, Alert, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { Icon } from '@/components/ui/Icon';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { ThemedBackground } from '@/components/ui/ThemedBackground';
import { V2Header } from '@/components/ui/V2Header';
import { FontFamily, type ThemeTokens, type AccentPalette } from '@/constants/theme';
import { useAppTheme } from '@/hooks/useAppTheme';

export default function NotificationsScreen() {
  const user = useUser();
  const { tokens: T, accent: ACCENT, mode } = useAppTheme();
  const styles = useMemo(() => createStyles(T, ACCENT), [T, ACCENT]);
  const { isRegistered, isLoading: hookLoading, register, unregister } = usePushNotifications();

  // If OS permission is revoked while the app is backgrounded, the toggle would
  // still show "on" when the user returns. Re-check on every focus and call
  // unregister() so the token is removed from DB and the toggle reflects reality.
  useFocusEffect(
    useCallback(() => {
      Notifications.getPermissionsAsync().then(({ status }) => {
        if (status !== 'granted') {
          unregister();
        }
      });
    }, [unregister])
  );

  // ── Check whether the user already has a push token saved in the DB ─────────
  // This determines the initial toggle state when the screen first opens.
  // staleTime: 0 means we always re-check on mount (correct for a settings page).
  const { data: hasExistingToken, isLoading: tokenCheckLoading } = useQuery({
    queryKey: ['push-tokens', 'has-token', user?.id],
    queryFn: async () => {
      if (!user) return false;
      const { count, error } = await supabase
        .from('push_tokens')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);
      if (error) {
        // Log only the error code — never user ID or token value.
        console.error('[notifications] token check failed:', error.code, error.message);
        return false;
      }
      return (count ?? 0) > 0;
    },
    enabled: !!user,
    staleTime: 0,
  });

  // The effective "on" state: a token exists in DB (from a previous session)
  // OR we just registered this session.
  const notificationsEnabled = isRegistered || (hasExistingToken ?? false);

  const isLoading = hookLoading || tokenCheckLoading;

  // ── Toggle handler ───────────────────────────────────────────────────────────
  async function handleToggle(value: boolean) {
    if (value) {
      const success = await register();
      if (!success) {
        // Permission was denied by the OS. Tell the user how to fix it.
        Alert.alert(
          'Notifications blocked',
          'To receive notifications, please enable them for PlayPlanner in your device Settings.',
          [{ text: 'OK' }]
        );
      }
    } else {
      await unregister();
    }
  }

  // ── Signed-out guard ─────────────────────────────────────────────────────────
  if (!user) {
    return (
      <View style={styles.root}>
        <ThemedBackground />
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
        <SafeAreaView style={styles.safe} edges={['top']}>
          <V2Header title="Notifications" />
          <View style={styles.signedOutBody}>
            <Icon name="bell" size={36} color={T.label4} />
            <Text style={styles.signedOutText}>Sign in to manage notifications</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <ThemedBackground />
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <V2Header title="Notifications" />

        <View style={styles.body}>

          {/* Toggle card */}
          <GlassSurface style={styles.toggleCard} tintColor="rgba(14,14,20,0.55)">
            <View style={styles.iconBox}>
              <Icon
                name="bell"
                size={20}
                color={ACCENT.accent}
              />
            </View>

            <View style={styles.flex}>
              <Text style={styles.toggleLabel}>Push notifications</Text>
              <Text style={styles.toggleSub}>
                {notificationsEnabled ? 'Enabled' : 'Disabled'}
              </Text>
            </View>

            <Switch
              value={notificationsEnabled}
              onValueChange={handleToggle}
              disabled={isLoading}
              trackColor={{ false: T.fill, true: ACCENT.accent }}
              thumbColor="#FFFFFF"
              accessibilityRole="switch"
              accessibilityLabel="Toggle push notifications"
              accessibilityState={{ checked: notificationsEnabled, disabled: isLoading }}
              style={{ opacity: isLoading ? 0.4 : 1 }}
            />
          </GlassSurface>

          {/* GDPR-friendly explanation of what we'll send */}
          <Text style={styles.explainer}>
            We&apos;ll notify you when your reviews are published. You can turn this off at any time.
          </Text>

          {/* Privacy reassurance card */}
          <GlassSurface style={styles.privacyCard} tintColor={ACCENT.light}>
            <Icon
              name="shield"
              size={16}
              color={ACCENT.accent}
              strokeWidth={1.8}
            />
            <Text style={styles.privacyText}>
              We&apos;ll never send marketing messages or sell your data to third parties.
              Notification tokens are deleted automatically if you delete your account.
            </Text>
          </GlassSurface>

        </View>
      </SafeAreaView>
    </View>
  );
}

function createStyles(T: ThemeTokens, ACCENT: AccentPalette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    safe: { flex: 1, backgroundColor: 'transparent' },
    flex: { flex: 1 },

    signedOutBody: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
      gap: 12,
    },
    signedOutText: {
      fontFamily: FontFamily.heading,
      fontSize: 15,
      color: T.label2,
      textAlign: 'center',
    },

    body: {
      paddingHorizontal: 20,
      paddingTop: 8,
    },

    toggleCard: {
      borderRadius: 18,
      padding: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    iconBox: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: ACCENT.light,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toggleLabel: {
      fontFamily: FontFamily.heading,
      fontSize: 15,
      color: T.label,
    },
    toggleSub: {
      fontFamily: FontFamily.body,
      fontSize: 13,
      color: T.label3,
      marginTop: 2,
    },

    explainer: {
      fontFamily: FontFamily.body,
      fontSize: 13,
      color: T.label3,
      lineHeight: 19,
      marginTop: 16,
      paddingHorizontal: 4,
    },

    privacyCard: {
      borderRadius: 14,
      padding: 14,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      marginTop: 16,
    },
    privacyText: {
      flex: 1,
      fontFamily: FontFamily.body,
      fontSize: 13,
      color: T.label2,
      lineHeight: 19,
    },
  });
}
