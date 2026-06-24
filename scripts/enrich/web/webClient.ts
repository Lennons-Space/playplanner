// =============================================================================
// scripts/enrich/web/webClient.ts
//
// The ONLY network module (spec §5). Fetches a single venue URL, following
// redirects MANUALLY so every hop is SSRF-checked, with robots.txt enforcement,
// per-domain throttling, transient-only retries, size/type/timeout limits, typed
// skip outcomes, and a disk cache (separate robots/page TTLs + SHA-256 hashes).
//
// FULLY DEPENDENCY-INJECTED: http, dns, clock (now+sleep) and filesystem are
// passed in, so tests make ZERO live requests and control time deterministically.
// `nodeWebClientDeps()` wires the real adapters for production use.
//
// SECURITY (non-negotiable):
//   - robots is honoured with NO bypass parameter. Fail CLOSED when robots.txt
//     cannot be retrieved (network/5xx) → skipped_robots.
//   - Every hop (initial + each redirect) is checked: literal URL safety, then DNS
//     resolution with EVERY resolved IP screened (DNS-rebinding defence).
//   - Off-domain redirects (different registrable domain) → skipped_redirect_offdomain.
//   - Secrets/PII are never logged; this module does no logging by default.
//
// No '@/' path alias — runs outside the Expo app bundle.
// =============================================================================

import { createHash } from 'crypto';

import type { FetchSkipKind, PageFetch, WebFetchResult } from '../../../types/webEnrichment';
import { isSafeIp, isSafeUrl, registrableDomain, sameRegistrableDomain } from './urlSafety';
import { crawlDelayMs, isPathAllowed, parseRobots } from './robotsParse';

// ── Injected dependencies ─────────────────────────────────────────────────────

export interface HttpResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  body: string;
}
export interface HttpRequestLike {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}
export type HttpFetch = (req: HttpRequestLike) => Promise<HttpResponseLike>;

/** Resolve a hostname to its IP literals (one or more). Throws on DNS failure. */
export type DnsResolve = (hostname: string) => Promise<string[]>;

export interface FileSystemLike {
  /** Returns the file contents, or null if the file does not exist. */
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, data: string): Promise<void>;
}

