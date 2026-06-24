// =============================================================================
// Tests for webClient.ts — the ONLY network module, exercised with fully INJECTED
// http / dns / clock / filesystem fakes. ZERO live requests.
//
// Covers: robots denial, private DNS, redirect→private IP, DNS-rebinding,
// redirect loop, too-many-redirects, off-domain redirect, cache fresh/expiry,
// throttling, crawl-delay, timeout, oversized, non-HTML, retry exhaustion,
// bot-protection, happy path.
// =============================================================================

import {
  WebClient,
  type FileSystemLike,
  type HttpRequestLike,
  type HttpResponseLike,
  type WebClientOptions,
} from '../webClient';
import type { FetchedPage, WebFetchResult } from '../../../../types/webEnrichment';

// ── Response builders ─────────────────────────────────────────────────────────

function resp(status: number, headers: Record<string, string> = {}, body = ''): HttpResponseLike {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { status, headers: { get: (n) => lower[n.toLowerCase()] ?? null }, body };
}
const html = (body: string, extra: Record<string, string> = {}) =>
  resp(200, { 'content-type': 'text/html', ...extra }, body);
const redirect = (location: string, status = 302) => resp(status, { location });

const ROBOTS_ALLOW = resp(200, { 'content-type': 'text/plain' }, 'User-agent: *\nDisallow:');
const ROBOTS_DENY = resp(200, { 'content-type': 'text/plain' }, 'User-agent: *\nDisallow: /');

const PUBLIC_IP = '93.184.216.34';

// ── Harness ───────────────────────────────────────────────────────────────────

type Handler = (req: HttpRequestLike, callIndex: number) => HttpResponseLike | Error;
type DnsFn = (host: string, callIndex: number) => string[];

function setup(
  handler: Handler,
  opts: { dns?: DnsFn; options?: WebClientOptions; startClock?: number } = {},
) {
  const httpCalls: HttpRequestLike[] = [];
  const dnsCalls: string[] = [];
  const sleeps: number[] = [];
  const clock = { t: opts.startClock ?? 1_000_000_000_000 };
  const files = new Map<string, string>();

  const fs: FileSystemLike = {
    readFile: async (p) => (files.has(p) ? files.get(p)! : null),
    writeFile: async (p, d) => {
      files.set(p, d);
    },
  };

  const client = new WebClient(
    {
      http: async (req) => {
        const n = httpCalls.length;
        httpCalls.push(req);
        const r = handler(req, n);
        if (r instanceof Error) throw r;
        return r;
      },
      resolveDns: async (host) => {
        const n = dnsCalls.length;
        dnsCalls.push(host);
        return opts.dns ? opts.dns(host, n) : [PUBLIC_IP];
      },
      now: () => clock.t,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.t += ms;
      },
      fs,
    },
    opts.options,
  );

  return { client, httpCalls, dnsCalls, sleeps, clock, files };
}

const isRobots = (req: HttpRequestLike) => req.url.endsWith('/robots.txt');

