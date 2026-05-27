/**
 * PlayPlanner — Stripe Webhook Handler
 * Supabase Edge Function (runs on Deno, not Node.js)
 *
 * PURPOSE
 * -------
 * Stripe calls this URL automatically after every billing event.
 * This function reads the event, decides what changed, and updates
 * the database so the app reflects reality (premium on/off, etc.).
 *
 * SECURITY
 * --------
 * Every incoming request is verified against Stripe's signature before
 * any database work happens. A forged request will be rejected at step 1.
 * The service-role key is used (bypasses RLS) because this runs as a
 * trusted server process, not as a logged-in app user.
 *
 * UK/EU GDPR NOTE
 * ---------------
 * This function processes billing data (subscription IDs, customer IDs).
 * No personal data beyond what Stripe already holds is stored here.
 * Logs must never include raw personal data — structured error messages only.
 */

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// CORS headers
// These tell browsers (and Stripe's servers) which requests are allowed.
// The stripe-signature header MUST be listed or verification will fail.
// ---------------------------------------------------------------------------
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, stripe-signature',
};

// ---------------------------------------------------------------------------
// Price ID → plan name mapping
// These come from your .env / Supabase Edge Function secrets.
// They match the values in lib/stripe.ts on the app side.
// ---------------------------------------------------------------------------
const PRICE_TO_PLAN: Record<string, 'basic' | 'pro'> = {
  [Deno.env.get('STRIPE_PRICE_BUSINESS_BASIC') ?? '']: 'basic',
  [Deno.env.get('STRIPE_PRICE_BUSINESS_PRO') ?? '']: 'pro',
};

/**
 * Given a Stripe price ID, return the matching plan name for our DB.
 * Falls back to 'basic' if the price ID is not recognised.
 */
