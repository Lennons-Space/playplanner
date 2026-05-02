/**
 * PlayPlanner — Create Stripe Checkout Session
 * Supabase Edge Function (runs on Deno, not Node.js)
 *
 * PURPOSE
 * -------
 * Called by the app when a business owner taps "Subscribe".
 * This function:
 *   1. Verifies the caller is a real, signed-in user (via Supabase JWT)
 *   2. Looks up or creates a Stripe Customer for that user
 *   3. Creates a Stripe Checkout Session for the chosen plan
 *   4. Returns the hosted Checkout URL — the app opens it in a browser
 *
 * SECURITY
 * --------
 * The Stripe secret key NEVER leaves this server. The app only receives
 * a short-lived Checkout URL. All payment handling happens on Stripe's
 * servers. The service-role key is used only server-side to read/write
 * the stripe_customer_id on the user's profile.
 *
 * UK/EU GDPR NOTE
 * ---------------
 * We store the Stripe customer ID on the profile so we can link billing
 * events back to the correct user. This is a legitimate-interest basis
 * (billing/contract fulfilment). No unnecessary personal data is sent
 * to Stripe beyond what is needed for payment processing.
 * Logs must never include email addresses, names, or payment details.
 */

import Stripe from 'https://esm.sh/stripe@17?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2026-03-25.dahlia',
})

const PRICE_IDS: Record<string, string> = {
  annual:  Deno.env.get('STRIPE_ANNUAL_PRICE_ID')!,
  monthly: Deno.env.get('STRIPE_MONTHLY_PRICE_ID')!,
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // -------------------------------------------------------------------------
  // 1. Handle CORS preflight
  // Browsers send OPTIONS before the real request. We must respond 200
  // immediately or the actual request will be blocked.
  // -------------------------------------------------------------------------
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // -----------------------------------------------------------------------
    // 2. Verify the caller is an authenticated Supabase user
    // We pass the user's JWT (from the Authorization header) to Supabase.
    // If the token is missing, expired, or tampered with, getUser() fails
    // and we return 401. This ensures only real signed-in users can start
    // a checkout session.
    // -----------------------------------------------------------------------
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    // -----------------------------------------------------------------------
    // 3. Parse and validate the request body
    // We only accept 'annual' or 'monthly'. Any other value is rejected
    // before we touch Stripe, avoiding wasted API calls.
    // -----------------------------------------------------------------------
    const { tier } = await req.json() as { tier: 'annual' | 'monthly' }
    const priceId = PRICE_IDS[tier]
    if (!priceId) {
      return new Response('Invalid tier', { status: 400 })
    }

    // -----------------------------------------------------------------------
    // 4. Look up or create a Stripe Customer
    // We store the Stripe customer ID on the user's profile so that if they
    // subscribe again later, we reuse the same Stripe customer rather than
    // creating a duplicate. This keeps billing history together.
    //
    // We use the SERVICE ROLE key here (bypasses RLS) because this code
    // runs on Supabase's servers, not in the app. It is safe here.
    // -----------------------------------------------------------------------
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const { data: profile } = await adminClient
      .from('profiles')
      .select('stripe_customer_id, full_name')
      .eq('id', user.id)
      .single()

    let customerId = profile?.stripe_customer_id
    if (!customerId) {
      // No existing Stripe customer — create one now.
      // We pass the user's email and name so Stripe's dashboard is readable,
      // and the supabase_user_id so we can always trace back to our DB.
      const customer = await stripe.customers.create({
        email: user.email,
        name: profile?.full_name ?? undefined,
        metadata: { supabase_user_id: user.id },
      })
      customerId = customer.id

      // Persist the new customer ID so future sessions reuse it.
      await adminClient
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id)
    }

    // -----------------------------------------------------------------------
    // 5. Create the Stripe Checkout Session
    // This returns a hosted URL. The user completes payment on Stripe's
    // servers — we never see card details. On success or cancel, Stripe
    // redirects to our deep-link URLs so the app can react.
    //
    // subscription_data.metadata carries the supabase_user_id so the
    // stripe-webhook function can map billing events back to this user.
    // -----------------------------------------------------------------------
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'playplanner://subscription/success',
      cancel_url:  'playplanner://subscription/cancel',
      subscription_data: { metadata: { supabase_user_id: user.id } },
    })

    // Never log the session URL — it contains a one-time token.
    console.log(`[create-checkout-session] Session created for user ${user.id.substring(0, 8)}...`)

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    // Log only the message — never the full error object (may contain keys/PII)
    console.error('[create-checkout-session] error:', (err as Error).message)
    return new Response('Internal error', { status: 500 })
  }
})
