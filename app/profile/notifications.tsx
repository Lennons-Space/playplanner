/**
 * Notifications settings screen.
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

import { useCallback } from 'react';
import { View, Text, Switch, Alert, TouchableOpacity } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { Colors, FontFamily, FontSize, Spacing } from '@/constants/theme';

export default function NotificationsScreen() {
  const user = useUser();
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
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.sand }} edges={['top']}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: Spacing.lg,
            paddingVertical: Spacing.md,
            gap: Spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: Colors.greyLighter,
          }}
        >
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-back" size={24} color={Colors.charcoal} />
          </TouchableOpacity>
          <Text style={{ fontFamily: FontFamily.extraBold, fontSize: FontSize.lg, color: Colors.charcoal, flex: 1 }}>
            Notifications
          </Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg }}>
          <Ionicons name="notifications-off-outline" size={40} color={Colors.grey} />
          <Text style={{ fontFamily: FontFamily.bold, fontSize: FontSize.md, color: Colors.charcoal, marginTop: 12, textAlign: 'center' }}>
            Sign in to manage notifications
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.sand }} edges={['top']}>

      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: Spacing.lg,
          paddingVertical: Spacing.md,
          gap: Spacing.md,
          borderBottomWidth: 1,
          borderBottomColor: Colors.greyLighter,
          backgroundColor: Colors.sand,
        }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={24} color={Colors.charcoal} />
        </TouchableOpacity>
        <Text
          style={{
            fontFamily: FontFamily.extraBold,
            fontSize: FontSize.lg,
            color: Colors.charcoal,
            flex: 1,
          }}
        >
          Notifications
        </Text>
      </View>

      {/* Body */}
      <View style={{ flex: 1, paddingHorizontal: Spacing.lg, paddingTop: Spacing.xl }}>

        {/* Toggle card */}
        <View
          style={{
            backgroundColor: Colors.surface,
            borderRadius: 16,
            paddingHorizontal: Spacing.lg,
            paddingVertical: 18,
            flexDirection: 'row',
            alignItems: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.05,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 1 },
            elevation: 2,
          }}
        >
          {/* Icon badge */}
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: Colors.sky + '18',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: Spacing.md,
            }}
          >
            <Ionicons
              name={notificationsEnabled ? 'notifications' : 'notifications-off-outline'}
              size={20}
              color={Colors.sky}
            />
          </View>

          {/* Label */}
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: FontFamily.bold,
                fontSize: FontSize.md,
                color: Colors.charcoal,
              }}
            >
              Push notifications
            </Text>
            <Text
              style={{
                fontFamily: FontFamily.regular,
                fontSize: FontSize.sm,
                color: Colors.grey,
                marginTop: 2,
              }}
            >
              {notificationsEnabled ? 'Enabled' : 'Disabled'}
            </Text>
          </View>

          <Switch
            value={notificationsEnabled}
            onValueChange={handleToggle}
            disabled={isLoading}
            trackColor={{ false: Colors.greyLighter, true: Colors.sky }}
            thumbColor="#fff"
            accessibilityRole="switch"
            accessibilityLabel="Toggle push notifications"
            accessibilityState={{ checked: notificationsEnabled, disabled: isLoading }}
            style={{ opacity: isLoading ? 0.4 : 1 }}
          />
        </View>

        {/* GDPR-friendly explanation of what we'll send */}
        <Text
          style={{
            fontFamily: FontFamily.regular,
            fontSize: FontSize.sm,
            color: Colors.grey,
            marginTop: Spacing.lg,
            lineHeight: 20,
            paddingHorizontal: Spacing.xs,
          }}
        >
          We'll notify you when your reviews are published. You can turn this off at any time.
        </Text>

        {/* Privacy reassurance card */}
        <View
          style={{
            backgroundColor: Colors.sky + '12',
            borderRadius: 12,
            padding: Spacing.md,
            marginTop: Spacing.lg,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: Spacing.sm,
          }}
        >
          <Ionicons
            name="shield-checkmark-outline"
            size={16}
            color={Colors.sky}
            style={{ marginTop: 1 }}
          />
          <Text
            style={{
              fontFamily: FontFamily.regular,
              fontSize: FontSize.sm,
              color: Colors.charcoal,
              flex: 1,
              lineHeight: 19,
            }}
          >
            We'll never send marketing messages or sell your data to third parties.
            Notification tokens are deleted automatically if you delete your account.
          </Text>
        </View>

      </View>
    </SafeAreaView>
  );
}
