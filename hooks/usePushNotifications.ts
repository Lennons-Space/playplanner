/**
 * usePushNotifications — Expo push token registration / deregistration.
 *
 * PRIVACY & GDPR
 * --------------
 * Push tokens are device-level identifiers and are personal data under
 * UK/EU GDPR. This hook:
 *   - Never auto-registers on mount. The user must tap "Enable" explicitly.
 *     (ICO Children's Code Standard 3: privacy by default; GDPR Art.7 consent.)
 *   - Never logs tokens or user IDs.
 *   - Provides `unregister()` so the user can withdraw consent at any time.
 *     (GDPR Art.7(3): right to withdraw consent.)
 *   - Token deletion on account deletion is handled by ON DELETE CASCADE in
 *     migration 035, satisfying GDPR Art.17 (right to erasure) automatically.
 *
 * DEVICE CHECK
 * ------------
 * Expo push tokens only work on real physical devices — the Expo push service
 * cannot reach the iOS Simulator or Android Emulator. We use Constants.isDevice
 * (from expo-constants) rather than expo-device, which is not installed.
 *
 * NOTIFICATION HANDLER
 * --------------------
 * Notifications.setNotificationHandler is NOT called here. It lives in
 * app/_layout.tsx so it runs once at app boot, not on every module import.
 */

import { useState, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';

interface UsePushNotificationsResult {
  /** True once a token has been successfully saved to the DB for this session. */
  isRegistered: boolean;
  /** True while the permission request or DB upsert is in flight. */
  isLoading: boolean;
  /**
   * Request permission and upsert the push token into push_tokens.
   * Resolves to `true` if registration succeeded, `false` otherwise
   * (e.g. permission denied, not a real device, missing EAS projectId).
   */
  register: () => Promise<boolean>;
  /**
   * Delete the current device token from push_tokens.
   * Call this when the user toggles notifications off.
   */
  unregister: () => Promise<void>;
}

export function usePushNotifications(): UsePushNotificationsResult {
  const user = useUser();
  const queryClient = useQueryClient();
  const [isRegistered, setIsRegistered] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // useRef keeps the token scoped to this hook instance across re-renders.
  const currentTokenRef = useRef<string | null>(null);

  const register = useCallback(async (): Promise<boolean> => {
    // Guard: push tokens only work on real physical devices.
    if (!Constants.isDevice) return false;

    // Guard: must be authenticated before we can save a token.
    if (!user) return false;

    setIsLoading(true);

    try {
      // Request explicit permission — required for ICO Children's Code Standard 3
      // and GDPR Art.7. On iOS this shows the system dialog on first call.
      const { status } = await Notifications.requestPermissionsAsync();

      if (status !== 'granted') {
        // The user declined. The caller is responsible for showing explanation.
        return false;
      }

      // Expo SDK 49+ requires projectId — without it getExpoPushTokenAsync throws.
      // Fail early with a clear error rather than silently triggering the catch.
      const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
      if (!projectId) {
        console.error('[usePushNotifications] EAS projectId missing from app config — cannot get push token');
        return false;
      }

      const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
      const token = tokenResponse.data;
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';

      // Upsert: UNIQUE (user_id, token) prevents duplicate rows on re-grant.
      const { error } = await supabase
        .from('push_tokens')
        .upsert(
          { user_id: user.id, token, platform },
          { onConflict: 'user_id,token', ignoreDuplicates: false }
        );

      if (error) {
        // Log only code and message — never the token value itself.
        console.error('[usePushNotifications] upsert failed:', error.code, error.message);
        return false;
      }

      currentTokenRef.current = token;
      setIsRegistered(true);
      return true;

    } catch (err) {
      console.error('[usePushNotifications] register error:', (err as Error).message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  const unregister = useCallback(async (): Promise<void> => {
    if (!user) return;

    setIsLoading(true);

    try {
      if (currentTokenRef.current) {
        // Delete the specific token registered this session.
        await supabase
          .from('push_tokens')
          .delete()
          .eq('user_id', user.id)
          .eq('token', currentTokenRef.current);
      } else {
        // No token in memory (registered in a previous session) — delete all
        // tokens for this user as a broad opt-out. This is the correct fallback
        // for explicit opt-out; token pruning for individual devices should be
        // handled via Expo push receipts in a future cleanup job.
        await supabase
          .from('push_tokens')
          .delete()
          .eq('user_id', user.id);
      }

      currentTokenRef.current = null;
      setIsRegistered(false);
      // Write false into the cache immediately so the toggle reflects reality
      // without waiting for a background refetch. This prevents the brief
      // "Enabled" flicker that would otherwise appear after OS permission is
      // revoked and unregister() is called from the focus effect.
      queryClient.setQueryData(['push-tokens', 'has-token', user.id], false);

    } catch (err) {
      console.error('[usePushNotifications] unregister error:', (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [user, queryClient]);

  return { isRegistered, isLoading, register, unregister };
}
