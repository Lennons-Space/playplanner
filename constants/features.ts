// ─────────────────────────────────────────────────────────────────
// features.ts — runtime feature flags.
//
// PAYMENTS_ENABLED:
//   Monetisation (Stripe) is postponed until after launch validation.
//   Rather than a separate on/off switch someone has to remember to flip,
//   we tie "payments enabled" directly to "is the Stripe publishable key
//   present in the environment". Consequences:
//     • EAS preview / beta builds (no EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY)
//       → payments OFF, app boots cleanly, no paywall, no dead checkout.
//     • Add the key back later → payments turn ON automatically. No code
//       change needed to re-enable.
//
//   Every Stripe runtime path (StripeProvider, the upgrade paywall, the
//   useSubscribe checkout) is guarded by this flag. Stripe source files are
//   intentionally KEPT — this disables the launch/runtime dependency only.
// ─────────────────────────────────────────────────────────────────

export const PAYMENTS_ENABLED = !!process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
