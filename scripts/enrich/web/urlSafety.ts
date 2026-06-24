// =============================================================================
// scripts/enrich/web/urlSafety.ts
//
// Pure SSRF guard (spec §4/§5, sec #2). A venue's `website` is ultimately
// user-submitted data, so it must never be trusted as a fetch target. The fetch
// layer (webClient.ts) calls isSafeUrl() before the first request AND on EVERY
// redirect hop, and isSafeIp() on EVERY DNS-resolved address (rebinding defence).
//
// Rejected: non-http(s) schemes; private/loopback/link-local/CGNAT IPv4 in ANY
// encoding (dotted-decimal, octal, hex, single-integer); private/loopback/ULA/
// link-local IPv6 plus NAT64 and IPv4-mapped/embedded forms; localhost and
// internal-style hostnames. No DNS resolution here (pure) — DNS-result screening
// is isSafeIp(), called by the fetch layer.
//
// No '@/' path alias — runs outside the Expo app bundle.
// =============================================================================

export interface UrlSafetyResult {
  safe: boolean;
  reason?: string; // populated when !safe (for logging/report; never a secret)
}

/** Validate a single absolute URL string for fetch-safety. */
export function isSafeUrl(input: string): UrlSafetyResult {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { safe: false, reason: 'unparseable_url' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { safe: false, reason: `disallowed_scheme:${url.protocol.replace(':', '')}` };
  }

  return hostSafety(url.hostname);
}

/**
 * Validate a resolved IP literal (from DNS). The fetch layer runs every address a
 * host resolves to through this — the defence against DNS-rebinding, where a
 * public-looking hostname resolves to a private/loopback address.
 */
export function isSafeIp(ip: string): UrlSafetyResult {
  const host = stripBrackets(ip.trim().toLowerCase());
  if (isIpv4Like(host)) {
    const norm = normalizeIpv4(host);
    if (!norm) return { safe: false, reason: 'malformed_ipv4' };
    return isPrivateIpv4(norm) ? { safe: false, reason: 'private_ipv4' } : { safe: true };
  }
  if (host.includes(':')) {
    return isPrivateIpv6(host) ? { safe: false, reason: 'private_ipv6' } : { safe: true };
  }
  return { safe: false, reason: 'not_an_ip' };
}

/**
 * Given the ordered chain of URLs a request resolved through (original + each
 * redirect hop), return the first unsafe one, or null if all are safe.
 */
export function firstUnsafeHop(chain: string[]): { url: string; reason: string } | null {
  for (const u of chain) {
    const r = isSafeUrl(u);
    if (!r.safe) return { url: u, reason: r.reason ?? 'unsafe' };
  }
  return null;
}

// ── Host classification ───────────────────────────────────────────────────────

function hostSafety(rawHost: string): UrlSafetyResult {
  const host = stripBrackets(rawHost.toLowerCase()).replace(/\.$/, ''); // tolerate trailing dot
  if (host === '') return { safe: false, reason: 'empty_host' };

  if (host === 'localhost' || host.endsWith('.localhost')) {
    return { safe: false, reason: 'localhost' };
  }
  if (/\.(local|internal|private|home|lan|corp|intranet)$/.test(host)) {
    return { safe: false, reason: 'internal_tld' };
  }

  if (isIpv4Like(host)) {
    const norm = normalizeIpv4(host);
    if (!norm) return { safe: false, reason: 'malformed_ipv4' };
    return isPrivateIpv4(norm) ? { safe: false, reason: 'private_ipv4' } : { safe: true };
  }
  if (host.includes(':')) {
    return isPrivateIpv6(host) ? { safe: false, reason: 'private_ipv6' } : { safe: true };
  }
  return { safe: true };
}

function stripBrackets(host: string): string {
  return host.replace(/^\[/, '').replace(/\]$/, '');
}

// ── IPv4 (all encodings) ──────────────────────────────────────────────────────

const IPV4_PART = /^(0x[0-9a-f]+|\d+)$/i;