function planFromPriceId(priceId: string | null | undefined): 'basic' | 'pro' {
  if (!priceId) return 'basic';
  return PRICE_TO_PLAN[priceId] ?? 'basic';
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  // ------------------------------------------------------------------
  // 1. Handle CORS preflight
  // Browsers send an OPTIONS request before the real request to check
  // if cross-origin calls are allowed. We must respond 200 immediately.
  // ------------------------------------------------------------------
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ------------------------------------------------------------------
    // 2. Initialise clients
    // ------------------------------------------------------------------

    // Stripe client — server-side secret key, never the publishable key
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-04-10',
      httpClient: Stripe.createFetchHttpClient(), // Deno-compatible HTTP
    });

    // Supabase admin client — service role key bypasses RLS.
    // This is safe here because this code runs on Supabase's servers,
    // never in the app. It must NEVER be shipped to the mobile client.
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ------------------------------------------------------------------
    // 3. Verify the webhook signature
    // Stripe signs every webhook with a secret (whsec_...). If the
    // signature is missing or wrong, someone is sending fake requests.
    // We must reject those immediately — before touching the database.
    // ------------------------------------------------------------------
    const signature = req.headers.get('stripe-signature');
    if (!signature) {
      console.error('[stripe-webhook] Missing stripe-signature header');
      return new Response(
        JSON.stringify({ error: 'Missing stripe-signature' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const body = await req.text(); // must read as raw text for signature check
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      // Invalid signature — log without echoing back the raw error to the caller
      console.error('[stripe-webhook] Signature verification failed:', (err as Error).message);
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`[stripe-webhook] Received verified event: ${event.type}`);

    // ------------------------------------------------------------------
    // 4. Route to the correct handler based on event type
    // ------------------------------------------------------------------
    switch (event.type) {

      // ----------------------------------------------------------------
      // checkout.session.completed
      // Fired when a business owner successfully completes the Stripe
      // Checkout flow and pays for the first time. This is where we
      // create the subscription record and enable the premium flag.
      // ----------------------------------------------------------------
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        // Only handle subscription checkouts, not one-off payments
        if (session.mode !== 'subscription') break;

        const subscriptionId = session.subscription as string;
        const customerId = session.customer as string;

        // Retrieve the full subscription object from Stripe so we have
        // the price ID, period dates, and status.
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0]?.price?.id ?? null;
        const plan = planFromPriceId(priceId);

        // The client_reference_id is set by the app when it creates the
        // checkout session — it must be the user's Supabase profile ID
        // and the venue ID, joined with a pipe: "profileId|venueId"
        const [profileId, venueId] = (session.client_reference_id ?? '|').split('|');

        if (!profileId || !venueId) {
          console.error(
            '[stripe-webhook] checkout.session.completed: missing client_reference_id',
            { sessionId: session.id },
          );
          break;
        }

        // Security: verify the profile in client_reference_id actually owns (or has
        // claimed) this venue. Without this check a malicious actor could craft a
        // checkout session with any profileId|venueId pair and trigger premium
        // activation on a venue they do not own.
        const { data: venueRow, error: ownershipError } = await supabaseAdmin
          .from('venues')
          .select('claimed_by')
          .eq('id', venueId)
          .single();

        if (ownershipError || !venueRow) {
          console.error('[stripe-webhook] checkout.session.completed: venue not found', { venueId });
          return new Response(
            JSON.stringify({ error: 'Venue not found' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }

        if (venueRow.claimed_by !== null && venueRow.claimed_by !== profileId) {
          console.error('[stripe-webhook] checkout.session.completed: ownership mismatch — rejecting');
          return new Response(
            JSON.stringify({ error: 'Ownership mismatch' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }

        // Upsert the subscription record.
        // onConflict: 'stripe_subscription_id' means if Stripe sends this
        // event twice (it retries on network failures), the second call
        // simply overwrites the first instead of creating a duplicate row.
        const { error: upsertError } = await supabaseAdmin
          .from('business_subscriptions')
          .upsert(
            {
              profile_id: profileId,
              venue_id: venueId,
              stripe_subscription_id: subscriptionId,
              stripe_customer_id: customerId,
              plan,
              status: subscription.status === 'trialing' ? 'trialing' : 'active',
              current_period_start: new Date(
                subscription.current_period_start * 1000,
              ).toISOString(),
              current_period_end: new Date(
                subscription.current_period_end * 1000,
              ).toISOString(),
            },
            { onConflict: 'stripe_subscription_id' },
          );

        if (upsertError) {
          console.error('[stripe-webhook] Failed to upsert subscription:', upsertError.message);
          throw upsertError;
        }

        // Enable the premium flag on the venue
        const { error: premiumError } = await supabaseAdmin
          .from('venues')
          .update({ is_premium: true })
          .eq('id', venueId);

        if (premiumError) {
          console.error('[stripe-webhook] Failed to set is_premium=true:', premiumError.message);
          throw premiumError;
        }

        // Also store the Stripe customer ID on the profile so future
        // billing portal links and subscription lookups work correctly
        const { error: profileError } = await supabaseAdmin
          .from('profiles')
          .update({ stripe_customer_id: customerId })
          .eq('id', profileId);

        if (profileError) {
          // Non-fatal — log but do not throw. Premium is already enabled.
          console.warn(
            '[stripe-webhook] Could not update stripe_customer_id on profile:',
            profileError.message,
          );
        }

        console.log(`[stripe-webhook] checkout.session.completed: venue ${venueId} set to premium`);
        break;
      }

      // ----------------------------------------------------------------
      // customer.subscription.updated
      // Fired when a subscription changes — plan upgrade/downgrade,
      // or when Stripe transitions a trial to an active paid subscription.
      // We update the plan name and status in our database.
      // ----------------------------------------------------------------
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const priceId = subscription.items.data[0]?.price?.id ?? null;
        const plan = planFromPriceId(priceId);

        // Map Stripe's status values to our database's allowed values
        const statusMap: Record<string, 'active' | 'cancelled' | 'past_due' | 'trialing'> = {
          active: 'active',
          trialing: 'trialing',
          past_due: 'past_due',
          canceled: 'cancelled',   // Stripe uses American spelling
          incomplete: 'past_due',
          incomplete_expired: 'cancelled',
          unpaid: 'past_due',
          paused: 'past_due',
        };
        const status = statusMap[subscription.status] ?? 'past_due';

        const { error } = await supabaseAdmin
          .from('business_subscriptions')
          .update({
            plan,
            status,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          })
          .eq('stripe_subscription_id', subscription.id);

        if (error) {
          console.error('[stripe-webhook] customer.subscription.updated failed:', error.message);
          throw error;
        }

        console.log(
          `[stripe-webhook] customer.subscription.updated: sub ${subscription.id} → plan=${plan} status=${status}`,
        );
        break;
      }

      // ----------------------------------------------------------------
      // customer.subscription.deleted
      // Fired when a subscription is fully cancelled (not just paused).
      // We mark the subscription as cancelled and turn off is_premium.
      // ----------------------------------------------------------------
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;

        // First, find the venue linked to this subscription so we can
        // revoke its premium status
        const { data: subRow, error: lookupError } = await supabaseAdmin
          .from('business_subscriptions')
          .select('venue_id')
          .eq('stripe_subscription_id', subscription.id)
          .single();

        if (lookupError || !subRow) {
          console.error(
            '[stripe-webhook] customer.subscription.deleted: subscription not found in DB',
            subscription.id,
          );
          break;
        }

        // Mark the subscription as cancelled
        const { error: cancelError } = await supabaseAdmin
          .from('business_subscriptions')
          .update({ status: 'cancelled' })
          .eq('stripe_subscription_id', subscription.id);

        if (cancelError) {
          console.error('[stripe-webhook] Failed to set status=cancelled:', cancelError.message);
          throw cancelError;
        }

        // Revoke the premium flag on the venue
        const { error: premiumError } = await supabaseAdmin
          .from('venues')
          .update({ is_premium: false })
          .eq('id', subRow.venue_id);

        if (premiumError) {
          console.error('[stripe-webhook] Failed to set is_premium=false:', premiumError.message);
          throw premiumError;
        }

        console.log(
          `[stripe-webhook] customer.subscription.deleted: venue ${subRow.venue_id} premium revoked`,
        );
        break;
      }

      // ----------------------------------------------------------------
      // invoice.payment_succeeded
      // Fired every time a recurring payment goes through successfully.
      // We confirm the subscription is active and update the period end
      // date so we always know when the next payment is due.
      // ----------------------------------------------------------------
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;

        // Only act on subscription invoices, not one-off charges
        if (!invoice.subscription) break;

        // Retrieve the subscription to get the fresh period end date
        const subscription = await stripe.subscriptions.retrieve(
          invoice.subscription as string,
        );

        const { error } = await supabaseAdmin
          .from('business_subscriptions')
          .update({
            status: 'active',
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          })
          .eq('stripe_subscription_id', invoice.subscription as string);

        if (error) {
          console.error('[stripe-webhook] invoice.payment_succeeded update failed:', error.message);
          throw error;
        }

        console.log(
          `[stripe-webhook] invoice.payment_succeeded: sub ${invoice.subscription} renewed, period_end updated`,
        );
        break;
      }

      // ----------------------------------------------------------------
      // invoice.payment_failed
      // Fired when a renewal payment fails (expired card, insufficient
      // funds, etc.). We mark the subscription as past_due. Stripe will
      // retry automatically. If all retries fail, subscription.deleted
      // fires and we then revoke premium.
      // ----------------------------------------------------------------
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;

        if (!invoice.subscription) break;

        const { error } = await supabaseAdmin
          .from('business_subscriptions')
          .update({ status: 'past_due' })
          .eq('stripe_subscription_id', invoice.subscription as string);

        if (error) {
          console.error('[stripe-webhook] invoice.payment_failed update failed:', error.message);
          throw error;
        }

        // NOTE: We intentionally do NOT turn off is_premium here.
        // Stripe gives a grace period and retries. Only when the
        // subscription is actually deleted (all retries exhausted)
        // do we revoke premium. This avoids penalising businesses
        // for a single transient payment failure.
        console.log(
          `[stripe-webhook] invoice.payment_failed: sub ${invoice.subscription} marked past_due`,
        );
        break;
      }

      // ----------------------------------------------------------------
      // customer.subscription.trial_will_end
      // Fired 3 days before a trial ends. No DB change needed yet —
      // this is the place to add push notifications or emails in future.
      // ----------------------------------------------------------------
      case 'customer.subscription.trial_will_end': {
        const subscription = event.data.object as Stripe.Subscription;
        console.log(
          `[stripe-webhook] customer.subscription.trial_will_end: sub ${subscription.id} — notification hook (no DB change)`,
        );
        break;
      }

      // ----------------------------------------------------------------
      // All other events — acknowledge receipt but take no action.
      // Stripe expects a 200 response even for events we don't handle.
      // ----------------------------------------------------------------
      default:
        console.log(`[stripe-webhook] Unhandled event type: ${event.type} — ignoring`);
        break;
    }

    // ------------------------------------------------------------------
    // 5. Return success
    // Stripe considers any 2xx response a success. If we return 4xx/5xx,
    // Stripe will retry the webhook for up to 3 days.
    // ------------------------------------------------------------------
    return new Response(
      JSON.stringify({ received: true }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );

  } catch (err) {
    // ------------------------------------------------------------------
    // 6. Catch-all error handler
    // Return 400 for client/input errors (bad IDs, ownership mismatches) so
    // Stripe does not retry them pointlessly for 3 days.
    // Return 500 only for server-side failures (DB timeouts, connection errors)
    // which Stripe should retry. Never expose internal error details in the body.
    // ------------------------------------------------------------------
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[stripe-webhook] Unhandled error:', message);

    const isClientError =
      message.includes('not found') ||
      message.includes('ownership') ||
      message.includes('invalid') ||
      message.includes('missing') ||
      message.includes('reference');

    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: isClientError ? 400 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
