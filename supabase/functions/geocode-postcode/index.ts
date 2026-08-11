/**
 * PlayPlanner — Geocode Postcode Edge Function
 * Supabase Edge Function (runs on Deno, not Node.js)
 *
 * PURPOSE
 * -------
 * Proxies postcodes.io so the mobile client never calls a third-party
 * API directly. This keeps the client's network surface minimal, keeps the
 * user's device/IP out of a third party's logs, and lets us add rate-limiting
 * or caching here in future without touching the app.
 *
 * Accepts:  POST { postcode: string }
 * Returns:  { latitude: number, longitude: number, city: string }
 *        or { error: string } with an appropriate HTTP status code
 *
 * AUTH — SIGNED-IN PLAYPLANNER USERS ONLY
 * ---------------------------------------
 * Two independent layers, both required:
 *
 *   1. Platform `verify_jwt` (Dashboard toggle ON / config.toml default true).
 *      The Supabase gateway validates the caller's JWT BEFORE this code runs,
 *      so unauthenticated traffic never reaches the function at all.
 *
 *   2. `withSupabase({ auth: 'user' })` from @supabase/server. This
 *      independently verifies a real Supabase Auth user JWT against the
 *      project's JWKS (cryptographic signature + expiry check) and only then
 *      invokes the handler below.
 *
 * The app sends the publishable key in the `apikey` header and the signed-in
 * user's session JWT in `Authorization: Bearer <jwt>`. A publishable key is
 * public application identification, NOT user authentication — `auth: 'user'`
 * deliberately does not accept one, so a key-only request is rejected even
 * though the key is valid.
 *
 * Consequences (all intentional):
 *   - no Authorization / no user JWT  → rejected, handler never runs
 *   - publishable key alone           → rejected, handler never runs
 *   - malformed or expired user JWT   → rejected, handler never runs
 *   - keyless internet request        → rejected at the gateway
 * Because the handler only runs after successful auth, an authentication
 * failure can never cause an outbound postcodes.io request.
 *
 * Postcode lookup is not itself sensitive, but this function is an outbound
 * fetch proxy — leaving it open would let anyone use the project as an
 * anonymising relay to postcodes.io. Hence user-level auth.
 *
 * ENVIRONMENT
 * -----------
 * Zero config. `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`
 * and `SUPABASE_JWKS` are auto-injected by the Supabase Edge runtime, which is
 * where @supabase/server resolves them from. No function secrets to set.
 *
 * VALIDATION
 * ----------
 * Input is normalised AND format-validated here, independently of the
 * client. Malformed input is rejected with 400 before any outbound
 * request, so arbitrary strings are never forwarded to postcodes.io.
 *
 * LOOKUP STRATEGY
 * ---------------
 * 1. Exact lookup:   GET /postcodes/{postcode}      (full postcodes only)
 * 2. Autocomplete:   GET /postcodes?q={postcode}&limit=1  (handles partial inputs)
 * Returns 404 only when both lookups genuinely find nothing. If either
 * lookup fails for a REAL reason (network error, or a non-404 status from
 * postcodes.io such as a 429 rate-limit or 5xx outage), that is reported as
 * 502 instead — a postcodes.io 404 ("no exact match") is treated as a
 * legitimate signal to try the autocomplete strategy, never as an error.
 *
 * PRIVACY: the postcode is never logged. This function performs no logging
 * of any kind, so nothing user-supplied can reach the function logs.
 */
import { withSupabase } from 'npm:@supabase/server@^1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

// ── Postcode format validation ───────────────────────────────────────────────
// Applied to the normalised (trimmed, space-stripped, uppercased) string.
//
// Deliberately NOT the maximally-strict gov.uk letter-exclusion regex: a
// false rejection of a real postcode is far worse here than forwarding one
// extra lookup, and postcodes.io remains the authority on whether a postcode
// actually exists. This is a shape check to keep arbitrary strings off the
// outbound request, not an existence check.
//
// These mirror the client-side rules in lib/postcode.ts. They are duplicated
// rather than imported ON PURPOSE — an Edge Function deployed by pasting a
// single file into the Supabase Dashboard cannot import from the app repo,
// and the server must validate independently of the client regardless.

/** Full UK postcode — covers A9 9AA, A99 9AA, AA9 9AA, AA99 9AA, A9A 9AA, AA9A 9AA. */
const FULL_POSTCODE_REGEX = /^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/;

/** Outward code only (the part before the final "digit + two letters"): "SY13", "M1", "EC1A". */
const OUTWARD_CODE_REGEX = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;

/** Girobank's special-case postcode — does not fit the general pattern. */
const GIR_POSTCODE = 'GIR0AA';

type PostcodeKind = 'full' | 'outward' | 'invalid';

/**
 * Classifies an already-normalised postcode string. A 'full' postcode gets
 * the exact lookup (with autocomplete as a fallback); an 'outward' code goes
 * straight to autocomplete, since an exact lookup could never match it.
 */
