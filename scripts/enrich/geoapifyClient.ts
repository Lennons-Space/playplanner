// =============================================================================
// scripts/enrich/geoapifyClient.ts
//
// Backend/scripts-only HTTP client for the Geoapify Location Platform.
//
// SECURITY (non-negotiable):
//   - The API key is read from the environment (scripts/.env -> GEOAPIFY_API_KEY).
//     It is NEVER hardcoded and NEVER shipped to the mobile app / client bundle.
//   - The key is NEVER logged. Every logged URL is redacted (apiKey=***).
//
// SAFETY:
//   - Rate limiting: a minimum gap between requests (default 1.2s ≈ 0.83 rps),
//     well under Geoapify's free-tier 5 rps cap.
//   - Daily credit budget guard: refuses to make a request once a self-imposed
//     budget is reached (default 500 of the 3,000 free daily credits).
//   - Retries with exponential backoff + jitter on 429 / 5xx / network errors.
//     Other 4xx responses fail fast (retrying a 401/400 just wastes credits).
//
// This file performs network I/O — it is the ONLY enrichment module that does.
// It is never imported by the app; only by scripts run on a trusted machine.
//
// No '@/' path alias — this file runs outside the Expo app bundle.
// =============================================================================

import type { GeoapifyResponse } from '../../types/enrichment';

const GEOCODE_URL       = 'https://api.geoapify.com/v1/geocode/search';
const PLACE_DETAILS_URL = 'https://api.geoapify.com/v2/place-details';

export interface GeoapifyClientOptions {
  apiKey:             string;
  minIntervalMs?:     number;  // default 1200
  maxRetries?:        number;  // default 3
  baseBackoffMs?:     number;  // default 1000
  requestTimeoutMs?:  number;  // default 15000
  dailyCreditBudget?: number;  // default 500
  logger?:            (msg: string) => void;
}

export interface GeocodeParams {
  text:       string;        // free-form query, e.g. "Name, Postcode, City"
  countrycode?: string;      // default 'gb'
  biasLat?:   number;        // proximity bias (our venue coords)
  biasLon?:   number;
  limit?:     number;        // default 5
}

export interface PlaceDetailsParams {
  placeId?:  string;         // preferred — exact, from a geocode match
  lat?:      number;         // fallback (riskier — nearest feature)
  lon?:      number;
  features?: string[];       // e.g. ['details','details.contact','details.facilities']
}

export interface GeoapifyCallResult {
  response: GeoapifyResponse; // parsed (typed) view
  raw:      unknown;          // full raw JSON, preserved verbatim for fixtures
  credits:  number;          // running total spent by this client
}

