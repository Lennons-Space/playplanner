/**
 * Tests for lib/postcode.ts — shared UK postcode lookup layer.
 *
 * Covers Liam's full required list for the postcode-lookup repair:
 *   - SY13 1NX passes validation/normalisation
 *   - lowercase / no-space / whitespace-padded variants all pass
 *   - malformed postcode is INVALID and makes NO network call
 *   - genuine remote not-found → NOT_FOUND
 *   - gateway 404 (function not deployed) → SERVICE_UNAVAILABLE
 *   - network failure → SERVICE_UNAVAILABLE
 *   - timeout → SERVICE_UNAVAILABLE
 *   - malformed/unexpected 2xx response → SERVICE_UNAVAILABLE
 *   - full-vs-partial (outward code) acceptance via the `allowPartial` option
 *
 * The two 404 shapes are deliberately distinguished:
 *   - gateway body {"code":"NOT_FOUND","message":"Requested function was
 *     not found"} — the Edge Function itself is not deployed.
 *   - our function's body {"error":"Postcode not found"} — a genuine
 *     remote not-found.
 */
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  lookupPostcode,
  normalisePostcode,
  isValidPostcodeFormat,
  POSTCODE_ERROR_MESSAGES,
} from '@/lib/postcode';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

const mockInvoke = supabase.functions.invoke as jest.MockedFunction<typeof supabase.functions.invoke>;