function expectOk(result: WebFetchResult): FetchedPage {
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind} (${'note' in result ? result.note : ''})`);
  return result.page;
}

const START = 'https://example.com/';

// ── Happy path ────────────────────────────────────────────────────────────────

describe('happy path', () => {
  it('fetches an allowed HTML page and caches it', async () => {
    const { client, httpCalls, files } = setup((req) =>
      isRobots(req) ? ROBOTS_ALLOW : html('<html>ok</html>'),
    );
    const page = expectOk(await client.fetch(START));
    expect(page.html).toContain('ok');
    expect(page.fromCache).toBe(false);
    expect(page.page.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(httpCalls).toHaveLength(2); // robots + page
    expect(files.size).toBe(2); // robots cache + page cache
  });
});

// ── robots ────────────────────────────────────────────────────────────────────

describe('robots.txt', () => {
  it('skips when disallowed, never fetching the page', async () => {
    const { client, httpCalls } = setup((req) => (isRobots(req) ? ROBOTS_DENY : html('x')));
    const r = await client.fetch(START);
    expect(r.kind).toBe('skipped_robots');
    expect(httpCalls).toHaveLength(1); // only robots
  });

  it('fails CLOSED when robots.txt returns 5xx', async () => {
    const { client } = setup((req) => (isRobots(req) ? resp(503) : html('x')));
    expect((await client.fetch(START)).kind).toBe('skipped_robots');
  });

  it('allows the page when robots.txt is 404 (no rules)', async () => {
    const { client } = setup((req) => (isRobots(req) ? resp(404) : html('<p>hi</p>')));
    expect((await client.fetch(START)).kind).toBe('ok');
  });
});

// ── SSRF / DNS ──────────────────────────────────────────────────────────────--

describe('SSRF guards', () => {
  it('rejects a host that resolves to a private IP (before any network)', async () => {
    const { client, httpCalls, dnsCalls } = setup((req) => (isRobots(req) ? ROBOTS_ALLOW : html('x')), {
      dns: () => ['10.0.0.5'],
    });
    const r = await client.fetch(START);
    expect(r.kind).toBe('skipped_invalid_url');
    expect('note' in r && r.note).toMatch(/private_ipv4/);
    expect(httpCalls).toHaveLength(0); // guarded before robots
    expect(dnsCalls).toHaveLength(1);
  });

  it('rejects a redirect to a private IP as invalid_url (not off-domain)', async () => {
    const { client } = setup((req) =>
      isRobots(req) ? ROBOTS_ALLOW : redirect('http://10.0.0.5/admin'),
    );
    expect((await client.fetch(START)).kind).toBe('skipped_invalid_url');
  });

  it('defends DNS-rebinding: public for the origin guard, private on the page hop', async () => {
    const { client } = setup((req) => (isRobots(req) ? ROBOTS_ALLOW : html('x')), {
      dns: (_host, n) => (n === 0 ? [PUBLIC_IP] : ['10.0.0.5']),
    });
    expect((await client.fetch(START)).kind).toBe('skipped_invalid_url');
  });

  it('treats a DNS failure as fetch_failed (robots fail-closed)', async () => {
    const { client } = setup((req) => (isRobots(req) ? ROBOTS_ALLOW : html('x')), {
      dns: () => {
        throw new Error('ENOTFOUND');
      },
    });
    // robots can't resolve → fail closed → skipped_robots (host unreachable).
    expect((await client.fetch(START)).kind).toBe('skipped_robots');
  });

  it('treats an empty DNS result as fetch_failed on the page hop', async () => {
    let dnsHit = 0;
    const { client } = setup((req) => (isRobots(req) ? ROBOTS_ALLOW : html('x')), {
      dns: () => {
        dnsHit += 1;
        return dnsHit === 1 ? [PUBLIC_IP] : []; // robots ok, page hop empty
      },
    });
    const r = await client.fetch(START);
    expect(r.kind).toBe('fetch_failed');
    expect('note' in r && r.note).toBe('dns_empty');
  });

  it('rejects a redirect to an IPv6 loopback', async () => {
    const { client } = setup((req) =>
      isRobots(req) ? ROBOTS_ALLOW : redirect('http://[::1]/admin'),
    );
    expect((await client.fetch(START)).kind).toBe('skipped_invalid_url');
  });

  it('rejects a redirect via an encoded (octal) private IP', async () => {
    const { client } = setup((req) =>
      isRobots(req) ? ROBOTS_ALLOW : redirect('http://0177.0.0.1/'),
    );
    expect((await client.fetch(START)).kind).toBe('skipped_invalid_url');
  });
});

describe('robustness', () => {
  it('handles a malformed Location header without throwing', async () => {
    const { client } = setup((req) =>
      isRobots(req) ? ROBOTS_ALLOW : resp(302, { location: 'http://' }),
    );
    const r = await client.fetch(START);
    expect(r.kind).toBe('fetch_failed');
    expect('note' in r && r.note).toBe('malformed_redirect_location');
  });

  it('refuses a browser-impersonating User-Agent at construction', () => {
    expect(
      () =>
        setup((req) => (isRobots(req) ? ROBOTS_ALLOW : html('x')), {
          options: { userAgent: 'Mozilla/5.0 (Windows NT 10.0)' },
        }),
    ).toThrow(/impersonate a browser/);
  });
});

// ── Redirects ──────────────────────────────────────────────────────────────--

describe('redirects', () => {
  it('rejects an off-domain (public) redirect', async () => {
    const { client } = setup((req) =>
      isRobots(req) ? ROBOTS_ALLOW : redirect('https://evil.example.net/'),
    );
    expect((await client.fetch(START)).kind).toBe('skipped_redirect_offdomain');
  });

  it('follows a same-domain redirect to the final page', async () => {
    const { client } = setup((req) => {
      if (isRobots(req)) return ROBOTS_ALLOW;
      return req.url.endsWith('/final') ? html('<p>landed</p>') : redirect('https://example.com/final');
    });
    const page = expectOk(await client.fetch(START));
    expect(page.finalUrl).toBe('https://example.com/final');
    expect(page.html).toContain('landed');
  });

  it('detects a redirect loop', async () => {
    const { client } = setup((req) => {
      if (isRobots(req)) return ROBOTS_ALLOW;
      return req.url.endsWith('/a')
        ? redirect('https://example.com/')
        : redirect('https://example.com/a');
    });
    const r = await client.fetch(START);
    expect(r.kind).toBe('fetch_failed');
    expect('note' in r && r.note).toBe('redirect_loop');
  });

  it('stops after maxRedirects (3)', async () => {
    let step = 0;
    const { client } = setup((req) => {
      if (isRobots(req)) return ROBOTS_ALLOW;
      step += 1;
      return redirect(`https://example.com/step${step}`);
    });
    const r = await client.fetch(START);
    expect(r.kind).toBe('fetch_failed');
    expect('note' in r && r.note).toBe('too_many_redirects');
  });
});

