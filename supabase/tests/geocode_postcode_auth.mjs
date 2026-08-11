// =============================================================================
// supabase/tests/geocode_postcode_auth.mjs
//
// Behavioural tests for the geocode-postcode Edge Function — its AUTH boundary
// and its postcode contract. NO live Supabase, NO production access, NO real
// project keys: a throwaway ES256 key pair is generated at run time and its
// public JWKS is handed to @supabase/server, so JWT verification is genuine
// cryptography against a key that exists only for the duration of this script.
//
// WHY A NODE SCRIPT AND NOT A JEST SUITE
// --------------------------------------
// The function under test imports `npm:@supabase/server@^1`, which is
// ESM-first and pulls in `jose` (also ESM). The jest-expo transform pipeline
// cannot parse those builds, and widening the global `transformIgnorePatterns`
// to force it would change node_modules resolution for all ~131 existing
// suites — a large blast radius for one file. Plain Node imports both
// natively, and this repo already runs behavioural Supabase tests as .mjs
// scripts (see 056/057/058), so this follows the established convention.
//
// WHAT IS ACTUALLY UNDER TEST
// ---------------------------
// The REAL deployment artifact. This reads ../functions/geocode-postcode/
// index.ts off disk, transpiles it, and evaluates it with the `npm:` specifier
// resolved to the genuinely installed @supabase/server. The auth decisions are
// therefore made by Supabase's own `withSupabase({ auth: 'user' })` — not by a
// hand-written stand-in that would wave through any bearer string. Edit
// index.ts and break the contract, and this script fails.
//
// Run:  node supabase/tests/geocode_postcode_auth.mjs      (npm run test:edge)
// =============================================================================

/* global Request */
// `Request` is a Web API global, standard in Node 18+ and in the Deno edge
// runtime this function actually targets. The repo's .eslintrc.js predates
// that and declares only the React Native/browser globals it needed, so it
// is declared here rather than widening the shared config for one file.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { withSupabase } from '@supabase/server';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FUNCTION_PATH = join(__dirname, '../functions/geocode-postcode/index.ts');
const SERVER_SPECIFIER = 'npm:@supabase/server@^1';

const URL_UNDER_TEST = 'https://test-project.supabase.co/functions/v1/geocode-postcode';
/** Stands in for a real sb_publishable_ key — deliberately NOT a JWT. */
const PUBLISHABLE_KEY = 'sb_publishable_test_0000000000000000000000';

