/**
 * Shared UK postcode lookup layer.
 *
 * Both `app/venue/add.tsx` (Add a Venue — requires a FULL postcode, since a
 * venue needs a real address) and `app/explore/map.tsx` (Map search — accepts
 * a FULL postcode OR an outward/partial code like "SY13", "M1", "EC1A", to
 * preserve the Edge Function's existing autocomplete strategy for area
 * search) used to duplicate this logic and — critically — both collapsed
 * every failure mode into a single "not found" result. That meant a
 * service outage (e.g. the Edge Function not being deployed) was reported to
 * the user as "your postcode is wrong", which is never true and actively
 * misleads them into re-typing a postcode that was fine all along.
 *
 * This module calls the `geocode-postcode` Supabase Edge Function (which
 * proxies postcodes.io — see supabase/functions/geocode-postcode/index.ts)
 * and returns a discriminated result instead of a nullable, so callers must
 * handle each failure category explicitly and can never accidentally show
 * "postcode not found" for a network/service problem.
 *
 * PRIVACY: raw coordinates returned here are geocoded from a postcode the
 * user typed voluntarily to find venues near an area — not their live GPS
 * location. Callers must still not log them (see add.tsx's header comment).
 */
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type PostcodeLookupReason = 'INVALID' | 'NOT_FOUND' | 'SERVICE_UNAVAILABLE';

export type PostcodeLookupResult =
  | { ok: true; latitude: number; longitude: number; city: string }
  | { ok: false; reason: PostcodeLookupReason };

/** Liam's exact user-facing copy for each failure category — single source of truth. */
export const POSTCODE_ERROR_MESSAGES: Record<PostcodeLookupReason, string> = {
  INVALID: 'Enter a valid UK postcode.',
  NOT_FOUND: 'Postcode not found. Please check and try again.',
  SERVICE_UNAVAILABLE: 'Postcode lookup is temporarily unavailable. Please try again.',
};

export interface PostcodeLookupOptions {
  /**
   * Accept an outward/partial code ("SY13", "M1", "EC1A") in addition to a
   * full postcode. Defaults to false: Add a Venue needs a full address, so
   * it must NOT set this. Map search sets it true to preserve today's
   * partial-postcode area search.
   */
  allowPartial?: boolean;
  /** Request timeout in ms. `functions.invoke` aborts and settles cleanly past this — see below. */
  timeoutMs?: number;
}

// A mobile network round trip to an Edge Function that itself calls a third
// party (postcodes.io) can legitimately take a few seconds on poor
// connections; 8s is generous enough to avoid false timeouts while still
// keeping the "Look up" / search button from spinning indefinitely.
const DEFAULT_TIMEOUT_MS = 8000;

// Full UK postcode, all 6 formats (A9 9AA, A99 9AA, AA9 9AA, AA99 9AA,
// A9A 9AA, AA9A 9AA), applied to the space-stripped uppercase string.
// Deliberately NOT the maximally-strict gov.uk letter-exclusion regex —
// this is only a pre-filter to skip a pointless network round trip;
// postcodes.io remains the authority on whether a postcode is real.
const FULL_POSTCODE_REGEX = /^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/;

// Outward code only (the part before the final "digit + 2 letters"), for
// partial/area search — "SY13", "M1", "EC1A".
const OUTWARD_CODE_REGEX = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;

// Girobank's special-case postcode — doesn't match the general pattern.
const GIR_POSTCODE = 'GIR0AA';

/** trim → uppercase → strip all internal whitespace. */
export function normalisePostcode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Local pre-filter only — never treat a pass here as proof the postcode
 * exists, and never treat a fail as anything other than INVALID (it must
 * never reach the network, so it can never be misreported as NOT_FOUND or
 * SERVICE_UNAVAILABLE).
 */
export function isValidPostcodeFormat(normalised: string, allowPartial = false): boolean {
  if (!normalised) return false;
  if (normalised === GIR_POSTCODE) return true;
  if (FULL_POSTCODE_REGEX.test(normalised)) return true;
  if (allowPartial && OUTWARD_CODE_REGEX.test(normalised)) return true;
  return false;
}

interface GeocodeSuccessBody {
  latitude: number;
  longitude: number;
  // Deliberately `unknown`, not `string` — the type guard below only proves
  // latitude/longitude are valid numbers; city's real-world type is checked
  // separately (and defaulted) at the call site, never assumed.
  city?: unknown;
}