// ── Content limits ────────────────────────────────────────────────────────────

describe('content limits', () => {
  it('skips a non-HTML response', async () => {
    const { client } = setup((req) =>
      isRobots(req) ? ROBOTS_ALLOW : resp(200, { 'content-type': 'application/pdf' }, '%PDF'),
    );
    expect((await client.fetch(START)).kind).toBe('skipped_non_html');
  });

  it('skips an oversized response', async () => {
    const { client } = setup((req) => (isRobots(req) ? ROBOTS_ALLOW : html('x'.repeat(100))), {
      options: { maxBytes: 50 },
    });
    expect((await client.fetch(START)).kind).toBe('skipped_too_large');
  });

  it('skips when content-length declares oversize', async () => {
    const { client } = setup(
      (req) => (isRobots(req) ? ROBOTS_ALLOW : html('small', { 'content-length': '99' })),
      { options: { maxBytes: 50 } },
    );
    expect((await client.fetch(START)).kind).toBe('skipped_too_large');
  });
});

// ── Retries / failures ────────────────────────────────────────────────────────

describe('retries and failures', () => {
  it('retries a transient 503 then fails (retry exhaustion)', async () => {
    let pageHits = 0;
    const { client } = setup((req) => {
      if (isRobots(req)) return ROBOTS_ALLOW;
      pageHits += 1;
      return resp(503, {}, 'server error');
    });
    const r = await client.fetch(START);
    expect(r.kind).toBe('fetch_failed');
    expect('note' in r && r.note).toBe('http_503');
    expect(pageHits).toBe(4); // initial + 3 retries
  });

  it('retries a thrown network/timeout error then fails', async () => {
    let pageHits = 0;
    const { client } = setup((req) => {
      if (isRobots(req)) return ROBOTS_ALLOW;
      pageHits += 1;
      return new Error('timeout');
    });
    const r = await client.fetch(START);
    expect(r.kind).toBe('fetch_failed');
    expect('note' in r && r.note).toBe('network_error');
    expect(pageHits).toBe(4);
  });

  it('classifies a Cloudflare-style challenge as bot-protected (no retry)', async () => {
    let pageHits = 0;
    const { client } = setup((req) => {
      if (isRobots(req)) return ROBOTS_ALLOW;
      pageHits += 1;
      return resp(503, {}, 'Just a moment... checking your browser before accessing.');
    });
    const r = await client.fetch(START);
    expect(r.kind).toBe('skipped_bot_protected');
    expect(pageHits).toBe(1); // challenges are not retried
  });

  it('does not retry a 404', async () => {
    let pageHits = 0;
    const { client } = setup((req) => {
      if (isRobots(req)) return ROBOTS_ALLOW;
      pageHits += 1;
      return resp(404);
    });
    const r = await client.fetch(START);
    expect(r.kind).toBe('fetch_failed');
    expect('note' in r && r.note).toBe('http_404');
    expect(pageHits).toBe(1);
  });
});

// ── Throttling ────────────────────────────────────────────────────────────────

describe('throttling', () => {
  it('waits the per-domain interval between same-domain requests', async () => {
    const { client, sleeps } = setup((req) => (isRobots(req) ? ROBOTS_ALLOW : html('ok')));
    await client.fetch(START);
    expect(sleeps).toContain(3000); // page request throttled after robots
  });

  it('honours a larger Crawl-delay from robots.txt', async () => {
    const robots = resp(200, { 'content-type': 'text/plain' }, 'User-agent: *\nCrawl-delay: 10\nDisallow:');
    const { client, sleeps } = setup((req) => (isRobots(req) ? robots : html('ok')));
    await client.fetch(START);
    expect(sleeps).toContain(10_000);
  });
});

