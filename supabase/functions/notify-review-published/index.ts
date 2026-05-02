/**
 * notify-review-published — Supabase Edge Function (Deno)
 *
 * PURPOSE
 * -------
 * Called by the admin moderation screen after a review is approved.
 * Sends an Expo push notification to the review author so they know
 * their review is now live.
 *
 * CALLER
 * ------
 * Client-side call from app/admin/moderation.tsx after the moderator
 * taps "Approve" on a review:
 *
 *   await supabase.functions.invoke('notify-review-published', {
 *     body: { reviewId: review.id },
 *   });
 *
 * PRIVACY / GDPR
 * --------------
 * - Uses the service-role key (server-only) so RLS is bypassed safely.
 * - We log only a token count and error codes — never token values, user
 *   IDs, or review content. (GDPR Art.5(1)(f): integrity and confidentiality.)
 * - If the user has no tokens (opted out), we return 200 { sent: 0 } —
 *   opting out is a valid and expected state.
 * - Single token failure does not crash the function — the other tokens
 *   still receive the notification.
 *
 * SECURITY
 * --------
 * - The SUPABASE_SERVICE_ROLE_KEY is never exposed to the client.
 * - The Expo push API response is validated before we count sent messages.
 * - Input (reviewId) is validated as a non-empty string before any DB call.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Shape of a single Expo push message
interface ExpoPushMessage {
  to:    string;
  title: string;
  body:  string;
  data?: Record<string, string>;
}

// Shape of the review row we fetch, joined with the venue name
interface ReviewRow {
  user_id:  string;
  venue_id: string;
  venues:   { name: string } | null;
}

// Shape of each push token row
interface PushTokenRow {
  token: string;
}

serve(async (req) => {
  // ── CORS preflight ──────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── 1. Authenticate the caller ──────────────────────────────────────────
    // Only authenticated admins may trigger notifications.
    // Without this check any client could spam users or enumerate review UUIDs.
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify JWT using the anon client (never the service-role key for JWT verification).
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check is_admin in profiles. Service-role client bypasses RLS safely here.
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single<{ is_admin: boolean }>();

    if (profileError || !profile?.is_admin) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── 2. Parse and validate input ─────────────────────────────────────────
    const body = await req.json() as { reviewId?: unknown };
    const reviewId = body.reviewId;

    if (typeof reviewId !== 'string' || reviewId.trim() === '') {
      return new Response(
        JSON.stringify({ error: 'reviewId is required and must be a non-empty string' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── 3. Fetch the review and venue name ──────────────────────────────────
    // adminClient (service-role) was created during the auth check above.
    // We select only the columns we need — data minimisation (GDPR Art.5(1)(c)).
    // We never log the review body, title, or author name.
    const { data: review, error: reviewError } = await adminClient
      .from('reviews')
      .select('user_id, venue_id, venues(name)')
      .eq('id', reviewId)
      .single<ReviewRow>();

    if (reviewError || !review) {
      // Log only the error code — no review content or user data.
      console.error('[notify-review-published] review fetch failed:', reviewError?.code);
      return new Response(
        JSON.stringify({ error: 'Review not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const venueName = review.venues?.name ?? 'the venue';

    // ── 4. Fetch push tokens for the review author ──────────────────────────
    const { data: tokenRows, error: tokenError } = await adminClient
      .from('push_tokens')
      .select('token')
      .eq('user_id', review.user_id);

    if (tokenError) {
      console.error('[notify-review-published] token fetch failed:', tokenError.code);
      return new Response(
        JSON.stringify({ error: 'Could not fetch tokens' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tokens = (tokenRows ?? []) as PushTokenRow[];

    // ── 5. User has opted out — normal and expected ─────────────────────────
    if (tokens.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── 6. Send to Expo Push API ────────────────────────────────────────────
    // We send one message per token. Expo recommends batching up to 100
    // messages per request — for a single-user notification one request is fine.
    //
    // A single token failure must not abort the other sends, so we wrap each
    // send in a try/catch and count successes.
    let sentCount = 0;

    const messages: ExpoPushMessage[] = tokens.map((row) => ({
      to:    row.token,
      title: 'Review published!',
      body:  `Your review of ${venueName} is now live.`,
      data:  { venueId: review.venue_id },
    }));

    // Expo accepts an array of messages in a single request (batch API).
    // We still handle per-message errors from the response body.
    try {
      const expoRes = await fetch('https://exp.host/--/api/v2/push/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body:    JSON.stringify(messages),
      });

      if (!expoRes.ok) {
        // Log only the HTTP status — never the token values in the request body.
        console.error('[notify-review-published] Expo API error:', expoRes.status);
      } else {
        const expoJson = await expoRes.json() as { data: { status: string }[] };
        // Count tickets with status 'ok' — each corresponds to one token.
        sentCount = (expoJson.data ?? []).filter((t) => t.status === 'ok').length;
      }
    } catch (fetchErr) {
      // Network failure — log the message only, not the request body (contains tokens).
      console.error('[notify-review-published] fetch error:', (fetchErr as Error).message);
    }

    // ── 7. Return result ────────────────────────────────────────────────────
    return new Response(
      JSON.stringify({ sent: sentCount }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    // Catch-all for unexpected errors (e.g. JSON parse failure on request body).
    console.error('[notify-review-published] unexpected error:', (err as Error).message);
    return new Response(
      JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
