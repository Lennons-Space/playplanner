/**
 * PlayPlanner — Get Stripe Plan Price IDs
 * Supabase Edge Function (runs on Deno, not Node.js)
 *
 * PURPOSE
 * -------
 * Returns the four Stripe plan price IDs that the app needs to initiate
 * a checkout session. By serving these from an edge function rather than
 * baking them into EXPO_PUBLIC_ env vars, we:
 *
 *   1. Keep price IDs out of the compiled JS bundle (reduces attack surface
 *      for plan manipulation if IDs were combined with other techniques).
 *   2. Allow price IDs to be rotated without a new app release.
 *   3. Keep the root .env cleaner — fewer EXPO_PUBLIC_ vars to manage.
 *
 * Price IDs are NOT secret (Stripe uses them as plan identifiers only — a
 * user cannot do anything harmful with a price ID alone), but there is no
 * reason to expose them in the bundle.
 *
 * Accepts:  GET (no body needed)
 * Returns:  { userPremiumMonthly, userPremiumAnnual, businessBasic, businessPro }
 *        or { error: string } with status 500 if any env var is missing
 *
 * AUTH
 * ----
 * No auth required — price IDs are not sensitive credentials.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // ── Read plan price IDs from Deno env ─────────────────────────────────────
  // These are injected by Supabase at deploy time via `supabase secrets set`.
  // They are NEVER in the client bundle.
  const userPremiumMonthly = Deno.env.get('STRIPE_USER_PREMIUM_MONTHLY');
  const userPremiumAnnual  = Deno.env.get('STRIPE_USER_PREMIUM_ANNUAL');
  const businessBasic      = Deno.env.get('STRIPE_BUSINESS_BASIC');
  const businessPro        = Deno.env.get('STRIPE_BUSINESS_PRO');

  // Fail fast if any price ID is not configured — a partial response would
  // cause silent payment failures that are hard to debug.
  if (!userPremiumMonthly || !userPremiumAnnual || !businessBasic || !businessPro) {
    const missing = [
      !userPremiumMonthly && 'STRIPE_USER_PREMIUM_MONTHLY',
      !userPremiumAnnual  && 'STRIPE_USER_PREMIUM_ANNUAL',
      !businessBasic      && 'STRIPE_BUSINESS_BASIC',
      !businessPro        && 'STRIPE_BUSINESS_PRO',
    ].filter(Boolean).join(', ');

    console.error(`[get-plans] Missing Stripe price ID env vars: ${missing}`);
    return json({ error: 'Stripe plans not configured' }, 500);
  }

  return json({ userPremiumMonthly, userPremiumAnnual, businessBasic, businessPro }, 200);
});

// ── Helper ────────────────────────────────────────────────────────────────────

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