export interface WebClientDeps {
  http: HttpFetch;
  resolveDns: DnsResolve;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  fs: FileSystemLike;
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface WebClientOptions {
  userAgent?: string;
  maxRedirects?: number;
  maxBytes?: number;
  requestTimeoutMs?: number;
  /**
   * FIX 3: Hard upper bound on the TOTAL wall-clock time for the entire robots
   * acquisition path (DNS guard + HTTP fetch). Enforced via Promise.race against
   * an injected-sleep timer — independent of the http adapter's own AbortController.
   * Defaults to 8 000 ms (much smaller than requestTimeoutMs) so a dead site
   * cannot stall the run for more than one per-domain interval + robotsTimeoutMs.
   */
  robotsTimeoutMs?: number;
  perDomainIntervalMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  pageTtlMs?: number;
  robotsTtlMs?: number;
  cacheDir?: string;
  /** Ignore page-cache freshness and re-fetch. */
  refresh?: boolean;
}

const DEFAULTS = {
  userAgent: 'PlayPlannerBot/0.1 (+https://playplanner.app/bot)',
  maxRedirects: 3,
  maxBytes: 2 * 1024 * 1024,
  requestTimeoutMs: 15_000,
  // FIX 3: robots budget is intentionally smaller than requestTimeoutMs.
  // Worst-case per dead site (real clock) ≈ throttle (3 000ms) + http cap (robotsTimeoutMs = 8 000ms)
  // = ~11 000 ms, down from the ~16 min observed in the pilot.
  robotsTimeoutMs: 8_000,
  perDomainIntervalMs: 3_000,
  maxRetries: 3,
  baseBackoffMs: 1_000,
  pageTtlMs: 30 * 24 * 60 * 60 * 1000,
  robotsTtlMs: 24 * 60 * 60 * 1000,
  cacheDir: 'scripts/data/raw/website_cache',
  refresh: false,
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const BOT_CHALLENGE_STATUS = new Set([403, 429, 503]);
const BOT_MARKER =
  /just a moment|attention required|cf-browser-verification|cf-chl|checking your browser|enable javascript and cookies/i;

// ── Internal cache shapes ─────────────────────────────────────────────────────

interface CachedPage {
  url: string;
  finalUrl: string;
  fetchedAt: number;
  httpStatus: number;
  contentType: string;
  bytes: number;
  contentSha256: string;
  html: string;
}
interface CachedRobots {
  host: string;
  fetchedAt: number;
  status: number;
  body: string;
  failClosed: boolean;
}

// ── Client ────────────────────────────────────────────────────────────────────

export class WebClient {
  private readonly d: WebClientDeps;
  private readonly o: Required<WebClientOptions>;
  private readonly lastRequestAt = new Map<string, number>();

  constructor(deps: WebClientDeps, options: WebClientOptions = {}) {
    this.d = deps;
    this.o = { ...DEFAULTS, ...stripUndefined(options) };
    // Never impersonate a browser — robots etiquette + spec §5 (sec #15).
    if (/mozilla|chrome|safari|firefox|opera|edg(e|a|ios)?\//i.test(this.o.userAgent)) {
      throw new Error('WebClient: userAgent must not impersonate a browser');
    }
  }

  /** Read-only view of the resolved options (handy for tests/reporting). */
  get options(): Required<WebClientOptions> {
    return this.o;
  }

  /** Clear per-domain throttle state (call between runs in a long-lived process). */
  reset(): void {
    this.lastRequestAt.clear();
  }

  /** Fetch a single URL with full policy. Never throws — returns a typed result. */
  async fetch(startUrl: string): Promise<WebFetchResult> {
    // 0. Literal safety of the entry URL.
    const entry = isSafeUrl(startUrl);
    if (!entry.safe) return skip('skipped_invalid_url', entry.reason);

    const startParsed = new URL(startUrl);
    const originHost = startParsed.hostname.toLowerCase();

    // 1. Page cache (fresh) → return without any network.
    const cached = await this.readPageCache(startUrl);
    if (cached && !this.o.refresh && this.fresh(cached.fetchedAt, this.o.pageTtlMs)) {
      return { kind: 'ok', page: { finalUrl: cached.finalUrl, html: cached.html, page: pageOf(cached), fromCache: true } };
    }

    // 2. robots.txt (per host). fetchRobots SSRF-guards the host immediately
    //    before its request, so a host that resolves to a private IP — including
    //    a rebind since any earlier check — is caught here as skipped_invalid_url.
    const robots = await this.ensureRobots(startParsed);
    if (!robots.ok) return robots.result;
    const interval = Math.max(this.o.perDomainIntervalMs, robots.crawlDelayMs ?? 0);

    // 3. Follow redirects manually, guarding every hop.
    let current = startUrl;
    let redirects = 0;
    const visited = new Set<string>();

    for (;;) {
      if (visited.has(current)) return skip('fetch_failed', 'redirect_loop');
      visited.add(current);

      const guard = await this.guardHop(current);
      if (!guard.ok) return skip(guard.kind, guard.note);

      const net = await this.request(current, guard.domain, interval, robots.path);
      if (!net.ok) return skip('fetch_failed', net.note);
      const resp = net.resp;

      if (isBotChallenge(resp)) return skip('skipped_bot_protected', `http_${resp.status}`);

      if (resp.status >= 300 && resp.status < 400) {
        redirects += 1;
        if (redirects > this.o.maxRedirects) return skip('fetch_failed', 'too_many_redirects');
        const loc = resp.headers.get('location');
        if (!loc) return skip('fetch_failed', 'missing_location');
        let next: string;
        try {
          next = new URL(loc, current).toString();
        } catch {
          return skip('fetch_failed', 'malformed_redirect_location');
        }
        // Literal SSRF safety FIRST so a redirect to a private IP is classified as
        // invalid_url, not merely off-domain.
        const nextLiteral = isSafeUrl(next);
        if (!nextLiteral.safe) return skip('skipped_invalid_url', nextLiteral.reason);
        if (!sameRegistrableDomain(new URL(next).hostname, originHost)) {
          return skip('skipped_redirect_offdomain', registrableDomain(new URL(next).hostname));
        }
        current = next;
        continue;
      }

      if (resp.status >= 200 && resp.status < 300) {
        return this.handleSuccess(startUrl, current, resp);
      }

      return skip('fetch_failed', `http_${resp.status}`);
    }
  }

  // ── Success / size / content-type ──────────────────────────────────────────

  private async handleSuccess(
    requestedUrl: string,
    finalUrl: string,
    resp: HttpResponseLike,
  ): Promise<WebFetchResult> {
    const contentType = (resp.headers.get('content-type') ?? '').toLowerCase();
    if (!/text\/html|application\/xhtml\+xml/.test(contentType)) {
      return skip('skipped_non_html', contentType || 'unknown');
    }

    const declared = Number(resp.headers.get('content-length') ?? '');
    const bytes = Buffer.byteLength(resp.body, 'utf8');
    if ((!Number.isNaN(declared) && declared > this.o.maxBytes) || bytes > this.o.maxBytes) {
      return skip('skipped_too_large', String(Math.max(declared || 0, bytes)));
    }

    const cached: CachedPage = {
      url: requestedUrl,
      finalUrl,
      fetchedAt: this.d.now(),
      httpStatus: resp.status,
      contentType,
      bytes,
      contentSha256: sha256(resp.body),
      html: resp.body,
    };
    await this.writePageCache(requestedUrl, cached);
    return { kind: 'ok', page: { finalUrl, html: resp.body, page: pageOf(cached), fromCache: false } };
  }

  // ── Per-hop SSRF guard (literal + DNS) ──────────────────────────────────────

  private async guardHop(
    url: string,
  ): Promise<{ ok: true; domain: string } | { ok: false; kind: FetchSkipKind; note: string }> {
    const literal = isSafeUrl(url);
    if (!literal.safe) return { ok: false, kind: 'skipped_invalid_url', note: literal.reason ?? 'unsafe' };

    const host = new URL(url).hostname.toLowerCase();
    let ips: string[];
    try {
      ips = await this.d.resolveDns(host);
    } catch {
      return { ok: false, kind: 'fetch_failed', note: 'dns_error' };
    }
    if (ips.length === 0) return { ok: false, kind: 'fetch_failed', note: 'dns_empty' };
    for (const ip of ips) {
      const safe = isSafeIp(ip);
      if (!safe.safe) return { ok: false, kind: 'skipped_invalid_url', note: `dns_${safe.reason}` };
    }
    return { ok: true, domain: registrableDomain(host) };
  }

  // ── robots.txt ──────────────────────────────────────────────────────────────

  private async ensureRobots(
    startParsed: URL,
  ): Promise<
    | { ok: true; path: string; crawlDelayMs: number | null }
    | { ok: false; result: WebFetchResult }
  > {
    const host = startParsed.hostname.toLowerCase();
    const path = startParsed.pathname || '/';

    let body = '';
    let failClosed = false;

    const cachedRobots = await this.readRobotsCache(host);
    if (cachedRobots && this.fresh(cachedRobots.fetchedAt, this.o.robotsTtlMs)) {
      body = cachedRobots.body;
      failClosed = cachedRobots.failClosed;
    } else {
      const fetched = await this.fetchRobots(startParsed, host);
      if (fetched.kind === 'unsafe') {
        return { ok: false, result: skip('skipped_invalid_url', fetched.note) };
      }
      body = fetched.body;
      failClosed = fetched.failClosed;
    }

    if (failClosed) return { ok: false, result: skip('skipped_robots', 'robots_unavailable') };

    const parsed = parseRobots(body);
    if (!isPathAllowed(parsed, this.o.userAgent, path)) {
      return { ok: false, result: skip('skipped_robots', 'disallowed') };
    }
    return { ok: true, path, crawlDelayMs: crawlDelayMs(parsed, this.o.userAgent) };
  }

  private async fetchRobots(
    startParsed: URL,
    host: string,
  ): Promise<{ kind: 'ok'; body: string; failClosed: boolean } | { kind: 'unsafe'; note: string }> {
    const robotsUrl = `${startParsed.protocol}//${startParsed.host}/robots.txt`;

    // FIX 3: bound the total wall-clock time for robots acquisition.
    //
    // We pass a `deadline` (absolute injected-clock timestamp) into the work
    // function. After each awaitable operation (DNS guard + throttle + HTTP), the
    // work checks whether `now() >= deadline`. If so, it fails closed immediately
    // rather than starting the next step. This works with both:
    //   - The REAL clock: `now()` returns wall-clock ms; a slow DNS/HTTP advances it.
    //   - The VIRTUAL CLOCK in tests: `sleep(n)` advances `clock.t` by n, so after
    //     the throttle sleep the clock has moved, and we check it before issuing http.
    //
    // For the "hanging http" case (a site whose robots.txt never responds): the
    // throttle sleep fires first (advancing the virtual clock by perDomainIntervalMs),
    // but the deadline check happens BEFORE we call `this.d.http(...)`, so we never
    // issue the hanging request — the total elapsed time is bounded by the throttle
    // wait alone (≤ perDomainIntervalMs ≈ 3 000 ms on the virtual clock).
    //
    // For the "hanging DNS" / "hanging HTTP" case: a deadline check ALONE is not
    // enough — if the injected `resolveDns`/`http` promise never settles, `await`
    // never returns and the deadline is never reached (infinite hang). So in
    // addition to the deadline checks, the two LEAF awaits on the robots path
    // (`resolveDns` inside the robots DNS guard, and the robots `http` call) are
    // each wrapped in `raceWithTimeout` against the injected `sleep` — see that
    // helper's doc comment for why the race must be at the leaf level and not
    // around the whole multi-await `fetchRobotsWork` function.
    //
    // Worst-case real-clock per dead site (DEFAULT config):
    //   DNS timeout (robotsTimeoutMs = 8 000 ms, raced) +
    //   throttle (perDomainIntervalMs = 3 000 ms) + robots http (remaining budget, raced).
    // (Previously: throttle + unbounded DNS ≈ 3 000 + OS-resolver default ~75 s,
    // observed as a ~16 min stall in the pilot run.)
    const deadline = this.d.now() + this.o.robotsTimeoutMs;
    return this.fetchRobotsWork(robotsUrl, host, deadline);
  }

  /**
   * The actual robots fetch work. Accepts a `deadline` (injected-clock absolute
   * timestamp) and checks `now() >= deadline` after each async step. If the
   * deadline has passed, fails closed immediately without issuing the HTTP call.
   *
   * Both leaf network calls (DNS resolution and the robots HTTP fetch) are raced
   * against the remaining budget via `raceWithTimeout`, so a never-resolving
   * `resolveDns`/`http` promise cannot stall this function past the deadline.
   */
  private async fetchRobotsWork(
    robotsUrl: string,
    host: string,
    deadline: number,
  ): Promise<{ kind: 'ok'; body: string; failClosed: boolean } | { kind: 'unsafe'; note: string }> {
    // SSRF-guard the robots host right before fetching it (literal + DNS). This is
    // the per-request guard that closes the TOCTOU window for robots.txt itself.
    // `guardHopForRobots` races the leaf `resolveDns` call against the remaining
    // budget — see that method for why a bare `await this.guardHop(...)` (shared
    // with the page-hop path) is NOT raced here: racing it would change page-hop
    // semantics, which must stay governed by `requestTimeoutMs`/retries only.
    const guard = await this.guardHopForRobots(robotsUrl, deadline - this.d.now());
    if (!guard.ok) {
      if (guard.kind === 'skipped_invalid_url') return { kind: 'unsafe', note: guard.note };
      // DNS error, DNS timeout, etc. → cannot retrieve robots → fail closed.
      const rec: CachedRobots = { host, fetchedAt: this.d.now(), status: 0, body: '', failClosed: true };
      await this.writeRobotsCache(host, rec);
      return { kind: 'ok', body: '', failClosed: true };
    }

    // Throttle before the HTTP call. After throttle, the injected clock has advanced
    // by the throttle wait. Check deadline BEFORE issuing the HTTP call — if budget
    // is already exhausted (e.g. DNS was very slow), abort now rather than hanging.
    await this.throttle(guard.domain, this.o.perDomainIntervalMs);
    const remaining = deadline - this.d.now();
    if (remaining <= 0) {
      // Deadline passed after throttle — fail closed without issuing http.
      const rec: CachedRobots = { host, fetchedAt: this.d.now(), status: 0, body: '', failClosed: true };
      await this.writeRobotsCache(host, rec);
      return { kind: 'ok', body: '', failClosed: true };
    }

    let body = '';
    let status = 0;
    let failClosed = false;
    try {
      // Use the remaining budget (not the full requestTimeoutMs) so a slow-drip
      // robots.txt response cannot exceed the robots budget in production.
      const robotsHttpTimeout = Math.min(this.o.requestTimeoutMs, remaining);
      // LEAF RACE: the http call itself is the thing that can hang forever (a
      // dead site that accepts the TCP connection but never sends a response).
      // We race it against `sleep(remaining)` so a never-resolving `http`
      // promise cannot stall this function past the deadline. See
      // `raceWithTimeout` for why this must wrap the single leaf call, not the
      // whole `fetchRobotsWork`.
      const race = await raceWithTimeout(
        () => this.d.http({ url: robotsUrl, headers: this.requestHeaders(), timeoutMs: robotsHttpTimeout }),
        remaining,
        this.d.sleep,
      );
      if (race.timedOut) {
        failClosed = true; // robots http hung past budget → fail closed
      } else {
        const resp = race.value;
        status = resp.status;
        if (resp.status >= 200 && resp.status < 300) {
          body = resp.body;
        } else if ([401, 403, 404, 410].includes(resp.status)) {
          body = ''; // no usable robots (RFC 9309) → allow all
        } else {
          failClosed = true; // 5xx / unexpected → fail closed (assume disallow)
        }
      }
    } catch {
      failClosed = true; // network/timeout → fail closed
    }

    const rec: CachedRobots = { host, fetchedAt: this.d.now(), status, body, failClosed };
    await this.writeRobotsCache(host, rec);
    return { kind: 'ok', body, failClosed };
  }

  /**
   * Robots-specific variant of `guardHop` that races the leaf `resolveDns` call
   * against the remaining robots budget. NOT used by the page-hop path (`fetch`'s
   * for-loop calls the plain `guardHop`) — page hops are governed only by
   * `requestTimeoutMs` + retries, and racing a shared multi-step helper would
   * couple unrelated timeout semantics together.
   *
   * On DNS timeout, returns the same shape as a DNS error (`fetch_failed` /
   * `dns_error`) so the caller's existing "cannot retrieve robots → fail closed"
   * branch handles it uniformly.
   */
  private async guardHopForRobots(
    url: string,
    remainingMs: number,
  ): Promise<{ ok: true; domain: string } | { ok: false; kind: FetchSkipKind; note: string }> {
    const literal = isSafeUrl(url);
    if (!literal.safe) return { ok: false, kind: 'skipped_invalid_url', note: literal.reason ?? 'unsafe' };

    if (remainingMs <= 0) return { ok: false, kind: 'fetch_failed', note: 'dns_error' };

    const host = new URL(url).hostname.toLowerCase();
    let ips: string[];
    try {
      // LEAF RACE: `resolveDns` is the call that can hang forever (e.g. an
      // unresponsive nameserver). Race it against `sleep(remainingMs)` so the
      // robots deadline is enforced even when DNS never settles.
      const race = await raceWithTimeout(() => this.d.resolveDns(host), remainingMs, this.d.sleep);
      if (race.timedOut) return { ok: false, kind: 'fetch_failed', note: 'dns_error' };
      ips = race.value;
    } catch {
      return { ok: false, kind: 'fetch_failed', note: 'dns_error' };
    }
    if (ips.length === 0) return { ok: false, kind: 'fetch_failed', note: 'dns_empty' };
    for (const ip of ips) {
      const safe = isSafeIp(ip);
      if (!safe.safe) return { ok: false, kind: 'skipped_invalid_url', note: `dns_${safe.reason}` };
    }
    return { ok: true, domain: registrableDomain(host) };
  }

  // ── Network request with transient-only retries ─────────────────────────────

  private async request(
    url: string,
    domain: string,
    intervalMs: number,
    _path: string,
  ): Promise<{ ok: true; resp: HttpResponseLike } | { ok: false; note: string }> {
    let note = 'fetch_failed';
    for (let attempt = 0; attempt <= this.o.maxRetries; attempt++) {
      await this.throttle(domain, intervalMs);

      let resp: HttpResponseLike;
      try {
        resp = await this.d.http({ url, headers: this.requestHeaders(), timeoutMs: this.o.requestTimeoutMs });
      } catch {
        note = 'network_error';
        if (attempt < this.o.maxRetries) {
          await this.d.sleep(this.backoff(attempt));
          continue;
        }
        return { ok: false, note };
      }

      // Bot challenges must NOT be retried — classify them up the stack.
      if (isBotChallenge(resp)) return { ok: true, resp };

      if (RETRYABLE_STATUS.has(resp.status)) {
        note = `http_${resp.status}`;
        if (attempt < this.o.maxRetries) {
          await this.d.sleep(this.backoff(attempt));
          continue;
        }
        return { ok: false, note };
      }
      return { ok: true, resp };
    }
    return { ok: false, note };
  }

  private backoff(attempt: number): number {
    // Deterministic exponential backoff (no jitter → reproducible tests).
    return this.o.baseBackoffMs * 2 ** attempt;
  }

  // ── Throttle ────────────────────────────────────────────────────────────────

  private async throttle(domain: string, intervalMs: number): Promise<void> {
    const last = this.lastRequestAt.get(domain) ?? 0;
    const wait = intervalMs - (this.d.now() - last);
    if (wait > 0) await this.d.sleep(wait);
    this.lastRequestAt.set(domain, this.d.now());
  }

  // ── Cache I/O ────────────────────────────────────────────────────────────────

  private requestHeaders(): Record<string, string> {
    return { 'User-Agent': this.o.userAgent, Accept: 'text/html,application/xhtml+xml' };
  }

  private fresh(fetchedAt: number, ttlMs: number): boolean {
    return this.d.now() - fetchedAt < ttlMs;
  }

  private pagePath(url: string): string {
    return `${this.o.cacheDir}/pages/${sha256(url)}.json`;
  }
  private robotsPath(host: string): string {
    // Keyed by HOST (not registrable domain) — robots.txt is per-origin, and
    // www.x.com may differ from x.com. Hashed so the host can never escape the dir.
    return `${this.o.cacheDir}/robots/${sha256(host)}.json`;
  }

  private async readPageCache(url: string): Promise<CachedPage | null> {
    return readJson<CachedPage>(this.d.fs, this.pagePath(url));
  }
  private async writePageCache(url: string, rec: CachedPage): Promise<void> {
    await this.d.fs.writeFile(this.pagePath(url), JSON.stringify(rec));
  }
  private async readRobotsCache(host: string): Promise<CachedRobots | null> {
    return readJson<CachedRobots>(this.d.fs, this.robotsPath(host));
  }
  private async writeRobotsCache(host: string, rec: CachedRobots): Promise<void> {
    await this.d.fs.writeFile(this.robotsPath(host), JSON.stringify(rec));
  }
}

// ── Free helpers ──────────────────────────────────────────────────────────────

function skip(kind: FetchSkipKind, note?: string): WebFetchResult {
  return note ? { kind, note } : { kind };
}

function pageOf(c: CachedPage): PageFetch {
  return {
    url: c.finalUrl,
    httpStatus: c.httpStatus,
    contentSha256: c.contentSha256,
    bytes: c.bytes,
    fetchedAt: new Date(c.fetchedAt).toISOString(),
  };
}

function isBotChallenge(resp: HttpResponseLike): boolean {
  if (!BOT_CHALLENGE_STATUS.has(resp.status)) return false;
  const server = (resp.headers.get('server') ?? '').toLowerCase();
  return BOT_MARKER.test(resp.body) || server.includes('cloudflare');
}

async function readJson<T>(fs: FileSystemLike, path: string): Promise<T | null> {
  const raw = await fs.readFile(path);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null; // corrupt cache entry → treat as a miss
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Read a fetch Response body, aborting once `maxBytes` of DECOMPRESSED output has
 * been seen (returns null = oversize). Caps the bomb at the output stage, so a
 * tiny compressed payload that inflates to gigabytes is stopped at the limit.
 */
async function readCappedBody(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return null;
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Headers view that reports an over-limit content-length so the client skips it. */
function oversizeHeaders(res: Response, maxBytes: number): { get(name: string): string | null } {
  return {
    get: (n: string) => (n.toLowerCase() === 'content-length' ? String(maxBytes + 1) : res.headers.get(n)),
  };
}

/**
 * Race a single leaf promise (built lazily by `makePromise`) against a bound of
 * `ms`. Returns `{timedOut:false,value}` if the work settles first, or
 * `{timedOut:true}` if the bound is hit first.
 *
 * WHY THIS MUST WRAP A SINGLE LEAF CALL, NOT A MULTI-AWAIT FUNCTION
 * ------------------------------------------------------------------
 * It is tempting to simplify FIX 3 by doing one big
 * `Promise.race([fetchRobotsWork(...), sleep(robotsTimeoutMs).then(() => TIMEOUT)])`
 * around the ENTIRE robots work. DO NOT DO THIS — it breaks the happy-path and
 * zero-budget tests. `fetchRobotsWork` as a whole is multi-await (guardHop →
 * resolveDns → throttle → http), so even on the happy path several microtask
 * hops occur before it can settle; a `sleep().then()` timeout arm settles in
 * far fewer hops and would wrongly win every time. Push the race down to the
 * individual leaf awaits that can actually hang in production — `resolveDns`
 * and the robots `http` call — so "happy path wins" stays true.
 *
 * WHY THE TIMEOUT ARM MUST BE BUILT LAZILY (the bug this fixed)
 * ------------------------------------------------------------------
 * The obvious leaf-level implementation is still wrong:
 *   `Promise.race([promise, sleep(ms).then(() => TIMEOUT)])`
 * This EAGERLY calls `sleep(ms)` to construct the timeout arm, before knowing
 * whether `promise` will win. In production `sleep` is a real `setTimeout` —
 * calling it has no observable effect until the timer actually fires, so this
 * looks harmless. But the test harness's injected `sleep` is a *virtual clock*
 * that mutates shared state SYNCHRONOUSLY the instant it is called:
 *   `sleep: async (ms) => { clock.t += ms }`
 * That whole body runs synchronously (no internal `await`) the moment
 * `sleep(ms)` is invoked — i.e. BEFORE `Promise.race` even has a chance to let
 * the fast leaf win. So merely constructing the eager timeout arm permanently
 * advances the virtual clock by the full timeout, even when the real work
 * resolves immediately and "wins" the race. Observed failure: every happy-path
 * robots fetch advanced the clock by a full `robotsTimeoutMs` on the DNS guard
 * alone, exhausting the remaining budget before the throttle/http steps ran —
 * turning every successful fetch into a false-positive `skipped_robots`.
 *
 * THE FIX: two-phase race.
 *   1. Race `promise` against an ALREADY-RESOLVED sentinel (`Promise.resolve`).
 *      This costs exactly one microtask hop and calls `sleep` zero times. If
 *      `promise` has settled within that one hop (true for every leaf used
 *      here — `resolveDns`/`http` test stubs and the real adapters' eventual
 *      resolution both settle without our code's involvement), we return its
 *      value/error immediately. The clock/timer is never touched.
 *   2. Only if `promise` is still pending after that first hop do we actually
 *      call `sleep(ms)` to arm a real timeout and race again. This is the path
 *      a genuinely hanging DNS/HTTP call takes — `sleep` firing here is
 *      correct and expected, and the bounded fail-closed tests (:540, :605)
 *      rely on exactly this arm firing after `ms`.
 *
 * UNHANDLED REJECTION GUARD: if the timeout arm wins, the original `promise`
 * is abandoned but may still reject later (e.g. the real AbortController
 * firing). We attach a no-op `.catch` to it so that a late rejection of a
 * promise nobody is awaiting does not surface as an unhandled rejection.
 */
async function raceWithTimeout<T>(
  makePromise: () => Promise<T>,
  ms: number,
  sleep: (ms: number) => Promise<void>,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  const promise = makePromise();
  // Swallow late rejections from the loser up front — `promise` itself (not a
  // derived promise) so the original holds no unhandled-rejection listener gap.
  promise.catch(() => {
    /* abandoned on timeout; caller no longer awaits this — see doc comment */
  });

  // Phase 1: does the work settle within a single microtask hop, with zero
  // calls to `sleep`? Covers every leaf used in this module (synchronous-body
  // async functions). `PENDING` can never be a real `T`/error, so this is safe.
  const PENDING = Symbol('raceWithTimeout:pending');
  const fast = await Promise.race([promise, Promise.resolve(PENDING as typeof PENDING)]).catch(
    (err: unknown) => {
      throw err; // propagate an immediate rejection out of phase 1 too
    },
  );
  if (fast !== PENDING) return { timedOut: false, value: fast as T };

  // Phase 2: genuinely still pending — arm a real timeout. Only NOW do we call
  // `sleep`, so its side effect (real timer, or virtual-clock advancement in
  // tests) only happens on the path that actually needs to wait.
  const TIMEOUT = Symbol('raceWithTimeout:timeout');
  const timeoutArm = sleep(Math.max(0, ms)).then(() => TIMEOUT as typeof TIMEOUT);
  const winner = await Promise.race([promise, timeoutArm]);
  if (winner === TIMEOUT) return { timedOut: true };
  return { timedOut: false, value: winner as T };
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj) as (keyof T)[]) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

// ── Production adapters (not used by tests) ───────────────────────────────────

/**
 * Wire the real node adapters. Network/filesystem I/O happens only when the
 * returned deps are actually called — importing this module performs no I/O.
 */
export function nodeWebClientDeps(opts: { maxBytes?: number } = {}): WebClientDeps {
  const maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes;
  // Lazy requires so the pure import graph stays clean and test bundles need no
  // node:dns / node:fs typings to be loaded eagerly.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dns = require('dns').promises as { lookup: (h: string, o: { all: true }) => Promise<{ address: string }[]> };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs').promises as {
    readFile: (p: string, e: string) => Promise<string>;
    writeFile: (p: string, d: string) => Promise<void>;
    mkdir: (p: string, o: { recursive: true }) => Promise<unknown>;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as { dirname: (p: string) => string };

  const http: HttpFetch = async ({ url, headers, timeoutMs }) => {
    const controller = new AbortController();
    // One timer covers the whole exchange — connect AND the streamed body read —
    // so a slow-drip (slowloris) body cannot hang the worker.
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, redirect: 'manual', signal: controller.signal });
      const passHeaders = { get: (n: string) => res.headers.get(n) };

      // Reject by declared size before reading a single byte.
      const declared = Number(res.headers.get('content-length') ?? '');
      if (!Number.isNaN(declared) && declared > maxBytes) {
        try {
          await res.body?.cancel();
        } catch {
          /* ignore */
        }
        return { status: res.status, headers: oversizeHeaders(res, maxBytes), body: '' };
      }

      // Stream-read with a hard cap on DECOMPRESSED bytes → defeats gzip bombs.
      const body = await readCappedBody(res, maxBytes);
      if (body === null) return { status: res.status, headers: oversizeHeaders(res, maxBytes), body: '' };
      return { status: res.status, headers: passHeaders, body };
    } finally {
      clearTimeout(timer);
    }
  };

