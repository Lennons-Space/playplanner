/**
 * Unit tests for useEnrichmentBatch.
 *
 * SAFETY RULES (enforced here):
 * - supabase is fully mocked. No real DB calls.
 * - auto_apply_venue_proposal is never called against a real database.
 * - Migration 057 is not touched.
 *
 * Coverage:
 *  1.  Initial state is idle.
 *  2.  runBatch calls rpc for every candidate.
 *  3.  applied outcome increments appliedCount.
 *  4.  stale outcome is NOT counted as applied — recorded as failed.
 *  5.  validation_failed is NOT counted as applied — recorded as failed.
 *  6.  not_pending is NOT counted as applied — recorded as failed.
 *  7.  moved_to_manual_review is NOT counted as applied — recorded as failed.
 *  8.  not_authorized JSON outcome stops the batch immediately — remaining items skipped.
 *  9.  Auth error (PGRST301 code) stops the batch — sets stoppedReason.
 * 10.  Auth error (42501 code) stops the batch — sets stoppedReason.
 * 11.  Auth error message containing 'JWT' stops the batch.
 * 12.  Non-auth RPC error continues to next candidate.
 * 13.  Mixed: applied + stale + validation_failed → correct counts.
 * 14.  Empty candidates list: status goes to complete immediately.
 * 15.  Idempotent: concurrent runBatch calls only call rpc once per candidate.
 * 16.  reset() returns state to idle.
 * 17.  batchOutcomeMessage returns correct strings for each outcome.
 * 18.  rpc is called with p_applied_text: null (descriptions never auto-applied).
 */

import { renderHook, act } from '@testing-library/react-native';
import { supabase } from '@/lib/supabase';
import { useEnrichmentBatch, batchOutcomeMessage } from '../useEnrichmentBatch';
import type { AutoApplyCandidate } from '../useEnrichmentProposals';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc:  jest.fn(),
  },
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

const mockRpc = supabase.rpc as jest.MockedFunction<typeof supabase.rpc>;

// ---------------------------------------------------------------------------
// Global reset — clears both call history AND the mockResolvedValueOnce queue.
// mockClear() only clears call history, leaving unconsumed Once-values in the
// queue which then leak into subsequent tests. mockReset() clears everything.
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockRpc.mockReset();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCandidate(id: string, field = 'phone'): AutoApplyCandidate {
  return {
    id,
    venue_id:         `venue-${id}`,
    run_id:           'run-test',
    field:            field as AutoApplyCandidate['field'],
    proposed_value:   { v: '+44 20 7946 0958' },
    current_value:    null,
    decision_reasons: [],
    venueName:        `Venue ${id}`,
  };
}

function rpcSuccess(outcome: string, field = 'phone') {
  return { data: { outcome, field }, error: null } as never;
}

function rpcError(code: string, message: string) {
  return { data: null, error: { code, message } } as never;
}

// ---------------------------------------------------------------------------
// Test 1 — Initial state is idle
// ---------------------------------------------------------------------------

