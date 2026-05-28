import { initStripe } from '@stripe/stripe-react-native';
import { supabase } from '@/lib/supabase';
import { PAYMENTS_ENABLED } from '@/constants/features';

export async function setupStripe() {
  // Payments postponed (constants/features.ts). Without a publishable key,
  // initStripe would receive `undefined` and throw — so no-op when disabled.
  if (!PAYMENTS_ENABLED) return;
  await initStripe({
    publishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
    merchantIdentifier: 'merchant.com.playplanner.app', // for Apple Pay
    urlScheme: 'playplanner',
  });
}

// ── Plan price IDs ────────────────────────────────────────────────────────────
//
// Price IDs are fetched from the get-plans edge function rather than baked into
// EXPO_PUBLIC_ env vars. This keeps them out of the compiled JS bundle and
// allows rotation without a new app release.
//
// They are NOT secret (a price ID alone cannot trigger any payment), but there
// is no benefit to bundling them client-side.

export interface PlanPriceIds {
  userPremiumMonthly: string;
  userPremiumAnnual: string;
  businessBasic: string;
  businessPro: string;
}

export async function fetchPlanPriceIds(): Promise<PlanPriceIds> {
  const { data, error } = await supabase.functions.invoke('get-plans');
  if (error) throw error;
  return data as PlanPriceIds;
}

// Human-readable plan details shown in the UI
export const PLAN_DETAILS = {
  user_premium: {
    monthly: { price: '£2.99', label: 'Monthly' },
    annual:  { price: '£24.99', label: 'Annual (save 30%)' },
    features: [
      'Ad-free experience',
      'Advanced filters',
      'Unlimited favourites lists',
      'Early access to new venues',
    ],
  },
  business_basic: {
    price: '£9.99/mo',
    features: [
      'Verified listing badge',
      'Respond to reviews',
      'Add up to 10 photos',
      'Basic analytics',
    ],
  },
  business_pro: {
    price: '£24.99/mo',
    features: [
      'Everything in Basic',
      'Featured placement on map',
      'Unlimited photos & videos',
      'Post offers & promotions',
      'Full analytics dashboard',
      'Priority support',
    ],
  },
};