// ── Caching ───────────────────────────────────────────────────────────────────

describe('caching', () => {
  it('returns a fresh page from cache without any network', async () => {
    const { client, httpCalls } = setup((req) => (isRobots(req) ? ROBOTS_ALLOW : html('<p>cached</p>')));
    await client.fetch(START); // populate
    const callsAfterFirst = httpCalls.length;
    const page = expectOk(await client.fetch(START)); // second
    expect(page.fromCache).toBe(true);
    expect(httpCalls.length).toBe(callsAfterFirst); // no new requests
  });

  it('re-fetches once the page TTL has expired', async () => {
    const { client, httpCalls, clock } = setup((req) =>
      isRobots(req) ? ROBOTS_ALLOW : html('<p>x</p>'),
    );
    await client.fetch(START);
    const callsAfterFirst = httpCalls.length;
    clock.t += 31 * 24 * 60 * 60 * 1000; // beyond the 30-day page TTL (and robots TTL)
    const page = expectOk(await client.fetch(START));
    expect(page.fromCache).toBe(false);
    expect(httpCalls.length).toBeGreaterThan(callsAfterFirst);
  });
});

// ── FIX 3: robots timeout budget ─────────────────────────────────────────────
//
// The deadline-check approach: `fetchRobots` computes `deadline = now() + robotsTimeoutMs`
// before starting work. After the throttle step, it checks `remaining = deadline - now()`.
// If remaining <= 0, the http call is skipped and the site is failed-closed. This
// prevents hanging http calls from stalling the run.
//
// The robots http call uses `timeoutMs = min(requestTimeoutMs, remaining)` — a capped
// timeout — so a slow-drip response cannot exceed the robots budget.
//
// Worst-case per dead site (DEFAULT config, real clock):
//   throttle wait (up to perDomainIntervalMs = 3 000ms) +
//   robots http timeout (remaining = robotsTimeoutMs - throttle ≤ 8 000ms)
//   = 11 000 ms max (down from 16+ minutes observed in the pilot).
//
// Test strategy: we use a clock that starts AT 0, set `robotsTimeoutMs = 1` so the
// deadline is immediately in the past after any clock advancement, and verify that
// the deadline check fires and the robots http call is never issued.