describe('useEnrichmentBatch — initial state', () => {
  it('starts in idle state with empty results and zero counts', () => {
    const { result } = renderHook(() => useEnrichmentBatch());
    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.results).toHaveLength(0);
    expect(result.current.state.appliedCount).toBe(0);
    expect(result.current.state.failedCount).toBe(0);
    expect(result.current.state.stoppedReason).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 2 — runBatch calls rpc for every candidate
// ---------------------------------------------------------------------------

describe('useEnrichmentBatch — rpc is called per candidate', () => {
  // mockRpc is reset globally before every test (see top-level beforeEach).

  it('calls rpc once for each candidate', async () => {
    mockRpc
      .mockResolvedValueOnce(rpcSuccess('applied'))
      .mockResolvedValueOnce(rpcSuccess('applied'));

    const candidates = [makeCandidate('c1'), makeCandidate('c2')];
    const { result } = renderHook(() => useEnrichmentBatch());

    await act(async () => {
      await result.current.runBatch(candidates);
    });

    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'auto_apply_venue_proposal', {
      p_proposal_id:  'c1',
      p_applied_text: null,
    });
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'auto_apply_venue_proposal', {
      p_proposal_id:  'c2',
      p_applied_text: null,
    });
  });

  it('always passes p_applied_text: null (descriptions never auto-applied)', async () => {
    mockRpc.mockResolvedValue(rpcSuccess('applied'));
    const candidate = makeCandidate('desc-c', 'description');
    const { result } = renderHook(() => useEnrichmentBatch());

    await act(async () => {
      await result.current.runBatch([candidate]);
    });

    expect(mockRpc).toHaveBeenCalledWith('auto_apply_venue_proposal', expect.objectContaining({
      p_applied_text: null,
    }));
  });
});

// ---------------------------------------------------------------------------
// Tests 3-7 — Outcome counting
// ---------------------------------------------------------------------------

describe('useEnrichmentBatch — outcome counting', () => {
  // mockRpc is reset globally before every test (see top-level beforeEach).

  it('applied → increments appliedCount', async () => {
    mockRpc.mockResolvedValue(rpcSuccess('applied'));
    const { result } = renderHook(() => useEnrichmentBatch());

    await act(async () => { await result.current.runBatch([makeCandidate('c1')]); });

    expect(result.current.state.appliedCount).toBe(1);
    expect(result.current.state.failedCount).toBe(0);
    expect(result.current.state.status).toBe('complete');
  });

  it('stale → increments failedCount, NOT appliedCount', async () => {
    mockRpc.mockResolvedValue(rpcSuccess('stale'));
    const { result } = renderHook(() => useEnrichmentBatch());

    await act(async () => { await result.current.runBatch([makeCandidate('c1')]); });

    expect(result.current.state.appliedCount).toBe(0);
    expect(result.current.state.failedCount).toBe(1);
    expect(result.current.state.results[0]?.outcome).toBe('stale');
    expect(result.current.state.status).toBe('complete');
  });

  it('validation_failed → increments failedCount, NOT appliedCount', async () => {
    mockRpc.mockResolvedValue(rpcSuccess('validation_failed'));
    const { result } = renderHook(() => useEnrichmentBatch());

    await act(async () => { await result.current.runBatch([makeCandidate('c1')]); });

    expect(result.current.state.appliedCount).toBe(0);
    expect(result.current.state.failedCount).toBe(1);
    expect(result.current.state.status).toBe('complete');
  });

  it('not_pending → increments failedCount, NOT appliedCount', async () => {
    mockRpc.mockResolvedValue(rpcSuccess('not_pending'));
    const { result } = renderHook(() => useEnrichmentBatch());

    await act(async () => { await result.current.runBatch([makeCandidate('c1')]); });

    expect(result.current.state.appliedCount).toBe(0);
    expect(result.current.state.failedCount).toBe(1);
    expect(result.current.state.status).toBe('complete');
  });

  it('moved_to_manual_review → increments failedCount, NOT appliedCount', async () => {
    mockRpc.mockResolvedValue(rpcSuccess('moved_to_manual_review'));
    const { result } = renderHook(() => useEnrichmentBatch());

    await act(async () => { await result.current.runBatch([makeCandidate('c1')]); });

    expect(result.current.state.appliedCount).toBe(0);
    expect(result.current.state.failedCount).toBe(1);
    expect(result.current.state.status).toBe('complete');
  });
});

// ---------------------------------------------------------------------------
// Test 8 — not_authorized JSON outcome stops batch
// ---------------------------------------------------------------------------

describe('useEnrichmentBatch — not_authorized stops the batch', () => {
  // mockRpc is reset globally before every test (see top-level beforeEach).

  it('stops after not_authorized outcome; remaining candidates are NOT called', async () => {
    mockRpc
      .mockResolvedValueOnce(rpcSuccess('applied'))       // c1 succeeds
      .mockResolvedValueOnce(rpcSuccess('not_authorized'))// c2 → stop
      .mockResolvedValueOnce(rpcSuccess('applied'));       // c3 must NOT be called

    const candidates = [makeCandidate('c1'), makeCandidate('c2'), makeCandidate('c3')];
    const { result } = renderHook(() => useEnrichmentBatch());

    await act(async () => { await result.current.runBatch(candidates); });

    // Only 2 rpc calls (c3 was never attempted)
    expect(mockRpc).toHaveBeenCalledTimes(2);

    expect(result.current.state.status).toBe('stopped');
    expect(result.current.state.stoppedReason).toMatch(/not authorised/i);
    expect(result.current.state.appliedCount).toBe(1);
    expect(result.current.state.failedCount).toBe(1);
    // Results has 2 items, not 3
    expect(result.current.state.results).toHaveLength(2);
    expect(result.current.state.results[1]?.outcome).toBe('not_authorized');
  });
});

// ---------------------------------------------------------------------------
// Tests 9-11 — Auth error codes stop the batch
// ---------------------------------------------------------------------------

describe('useEnrichmentBatch — auth RPC error stops the batch', () => {
  // mockRpc is reset globally before every test (see top-level beforeEach).

  it('PGRST301 (JWT expired) stops the batch', async () => {
    mockRpc
      .mockResolvedValueOnce(rpcError('PGRST301', 'JWT expired'))
      .mockResolvedValueOnce(rpcSuccess('applied'));

    const candidates = [makeCandidate('c1'), makeCandidate('c2')];
    const { result } = renderHook(() => useEnrichmentBatch());

    await act(async () => { await result.current.runBatch(candidates); });

    expect(mockRpc).toHaveBeenCalledTimes(1); // c2 never called
    expect(result.current.state.status).toBe('stopped');
    expect(result.current.state.stoppedReason).toMatch(/permission or authentication/i);
  });

  it('42501 (insufficient_privilege) stops the batch', async () => {
    mockRpc
      .mockResolvedValueOnce(rpcError('42501', 'permission denied'))
      .mockResolvedValueOnce(rpcSuccess('applied'));

    const candidates = [makeCandidate('c1'), makeCandidate('c2')];
    const { result } = renderHook(() => useEnrichmentBatch());

    await act(async () => { await result.current.runBatch(candidates); });

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe('stopped');
  });

  it('message containing "JWT" stops the batch', async () => {
    mockRpc
      .mockResolvedValueOnce(rpcError('P0001', 'JWT token is invalid'))
      .mockResolvedValueOnce(rpcSuccess('applied'));

    const candidates = [makeCandidate('c1'), makeCandidate('c2')];
    const { result } = renderHook(() => useEnrichmentBatch());

    await act(async () => { await result.current.runBatch(candidates); });

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe('stopped');
  });
});

// ---------------------------------------------------------------------------
// Test 12 — Non-auth RPC error continues to next candidate
// ---------------------------------------------------------------------------

describe('useEnrichmentBatch — non-auth error continues batch', () => {
  // mockRpc is reset globally before every test (see top-level beforeEach).

  it('transient network error is recorded as unexpected_failure and batch continues', async () => {
    mockRpc
      .mockResolvedValueOnce(rpcError('500', 'Internal Server Error'))
      .mockResolvedValueOnce(rpcSuccess('applied'));

    const candidates = [makeCandidate('c1'), makeCandidate('c2')];
    const { result } = renderHook(() => useEnrichmentBatch());

    await act(async () => { await result.current.runBatch(candidates); });

    // Both rpc calls were made
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(result.current.state.status).toBe('complete');
    expect(result.current.state.results[0]?.outcome).toBe('unexpected_failure');
    expect(result.current.state.results[1]?.outcome).toBe('applied');
    expect(result.current.state.appliedCount).toBe(1);
    expect(result.current.state.failedCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test 13 — Mixed outcomes: correct counts
// ---------------------------------------------------------------------------

describe('useEnrichmentBatch — mixed outcomes', () => {
  // mockRpc is reset globally before every test (see top-level beforeEach).

  it('3 applied + 1 stale + 1 validation_failed → appliedCount=3, failedCount=2', async () => {
    mockRpc
      .mockResolvedValueOnce(rpcSuccess('applied'))
      .mockResolvedValueOnce(rpcSuccess('applied'))
      .mockResolvedValueOnce(rpcSuccess('stale'))
      .mockResolvedValueOnce(rpcSuccess('applied'))
      .mockResolvedValueOnce(rpcSuccess('validation_failed'));

    const candidates = Array.from({ length: 5 }, (_, i) => makeCandidate(`c${i + 1}`));
    const { result } = renderHook(() => useEnrichmentBatch());

    await act(async () => { await result.current.runBatch(candidates); });

    expect(result.current.state.status).toBe('complete');
    expect(result.current.state.appliedCount).toBe(3);
    expect(result.current.state.failedCount).toBe(2);
    expect(result.current.state.results).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Test 14 — Empty candidates list
// ---------------------------------------------------------------------------

describe('useEnrichmentBatch — empty candidates', () => {
  it('empty list: completes immediately with zero counts', async () => {
    const { result } = renderHook(() => useEnrichmentBatch());

    await act(async () => { await result.current.runBatch([]); });

    expect(result.current.state.status).toBe('complete');
    expect(result.current.state.appliedCount).toBe(0);
    expect(result.current.state.failedCount).toBe(0);
    expect(result.current.state.results).toHaveLength(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 15 — Idempotent: concurrent calls
// ---------------------------------------------------------------------------

describe('useEnrichmentBatch — idempotent concurrent calls', () => {
  // mockRpc is reset globally before every test (see top-level beforeEach).

  it('second runBatch call while first is running is a no-op (rpc called once per candidate)', async () => {
    // Make the first rpc call hang so the first batch is still in-flight
    // when the second call arrives.
    let resolveRpc!: (v: unknown) => void;
    const hangingRpc = new Promise<unknown>((res) => { resolveRpc = res; });
    mockRpc.mockReturnValue(hangingRpc as never);

    const candidates = [makeCandidate('c1')];
    const { result } = renderHook(() => useEnrichmentBatch());

    // Start the first batch (without awaiting — it's suspended in the rpc call).
    let firstDone = false;
    act(() => {
      result.current.runBatch(candidates).then(() => { firstDone = true; });
    });

    // At this point isRunningRef.current = true.
    // Start the second batch — it must return immediately without calling rpc again.
    await act(async () => {
      await result.current.runBatch(candidates);
    });

    // Resolve the first batch's hanging rpc.
    await act(async () => {
      resolveRpc({ data: { outcome: 'applied', field: 'phone' }, error: null });
    });

    // rpc must have been called exactly once (not twice).
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(firstDone).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 16 — reset() returns state to idle
// ---------------------------------------------------------------------------

describe('useEnrichmentBatch — reset', () => {
  it('reset after complete returns state to idle', async () => {
    mockRpc.mockResolvedValue(rpcSuccess('applied'));
    const { result } = renderHook(() => useEnrichmentBatch());

    await act(async () => { await result.current.runBatch([makeCandidate('c1')]); });
    expect(result.current.state.status).toBe('complete');

    act(() => { result.current.reset(); });

    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.results).toHaveLength(0);
    expect(result.current.state.appliedCount).toBe(0);
    expect(result.current.state.failedCount).toBe(0);
  });

  it('reset allows a fresh runBatch after completion', async () => {
    mockRpc.mockResolvedValue(rpcSuccess('applied'));
    const { result } = renderHook(() => useEnrichmentBatch());

    await act(async () => { await result.current.runBatch([makeCandidate('c1')]); });
    act(() => { result.current.reset(); });

    // Should be able to run again
    mockRpc.mockClear();
    mockRpc.mockResolvedValue(rpcSuccess('applied'));
    await act(async () => { await result.current.runBatch([makeCandidate('c2')]); });

    expect(result.current.state.status).toBe('complete');
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Test 17 — batchOutcomeMessage
// ---------------------------------------------------------------------------

describe('batchOutcomeMessage', () => {
  it('applied → "Applied successfully."', () => {
    expect(batchOutcomeMessage({ proposalId: 'x', venueId: 'v', field: 'phone', venueName: 'V', outcome: 'applied' }))
      .toBe('Applied successfully.');
  });

  it('not_authorized → contains "Not authorised"', () => {
    expect(batchOutcomeMessage({ proposalId: 'x', venueId: 'v', field: 'phone', venueName: 'V', outcome: 'not_authorized' }))
      .toMatch(/Not authorised/i);
  });

  it('stale → contains "Skipped"', () => {
    expect(batchOutcomeMessage({ proposalId: 'x', venueId: 'v', field: 'phone', venueName: 'V', outcome: 'stale' }))
      .toMatch(/Skipped/i);
  });

  it('validation_failed without reason → "Validation failed."', () => {
    expect(batchOutcomeMessage({ proposalId: 'x', venueId: 'v', field: 'phone', venueName: 'V', outcome: 'validation_failed' }))
      .toBe('Validation failed.');
  });

  it('validation_failed with reason → includes the reason', () => {
    expect(batchOutcomeMessage({
      proposalId: 'x', venueId: 'v', field: 'phone', venueName: 'V',
      outcome: 'validation_failed', reason: 'description_not_rewritten',
    })).toBe('Validation failed: description_not_rewritten.');
  });

  it('unexpected_failure with error message → includes the message', () => {
    expect(batchOutcomeMessage({
      proposalId: 'x', venueId: 'v', field: 'phone', venueName: 'V',
      outcome: 'unexpected_failure', errorMessage: 'Network timeout',
    })).toMatch(/Network timeout/);
  });

  it('moved_to_manual_review → contains "manual review"', () => {
    expect(batchOutcomeMessage({
      proposalId: 'x', venueId: 'v', field: 'phone', venueName: 'V',
      outcome: 'moved_to_manual_review',
    })).toMatch(/manual review/i);
  });

  it('not_pending → contains "Already resolved"', () => {
    expect(batchOutcomeMessage({
      proposalId: 'x', venueId: 'v', field: 'phone', venueName: 'V',
      outcome: 'not_pending',
    })).toMatch(/Already resolved/i);
  });
});

// ---------------------------------------------------------------------------
// Test 18 — JS exception is caught and recorded as unexpected_failure
// ---------------------------------------------------------------------------

describe('useEnrichmentBatch — JS exception handling', () => {
  // mockRpc is reset globally before every test (see top-level beforeEach).

  it('JS throw from rpc is caught, recorded as unexpected_failure, batch continues', async () => {
    mockRpc
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockResolvedValueOnce(rpcSuccess('applied'));

    const candidates = [makeCandidate('c1'), makeCandidate('c2')];
    const { result } = renderHook(() => useEnrichmentBatch());

    await act(async () => { await result.current.runBatch(candidates); });

    expect(result.current.state.status).toBe('complete');
    expect(result.current.state.results[0]?.outcome).toBe('unexpected_failure');
    expect(result.current.state.results[0]?.errorMessage).toBe('Network timeout');
    expect(result.current.state.results[1]?.outcome).toBe('applied');
    expect(result.current.state.appliedCount).toBe(1);
    expect(result.current.state.failedCount).toBe(1);
  });
});