// ── Tiny test runner ─────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, message: err?.message ?? String(err) });
    console.log(`  FAIL ${name}`);
    console.log(`         ${err?.message ?? err}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

function assertRejected(res, label) {
  assert(
    res.status >= 400 && res.status < 500,
    `${label}: expected a 4xx rejection, got ${res.status}`,
  );
}

// ── Outbound fetch capture ───────────────────────────────────────────────────
let fetchCalls = [];
let fetchQueue = [];

function resetFetch() {
  fetchCalls = [];
  fetchQueue = [];
}

function queueFetch(...responses) {
  fetchQueue.push(...responses);
}

/** URLs the function requested against postcodes.io, in order. */
function postcodeCalls() {
  return fetchCalls.filter((u) => u.includes('api.postcodes.io'));
}

function fetchShim(url) {
  fetchCalls.push(String(url));
  const next = fetchQueue.shift();
  if (!next) throw new Error(`Unexpected fetch with no queued response: ${url}`);
  if (next instanceof Error) return Promise.reject(next);
  return Promise.resolve(next);
}

// postcodes.io response shapes
const exactHit = (latitude, longitude, admin_district) => ({
  ok: true,
  status: 200,
  json: async () => ({ result: { latitude, longitude, admin_district } }),
});
const autoHit = (latitude, longitude, admin_district) => ({
  ok: true,
  status: 200,
  json: async () => ({ result: [{ latitude, longitude, admin_district }] }),
});
const cleanMiss = { ok: false, status: 404, json: async () => ({}) };
const emptyAuto = { ok: true, status: 200, json: async () => ({ result: [] }) };
const upstream = (status) => ({ ok: false, status, json: async () => ({}) });

// ── Boot ─────────────────────────────────────────────────────────────────────
console.log('\ngeocode-postcode Edge Function — auth boundary + postcode contract\n');

const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = 'test-key-1';
publicJwk.alg = 'ES256';
publicJwk.use = 'sig';

// A second, UNTRUSTED key pair — proves signatures are really verified.
const foreign = await generateKeyPair('ES256', { extractable: true });

const now = Math.floor(Date.now() / 1000);
const sign = (key, exp, sub) =>
  new SignJWT({ role: 'authenticated', aud: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1', typ: 'JWT' })
    .setSubject(sub)
    .setIssuedAt(now - 60)
    .setExpirationTime(exp)
    .sign(key);

const validUserJwt = await sign(privateKey, now + 3600, 'user-abc-123');
const expiredUserJwt = await sign(privateKey, now - 30, 'user-abc-123');
const foreignlySignedJwt = await sign(foreign.privateKey, now + 3600, 'user-evil');

// @supabase/server resolves these from the environment. The hosted Edge
// runtime auto-injects the real equivalents (SUPABASE_URL,
// SUPABASE_PUBLISHABLE_KEYS, SUPABASE_SECRET_KEYS, SUPABASE_JWKS — see the
// package README's "Environment Variables" table); here we supply throwaway
// ones. The secret key is required because withSupabase eagerly builds the
// admin client on its context — this function never uses ctx.supabaseAdmin,
// and this fake value is never sent anywhere: no test performs a real
// network call (JWKS is inline and postcodes.io is stubbed).
process.env.SUPABASE_URL = 'https://test-project.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE_KEY;
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_0000000000000000000000';
process.env.SUPABASE_JWKS = JSON.stringify({ keys: [publicJwk] });

// Load the real artifact.
const source = readFileSync(FUNCTION_PATH, 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});

const moduleShim = { exports: {} };
const requireShim = (specifier) => {
  if (specifier === SERVER_SPECIFIER) return { withSupabase };
  throw new Error(`Unexpected import in the Edge Function: ${specifier}`);
};

// eslint-disable-next-line no-new-func
const evaluate = new Function('require', 'module', 'exports', 'fetch', outputText);
evaluate(requireShim, moduleShim, moduleShim.exports, fetchShim);

const handler = moduleShim.exports?.default?.fetch;
if (typeof handler !== 'function') {
  console.error('FATAL: index.ts did not export a default { fetch } handler');
  process.exit(1);
}

// ── Request builders ─────────────────────────────────────────────────────────
/** Exactly what the signed-in app sends. */
function authedPost(body, jwt = validUserJwt) {
  return new Request(URL_UNDER_TEST, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });
}

function rawPost(headers, body = { postcode: 'SY13 1NX' }) {
  return new Request(URL_UNDER_TEST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function run(req) {
  return handler(req);
}

// =============================================================================
// PART 1 — the auth boundary, decided by @supabase/server itself
// =============================================================================
console.log('PART 1 — authentication boundary');

await test('valid signed-in user JWT is accepted and the lookup runs', async () => {
  resetFetch();
  queueFetch(exactHit(52.972411, -2.676992, 'Shropshire'));
  const res = await run(authedPost({ postcode: 'SY13 1NX' }));
  assertEqual(res.status, 200, 'status');
  assertEqual(await res.json(), { latitude: 52.972411, longitude: -2.676992, city: 'Shropshire' }, 'body');
});

await test('no Authorization header is rejected, zero postcodes.io calls', async () => {
  resetFetch();
  const res = await run(rawPost({ apikey: PUBLISHABLE_KEY }));
  assertRejected(res, 'no-auth');
  assertEqual(postcodeCalls().length, 0, 'postcodes.io calls');
});

await test('publishable key ALONE is rejected (public identifier is not user auth)', async () => {
  resetFetch();
  const res = await run(rawPost({ apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${PUBLISHABLE_KEY}` }));
  assertRejected(res, 'publishable-only');
  assertEqual(postcodeCalls().length, 0, 'postcodes.io calls');
});

await test('completely keyless request is rejected', async () => {
  resetFetch();
  const res = await run(rawPost({}));
  assertRejected(res, 'keyless');
  assertEqual(postcodeCalls().length, 0, 'postcodes.io calls');
});

for (const [label, authorization] of [
  ['malformed bearer string', 'Bearer not-a-jwt'],
  ['too few JWT segments', 'Bearer aaa.bbb'],
  ['empty bearer', 'Bearer '],
  ['non-bearer scheme', `Basic ${PUBLISHABLE_KEY}`],
]) {
  await test(`${label} is rejected`, async () => {
    resetFetch();
    const res = await run(rawPost({ apikey: PUBLISHABLE_KEY, Authorization: authorization }));
    assertRejected(res, label);
    assertEqual(postcodeCalls().length, 0, 'postcodes.io calls');
  });
}