function isValidGeocodeBody(data: unknown): data is GeocodeSuccessBody {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.latitude === 'number' && Number.isFinite(d.latitude) &&
    typeof d.longitude === 'number' && Number.isFinite(d.longitude)
  );
}

/**
 * Reads the two possible 404 shapes off a FunctionsHttpError and tells them
 * apart — this is the crux of the whole error-classification task:
 *   - gateway 404 `{"code":"NOT_FOUND","message":"Requested function was
 *     not found"}` → the geocode-postcode function is not deployed at all →
 *     SERVICE_UNAVAILABLE (never the user's fault).
 *   - our function's own 404 `{"error":"Postcode not found"}` → genuine
 *     remote not-found → NOT_FOUND.
 * Any other/unparseable body on a 404 is treated as SERVICE_UNAVAILABLE —
 * an unrecognised shape is a service problem, not proof the postcode is bad.
 */
async function classifyNotFoundBody(response: { json: () => Promise<unknown> }): Promise<PostcodeLookupReason> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return 'SERVICE_UNAVAILABLE';
  }
  if (!body || typeof body !== 'object') return 'SERVICE_UNAVAILABLE';
  const b = body as Record<string, unknown>;
  if (b.code === 'NOT_FOUND') return 'SERVICE_UNAVAILABLE';
  if (typeof b.error === 'string') return 'NOT_FOUND';
  return 'SERVICE_UNAVAILABLE';
}

async function classifyInvokeError(error: unknown): Promise<PostcodeLookupReason> {
  if (error instanceof FunctionsHttpError) {
    // error.context is the raw fetch Response (see FunctionsClient.js in
    // @supabase/functions-js 2.103.0 — verified by reading the installed
    // package, not assumed from documentation).
    const response = error.context as { status?: number; json: () => Promise<unknown> };
    const status = response?.status;

    if (status === 404) {
      return classifyNotFoundBody(response);
    }
    if (status === 400) return 'INVALID';
    if (status === 401 || status === 403) return 'SERVICE_UNAVAILABLE';
    // Any other non-2xx (including 5xx) is a service problem.
    return 'SERVICE_UNAVAILABLE';
  }

  // Network failure reaching the function, or the Supabase relay itself
  // couldn't reach it — both are service problems, never the user's postcode.
  if (error instanceof FunctionsFetchError) return 'SERVICE_UNAVAILABLE';
  if (error instanceof FunctionsRelayError) return 'SERVICE_UNAVAILABLE';

  // Unrecognised error shape — fail safe rather than blaming the postcode.
  return 'SERVICE_UNAVAILABLE';
}

/**
 * Looks up a UK postcode via the geocode-postcode Edge Function. Never
 * throws — always resolves to a PostcodeLookupResult.
 */
export async function lookupPostcode(
  raw: string,
  options: PostcodeLookupOptions = {},
): Promise<PostcodeLookupResult> {
  const { allowPartial = false, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const normalised = normalisePostcode(raw);

  // Local format check first — malformed input never reaches the network.
  if (!isValidPostcodeFormat(normalised, allowPartial)) {
    return { ok: false, reason: 'INVALID' };
  }

  let invokeResult: Awaited<ReturnType<typeof supabase.functions.invoke>>;
  try {
    // `timeout` is a native option on functions.invoke (verified against the
    // installed @supabase/functions-js 2.103.0: it wraps the fetch in an
    // AbortController and the resulting AbortError is caught internally and
    // turned into a FunctionsFetchError) — the promise always settles within
    // timeoutMs, so the caller's loading state can never get stuck.
    invokeResult = await supabase.functions.invoke('geocode-postcode', {
      body: { postcode: normalised },
      timeout: timeoutMs,
    });
  } catch {
    // Defensive only — functions.invoke() catches internally and resolves
    // with { error } rather than throwing, but guard anyway.
    return { ok: false, reason: 'SERVICE_UNAVAILABLE' };
  }

  const { data, error } = invokeResult;

  if (error) {
    const reason = await classifyInvokeError(error);
    return { ok: false, reason };
  }

  if (!isValidGeocodeBody(data)) {
    // 2xx but the body is missing/malformed — a service problem, not a bad postcode.
    return { ok: false, reason: 'SERVICE_UNAVAILABLE' };
  }

  return {
    ok: true,
    latitude: data.latitude,
    longitude: data.longitude,
    city: typeof data.city === 'string' ? data.city : '',
  };
}