describe('FIX 3 — robots acquisition timeout', () => {
  // Helper that builds a client whose clock starts at 0 and whose `sleep` advances
  // the clock. With robotsTimeoutMs = 1, the deadline = 1 ms in the future. When the
  // mock sleep (from throttle or elsewhere) fires, clock.t ≥ deadline → fail closed.
  function setupZeroBudgetClient() {
    const httpCalls: HttpRequestLike[] = [];
    const clock = { t: 0 };
    const files = new Map<string, string>();

    const client = new WebClient(
      {
        http: async (req) => {
          httpCalls.push(req);
          return html('<html>ok</html>');
        },
        resolveDns: async () => [PUBLIC_IP],
        now: () => clock.t,
        sleep: async (ms) => { clock.t += ms; },
        fs: {
          readFile: async (p) => (files.has(p) ? files.get(p)! : null),
          writeFile: async (p, d) => { files.set(p, d); },
        },
      },
      // robotsTimeoutMs = 1 ms: deadline fires after any clock advancement.
      // perDomainIntervalMs = 100 so the throttle sleep advances clock past deadline.
      { robotsTimeoutMs: 1, perDomainIntervalMs: 100 },
    );

    return { client, httpCalls, clock };
  }

  it('returns skipped_robots when the robots budget is exhausted', async () => {
    // With robotsTimeoutMs=1 and perDomainIntervalMs=100:
    // - deadline = 0 + 1 = 1 ms (clock starts at 0)
    // - after throttle sleep(100): clock.t = 100 > deadline(1) → fail closed
    const { client } = setupZeroBudgetClient();
    const result = await client.fetch(START);
    expect(result.kind).toBe('skipped_robots');
    expect('note' in result && result.note).toBe('robots_unavailable');
  });

  it('does NOT issue the robots http call when deadline is exceeded after throttle', async () => {
    // The deadline check fires BEFORE issuing the http call, so no robots request.
    const { client, httpCalls } = setupZeroBudgetClient();
    await client.fetch(START);
    const robotsCalls = httpCalls.filter((r) => r.url.endsWith('/robots.txt'));
    expect(robotsCalls).toHaveLength(0);
  });

  it('does NOT fetch the page after a robots timeout (fail closed)', async () => {
    const { client, httpCalls } = setupZeroBudgetClient();
    await client.fetch(START);
    // Page must not be fetched — robots timeout causes an immediate skip.
    const pageCalls = httpCalls.filter((r) => !r.url.endsWith('/robots.txt'));
    expect(pageCalls).toHaveLength(0);
  });

  it('within-budget robots fetch still succeeds (budget not exhausted)', async () => {
    // Default config: robotsTimeoutMs = 8 000, perDomainIntervalMs = 3 000.
    // On first request the throttle wait is 0 (no prior request). remaining = 8 000 > 0.
    // Robots http call IS issued and returns normally.
    const { client } = setup((req) => (isRobots(req) ? ROBOTS_ALLOW : html('<p>ok</p>')), {
      options: { robotsTimeoutMs: 8_000 },
    });
    const result = await client.fetch(START);
    expect(result.kind).toBe('ok');
  });

  it('robots http call receives a capped timeoutMs (remaining budget, not full requestTimeoutMs)', async () => {
    // We need the throttle to actually sleep so remaining < requestTimeoutMs.
    // Trick: pre-warm the domain so the throttle fires on the robots call.
    // We do two fetches in sequence — the second robots call will see a recent
    // lastRequestAt and the throttle will sleep.
    //
    // Simpler approach: verify by direct clock control. Start clock at 3 000,
    // robotsTimeoutMs = 8 000 → deadline = 3 000 + 8 000 = 11 000.
    // The throttle for the first request doesn't sleep (lastRequestAt=0, wait = negative).
    // So remaining = 11 000 - 3 000 = 8 000. min(15 000, 8 000) = 8 000.
    const httpCalls: HttpRequestLike[] = [];
    const clock = { t: 3_000 }; // start at 3 000 to create a remaining gap
    const files = new Map<string, string>();
    const client = new WebClient(
      {
        http: async (req) => {
          httpCalls.push(req);
          return isRobots(req) ? ROBOTS_ALLOW : html('<p>ok</p>');
        },
        resolveDns: async () => [PUBLIC_IP],
        now: () => clock.t,
        sleep: async (ms) => { clock.t += ms; },
        fs: {
          readFile: async (p) => (files.has(p) ? files.get(p)! : null),
          writeFile: async (p, d) => { files.set(p, d); },
        },
      },
      { robotsTimeoutMs: 8_000, perDomainIntervalMs: 3_000, requestTimeoutMs: 15_000 },
    );
    await client.fetch(START);
    const robotsCall = httpCalls.find((r) => r.url.endsWith('/robots.txt'));
    expect(robotsCall).toBeDefined();
    // remaining = (3_000 + 8_000) - 3_000 = 8_000; min(15_000, 8_000) = 8_000
    expect(robotsCall!.timeoutMs).toBe(8_000);
  });

  it('existing retry semantics for PAGE fetches are unchanged (503 retries × 4)', async () => {
    // This test proves FIX 3 only touches the robots path, not the page-fetch retry logic.
    let pageHits = 0;
    const { client } = setup((req) => {
      if (isRobots(req)) return ROBOTS_ALLOW;
      pageHits += 1;
      return resp(503, {}, 'server error');
    });
    const r = await client.fetch(START);
    expect(r.kind).toBe('fetch_failed');
    expect(pageHits).toBe(4); // initial + 3 retries — unchanged
  });

  it('robotsTimeoutMs default is smaller than requestTimeoutMs', () => {
    // Sanity: the option is wired and readable from the constructed client.
    const { client } = setup((req) => (isRobots(req) ? ROBOTS_ALLOW : html('ok')));
    expect(client.options.robotsTimeoutMs).toBeLessThan(client.options.requestTimeoutMs);
    // Default = 8 000; requestTimeoutMs default = 15 000
    expect(client.options.robotsTimeoutMs).toBe(8_000);
  });

  // ── FIX 3 hardening: hanging DNS is now bounded via Promise.race ──────────────
  //
  // Previous gap: deadline was only checked AFTER guardHop returned. A dns.lookup
  // that never resolves would stall guardHop forever and the deadline was never
  // reached — reproducing the ~16 min pilot stall.
  //
  // Fix: fetchRobots races fetchRobotsWork against sleep(robotsTimeoutMs). If DNS
  // hangs, the sleep arm wins, returning failClosed:true (skipped_robots). Total
  // simulated elapsed time = exactly robotsTimeoutMs (the sleep arm advances the
  // virtual clock by that amount when it fires).

  it('hanging DNS is bounded: returns skipped_robots within robotsTimeoutMs virtual time', async () => {
    const clock = { t: 0 };
    const files = new Map<string, string>();
    const httpCalls: HttpRequestLike[] = [];

    // DNS promise that never resolves — simulates a hung dns.lookup call.
    const hangingDns = (): Promise<string[]> => new Promise(() => { /* never resolves */ });

    const client = new WebClient(
      {
        http: async (req) => { httpCalls.push(req); return html('<html>ok</html>'); },
        resolveDns: hangingDns,
        now: () => clock.t,
        sleep: async (ms) => { clock.t += ms; },
        fs: {
          readFile: async (p) => (files.has(p) ? files.get(p)! : null),
          writeFile: async (p, d) => { files.set(p, d); },
        },
      },
      { robotsTimeoutMs: 5_000, perDomainIntervalMs: 3_000 },
    );

    const result = await client.fetch(START);

    // Must fail closed, not hang.
    expect(result.kind).toBe('skipped_robots');
    expect('note' in result && result.note).toBe('robots_unavailable');

    // Total simulated elapsed time is bounded by robotsTimeoutMs (5 000 ms).
    // The Promise.race sleep arm advances the clock by exactly robotsTimeoutMs.
    expect(clock.t).toBeLessThanOrEqual(5_000);

    // No HTTP calls must have been issued — we never got past DNS.
    expect(httpCalls).toHaveLength(0);
  });

  it('hanging DNS: fail-closed result is cached so subsequent same-domain fetches avoid re-stalling', async () => {
    const clock = { t: 0 };
    const files = new Map<string, string>();
    const hangingDns = (): Promise<string[]> => new Promise(() => { /* never resolves */ });

    const client = new WebClient(
      {
        http: async () => html('<html>ok</html>'),
        resolveDns: hangingDns,
        now: () => clock.t,
        sleep: async (ms) => { clock.t += ms; },
        fs: {
          readFile: async (p) => (files.has(p) ? files.get(p)! : null),
          writeFile: async (p, d) => { files.set(p, d); },
        },
      },
      { robotsTimeoutMs: 5_000, perDomainIntervalMs: 3_000 },
    );

    await client.fetch(START); // first call — stalls DNS, times out, caches failClosed

    // The cache entry written by the timeout arm should contain failClosed:true.
    // Find any file whose parsed content has failClosed === true and host === 'example.com'.
    const cachedEntries = [...files.values()].map((v) => {
      try { return JSON.parse(v) as { failClosed?: boolean }; } catch { return null; }
    });
    expect(cachedEntries.some((e) => e?.failClosed === true)).toBe(true);
  });

  it('hanging HTTP (not DNS): Promise.race bounds the robots HTTP call via the sleep arm', async () => {
    // DNS resolves immediately (public IP), but the robots HTTP request hangs forever.
    // The Promise.race sleep arm fires after robotsTimeoutMs, winning the race.
    const clock = { t: 0 };
    const files = new Map<string, string>();

    const client = new WebClient(
      {
        http: async (req) => {
          if (req.url.endsWith('/robots.txt')) {
            // Hang forever — simulates a stalled robots.txt download.
            return new Promise(() => { /* never resolves */ });
          }
          return html('<html>ok</html>');
        },
        resolveDns: async () => [PUBLIC_IP],
        now: () => clock.t,
        sleep: async (ms) => { clock.t += ms; },
        fs: {
          readFile: async (p) => (files.has(p) ? files.get(p)! : null),
          writeFile: async (p, d) => { files.set(p, d); },
        },
      },
      { robotsTimeoutMs: 5_000, perDomainIntervalMs: 3_000 },
    );

    const result = await client.fetch(START);

    // Fails closed — the hanging robots HTTP is raced by the sleep arm.
    expect(result.kind).toBe('skipped_robots');
    expect('note' in result && result.note).toBe('robots_unavailable');

    // Elapsed virtual time: the sleep arm fires after robotsTimeoutMs.
    // (Throttle sleep also fires: but the race sleep runs concurrently and
    // the test harness sleep is sync, so both resolve; the race arm wins.)
    expect(clock.t).toBeLessThanOrEqual(5_000 + 3_000); // at most robotsTimeout + throttle
  });
});