await test('EXPIRED but correctly signed user JWT is rejected', async () => {
  resetFetch();
  const res = await run(rawPost({ apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${expiredUserJwt}` }));
  assertRejected(res, 'expired');
  assertEqual(postcodeCalls().length, 0, 'postcodes.io calls');
});

await test('JWT signed by an UNTRUSTED key is rejected (real signature verification)', async () => {
  resetFetch();
  const res = await run(rawPost({ apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${foreignlySignedJwt}` }));
  assertRejected(res, 'foreign-signature');
  assertEqual(postcodeCalls().length, 0, 'postcodes.io calls');
});

// =============================================================================
// PART 2 — server-side postcode validation
// =============================================================================
console.log('\nPART 2 — server-side postcode validation');

await test('valid full postcode performs the exact lookup', async () => {
  resetFetch();
  queueFetch(exactHit(52.972411, -2.676992, 'Shropshire'));
  const res = await run(authedPost({ postcode: 'SY13 1NX' }));
  assertEqual(res.status, 200, 'status');
  assert(postcodeCalls()[0].includes('/postcodes/SY131NX'), 'exact endpoint used');
});

await test('lowercase input is normalised', async () => {
  resetFetch();
  queueFetch(exactHit(51.501009, -0.141588, 'Westminster'));
  const res = await run(authedPost({ postcode: 'sw1a 1aa' }));
  assertEqual(res.status, 200, 'status');
  assert(postcodeCalls()[0].includes('/postcodes/SW1A1AA'), 'normalised to SW1A1AA');
});

for (const variant of ['SY131NX', 'SY13 1NX', '  SY13 1NX  ', 'sy13   1nx']) {
  await test(`spacing variant ${JSON.stringify(variant)} normalises identically`, async () => {
    resetFetch();
    queueFetch(exactHit(52.972411, -2.676992, 'Shropshire'));
    const res = await run(authedPost({ postcode: variant }));
    assertEqual(res.status, 200, 'status');
    assert(postcodeCalls()[0].includes('/postcodes/SY131NX'), 'normalised');
  });
}

await test('GIR 0AA special case is accepted', async () => {
  resetFetch();
  queueFetch(exactHit(51.178882, -1.826215, 'Girobank'));
  const res = await run(authedPost({ postcode: 'GIR 0AA' }));
  assertEqual(res.status, 200, 'status');
  assert(postcodeCalls()[0].includes('/postcodes/GIR0AA'), 'GIR0AA used');
});

await test('valid outward code goes STRAIGHT to autocomplete (no wasted exact lookup)', async () => {
  resetFetch();
  queueFetch(autoHit(52.96, -2.68, 'Shropshire'));
  const res = await run(authedPost({ postcode: 'SY13' }));
  assertEqual(res.status, 200, 'status');
  assertEqual(await res.json(), { latitude: 52.96, longitude: -2.68, city: 'Shropshire' }, 'body');
  assertEqual(postcodeCalls().length, 1, 'exactly one outbound call');
  assert(postcodeCalls()[0].includes('/postcodes?q=SY13'), 'autocomplete endpoint used');
});

await test('longer alphanumeric outward code (EC1A) is accepted', async () => {
  resetFetch();
  queueFetch(autoHit(51.52, -0.1, 'Islington'));
  const res = await run(authedPost({ postcode: 'EC1A' }));
  assertEqual(res.status, 200, 'status');
  assert(postcodeCalls()[0].includes('/postcodes?q=EC1A'), 'autocomplete endpoint used');
});

for (const [label, input] of [
  ['obvious garbage', 'NOT A POSTCODE'],
  ['letters only', 'ZZZZZZ'],
  ['digits only', '12345'],
  ['SQL-ish injection attempt', "'; DROP TABLE venues;--"],
  ['a URL', 'https://evil.example.com/x'],
  ['path traversal attempt', '../../etc/passwd'],
  ['too long', 'SY131NXSY131NX'],
]) {
  await test(`${label} → 400 with ZERO postcodes.io calls`, async () => {
    resetFetch();
    const res = await run(authedPost({ postcode: input }));
    assertEqual(res.status, 400, 'status');
    assertEqual(await res.json(), { error: 'Invalid postcode format' }, 'body');
    assertEqual(postcodeCalls().length, 0, 'postcodes.io calls');
  });
}

await test('empty / whitespace / missing / non-string input → 400, no fetch', async () => {
  for (const body of [{ postcode: '' }, { postcode: '   ' }, {}, { postcode: 123 }, { postcode: null }]) {
    resetFetch();
    const res = await run(authedPost(body));
    assertEqual(res.status, 400, `status for ${JSON.stringify(body)}`);
    assertEqual(postcodeCalls().length, 0, 'postcodes.io calls');
  }
});

