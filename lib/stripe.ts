import { initStripe } from '@stripe/stripe-react-native';

export async function setupStripe() {
  await initStripe({
    publishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
    merchantIdentifier: 'merchant.com.playplanner.app', // for Apple Pay
    urlScheme: 'playplanner',
  });
}

// Price IDs from your Stripe dashboard (set in .env)
export const STRIPE_PRICES = {
  USER_PREMIUM_MONTHLY: process.env.EXPO_PUBLIC_STRIPE_USER_PREMIUM_MONTHLY!,
  USER_PREMIUM_ANNUAL:  process.env.EXPO_PUBLIC_STRIPE_USER_PREMIUM_ANNUAL!,
  BUSINESS_BASIC:       process.env.EXPO_PUBLIC_STRIPE_BUSINESS_BASIC!,
  BUSINESS_PRO:         process.env.EXPO_PUBLIC_STRIPE_BUSINESS_PRO!,
} as const;

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
