/**
 * PlayPlanner — Geocode Postcode Edge Function
 * Supabase Edge Function (runs on Deno, not Node.js)
 *
 * PURPOSE
 * -------
 * Proxies postcodes.io so the mobile client never calls a third-party
 * API directly. This keeps the client's network surface minimal and lets
 * us add rate-limiting or caching here in future without touching the app.
 *
 * Accepts:  POST { postcode: string }
 * Returns:  { latitude: number, longitude: number, city: string }
 *        or { error: string } with an appropriate HTTP status code
 *
 * AUTH
 * ----
 * No auth required — postcode lookup is not sensitive.
 * The anon key (or no key) is sufficient to call this function.
 *
 * LOOKUP STRATEGY
 * ---------------
 * 1. Exact lookup:   GET /postcodes/{postcode}
 * 2. Autocomplete:   GET /postcodes?q={postcode}&limit=1  (handles partial inputs)
 * Returns 404 only when both lookups fail.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight — Expo Go and mobile clients send this first.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

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

  // ── Strategy 1: exact lookup ───────────────────────────────────────────────
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
    }

    // A non-404 non-ok status from postcodes.io is unexpected — fall through
    // to the autocomplete strategy before giving up.
  } catch {
    // Network error fetching postcodes.io — fall through to autocomplete.
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
    }
  } catch {
    // Network error on autocomplete — return 500 below.
    return json({ error: 'Failed to reach geocoding service' }, 500);
  }

  // Both strategies exhausted with no result.
  return json({ error: 'Postcode not found' }, 404);
});

// ── Helper ────────────────────────────────────────────────────────────────────

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