/** Does the host LOOK like an IPv4 literal in any encoding (so we must decode it)? */
function isIpv4Like(host: string): boolean {
  const parts = host.split('.');
  if (parts.length < 1 || parts.length > 4) return false;
  // A single bare token only counts as an IP if it is a pure integer/hex form
  // (e.g. "2130706433", "0x7f000001") — a word like "cafe" is a hostname.
  if (parts.length === 1) return IPV4_PART.test(host);
  return parts.every((p) => IPV4_PART.test(p));
}

/** Decode any IPv4 encoding to canonical dotted-decimal, or null if out of range. */
function normalizeIpv4(host: string): string | null {
  const parts = host.split('.');
  if (parts.length >= 2 && parts.length <= 4) {
    const octets: number[] = [];
    for (const p of parts) {
      const n = parseIntPart(p);
      if (n === null || n < 0 || n > 255) return null;
      octets.push(n);
    }
    // Left-pad short dotted forms (e.g. a.b → a.0.0.b is non-standard; require 4).
    if (octets.length !== 4) return null;
    return octets.join('.');
  }
  // Single integer (decimal / hex / octal) → 32-bit address.
  const whole = parseIntPart(host);
  if (whole === null || whole < 0 || whole > 0xffffffff) return null;
  return [(whole >>> 24) & 0xff, (whole >>> 16) & 0xff, (whole >>> 8) & 0xff, whole & 0xff].join('.');
}

function parseIntPart(p: string): number | null {
  if (/^0x[0-9a-f]+$/i.test(p)) return parseInt(p.slice(2), 16);
  if (/^0[0-7]+$/.test(p)) return parseInt(p, 8);
  if (/^\d+$/.test(p)) return parseInt(p, 10);
  return null;
}

/** Expects canonical dotted-decimal (from normalizeIpv4). */
function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // multicast / reserved
  return false;
}

// ── IPv6 (incl. NAT64 & embedded-IPv4) ────────────────────────────────────────

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::1' || h === '::') return true; // loopback / unspecified
  if (h.startsWith('fe80')) return true; // link-local fe80::/10
  if (/^f[cd]/.test(h)) return true; // ULA fc00::/7

  // Embedded / translated IPv4: ::ffff:a.b.c.d, ::ffff:HHHH:HHHH, 64:ff9b::… (NAT64).
  const embedded = embeddedIpv4(h);
  if (embedded) return isPrivateIpv4(embedded);
  if (h.startsWith('64:ff9b')) return true; // any other NAT64 form → block conservatively

  return false;
}

/** Extract the embedded IPv4 from a mapped/translated IPv6, or null. */
function embeddedIpv4(h: string): string | null {
  const dotted = h.match(/(?:::ffff:|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted && dotted[1]) return normalizeIpv4(dotted[1]);
  const hex = h.match(/(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex && hex[1] && hex[2]) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join('.');
  }
  return null;
}

// ── Registrable domain (off-domain redirect checks) ───────────────────────────

// Multi-label public suffixes we care about (UK-centric venue data + common ones).
// NOT a full Public Suffix List — see WEBSITE_ENRICHMENT_SPEC.md §18. Erring toward
// a SHORTER registrable domain only risks rejecting a legitimate same-site redirect
// (fail-closed / conservative), never accepting an off-domain one.
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'ac.uk', 'gov.uk',
  'nhs.uk', 'police.uk', 'mod.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'org.nz',
  'co.za', 'com.br', 'co.in', 'com.sg',
]);

/** Best-effort registrable domain (eTLD+1), e.g. www.venue.co.uk → venue.co.uk. */
export function registrableDomain(host: string): string {
  const labels = stripBrackets(host.trim().toLowerCase()).replace(/\.$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

/** True when two hosts share a registrable domain (same-site). */
export function sameRegistrableDomain(a: string, b: string): boolean {
  return registrableDomain(a) === registrableDomain(b);
}