await test('malformed JSON body → 400, no fetch', async () => {
  resetFetch();
  const res = await run(rawPost(
    { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${validUserJwt}` },
    'not json at all',
  ));
  assertEqual(res.status, 400, 'status');
  assertEqual(await res.json(), { error: 'Invalid JSON body' }, 'body');
  assertEqual(postcodeCalls().length, 0, 'postcodes.io calls');
});

// =============================================================================
// PART 3 — response contract
// =============================================================================
console.log('\nPART 3 — response contract');

await test('exact miss falls back to autocomplete', async () => {
  resetFetch();
  queueFetch(cleanMiss, autoHit(53.4, -2.9, 'Manchester'));
  const res = await run(authedPost({ postcode: 'M1 1AE' }));
  assertEqual(res.status, 200, 'status');
  assertEqual(postcodeCalls().length, 2, 'both strategies tried');
});

await test('genuine not-found → 404', async () => {
  resetFetch();
  queueFetch(cleanMiss, emptyAuto);
  const res = await run(authedPost({ postcode: 'SY13 1NX' }));
  assertEqual(res.status, 404, 'status');
  assertEqual(await res.json(), { error: 'Postcode not found' }, 'body');
});

await test('postcodes.io 429 → 502, never a lying 404', async () => {
  resetFetch();
  queueFetch(upstream(429), upstream(429));
  const res = await run(authedPost({ postcode: 'SY13 1NX' }));
  assertEqual(res.status, 502, 'status');
  assertEqual(await res.json(), { error: 'Failed to reach geocoding service' }, 'body');
});

await test('postcodes.io 5xx → 502', async () => {
  resetFetch();
  queueFetch(upstream(503), upstream(503));
  assertEqual((await run(authedPost({ postcode: 'SY13 1NX' }))).status, 502, 'status');
});

await test('network exception → 502', async () => {
  resetFetch();
  queueFetch(new TypeError('network down'), new TypeError('network down'));
  assertEqual((await run(authedPost({ postcode: 'SY13 1NX' }))).status, 502, 'status');
});

await test('Strategy 2 success wins even if Strategy 1 failed upstream', async () => {
  resetFetch();
  queueFetch(upstream(500), autoHit(52.97, -2.67, 'Shropshire'));
  assertEqual((await run(authedPost({ postcode: 'SY13 1NX' }))).status, 200, 'status');
});

await test('null admin_district defaults city to an empty string', async () => {
  resetFetch();
  queueFetch(exactHit(52.97, -2.67, null));
  const res = await run(authedPost({ postcode: 'SY13 1NX' }));
  assertEqual(await res.json(), { latitude: 52.97, longitude: -2.67, city: '' }, 'body');
});

await test('non-POST method → 405, no fetch', async () => {
  resetFetch();
  const req = new Request(URL_UNDER_TEST, {
    method: 'GET',
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${validUserJwt}` },
  });
  const res = await run(req);
  assertEqual(res.status, 405, 'status');
  assertEqual(postcodeCalls().length, 0, 'postcodes.io calls');
});

// =============================================================================
// PART 4 — CORS
// =============================================================================
console.log('\nPART 4 — CORS');

await test('preflight succeeds without auth and performs no lookup', async () => {
  resetFetch();
  const res = await run(new Request(URL_UNDER_TEST, { method: 'OPTIONS' }));
  assert(res.status < 400, `preflight status was ${res.status}`);
  assertEqual(res.headers.get('Access-Control-Allow-Origin'), '*', 'ACAO');
  assertEqual(postcodeCalls().length, 0, 'postcodes.io calls');
});

await test('handler responses carry the pinned CORS headers', async () => {
  resetFetch();
  const res = await run(authedPost({ postcode: 'GARBAGE!!' }));
  assertEqual(res.status, 400, 'status');
  assertEqual(res.headers.get('Access-Control-Allow-Origin'), '*', 'ACAO');
  assertEqual(res.headers.get('Content-Type'), 'application/json', 'content-type');
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(70)}`);
console.log(`  passed: ${passed}    failed: ${failed}`);
if (failed > 0) {
  console.log('\n  Failures:');
  for (const f of failures) console.log(`   • ${f.name}\n     ${f.message}`);
}
console.log(`${'─'.repeat(70)}\n`);

process.exit(failed > 0 ? 1 : 0);