function httpError(status: number, body: unknown): FunctionsHttpError {
  return new FunctionsHttpError({
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Normalisation ──────────────────────────────────────────────────────────

describe('normalisePostcode', () => {
  it('trims, uppercases and strips internal whitespace', () => {
    expect(normalisePostcode('  sy13 1nx  ')).toBe('SY131NX');
    expect(normalisePostcode('SY13 1NX')).toBe('SY131NX');
    expect(normalisePostcode('SY131NX')).toBe('SY131NX');
    expect(normalisePostcode('sy131nx')).toBe('SY131NX');
  });
});

// ─── Local format validation ────────────────────────────────────────────────

describe('isValidPostcodeFormat', () => {
  it('accepts SY13 1NX in every casing/spacing variant', () => {
    for (const variant of ['SY131NX', 'sy131nx', 'SY13 1NX', '  SY13 1NX  ']) {
      expect(isValidPostcodeFormat(normalisePostcode(variant))).toBe(true);
    }
  });

  it('accepts all six UK postcode formats', () => {
    expect(isValidPostcodeFormat('M11AE')).toBe(true);       // A9 9AA
    expect(isValidPostcodeFormat('M601AE')).toBe(true);      // A99 9AA
    expect(isValidPostcodeFormat('CR26XH')).toBe(true);      // AA9 9AA
    expect(isValidPostcodeFormat('EC1A1BB')).toBe(true);     // AA9A 9AA
    expect(isValidPostcodeFormat('SW1A1AA')).toBe(true);     // A9A 9AA (also EC1A pattern)
    expect(isValidPostcodeFormat('DN551PT')).toBe(true);     // AA99 9AA
  });

  it('accepts the GIR 0AA special case', () => {
    expect(isValidPostcodeFormat('GIR0AA')).toBe(true);
  });

  it('rejects a malformed postcode by default (full mode)', () => {
    expect(isValidPostcodeFormat('NOTAPOSTCODE')).toBe(false);
    expect(isValidPostcodeFormat('')).toBe(false);
    expect(isValidPostcodeFormat('12345')).toBe(false);
  });

  it('rejects an outward-only code when allowPartial is false', () => {
    expect(isValidPostcodeFormat('SY13', false)).toBe(false);
    expect(isValidPostcodeFormat('M1', false)).toBe(false);
  });

  it('accepts an outward-only code when allowPartial is true', () => {
    expect(isValidPostcodeFormat('SY13', true)).toBe(true);
    expect(isValidPostcodeFormat('M1', true)).toBe(true);
    expect(isValidPostcodeFormat('EC1A', true)).toBe(true);
  });

  it('still rejects garbage even when allowPartial is true', () => {
    expect(isValidPostcodeFormat('NOTAPOSTCODE', true)).toBe(false);
  });
});

// ─── lookupPostcode — validation short-circuit (no network call) ───────────

describe('lookupPostcode — malformed input never reaches the network', () => {
  it('returns INVALID and does not call functions.invoke', async () => {
    const result = await lookupPostcode('NOT A POSTCODE');
    expect(result).toEqual({ ok: false, reason: 'INVALID' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('returns INVALID for an empty string and does not call functions.invoke', async () => {
    const result = await lookupPostcode('   ');
    expect(result).toEqual({ ok: false, reason: 'INVALID' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('returns INVALID for an outward code when allowPartial is not set', async () => {
    const result = await lookupPostcode('SY13');
    expect(result).toEqual({ ok: false, reason: 'INVALID' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

// ─── lookupPostcode — success ───────────────────────────────────────────────

describe('lookupPostcode — success', () => {
  it('looks up SY13 1NX, normalising before sending to the Edge Function', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { latitude: 52.972411, longitude: -2.676992, city: 'Shropshire' },
      error: null,
    } as never);

    const result = await lookupPostcode('SY13 1NX');

    expect(mockInvoke).toHaveBeenCalledWith(
      'geocode-postcode',
      expect.objectContaining({ body: { postcode: 'SY131NX' } }),
    );
    expect(result).toEqual({
      ok: true,
      latitude: 52.972411,
      longitude: -2.676992,
      city: 'Shropshire',
    });
  });

  it('accepts a lowercase, unspaced or padded SY13 1NX identically', async () => {
    mockInvoke.mockResolvedValue({
      data: { latitude: 52.972411, longitude: -2.676992, city: 'Shropshire' },
      error: null,
    } as never);

    for (const variant of ['sy13 1nx', 'SY131NX', '  SY13 1NX  ']) {
      mockInvoke.mockClear();
      const result = await lookupPostcode(variant);
      expect(result.ok).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith(
        'geocode-postcode',
        expect.objectContaining({ body: { postcode: 'SY131NX' } }),
      );
    }
  });

  it('accepts an outward code when allowPartial is true', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { latitude: 52.97, longitude: -2.68, city: 'Shropshire' },
      error: null,
    } as never);

    const result = await lookupPostcode('SY13', { allowPartial: true });
    expect(result.ok).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith(
      'geocode-postcode',
      expect.objectContaining({ body: { postcode: 'SY13' } }),
    );
  });

  it('passes a timeout to functions.invoke so the caller can never hang', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { latitude: 1, longitude: 1, city: 'X' },
      error: null,
    } as never);

    await lookupPostcode('SY13 1NX');

    expect(mockInvoke).toHaveBeenCalledWith(
      'geocode-postcode',
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it('defaults city to an empty string when the field is missing', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { latitude: 1, longitude: 2 },
      error: null,
    } as never);

    const result = await lookupPostcode('SY13 1NX');
    expect(result).toEqual({ ok: true, latitude: 1, longitude: 2, city: '' });
  });
});

// ─── lookupPostcode — the two 404 shapes ───────────────────────────────────

describe('lookupPostcode — distinguishing the two 404s', () => {
  it('maps a genuine remote not-found (our function\'s 404 body) to NOT_FOUND', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: httpError(404, { error: 'Postcode not found' }),
    } as never);

    const result = await lookupPostcode('ZZ99 9ZZ');
    expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('maps the gateway 404 (function not deployed) to SERVICE_UNAVAILABLE', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: httpError(404, { code: 'NOT_FOUND', message: 'Requested function was not found' }),
    } as never);

    const result = await lookupPostcode('SY13 1NX');
    expect(result).toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });
  });

  it('maps an unrecognised 404 body to SERVICE_UNAVAILABLE (fail safe, never blame the postcode)', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: httpError(404, { totally: 'unexpected' }),
    } as never);

    const result = await lookupPostcode('SY13 1NX');
    expect(result).toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });
  });

  it('maps a 404 whose body fails to parse as JSON to SERVICE_UNAVAILABLE', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError({
        status: 404,
        json: async () => { throw new Error('not json'); },
      }),
    } as never);

    const result = await lookupPostcode('SY13 1NX');
    expect(result).toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });
  });
});

// ─── lookupPostcode — other HTTP statuses ──────────────────────────────────