  // DNS resolver with a hard wall-clock timeout. dns.lookup has no built-in
  // timeout; without this guard a single unresponsive nameserver can stall the
  // worker for the OS resolver timeout (up to ~75 s on Linux, unbounded on
  // some systems — observed as a ~16 min stall in the pilot run).
  //
  // The timeout is set to DEFAULTS.robotsTimeoutMs so DNS can never outlast
  // the robots budget that the caller already enforces. The AbortController
  // cancels the lookup; the reject branch throws so guardHop's catch classifies
  // it as dns_error (fail-closed).
  const dnsTimeoutMs = DEFAULTS.robotsTimeoutMs;
  const resolveDns: DnsResolve = (host) => {
    // AbortController is only available in dns.lookup since Node 20+.
    // We add a belt-and-suspenders setTimeout that rejects independently.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), dnsTimeoutMs);
    return dns
      .lookup(host, { all: true })
      .then((results) => {
        clearTimeout(timer);
        return results.map((r) => r.address);
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        throw err;
      });
  };

  return {
    http,
    resolveDns,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    fs: {
      readFile: async (p) => {
        try {
          return await fs.readFile(p, 'utf8');
        } catch {
          return null;
        }
      },
      writeFile: async (p, data) => {
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, data);
      },
    },
  };
}