// Status codes worth retrying — transient on Geoapify's side or rate limiting.
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class GeoapifyClient {
  private readonly apiKey: string;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly requestTimeoutMs: number;
  private readonly dailyCreditBudget: number;
  private readonly log: (msg: string) => void;

  private lastRequestAt = 0;
  private creditsUsed = 0;

  constructor(opts: GeoapifyClientOptions) {
    if (!opts.apiKey) {
      throw new Error('GeoapifyClient: apiKey is required (set GEOAPIFY_API_KEY in scripts/.env).');
    }
    this.apiKey            = opts.apiKey;
    this.minIntervalMs     = opts.minIntervalMs     ?? 1200;
    this.maxRetries        = opts.maxRetries        ?? 3;
    this.baseBackoffMs     = opts.baseBackoffMs     ?? 1000;
    this.requestTimeoutMs  = opts.requestTimeoutMs  ?? 15000;
    this.dailyCreditBudget = opts.dailyCreditBudget ?? 500;
    // eslint-disable-next-line no-console
    this.log               = opts.logger ?? ((m) => console.log(m));
  }

  /** Credits this client has spent so far (1 per successful request). */
  get credits(): number {
    return this.creditsUsed;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Geocoding search — used to find which Geoapify place is our venue. */
  async geocodeSearch(params: GeocodeParams): Promise<GeoapifyCallResult> {
    const url = new URL(GEOCODE_URL);
    url.searchParams.set('text', params.text);
    url.searchParams.set('format', 'geojson');
    url.searchParams.set('filter', `countrycode:${params.countrycode ?? 'gb'}`);
    url.searchParams.set('limit', String(params.limit ?? 5));
    if (typeof params.biasLat === 'number' && typeof params.biasLon === 'number') {
      // Geoapify bias syntax is proximity:lon,lat
      url.searchParams.set('bias', `proximity:${params.biasLon},${params.biasLat}`);
    }
    url.searchParams.set('apiKey', this.apiKey);
    return this.request(url, `geocode "${params.text}"`);
  }

  /** Place Details — used to pull the rich facts once a match is found. */
  async placeDetails(params: PlaceDetailsParams): Promise<GeoapifyCallResult> {
    const url = new URL(PLACE_DETAILS_URL);
    if (params.placeId) {
      url.searchParams.set('id', params.placeId);
    } else if (typeof params.lat === 'number' && typeof params.lon === 'number') {
      url.searchParams.set('lat', String(params.lat));
      url.searchParams.set('lon', String(params.lon));
    } else {
      throw new Error('placeDetails requires either placeId or lat+lon.');
    }
    if (params.features && params.features.length > 0) {
      url.searchParams.set('features', params.features.join(','));
    }
    url.searchParams.set('apiKey', this.apiKey);
    const label = params.placeId ? `place-details id=${params.placeId}` : `place-details ${params.lat},${params.lon}`;
    return this.request(url, label);
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  /** Redact the apiKey query param so it never reaches a log line. */
  private redact(url: URL): string {
    const clone = new URL(url.toString());
    if (clone.searchParams.has('apiKey')) clone.searchParams.set('apiKey', '***');
    return clone.toString();
  }

  private async throttle(): Promise<void> {
    const wait = this.minIntervalMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
  }

  private async request(url: URL, label: string): Promise<GeoapifyCallResult> {
    if (this.creditsUsed >= this.dailyCreditBudget) {
      throw new Error(
        `Geoapify credit budget reached (${this.creditsUsed}/${this.dailyCreditBudget}). ` +
        'Aborting to stay within the free tier. Raise dailyCreditBudget deliberately if intended.',
      );
    }

    let attempt = 0;
    // attempt 0 is the first try; up to maxRetries additional attempts.
    for (;;) {
      await this.throttle();
      const startedAt = Date.now();

      let status = 0;
      let bodyText = '';
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
        let res: Response;
        try {
          res = await fetch(url.toString(), { signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
        status = res.status;
        bodyText = await res.text();

        if (res.ok) {
          this.creditsUsed += 1;
          const raw: unknown = bodyText ? JSON.parse(bodyText) : {};
          const elapsed = Date.now() - startedAt;
          this.log(`[geoapify] ${label} -> HTTP ${status} (${elapsed}ms, credit ${this.creditsUsed}/${this.dailyCreditBudget})`);
          return { response: raw as GeoapifyResponse, raw, credits: this.creditsUsed };
        }

        // Non-2xx.
        if (!RETRYABLE.has(status) || attempt >= this.maxRetries) {
          this.log(`[geoapify] ${label} -> HTTP ${status} FAILED (${this.redact(url)})`);
          throw new Error(`Geoapify ${label} failed: HTTP ${status}`);
        }
        // fall through to backoff for retryable status
      } catch (err) {
        // Network/parse/abort error, or the thrown non-retryable error above.
        const isThrownFailure = err instanceof Error && err.message.startsWith('Geoapify ');
        if (isThrownFailure || attempt >= this.maxRetries) {
          if (!isThrownFailure) {
            this.log(`[geoapify] ${label} -> network error after ${attempt} retr${attempt === 1 ? 'y' : 'ies'}: ${(err as Error).message}`);
          }
          throw err;
        }
        // otherwise: transient network error → retry
      }

      attempt += 1;
      const backoff = this.baseBackoffMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      this.log(`[geoapify] ${label} -> retry ${attempt}/${this.maxRetries} after ${backoff}ms (last status ${status || 'network'})`);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

/**
 * Construct a client from the environment. Throws a clear, actionable error if
 * GEOAPIFY_API_KEY is not set — we never make a live call without a real key.
 */
export function geoapifyClientFromEnv(overrides: Partial<GeoapifyClientOptions> = {}): GeoapifyClient {
  const apiKey = process.env['GEOAPIFY_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'GEOAPIFY_API_KEY is not set.\n' +
      '  1. Create a free key at https://www.geoapify.com/ (no card required).\n' +
      '  2. Add to scripts/.env:  GEOAPIFY_API_KEY=your_key_here\n' +
      '  3. Re-run. The key is read backend-side only and never sent to the app.',
    );
  }
  return new GeoapifyClient({ apiKey, ...overrides });
}