function classifyPostcode(normalised: string): PostcodeKind {
  if (!normalised) return 'invalid';
  if (normalised === GIR_POSTCODE) return 'full';
  if (FULL_POSTCODE_REGEX.test(normalised)) return 'full';
  if (OUTWARD_CODE_REGEX.test(normalised)) return 'outward';
  return 'invalid';
}

/**
 * The postcode lookup itself. Only ever invoked by withSupabase AFTER the
 * caller has been verified as a signed-in Supabase Auth user.
 */
async function handleGeocodeRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !('postcode' in body) ||
    typeof (body as Record<string, unknown>).postcode !== 'string' ||
    !(body as Record<string, string>).postcode.trim()
  ) {
    return json({ error: 'Missing required field: postcode (non-empty string)' }, 400);
  }

  const rawPostcode = (body as Record<string, string>).postcode;
  // Normalise: strip spaces, uppercase — postcodes.io accepts both formats
  // but this prevents cache-miss variants of the same postcode.
  const postcode = rawPostcode.trim().replace(/\s+/g, '').toUpperCase();

  // Reject anything that isn't shaped like a UK postcode BEFORE any outbound
  // request — arbitrary strings must never be forwarded to postcodes.io.
  // 400 (not 404) so the client classifies this as INVALID rather than
  // "we looked and it isn't there".
  const kind = classifyPostcode(postcode);
  if (kind === 'invalid') {
    return json({ error: 'Invalid postcode format' }, 400);
  }

  // Tracks whether either strategy hit a genuine upstream problem (network
  // failure, or a non-404 non-ok status like 429/500/503) rather than a
  // clean "no match". Without this, a postcodes.io outage or rate-limit was
  // silently reported to the client as our own 404 "Postcode not found" —
  // the same client never-blame-the-postcode-for-a-service-failure bug one
  // layer down. A 404 from postcodes.io itself is NOT an upstream problem —
  // it is postcodes.io correctly saying "no exact match", which is exactly
  // what should fall through to the autocomplete strategy below.
  let upstreamError = false;

  // ── Strategy 1: exact lookup (full postcodes only) ────────────────────────
  // Skipped entirely for an outward code like "SY13" — /postcodes/SY13 can
  // never match, so it would be a guaranteed-wasted round trip.
  if (kind === 'full') {
    try {
      const exactRes = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`,
      );

      if (exactRes.ok) {
        const exactJson = await exactRes.json() as {
          result?: {
            latitude: number;
            longitude: number;
            admin_district: string | null;
          } | null;
        };

        if (exactJson.result) {
          return json({
            latitude: exactJson.result.latitude,
            longitude: exactJson.result.longitude,
            city: exactJson.result.admin_district ?? '',
          }, 200);
        }
        // 2xx with no result is not expected from this endpoint, but treat it
        // the same as a clean not-found rather than an upstream error.
      } else if (exactRes.status !== 404) {
        // Any non-404 non-ok status (429 rate-limited, 5xx, ...) is a genuine
        // upstream problem — remember it so the final response can't lie.
        upstreamError = true;
      }
      // status 404 here means postcodes.io found no EXACT match — that is a
      // legitimate signal, not an error, so we deliberately fall through to
      // try the autocomplete strategy next.
    } catch {
      // Network error fetching postcodes.io.
      upstreamError = true;
    }
  }

  // ── Strategy 2: autocomplete (handles partial / sector postcodes) ──────────
  try {
    const autoRes = await fetch(
      `https://api.postcodes.io/postcodes?q=${encodeURIComponent(postcode)}&limit=1`,
    );

    if (autoRes.ok) {
      const autoJson = await autoRes.json() as {
        result?: {
          latitude: number;
          longitude: number;
          admin_district: string | null;
        }[] | null;
      };

      if (autoJson.result?.[0]) {
        const first = autoJson.result[0];
        return json({
          latitude: first.latitude,
          longitude: first.longitude,
          city: first.admin_district ?? '',
        }, 200);
      }
      // ok with an empty result array is a genuine "no match" — not an error.
    } else {
      upstreamError = true;
    }
  } catch {
    // Network error on autocomplete.
    upstreamError = true;
  }

  if (upstreamError) {
    return json({ error: 'Failed to reach geocoding service' }, 502);
  }

  // Both strategies genuinely found nothing — a real not-found, safe to report.
  return json({ error: 'Postcode not found' }, 404);
}

// ── Entry point ──────────────────────────────────────────────────────────────
// withSupabase verifies credentials, handles the CORS preflight, and only
// then calls the handler. `cors.headers` pins the exact same header set the
// app has always received, so the client contract is unchanged.
export default {
  fetch: withSupabase(
    { auth: 'user', cors: { headers: CORS_HEADERS } },
    async (req: Request) => handleGeocodeRequest(req),
  ),
};

// ── Helper ────────────────────────────────────────────────────────────────────

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
