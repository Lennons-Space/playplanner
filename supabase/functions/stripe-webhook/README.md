# stripe-webhook — Supabase Edge Function

## What this does

When a business pays for a premium listing, Stripe sends a message to this function. It verifies the message is genuinely from Stripe, then updates the database — turning the `is_premium` flag on for their venue and recording their subscription status. When they cancel, it turns the flag back off.

## How to deploy

```bash
supabase functions deploy stripe-webhook
```

Run this from the `D:\PlayPlanner` directory after installing the Supabase CLI.

## Setting environment variables

Go to: **Supabase Dashboard → Settings → Edge Functions → stripe-webhook → Edit secrets**

Add each variable from `.env.example` with your real values.

## Setting the webhook URL in Stripe

1. Go to **Stripe Dashboard → Developers → Webhooks → Add endpoint**
2. Set the URL to: `https://YOUR-PROJECT-REF.supabase.co/functions/v1/stripe-webhook`
3. Select these events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.trial_will_end`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Copy the **Signing secret** (starts with `whsec_`) into the `STRIPE_WEBHOOK_SECRET` env var.

## Testing locally (free — uses Stripe CLI)

```bash
stripe listen --forward-to http://localhost:54321/functions/v1/stripe-webhook
```

Then trigger a test event in a second terminal:

```bash
stripe trigger checkout.session.completed
```
