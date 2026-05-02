/**
 * Centralised pricing constants.
 * Update here and all screens stay in sync automatically.
 * Prices are display strings — do not use these for Stripe amounts (use pence integers there).
 * Stripe price IDs live in Supabase Edge Function env vars only — never here.
 */
export const PREMIUM_PRICE_MONTHLY         = '£2.99';
export const PREMIUM_PRICE_MONTHLY_DISPLAY = '£2.99 / month';
export const PREMIUM_PRICE_ANNUAL          = '£19.99';
export const PREMIUM_PRICE_ANNUAL_DISPLAY  = '£19.99 / year';
export const PREMIUM_PRICE_ANNUAL_MONTHLY_EQUIV = '£1.67/mo';
