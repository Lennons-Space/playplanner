/**
 * useSubscribe — PlayPlanner subscription hook
 *
 * PURPOSE
 * -------
 * Called by app/business/upgrade.tsx when a business owner taps "Subscribe".
 * This hook:
 *   1. Calls the create-checkout-session Edge Function with the chosen plan tier
 *   2. Opens the returned Stripe-hosted Checkout URL in a secure in-app browser
 *   3. Refreshes the user profile on close (success OR cancel) so the UI
 *      reflects any subscription change that may have occurred
 *
 * WHY AN EDGE FUNCTION?
 * ----------------------
 * The Stripe secret key must never be bundled into the app. We call our
 * own server (the Edge Function) which holds the secret, and it gives us
 * back only a short-lived Checkout URL. The app never touches payment details.
 *
 * WHY openBrowserAsync?
 * ----------------------
 * Stripe Checkout is a full web page. expo-web-browser opens it in the
 * platform's trusted browser (Safari/Chrome), giving the user confidence
 * they are on a real Stripe page, not a phishing screen inside our app.
 *
 * PRIVACY
 * -------
 * No payment information is logged or stored in the app. The only data
 * that flows through this hook is the plan tier and the Checkout URL.
 *
 * PREREQUISITE
 * ------------
 * expo-web-browser must be installed:
 *   npx expo install expo-web-browser
 */

import { useMutation } from '@tanstack/react-query'
import * as WebBrowser from 'expo-web-browser'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { PAYMENTS_ENABLED } from '@/constants/features'

interface SubscribeInput {
  tier: 'annual' | 'monthly'
}

export function useSubscribe() {
  const fetchProfile = useAuthStore((s) => s.fetchProfile)
  const session = useAuthStore((s) => s.session)

  return useMutation({
    mutationFn: async ({ tier }: SubscribeInput) => {
      // Defence-in-depth: payments are postponed (constants/features.ts). The
      // upgrade screen already shows "Coming soon" instead of calling this hook
      // when disabled, but guard here too so checkout can never fire without a
      // Stripe key configured.
      if (!PAYMENTS_ENABLED) throw new Error('Payments are not available yet.')

      // Guard: user must be signed in before we attempt a checkout.
      // This should never fire in normal use (the upgrade screen is
      // gated behind auth) but acts as a safety net.
      if (!session) throw new Error('You must be signed in to subscribe.')

      // Call our Edge Function — the Stripe secret key stays on the server.
      // supabase.functions.invoke automatically attaches the user's JWT in
      // the Authorization header, so the function can verify the caller.
      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: { tier },
      })

      if (error) throw new Error(error.message ?? 'Could not start checkout. Please try again.')

      const { url } = data as { url: string }
      if (!url) throw new Error('No checkout URL returned.')

      // Open Stripe-hosted Checkout in the device's trusted browser.
      // We use openBrowserAsync (not openAuthSessionAsync) because this
      // is a payment flow, not an OAuth flow — we do not need to intercept
      // the redirect URL in the app. The webhook updates the DB for us.
      await WebBrowser.openBrowserAsync(url)
    },

    onSettled: () => {
      // Refresh the profile regardless of success or cancel.
      // The stripe-webhook may have already fired and updated subscription
      // status by the time the user closes the browser. Refreshing here
      // ensures the UI stays in sync without requiring a manual reload.
      fetchProfile()
    },
  })
}