describe('lookupPostcode — other HTTP error statuses', () => {
  it('maps HTTP 400 (function rejected the input) to INVALID', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: httpError(400, { error: 'Bad request' }),
    } as never);

    const result = await lookupPostcode('SY13 1NX');
    expect(result).toEqual({ ok: false, reason: 'INVALID' });
  });

  it('maps HTTP 401 to SERVICE_UNAVAILABLE', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: httpError(401, { error: 'Unauthorized' }),
    } as never);
    expect(await lookupPostcode('SY13 1NX')).toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });
  });

  it('maps HTTP 403 to SERVICE_UNAVAILABLE', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: httpError(403, { error: 'Forbidden' }),
    } as never);
    expect(await lookupPostcode('SY13 1NX')).toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });
  });

  it('maps HTTP 5xx to SERVICE_UNAVAILABLE', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: httpError(500, { error: 'Internal error' }),
    } as never);
    expect(await lookupPostcode('SY13 1NX')).toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });
  });

  it('maps a postcodes.io-style 502 (upstream failure surfaced by the function) to SERVICE_UNAVAILABLE', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: httpError(502, { error: 'Failed to reach geocoding service' }),
    } as never);
    expect(await lookupPostcode('SY13 1NX')).toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });
  });
});

// ─── lookupPostcode — network / relay / timeout failures ──────────────────

describe('lookupPostcode — network, relay and timeout failures', () => {
  it('maps FunctionsFetchError (network failure) to SERVICE_UNAVAILABLE', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsFetchError(new TypeError('Network request failed')),
    } as never);

    expect(await lookupPostcode('SY13 1NX')).toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });
  });

  it('maps FunctionsRelayError to SERVICE_UNAVAILABLE', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsRelayError({ region: 'eu-west-2' }),
    } as never);

    expect(await lookupPostcode('SY13 1NX')).toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });
  });

  it('maps a timeout (surfaced as FunctionsFetchError via the internal AbortController) to SERVICE_UNAVAILABLE', async () => {
    // functions.invoke's own `timeout` option aborts the underlying fetch and
    // wraps the resulting AbortError in a FunctionsFetchError internally —
    // verified by reading @supabase/functions-js 2.103.0's FunctionsClient.js.
    // The invoke() promise always resolves (never hangs), which is exactly
    // what guarantees the caller's loading state can't get stuck.
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsFetchError(new DOMException('The operation was aborted.', 'AbortError')),
    } as never);

    const result = await lookupPostcode('SY13 1NX');
    expect(result).toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });
  });

  it('maps an unexpected thrown error from invoke() itself to SERVICE_UNAVAILABLE (defensive)', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('should not normally happen'));
    expect(await lookupPostcode('SY13 1NX')).toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });
  });
});

// ─── lookupPostcode — malformed 2xx response ───────────────────────────────

describe('lookupPostcode — malformed/unexpected 2xx response', () => {
  it('maps a 2xx body missing latitude/longitude to SERVICE_UNAVAILABLE', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { message: 'unexpected shape' }, error: null } as never);
    expect(await lookupPostcode('SY13 1NX')).toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });
  });

  it('maps null data with no error to SERVICE_UNAVAILABLE', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: null } as never);
    expect(await lookupPostcode('SY13 1NX')).toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });
  });

  it('maps non-numeric latitude/longitude to SERVICE_UNAVAILABLE', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { latitude: '52.97', longitude: '-2.68', city: 'Shropshire' },
      error: null,
    } as never);
    expect(await lookupPostcode('SY13 1NX')).toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });
  });

  it('maps non-finite latitude/longitude (e.g. NaN/Infinity) to SERVICE_UNAVAILABLE', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { latitude: NaN, longitude: -2.68, city: 'Shropshire' },
      error: null,
    } as never);
    expect(await lookupPostcode('SY13 1NX')).toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });
  });
});

// ─── User-facing copy ───────────────────────────────────────────────────────

describe('POSTCODE_ERROR_MESSAGES', () => {
  it('matches Liam\'s exact required wording for every reason', () => {
    expect(POSTCODE_ERROR_MESSAGES.INVALID).toBe('Enter a valid UK postcode.');
    expect(POSTCODE_ERROR_MESSAGES.NOT_FOUND).toBe('Postcode not found. Please check and try again.');
    expect(POSTCODE_ERROR_MESSAGES.SERVICE_UNAVAILABLE).toBe(
      'Postcode lookup is temporarily unavailable. Please try again.',
    );
  });
});
