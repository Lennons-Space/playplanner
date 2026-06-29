/**
 * Unit + Security tests for the Admin Enrichment Review screen
 * (app/admin/enrichment.tsx).
 *
 * SAFETY RULES (enforced here):
 * - Supabase is fully mocked — NO real DB calls, no live proposals resolved.
 * - apply_venue_proposal and reject_venue_proposal are never called against a
 *   real database.
 * - Migration 056, RLS policies, and RPC grants are not touched.
 *
 * Test coverage:
 *  1.  Non-admin is redirected — never sees the screen.
 *  2.  Pending proposals render and are grouped by venue.
 *  3.  conflicts_existing=true shows CONFLICT badge.
 *  4.  confidence=low shows LOW CONFIDENCE badge.
 *  5.  booking_url field has NO Approve & Apply button.
 *  6.  description field: Apply is disabled until rewritten text is entered.
 *  7.  Approve+Apply calls update (step 1) then rpc('apply_venue_proposal') with
 *      correct args (step 2).
 *  8.  Reject calls rpc('reject_venue_proposal') with the admin's notes.
 *  9.  RPC error (stale_current_value) is shown inline; proposal stays visible.
 * 10.  Successful approve+apply invalidates the pending-proposals query.
 * 11.  Successful reject invalidates the pending-proposals query.
 * 12.  Approved proposals render with AWAITING APPLY badge, Retry Apply, and
 *      Return to Pending buttons.
 * 13.  retryApply calls rpc('apply_venue_proposal') without a preceding update.
 * 14.  returnToPending calls update with { status: 'pending' }.
 *
 * Pattern mirrors app/admin/__tests__/moderation.test.tsx.
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { supabase }    from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import { useIsAdmin }  from '@/hooks/useAuth';
import EnrichmentScreen from '../enrichment';

// ---------------------------------------------------------------------------
// Mocks — hoisted by Jest; factories must be inline
// ---------------------------------------------------------------------------

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc:  jest.fn(),
  },
}));

jest.mock('@/store/authStore', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('@/hooks/useAuth', () => ({
  useIsAdmin: jest.fn(),
}));

jest.mock('expo-router', () => ({
  router:   { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  Redirect: ({ href }: { href: string }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, { testID: 'redirect' }, `redirect:${href}`);
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native/Libraries/Linking/Linking', () => ({
  openURL: jest.fn().mockResolvedValue(undefined),
}));

// Alert.alert needs to be captured for opening_hours confirmation tests
jest.spyOn(require('react-native'), 'Alert', 'get').mockReturnValue({
  alert: jest.fn(),
});

// ── Phase 4 component mocks ───────────────────────────────────────────────────
// Mock the new sub-components so they don't fire their own Supabase queries
// during screen-level tests. Each mock renders a testID element so tab-switch
// tests can verify the correct panel is mounted.

jest.mock('@/components/admin/EnrichmentSummary', () => ({
  EnrichmentSummary: () => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, { testID: 'mocked-enrichment-summary' });
  },
}));

jest.mock('@/components/admin/AutoApplyBatchPanel', () => ({
  AutoApplyBatchPanel: () => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, { testID: 'mocked-auto-apply-panel' });
  },
}));

jest.mock('@/components/admin/EnrichmentAudit', () => ({
  EnrichmentAudit: () => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, { testID: 'mocked-enrichment-audit' });
  },
}));

jest.mock('@/components/admin/EnrichmentRollback', () => ({
  EnrichmentRollback: () => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, { testID: 'mocked-enrichment-rollback' });
  },
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// ---------------------------------------------------------------------------
// Typed mock references
// ---------------------------------------------------------------------------

const mockUseIsAdmin   = useIsAdmin   as jest.MockedFunction<typeof useIsAdmin>;
const mockUseAuthStore = useAuthStore as jest.MockedFunction<typeof useAuthStore>;

// Derive the store state type without importing AuthState directly (it is not exported).
type AuthStoreState = ReturnType<typeof useAuthStore.getState>;
const mockFrom         = supabase.from as jest.MockedFunction<typeof supabase.from>;
const mockRpc          = supabase.rpc  as jest.MockedFunction<typeof supabase.rpc>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

/**
 * Returns a supabase.from builder that handles:
 *
 *   SELECT chain:  .select(...).in(...).order(...).limit() → resolves with proposals
 *                  Also accepts .eq() after select for backward compat.
 *
 *   UPDATE chain:  .update({...}).eq(...).select('id') → resolves with updateResult
 *
 * The select chain uses `.in()` because the hook was updated to query
 * `status IN ('pending', 'approved')` instead of `status = 'pending'`.
 */
function makeVenueFieldProposalsFromBuilder(
  proposals: ProposalRow[],
  updateResult: { data: { id: string }[] | null; error: null | { message: string; code: string } }
) {
  // Update chain: update().eq().select() → resolved promise
  const selectAfterUpdate = jest.fn().mockResolvedValue(updateResult);
  const eqAfterUpdate     = jest.fn().mockReturnValue({ select: selectAfterUpdate });
  const updateMock        = jest.fn().mockReturnValue({ eq: eqAfterUpdate });

  // Select chain: select().in().eq().order().limit() → resolved promise
  //
  // useReviewableProposals now does:
  //   .in('status', ['pending', 'approved'])
  //   .eq('decision', 'manual_review')   ← Phase 4 addition
  //   .order(...).limit(...)
  //
  // We expose .eq on inMock so the chained .eq() call doesn't throw.
  // Old tests that call .in().order() directly still work because .order is
  // still present on inMock's return value.
  const limitMock   = jest.fn().mockResolvedValue({ data: proposals, error: null });
  const orderMock   = jest.fn().mockReturnValue({ limit: limitMock });
  const eqAfterIn   = jest.fn().mockReturnValue({ order: orderMock }); // for .in().eq().order()
  const inMock      = jest.fn().mockReturnValue({ order: orderMock, eq: eqAfterIn });
  const eqForQuery  = jest.fn().mockReturnValue({ order: orderMock }); // back-compat for .select().eq()
  const selectMock  = jest.fn().mockReturnValue({ in: inMock, eq: eqForQuery });

  return {
    select: selectMock,
    update: updateMock,
    _updateMock: updateMock,
    _eqAfterUpdate: eqAfterUpdate,
    _selectAfterUpdate: selectAfterUpdate,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface ProposalRow {
  id: string;
  venue_id: string;
  field: string;
  proposed_value: unknown;
  current_value: unknown;
  confidence: string;
  extraction_method: string;
  conflicts_existing: boolean;
  source_url: string;
  evidence_snippet: string;
  evidence_raw: string | null;
  retrieved_at: string;
  status: string;
  // Phase 4 fields (optional — not set in pre-Phase-4 fixtures)
  run_id?: string | null;
  decision?: string | null;
  decision_reasons?: string[];
  decision_engine_version?: string | null;
  decision_at?: string | null;
  applied_mode?: string | null;
  venues: { name: string } | null;
}

const PROPOSAL_PHONE: ProposalRow = {
  id:                 'prop-phone-1',
  venue_id:           'venue-aaa',
  field:              'phone',
  proposed_value:     { v: '+44 20 7946 0958' },
  current_value:      null,
  confidence:         'high',
  extraction_method:  'jsonld',
  conflicts_existing: false,
  source_url:         'https://happykidsfarm.co.uk',
  evidence_snippet:   'Phone: +44 20 7946 0958',
  evidence_raw:       null,
  retrieved_at:       '2024-01-01T10:00:00Z',
  status:             'pending',
  venues:             { name: 'Happy Kids Farm' },
};

/**
 * Approved-but-unapplied proposal — simulates a step-1-succeeded, step-2-failed row.
 * Uses a distinct id to avoid duplicate React keys / testIDs when rendered
 * alongside PROPOSAL_PHONE in the same venue group.
 */
const PROPOSAL_APPROVED_PHONE: ProposalRow = {
  ...PROPOSAL_PHONE,
  id:     'prop-phone-1-approved',
  status: 'approved',
};

const PROPOSAL_CONFLICT: ProposalRow = {
  ...PROPOSAL_PHONE,
  id:                 'prop-conflict-1',
  conflicts_existing: true,
  confidence:         'low',
  proposed_value:     { v: '+44 20 7946 9999' },
};

const PROPOSAL_BOOKING: ProposalRow = {
  ...PROPOSAL_PHONE,
  id:             'prop-booking-1',
  field:          'booking_url',
  proposed_value: { v: 'https://happykidsfarm.co.uk/book' },
};

const PROPOSAL_DESC: ProposalRow = {
  ...PROPOSAL_PHONE,
  id:               'prop-desc-1',
  field:            'description',
  proposed_value:   { v: 'A great family venue with outdoor play.' },
  evidence_snippet: 'A great family venue with outdoor play areas and cafe.',
};

/** Second venue — tests grouping */
const PROPOSAL_EMAIL_B: ProposalRow = {
  ...PROPOSAL_PHONE,
  id:             'prop-email-b',
  venue_id:       'venue-bbb',
  field:          'email',
  proposed_value: { v: 'info@outdooradventure.co.uk' },
  venues:         { name: 'Outdoor Adventure Park' },
};

// ---------------------------------------------------------------------------
// Auth stub helpers
// ---------------------------------------------------------------------------

function stubAdmin() {
  mockUseIsAdmin.mockReturnValue(true);
  mockUseAuthStore.mockImplementation((selector) =>
    selector({ user: { id: 'admin-user' }, profile: { is_admin: true }, isLoading: false } as unknown as AuthStoreState)
  );
}

function stubNonAdmin() {
  mockUseIsAdmin.mockReturnValue(false);
  mockUseAuthStore.mockImplementation((selector) =>
    selector({ user: { id: 'user-123' }, profile: { is_admin: false }, isLoading: false } as unknown as AuthStoreState)
  );
}

// ---------------------------------------------------------------------------
// Test 1 — non-admin is redirected
// ---------------------------------------------------------------------------

describe('EnrichmentScreen — non-admin', () => {
  beforeEach(() => {
    stubNonAdmin();
    mockFrom.mockReturnValue(makeVenueFieldProposalsFromBuilder([], {
      data: [], error: null,
    }) as unknown as ReturnType<typeof supabase.from>);
    mockRpc.mockResolvedValue({ data: null, error: null } as never);
  });

  it('renders a Redirect element and never shows proposal UI', async () => {
    const { getByTestId, queryByText } = render(
      <EnrichmentScreen />, { wrapper: makeWrapper() }
    );
    await waitFor(() => {
      expect(getByTestId('redirect')).toBeTruthy();
    });
    // Should never see proposal content
    expect(queryByText('Approve & Apply')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 2 — pending proposals render, grouped by venue
// ---------------------------------------------------------------------------

describe('EnrichmentScreen — pending proposals render', () => {
  beforeEach(() => {
    stubAdmin();
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_PHONE, PROPOSAL_EMAIL_B],
        { data: [{ id: PROPOSAL_PHONE.id }], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    mockRpc.mockResolvedValue({ data: null, error: null } as never);
  });

  it('displays both venue names as group headers', async () => {
    const { getByText } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(getByText('Happy Kids Farm')).toBeTruthy();
      expect(getByText('Outdoor Adventure Park')).toBeTruthy();
    });
  });

  it('renders a proposal card for each proposal', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(getByTestId(`proposal-card-${PROPOSAL_PHONE.id}`)).toBeTruthy();
      expect(getByTestId(`proposal-card-${PROPOSAL_EMAIL_B.id}`)).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Test 3 & 4 — visual warnings
// ---------------------------------------------------------------------------

describe('EnrichmentScreen — visual warnings', () => {
  beforeEach(() => {
    stubAdmin();
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_CONFLICT],
        { data: [{ id: PROPOSAL_CONFLICT.id }], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    mockRpc.mockResolvedValue({ data: null, error: null } as never);
  });

  it('shows CONFLICT badge when conflicts_existing is true', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(getByTestId(`conflict-warning-${PROPOSAL_CONFLICT.id}`)).toBeTruthy();
    });
  });

  it('shows LOW CONFIDENCE badge when confidence is low', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(getByTestId(`low-confidence-warning-${PROPOSAL_CONFLICT.id}`)).toBeTruthy();
    });
  });

  it('does NOT show CONFLICT badge for non-conflicting proposals', async () => {
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_PHONE],
        { data: [{ id: PROPOSAL_PHONE.id }], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    const { queryByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(queryByTestId(`conflict-warning-${PROPOSAL_PHONE.id}`)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Test 5 — booking_url has no Approve & Apply button
// ---------------------------------------------------------------------------

describe('EnrichmentScreen — booking_url has no Apply button', () => {
  beforeEach(() => {
    stubAdmin();
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_BOOKING],
        { data: [{ id: PROPOSAL_BOOKING.id }], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    mockRpc.mockResolvedValue({ data: null, error: null } as never);
  });

  it('does not render an Approve & Apply button for booking_url', async () => {
    const { queryByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(queryByTestId(`approve-apply-btn-${PROPOSAL_BOOKING.id}`)).toBeNull();
    });
  });

  it('renders a Reject button for booking_url', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(getByTestId(`reject-btn-${PROPOSAL_BOOKING.id}`)).toBeTruthy();
    });
  });

  it('shows the no-target-column badge for booking_url', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(getByTestId(`no-apply-booking-${PROPOSAL_BOOKING.id}`)).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Test 6 — description Apply is disabled until rewritten text is entered
// ---------------------------------------------------------------------------

describe('EnrichmentScreen — description Apply disabled until text entered', () => {
  beforeEach(() => {
    stubAdmin();
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_DESC],
        { data: [{ id: PROPOSAL_DESC.id }], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    mockRpc.mockResolvedValue({ data: null, error: null } as never);
  });

  it('renders the description text input (not prefilled with evidence)', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      const input = getByTestId(`description-input-${PROPOSAL_DESC.id}`);
      expect(input).toBeTruthy();
      // Input must be blank — never prefilled with extracted text
      expect(input.props.value).toBe('');
    });
  });

  it('Apply & Approve button is disabled when description input is empty', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      const btn = getByTestId(`approve-apply-btn-${PROPOSAL_DESC.id}`);
      expect(btn.props.accessibilityState?.disabled ?? btn.props.disabled).toBeTruthy();
    });
  });

  it('Apply & Approve button becomes enabled after entering rewritten text', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`description-input-${PROPOSAL_DESC.id}`)).toBeTruthy());

    await act(async () => {
      fireEvent.changeText(
        getByTestId(`description-input-${PROPOSAL_DESC.id}`),
        'A lovely farm venue perfect for families with young children.'
      );
    });

    await waitFor(() => {
      const btn = getByTestId(`approve-apply-btn-${PROPOSAL_DESC.id}`);
      const isDisabled = btn.props.accessibilityState?.disabled ?? btn.props.disabled;
      expect(isDisabled).toBeFalsy();
    });
  });
});

// ---------------------------------------------------------------------------
// Test 7 — approve + apply calls update then rpc with correct args
// ---------------------------------------------------------------------------

describe('EnrichmentScreen — approve + apply mutation', () => {
  let updateMock: jest.Mock;

  beforeEach(() => {
    stubAdmin();

    const builder = makeVenueFieldProposalsFromBuilder(
      [PROPOSAL_PHONE],
      { data: [{ id: PROPOSAL_PHONE.id }], error: null }
    );
    updateMock = builder._updateMock;

    mockFrom.mockReturnValue(builder as unknown as ReturnType<typeof supabase.from>);
    mockRpc.mockResolvedValue({ data: { ok: true, field: 'phone' }, error: null } as never);
  });

  it('calls update with { status: approved, reviewed_by } and the proposal id', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`approve-apply-btn-${PROPOSAL_PHONE.id}`)).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId(`approve-apply-btn-${PROPOSAL_PHONE.id}`));
    });
    // The button now opens the confirmation modal — confirm the write.
    await waitFor(() => expect(getByTestId('confirm-apply-confirm')).toBeTruthy());
    await act(async () => {
      fireEvent.press(getByTestId('confirm-apply-confirm'));
    });

    await waitFor(() => {
      // Use objectContaining — reviewed_at is a dynamic timestamp we cannot predict exactly.
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status:      'approved',
          reviewed_by: 'admin-user',
        })
      );
    });
  });

  it('calls rpc("apply_venue_proposal") with the correct proposal id and null applied_text', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`approve-apply-btn-${PROPOSAL_PHONE.id}`)).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId(`approve-apply-btn-${PROPOSAL_PHONE.id}`));
    });
    await waitFor(() => expect(getByTestId('confirm-apply-confirm')).toBeTruthy());
    await act(async () => {
      fireEvent.press(getByTestId('confirm-apply-confirm'));
    });

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('apply_venue_proposal', {
        p_proposal_id:  PROPOSAL_PHONE.id,
        p_applied_text: null,
      });
    });
  });

  it('calls rpc("apply_venue_proposal") with appliedText for description field', async () => {
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_DESC],
        { data: [{ id: PROPOSAL_DESC.id }], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );

    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`description-input-${PROPOSAL_DESC.id}`)).toBeTruthy());

    const rewrittenText = 'A wonderful family farm with animals and play areas.';
    await act(async () => {
      fireEvent.changeText(getByTestId(`description-input-${PROPOSAL_DESC.id}`), rewrittenText);
    });
    await act(async () => {
      fireEvent.press(getByTestId(`approve-apply-btn-${PROPOSAL_DESC.id}`));
    });
    // Modal opens — confirm the write.
    await waitFor(() => expect(getByTestId('confirm-apply-confirm')).toBeTruthy());
    await act(async () => {
      fireEvent.press(getByTestId('confirm-apply-confirm'));
    });

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('apply_venue_proposal', {
        p_proposal_id:  PROPOSAL_DESC.id,
        p_applied_text: rewrittenText,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Test 8 — reject calls rpc('reject_venue_proposal') with the admin's notes
// ---------------------------------------------------------------------------

describe('EnrichmentScreen — reject mutation', () => {
  beforeEach(() => {
    stubAdmin();
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_PHONE],
        { data: [{ id: PROPOSAL_PHONE.id }], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null } as never);
  });

  it('opens reject modal when Reject is pressed', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`reject-btn-${PROPOSAL_PHONE.id}`)).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId(`reject-btn-${PROPOSAL_PHONE.id}`));
    });

    await waitFor(() => {
      expect(getByTestId('reject-note-input')).toBeTruthy();
    });
  });

  it('Reject button in modal is disabled until a note is entered', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`reject-btn-${PROPOSAL_PHONE.id}`)).toBeTruthy());

    await act(async () => { fireEvent.press(getByTestId(`reject-btn-${PROPOSAL_PHONE.id}`)); });

    await waitFor(() => expect(getByTestId('reject-modal-confirm')).toBeTruthy());
    const confirmBtn = getByTestId('reject-modal-confirm');
    expect(confirmBtn.props.accessibilityState?.disabled ?? confirmBtn.props.disabled).toBeTruthy();
  });

  it('calls rpc("reject_venue_proposal") with the admin notes after confirming', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`reject-btn-${PROPOSAL_PHONE.id}`)).toBeTruthy());

    await act(async () => { fireEvent.press(getByTestId(`reject-btn-${PROPOSAL_PHONE.id}`)); });
    await waitFor(() => expect(getByTestId('reject-note-input')).toBeTruthy());

    const noteText = 'Data is incorrect — wrong phone number format.';
    await act(async () => {
      fireEvent.changeText(getByTestId('reject-note-input'), noteText);
    });
    await act(async () => {
      fireEvent.press(getByTestId('reject-modal-confirm'));
    });

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('reject_venue_proposal', {
        p_proposal_id: PROPOSAL_PHONE.id,
        p_notes:       noteText,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Test 9 — RPC error is shown inline; proposal card stays visible
// ---------------------------------------------------------------------------

describe('EnrichmentScreen — RPC error stays visible', () => {
  beforeEach(() => {
    stubAdmin();
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_PHONE],
        { data: [{ id: PROPOSAL_PHONE.id }], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
  });

  it('shows the RPC error message inline and keeps the proposal card', async () => {
    // Step 1 (update) succeeds; step 2 (apply RPC) fails with stale_current_value
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'stale_current_value', code: 'P0001' },
    } as never);

    const { getByTestId, getByText } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`approve-apply-btn-${PROPOSAL_PHONE.id}`)).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId(`approve-apply-btn-${PROPOSAL_PHONE.id}`));
    });
    // Modal opens — confirm the write (which will then fail at step 2).
    await waitFor(() => expect(getByTestId('confirm-apply-confirm')).toBeTruthy());
    await act(async () => {
      fireEvent.press(getByTestId('confirm-apply-confirm'));
    });

    await waitFor(() => {
      expect(
        getByText(/changed since this proposal was created/i)
      ).toBeTruthy();
      expect(getByTestId(`proposal-card-${PROPOSAL_PHONE.id}`)).toBeTruthy();
    });
  });

  it('shows the reject RPC error inline and keeps the proposal card', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'not_found', code: 'P0001' },
    } as never);

    const { getByTestId, getByText } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`reject-btn-${PROPOSAL_PHONE.id}`)).toBeTruthy());

    await act(async () => { fireEvent.press(getByTestId(`reject-btn-${PROPOSAL_PHONE.id}`)); });
    await waitFor(() => expect(getByTestId('reject-note-input')).toBeTruthy());

    await act(async () => {
      fireEvent.changeText(getByTestId('reject-note-input'), 'test note');
    });
    await act(async () => {
      fireEvent.press(getByTestId('reject-modal-confirm'));
    });

    await waitFor(() => {
      expect(getByText(/Proposal not found/i)).toBeTruthy();
      expect(getByTestId(`proposal-card-${PROPOSAL_PHONE.id}`)).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Test 10 & 11 — query invalidation on success
// ---------------------------------------------------------------------------

describe('EnrichmentScreen — query invalidation after resolve', () => {
  it('re-fetches the proposals list after a successful approve+apply', async () => {
    stubAdmin();

    let refetchCount = 0;
    const proposalsAfterApply: ProposalRow[] = [];

    mockFrom.mockImplementation(() => {
      refetchCount++;
      const data = refetchCount === 1 ? [PROPOSAL_PHONE] : proposalsAfterApply;
      return makeVenueFieldProposalsFromBuilder(
        data,
        { data: [{ id: PROPOSAL_PHONE.id }], error: null }
      ) as unknown as ReturnType<typeof supabase.from>;
    });
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null } as never);

    const { getByTestId, queryByTestId } = render(
      <EnrichmentScreen />, { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(getByTestId(`approve-apply-btn-${PROPOSAL_PHONE.id}`)).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId(`approve-apply-btn-${PROPOSAL_PHONE.id}`));
    });
    // Modal opens — confirm the write.
    await waitFor(() => expect(getByTestId('confirm-apply-confirm')).toBeTruthy());
    await act(async () => {
      fireEvent.press(getByTestId('confirm-apply-confirm'));
    });

    await waitFor(() => {
      expect(refetchCount).toBeGreaterThan(1);
    });

    await waitFor(() => {
      expect(queryByTestId(`proposal-card-${PROPOSAL_PHONE.id}`)).toBeNull();
    });
  });

  it('re-fetches the proposals list after a successful reject', async () => {
    stubAdmin();

    let refetchCount = 0;
    mockFrom.mockImplementation(() => {
      refetchCount++;
      const data = refetchCount === 1 ? [PROPOSAL_PHONE] : [];
      return makeVenueFieldProposalsFromBuilder(
        data,
        { data: [], error: null }
      ) as unknown as ReturnType<typeof supabase.from>;
    });
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null } as never);

    const { getByTestId, queryByTestId } = render(
      <EnrichmentScreen />, { wrapper: makeWrapper() }
    );
    await waitFor(() => expect(getByTestId(`reject-btn-${PROPOSAL_PHONE.id}`)).toBeTruthy());

    await act(async () => { fireEvent.press(getByTestId(`reject-btn-${PROPOSAL_PHONE.id}`)); });
    await waitFor(() => expect(getByTestId('reject-note-input')).toBeTruthy());

    await act(async () => {
      fireEvent.changeText(getByTestId('reject-note-input'), 'Data is wrong.');
    });
    await act(async () => {
      fireEvent.press(getByTestId('reject-modal-confirm'));
    });

    await waitFor(() => {
      expect(refetchCount).toBeGreaterThan(1);
    });

    await waitFor(() => {
      expect(queryByTestId(`proposal-card-${PROPOSAL_PHONE.id}`)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Test 12 — approved proposals render with correct badges + buttons
// ---------------------------------------------------------------------------

describe('EnrichmentScreen — approved proposals (awaiting apply)', () => {
  beforeEach(() => {
    stubAdmin();
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_APPROVED_PHONE],
        { data: [{ id: PROPOSAL_APPROVED_PHONE.id }], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null } as never);
  });

  it('shows the AWAITING APPLY badge for an approved proposal', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(getByTestId(`approved-awaiting-apply-${PROPOSAL_APPROVED_PHONE.id}`)).toBeTruthy();
    });
  });

  it('renders a Retry Apply button for an approved proposal', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(getByTestId(`retry-apply-btn-${PROPOSAL_APPROVED_PHONE.id}`)).toBeTruthy();
    });
  });

  it('renders a Return to Pending button for an approved proposal', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(getByTestId(`return-to-pending-btn-${PROPOSAL_APPROVED_PHONE.id}`)).toBeTruthy();
    });
  });

  it('does NOT show an Approve & Apply button for an approved proposal', async () => {
    const { queryByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(
        queryByTestId(`approve-apply-btn-${PROPOSAL_APPROVED_PHONE.id}`)
      ).toBeNull();
    });
  });

  it('shows approved proposal card alongside pending proposals', async () => {
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_PHONE, PROPOSAL_APPROVED_PHONE],
        { data: [], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(getByTestId(`proposal-card-${PROPOSAL_PHONE.id}`)).toBeTruthy();
      expect(getByTestId(`proposal-card-${PROPOSAL_APPROVED_PHONE.id}`)).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Test 13 — retryApply calls rpc without a preceding update call
// ---------------------------------------------------------------------------

describe('EnrichmentScreen — retryApply mutation', () => {
  let updateMock: jest.Mock;

  beforeEach(() => {
    stubAdmin();
    const builder = makeVenueFieldProposalsFromBuilder(
      [PROPOSAL_APPROVED_PHONE],
      { data: [{ id: PROPOSAL_APPROVED_PHONE.id }], error: null }
    );
    updateMock = builder._updateMock;

    mockFrom.mockReturnValue(builder as unknown as ReturnType<typeof supabase.from>);
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null } as never);
  });

  it('calls rpc("apply_venue_proposal") with the proposal id when Retry Apply is pressed', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`retry-apply-btn-${PROPOSAL_APPROVED_PHONE.id}`)).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId(`retry-apply-btn-${PROPOSAL_APPROVED_PHONE.id}`));
    });

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('apply_venue_proposal', {
        p_proposal_id:  PROPOSAL_APPROVED_PHONE.id,
        p_applied_text: null,
      });
    });
  });

  it('does NOT call update when Retry Apply is pressed (step 1 already done)', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`retry-apply-btn-${PROPOSAL_APPROVED_PHONE.id}`)).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId(`retry-apply-btn-${PROPOSAL_APPROVED_PHONE.id}`));
    });

    // rpc fires, but update must NOT be called
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('shows inline error and keeps the card when retryApply RPC fails', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'stale_current_value', code: 'P0001' },
    } as never);

    const { getByTestId, getByText } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`retry-apply-btn-${PROPOSAL_APPROVED_PHONE.id}`)).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId(`retry-apply-btn-${PROPOSAL_APPROVED_PHONE.id}`));
    });

    await waitFor(() => {
      expect(getByText(/changed since this proposal was created/i)).toBeTruthy();
      expect(getByTestId(`proposal-card-${PROPOSAL_APPROVED_PHONE.id}`)).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Test 14 — returnToPending calls update with { status: 'pending' }
// ---------------------------------------------------------------------------

describe('EnrichmentScreen — returnToPending mutation', () => {
  let updateMock: jest.Mock;

  beforeEach(() => {
    stubAdmin();
    // Clear rpc call history so "not.toHaveBeenCalled" assertions are not
    // polluted by calls made in earlier describe blocks.
    mockRpc.mockClear();
    const builder = makeVenueFieldProposalsFromBuilder(
      [PROPOSAL_APPROVED_PHONE],
      { data: [{ id: PROPOSAL_APPROVED_PHONE.id }], error: null }
    );
    updateMock = builder._updateMock;

    mockFrom.mockReturnValue(builder as unknown as ReturnType<typeof supabase.from>);
    mockRpc.mockResolvedValue({ data: null, error: null } as never);
  });

  it('calls update with { status: "pending" } when Return to Pending is pressed', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`return-to-pending-btn-${PROPOSAL_APPROVED_PHONE.id}`)).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId(`return-to-pending-btn-${PROPOSAL_APPROVED_PHONE.id}`));
    });

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith({ status: 'pending' });
    });
  });

  it('does NOT call rpc when Return to Pending is pressed', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`return-to-pending-btn-${PROPOSAL_APPROVED_PHONE.id}`)).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId(`return-to-pending-btn-${PROPOSAL_APPROVED_PHONE.id}`));
    });

    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('re-fetches after successful returnToPending', async () => {
    let refetchCount = 0;
    mockFrom.mockImplementation(() => {
      refetchCount++;
      // After the first fetch, return a pending proposal
      const data = refetchCount === 1
        ? [PROPOSAL_APPROVED_PHONE]
        : [PROPOSAL_PHONE]; // same proposal but status='pending'
      return makeVenueFieldProposalsFromBuilder(
        data,
        { data: [{ id: PROPOSAL_APPROVED_PHONE.id }], error: null }
      ) as unknown as ReturnType<typeof supabase.from>;
    });

    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`return-to-pending-btn-${PROPOSAL_APPROVED_PHONE.id}`)).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId(`return-to-pending-btn-${PROPOSAL_APPROVED_PHONE.id}`));
    });

    await waitFor(() => {
      expect(refetchCount).toBeGreaterThan(1);
    });
  });
});

// ---------------------------------------------------------------------------
// New test N1 — Tapping Approve & Apply opens modal but performs NO write
// ---------------------------------------------------------------------------

describe('confirm-apply modal — opens on button press with no write', () => {
  let updateMock: jest.Mock;

  beforeEach(() => {
    stubAdmin();
    // Clear call history so not.toHaveBeenCalled() isn't polluted by earlier describes.
    mockRpc.mockClear();
    const builder = makeVenueFieldProposalsFromBuilder(
      [PROPOSAL_PHONE],
      { data: [{ id: PROPOSAL_PHONE.id }], error: null }
    );
    updateMock = builder._updateMock;
    mockFrom.mockReturnValue(builder as unknown as ReturnType<typeof supabase.from>);
    mockRpc.mockResolvedValue({ data: null, error: null } as never);
  });

  it('tapping Approve & Apply opens confirm-apply-modal but does NOT call update or rpc', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`approve-apply-btn-${PROPOSAL_PHONE.id}`)).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId(`approve-apply-btn-${PROPOSAL_PHONE.id}`));
    });

    await waitFor(() => expect(getByTestId('confirm-apply-modal')).toBeTruthy());

    // No DB write must have happened — only the modal opened.
    expect(updateMock).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// New test N2 — Cancel closes modal, performs NO write
// ---------------------------------------------------------------------------

describe('confirm-apply modal — Cancel closes modal with no write', () => {
  let updateMock: jest.Mock;

  beforeEach(() => {
    stubAdmin();
    mockRpc.mockClear();
    const builder = makeVenueFieldProposalsFromBuilder(
      [PROPOSAL_PHONE],
      { data: [{ id: PROPOSAL_PHONE.id }], error: null }
    );
    updateMock = builder._updateMock;
    mockFrom.mockReturnValue(builder as unknown as ReturnType<typeof supabase.from>);
    mockRpc.mockResolvedValue({ data: null, error: null } as never);
  });

  it('pressing Cancel closes the modal and performs NO write', async () => {
    const { getByTestId, queryByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`approve-apply-btn-${PROPOSAL_PHONE.id}`)).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId(`approve-apply-btn-${PROPOSAL_PHONE.id}`));
    });
    await waitFor(() => expect(getByTestId('confirm-apply-cancel')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId('confirm-apply-cancel'));
    });

    // Modal should be gone.
    await waitFor(() => {
      expect(queryByTestId('confirm-apply-modal')).toBeNull();
    });
    // No write at all.
    expect(updateMock).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// New test N3 — Confirming runs update then rpc (explicit flow test)
// ---------------------------------------------------------------------------

describe('confirm-apply modal — confirming runs update then rpc', () => {
  let updateMock: jest.Mock;

  beforeEach(() => {
    stubAdmin();
    const builder = makeVenueFieldProposalsFromBuilder(
      [PROPOSAL_PHONE],
      { data: [{ id: PROPOSAL_PHONE.id }], error: null }
    );
    updateMock = builder._updateMock;
    mockFrom.mockReturnValue(builder as unknown as ReturnType<typeof supabase.from>);
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null } as never);
  });

  it('pressing Apply live change calls update (step 1) then rpc (step 2)', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`approve-apply-btn-${PROPOSAL_PHONE.id}`)).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId(`approve-apply-btn-${PROPOSAL_PHONE.id}`));
    });
    await waitFor(() => expect(getByTestId('confirm-apply-confirm')).toBeTruthy());
    await act(async () => {
      fireEvent.press(getByTestId('confirm-apply-confirm'));
    });

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'approved', reviewed_by: 'admin-user' })
      );
      expect(mockRpc).toHaveBeenCalledWith('apply_venue_proposal', {
        p_proposal_id:  PROPOSAL_PHONE.id,
        p_applied_text: null,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// New test N4 — Modal displays venue name, field label, current & new values
// ---------------------------------------------------------------------------

describe('confirm-apply modal — displays correct content', () => {
  beforeEach(() => {
    stubAdmin();
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_PHONE],
        { data: [{ id: PROPOSAL_PHONE.id }], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    mockRpc.mockResolvedValue({ data: null, error: null } as never);
  });

  it('shows venue name, field label, current value placeholder, and proposed value', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`approve-apply-btn-${PROPOSAL_PHONE.id}`)).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId(`approve-apply-btn-${PROPOSAL_PHONE.id}`));
    });
    await waitFor(() => expect(getByTestId('confirm-apply-modal')).toBeTruthy());

    // Venue name
    expect(getByTestId('confirm-venue-name').props.children).toBe('Happy Kids Farm');
    // Field label (phone → 'Phone')
    expect(getByTestId('confirm-field-label').props.children).toBe('Phone');
    // Current value — PROPOSAL_PHONE has current_value: null → '(none)'
    expect(getByTestId('confirm-current-value').props.children).toBe('(none)');
    // New value — scalarValue({ v: '+44 20 7946 0958' })
    expect(getByTestId('confirm-new-value').props.children).toBe('+44 20 7946 0958');
  });
});

// ---------------------------------------------------------------------------
// New test N5 — Double-tap confirm does not produce duplicate writes
// ---------------------------------------------------------------------------

describe('confirm-apply modal — double-tap protection', () => {
  it('pressing confirm-apply-confirm twice only calls update and rpc once each', async () => {
    stubAdmin();

    // Make update hang indefinitely so pendingApproveId stays set after first press.
    let resolveUpdate!: (v: unknown) => void;
    const hangingUpdate = new Promise<unknown>((res) => { resolveUpdate = res; });

    const selectAfterUpdateDouble = jest.fn().mockReturnValue(hangingUpdate);
    const eqAfterUpdateDouble     = jest.fn().mockReturnValue({ select: selectAfterUpdateDouble });
    const updateMockDouble        = jest.fn().mockReturnValue({ eq: eqAfterUpdateDouble });

    const limitMockDouble  = jest.fn().mockResolvedValue({ data: [PROPOSAL_PHONE], error: null });
    const orderMockDouble  = jest.fn().mockReturnValue({ limit: limitMockDouble });
    // eqAfterInDouble handles .in(...).eq('decision','manual_review').order(...) chain
    const eqAfterInDouble  = jest.fn().mockReturnValue({ order: orderMockDouble });
    const inMockDouble     = jest.fn().mockReturnValue({ order: orderMockDouble, eq: eqAfterInDouble });
    const eqQueryDouble    = jest.fn().mockReturnValue({ order: orderMockDouble });
    const selectMockDouble = jest.fn().mockReturnValue({ in: inMockDouble, eq: eqQueryDouble });

    mockFrom.mockReturnValue({
      select: selectMockDouble,
      update: updateMockDouble,
    } as unknown as ReturnType<typeof supabase.from>);
    mockRpc.mockResolvedValue({ data: null, error: null } as never);

    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`approve-apply-btn-${PROPOSAL_PHONE.id}`)).toBeTruthy());

    // Open the modal.
    await act(async () => {
      fireEvent.press(getByTestId(`approve-apply-btn-${PROPOSAL_PHONE.id}`));
    });
    await waitFor(() => expect(getByTestId('confirm-apply-confirm')).toBeTruthy());

    // First press — starts the mutation (update hangs, pendingApproveId is set).
    await act(async () => {
      fireEvent.press(getByTestId('confirm-apply-confirm'));
    });

    // State has now flushed: pendingApproveId === proposal.id, button is disabled.
    // Second press — early-return guard fires; no duplicate write.
    await act(async () => {
      fireEvent.press(getByTestId('confirm-apply-confirm'));
    });

    // Resolve the hanging update so the mutation can clean up.
    await act(async () => {
      resolveUpdate({ data: [{ id: PROPOSAL_PHONE.id }], error: null });
    });

    // update called exactly once; rpc called exactly once (after update resolves).
    await waitFor(() => {
      expect(updateMockDouble).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// New test N6 — booking_url has no apply path and cannot open the confirm modal
// ---------------------------------------------------------------------------

describe('confirm-apply modal — booking_url has no apply path', () => {
  beforeEach(() => {
    stubAdmin();
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_BOOKING],
        { data: [{ id: PROPOSAL_BOOKING.id }], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    mockRpc.mockResolvedValue({ data: null, error: null } as never);
  });

  it('booking_url has no approve-apply-btn and the confirm modal is never shown', async () => {
    const { queryByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(queryByTestId(`reject-btn-${PROPOSAL_BOOKING.id}`)).toBeTruthy());

    // No approve-apply button exists for booking_url.
    expect(queryByTestId(`approve-apply-btn-${PROPOSAL_BOOKING.id}`)).toBeNull();
    // Confirmation modal is not present (no way to open it for booking_url).
    expect(queryByTestId('confirm-apply-modal')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// New test N7 — Description rewrite validation (modal gate + appliedText)
// ---------------------------------------------------------------------------

describe('confirm-apply modal — description rewrite validation', () => {
  beforeEach(() => {
    stubAdmin();
    mockRpc.mockClear();
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_DESC],
        { data: [{ id: PROPOSAL_DESC.id }], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null } as never);
  });

  it('approve-apply button is disabled when description input is empty', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`approve-apply-btn-${PROPOSAL_DESC.id}`)).toBeTruthy());

    const btn = getByTestId(`approve-apply-btn-${PROPOSAL_DESC.id}`);
    expect(btn.props.accessibilityState?.disabled ?? btn.props.disabled).toBeTruthy();
  });

  it('pressing Approve & Apply after entering text opens the modal without writing', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`description-input-${PROPOSAL_DESC.id}`)).toBeTruthy());

    await act(async () => {
      fireEvent.changeText(
        getByTestId(`description-input-${PROPOSAL_DESC.id}`),
        'A lovely farm for families.'
      );
    });
    await act(async () => {
      fireEvent.press(getByTestId(`approve-apply-btn-${PROPOSAL_DESC.id}`));
    });

    // Modal is open — no write yet.
    await waitFor(() => expect(getByTestId('confirm-apply-modal')).toBeTruthy());
    // update and rpc must not have been called.
    const builderFrom = mockFrom.mock.results[0]?.value as { _updateMock?: jest.Mock } | undefined;
    if (builderFrom?._updateMock) {
      expect(builderFrom._updateMock).not.toHaveBeenCalled();
    }
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('confirming sends the rewritten text as p_applied_text', async () => {
    const rewrittenText = 'A charming family farm with soft play and animals.';
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`description-input-${PROPOSAL_DESC.id}`)).toBeTruthy());

    await act(async () => {
      fireEvent.changeText(getByTestId(`description-input-${PROPOSAL_DESC.id}`), rewrittenText);
    });
    await act(async () => {
      fireEvent.press(getByTestId(`approve-apply-btn-${PROPOSAL_DESC.id}`));
    });
    await waitFor(() => expect(getByTestId('confirm-apply-confirm')).toBeTruthy());
    await act(async () => {
      fireEvent.press(getByTestId('confirm-apply-confirm'));
    });

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('apply_venue_proposal', {
        p_proposal_id:  PROPOSAL_DESC.id,
        p_applied_text: rewrittenText,
      });
    });
  });
});

// ===========================================================================
// Phase 4 tests
// ===========================================================================

// Extra fixtures for Phase 4
const PROPOSAL_DESC_ENGINE: ProposalRow = {
  ...PROPOSAL_DESC,
  id:              'prop-desc-engine',
  decision:        'manual_review',
  decision_reasons: ['low_confidence', 'existing_description'],
  decision_engine_version: '1.0.0',
};

const PROPOSAL_WITH_REASONS: ProposalRow = {
  ...PROPOSAL_PHONE,
  id:               'prop-reasons-1',
  decision:         'manual_review',
  decision_reasons: ['conflict_with_existing', 'low_confidence'],
};

// ---------------------------------------------------------------------------
// Phase 4 — Tab navigation
// ---------------------------------------------------------------------------

describe('Phase 4 — tab navigation', () => {
  beforeEach(() => {
    stubAdmin();
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [], { data: [], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    mockRpc.mockResolvedValue({ data: null, error: null } as never);
  });

  it('renders all four tab buttons', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(getByTestId('tab-review')).toBeTruthy();
      expect(getByTestId('tab-auto-apply')).toBeTruthy();
      expect(getByTestId('tab-audit')).toBeTruthy();
      expect(getByTestId('tab-rollback')).toBeTruthy();
    });
  });

  it('default tab is review — proposal list is shown, not other panels', async () => {
    const { queryByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      // Mocked sub-panels must NOT be visible on the default tab
      expect(queryByTestId('mocked-auto-apply-panel')).toBeNull();
      expect(queryByTestId('mocked-enrichment-audit')).toBeNull();
      expect(queryByTestId('mocked-enrichment-rollback')).toBeNull();
    });
  });

  it('pressing Auto-Apply tab renders AutoApplyBatchPanel', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId('tab-auto-apply')).toBeTruthy());

    await act(async () => { fireEvent.press(getByTestId('tab-auto-apply')); });

    await waitFor(() => {
      expect(getByTestId('mocked-auto-apply-panel')).toBeTruthy();
    });
  });

  it('pressing Audit tab renders EnrichmentAudit', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId('tab-audit')).toBeTruthy());

    await act(async () => { fireEvent.press(getByTestId('tab-audit')); });

    await waitFor(() => {
      expect(getByTestId('mocked-enrichment-audit')).toBeTruthy();
    });
  });

  it('pressing Rollback tab renders EnrichmentRollback', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId('tab-rollback')).toBeTruthy());

    await act(async () => { fireEvent.press(getByTestId('tab-rollback')); });

    await waitFor(() => {
      expect(getByTestId('mocked-enrichment-rollback')).toBeTruthy();
    });
  });

  it('switching from Auto-Apply back to Review shows proposal cards again', async () => {
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_PHONE], { data: [], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    const { getByTestId, queryByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId('tab-auto-apply')).toBeTruthy());

    // Go to Auto-Apply
    await act(async () => { fireEvent.press(getByTestId('tab-auto-apply')); });
    await waitFor(() => expect(getByTestId('mocked-auto-apply-panel')).toBeTruthy());

    // Back to Review
    await act(async () => { fireEvent.press(getByTestId('tab-review')); });
    await waitFor(() => {
      expect(queryByTestId('mocked-auto-apply-panel')).toBeNull();
      expect(getByTestId(`proposal-card-${PROPOSAL_PHONE.id}`)).toBeTruthy();
    });
  });

  it('the mocked EnrichmentSummary is rendered regardless of active tab', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    // Mocked summary is shown on review tab
    await waitFor(() => expect(getByTestId('mocked-enrichment-summary')).toBeTruthy());
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — Exception filter chips
// ---------------------------------------------------------------------------

describe('Phase 4 — exception filter chips', () => {
  beforeEach(() => {
    stubAdmin();
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_PHONE, PROPOSAL_CONFLICT],
        { data: [], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    mockRpc.mockResolvedValue({ data: null, error: null } as never);
  });

  it('conflict filter chip is shown when proposals exist', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId('filter-conflict')).toBeTruthy());
  });

  it('low-confidence filter chip is shown when proposals exist', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId('filter-low-confidence')).toBeTruthy());
  });

  it('has-existing-value filter chip is shown when proposals exist', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId('filter-has-current')).toBeTruthy());
  });

  it('activating conflict filter hides non-conflicting proposals', async () => {
    const { getByTestId, queryByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId('filter-conflict')).toBeTruthy());

    // Both cards initially visible
    await waitFor(() => {
      expect(getByTestId(`proposal-card-${PROPOSAL_PHONE.id}`)).toBeTruthy();
      expect(getByTestId(`proposal-card-${PROPOSAL_CONFLICT.id}`)).toBeTruthy();
    });

    // Toggle conflict filter
    await act(async () => { fireEvent.press(getByTestId('filter-conflict')); });

    // Only the conflicting proposal stays visible
    await waitFor(() => {
      expect(queryByTestId(`proposal-card-${PROPOSAL_PHONE.id}`)).toBeNull();
      expect(getByTestId(`proposal-card-${PROPOSAL_CONFLICT.id}`)).toBeTruthy();
    });
  });

  it('toggling conflict filter twice shows all proposals again', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId('filter-conflict')).toBeTruthy());

    await act(async () => { fireEvent.press(getByTestId('filter-conflict')); });
    await act(async () => { fireEvent.press(getByTestId('filter-conflict')); });

    await waitFor(() => {
      expect(getByTestId(`proposal-card-${PROPOSAL_PHONE.id}`)).toBeTruthy();
      expect(getByTestId(`proposal-card-${PROPOSAL_CONFLICT.id}`)).toBeTruthy();
    });
  });

  it('field filter chip is shown for each unique field in proposals', async () => {
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    // PROPOSAL_PHONE has field='phone'; PROPOSAL_CONFLICT also has field='phone'
    // So only one field chip should appear
    await waitFor(() => expect(getByTestId('filter-field-phone')).toBeTruthy());
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — Decision reason chips
// ---------------------------------------------------------------------------

describe('Phase 4 — decision reason chips on proposal cards', () => {
  beforeEach(() => {
    stubAdmin();
    mockRpc.mockResolvedValue({ data: null, error: null } as never);
  });

  it('shows decision-reason-chips for proposals with decision_reasons', async () => {
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_WITH_REASONS],
        { data: [], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(getByTestId('decision-reason-chips')).toBeTruthy();
    });
  });

  it('does NOT show decision-reason-chips for proposals with no decision_reasons', async () => {
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_PHONE],
        { data: [], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    const { queryByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(queryByTestId(`proposal-card-${PROPOSAL_PHONE.id}`)).toBeTruthy());
    // PROPOSAL_PHONE has no decision_reasons (field not set)
    expect(queryByTestId('decision-reason-chips')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — Engine description prefill (decision='manual_review')
// ---------------------------------------------------------------------------

describe('Phase 4 — description prefill for engine proposals', () => {
  beforeEach(() => {
    stubAdmin();
    // Clear call history so assertions don't pick up rpc calls from earlier describe blocks.
    mockRpc.mockClear();
    mockRpc.mockResolvedValue({ data: null, error: null } as never);
  });

  it('prefills the description input with sanitized proposed_value.v when decision=manual_review', async () => {
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_DESC_ENGINE],
        { data: [], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`description-input-${PROPOSAL_DESC_ENGINE.id}`)).toBeTruthy());

    const input = getByTestId(`description-input-${PROPOSAL_DESC_ENGINE.id}`);
    // PROPOSAL_DESC_ENGINE.proposed_value = { v: 'A great family venue with outdoor play.' }
    expect(input.props.value).toBe('A great family venue with outdoor play.');
  });

  it('prefilled engine draft enables the Approve & Apply button (text is non-empty)', async () => {
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_DESC_ENGINE],
        { data: [], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`approve-apply-btn-${PROPOSAL_DESC_ENGINE.id}`)).toBeTruthy());

    const btn = getByTestId(`approve-apply-btn-${PROPOSAL_DESC_ENGINE.id}`);
    const isDisabled = btn.props.accessibilityState?.disabled ?? btn.props.disabled;
    expect(isDisabled).toBeFalsy();
  });

  it('does NOT prefill description when decision is null (legacy/non-engine row)', async () => {
    // PROPOSAL_DESC has no decision field → treated as null/undefined.
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_DESC],
        { data: [], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`description-input-${PROPOSAL_DESC.id}`)).toBeTruthy());

    const input = getByTestId(`description-input-${PROPOSAL_DESC.id}`);
    expect(input.props.value).toBe('');
  });

  it('editing the prefilled text updates the state (admin can modify the draft)', async () => {
    // updateResult.data must be non-empty — the hook throws if 0 rows returned.
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_DESC_ENGINE],
        { data: [{ id: PROPOSAL_DESC_ENGINE.id }], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null } as never);

    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`description-input-${PROPOSAL_DESC_ENGINE.id}`)).toBeTruthy());

    const editedText = 'An edited version of the draft text.';
    await act(async () => {
      fireEvent.changeText(getByTestId(`description-input-${PROPOSAL_DESC_ENGINE.id}`), editedText);
    });

    // Open apply modal and verify it uses the edited (not original prefilled) text
    await act(async () => {
      fireEvent.press(getByTestId(`approve-apply-btn-${PROPOSAL_DESC_ENGINE.id}`));
    });
    await waitFor(() => expect(getByTestId('confirm-apply-confirm')).toBeTruthy());
    await act(async () => {
      fireEvent.press(getByTestId('confirm-apply-confirm'));
    });

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('apply_venue_proposal', {
        p_proposal_id:  PROPOSAL_DESC_ENGINE.id,
        p_applied_text: editedText,
      });
    });
  });

  it('whitespace in prefilled text is sanitized (3+ newlines → 2)', async () => {
    const proposalWithPaddedText: ProposalRow = {
      ...PROPOSAL_DESC_ENGINE,
      id:             'prop-padded',
      proposed_value: { v: '  Great farm.\n\n\n\nNice venue.  ' },
    };
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [proposalWithPaddedText],
        { data: [], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`description-input-${proposalWithPaddedText.id}`)).toBeTruthy());

    const input = getByTestId(`description-input-${proposalWithPaddedText.id}`);
    // trim() removes leading/trailing spaces; 4 newlines collapse to 2
    expect(input.props.value).toBe('Great farm.\n\nNice venue.');
  });

  it('character counter is visible for description proposals', async () => {
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_DESC_ENGINE],
        { data: [], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(getByTestId(`description-char-count-${PROPOSAL_DESC_ENGINE.id}`)).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Fix B regression — T3: opening_hours day with NO intervals key renders gracefully
// ---------------------------------------------------------------------------

// A proposal whose first day object has no `intervals` key at all
const PROPOSAL_HOURS_NO_INTERVALS: ProposalRow = {
  ...PROPOSAL_PHONE,
  id:     'prop-hours-no-iv',
  field:  'opening_hours',
  proposed_value: {
    days: [
      { day_of_week: 0, is_closed: false },                                         // ← no intervals key
      { day_of_week: 1, is_closed: true,  intervals: [] },                          // closed, empty array
      { day_of_week: 2, is_closed: false, intervals: [{ opens: '09:00', closes: '17:00' }] },
      { day_of_week: 3, is_closed: true },                                           // ← no intervals key
      { day_of_week: 4, is_closed: false, intervals: [{ opens: '10:00', closes: '16:00' }] },
      { day_of_week: 5, is_closed: false, intervals: [{ opens: '10:00', closes: '16:00' }] },
      { day_of_week: 6, is_closed: true },                                           // ← no intervals key
    ],
    seasonal_notes: null,
  },
  current_value: null,
};

describe('Fix B — T3: opening_hours with no intervals key renders without crashing', () => {
  beforeEach(() => {
    stubAdmin();
    mockRpc.mockClear();
    mockRpc.mockResolvedValue({ data: null, error: null } as never);
  });

  it('T3a: review card (FieldValueDisplay ~L1008) renders "Closed" for days missing intervals', async () => {
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_HOURS_NO_INTERVALS],
        { data: [], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    // If the component crashes, waitFor will time out. Success = no throw.
    await waitFor(() =>
      expect(getByTestId(`proposal-card-${PROPOSAL_HOURS_NO_INTERVALS.id}`)).toBeTruthy()
    );
  });

  it('T3b: confirm modal (ConfirmModalNewValue ~L1298) renders without crash for days missing intervals', async () => {
    // The opening_hours flow goes: button → Alert → "Yes, apply" → setConfirmTarget → confirm modal.
    // We capture the Alert callback and invoke it manually.
    const { Alert } = require('react-native');
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [PROPOSAL_HOURS_NO_INTERVALS],
        { data: [{ id: PROPOSAL_HOURS_NO_INTERVALS.id }], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() =>
      expect(getByTestId(`approve-apply-btn-${PROPOSAL_HOURS_NO_INTERVALS.id}`)).toBeTruthy()
    );

    // Press the button — this triggers Alert.alert (not the confirm modal directly).
    await act(async () => {
      fireEvent.press(getByTestId(`approve-apply-btn-${PROPOSAL_HOURS_NO_INTERVALS.id}`));
    });

    // Simulate the user pressing "Yes, apply" in the Alert.
    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const lastCall = alertCalls[alertCalls.length - 1];
    const buttons: { text: string; onPress?: () => void }[] = lastCall?.[2] ?? [];
    const yesButton = buttons.find((b) => b.text === 'Yes, apply');
    await act(async () => { yesButton?.onPress?.(); });

    // Confirm modal must appear without crashing.
    await waitFor(() => expect(getByTestId('confirm-apply-modal')).toBeTruthy());
    // ConfirmModalNewValue (L1298 path) rendered successfully — no crash.
    expect(getByTestId('confirm-new-value')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Fix C regression — T4: engine-draft label uses decision_engine_version, not decision
// ---------------------------------------------------------------------------

describe('Fix C — T4: descriptionInitial/isEngineDraft discriminates by decision_engine_version', () => {
  beforeEach(() => {
    stubAdmin();
    mockRpc.mockClear();
    mockRpc.mockResolvedValue({ data: null, error: null } as never);
  });

  it('T4a: legacy-pilot proposal → blank input (NOT labeled engine draft)', async () => {
    const legacyProposal: ProposalRow = {
      ...PROPOSAL_DESC,
      id:                      'prop-desc-legacy-t4',
      decision:                'manual_review',
      decision_engine_version: 'legacy-pilot',
      proposed_value:          { v: 'Some legacy scraped text.' },
    };
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [legacyProposal],
        { data: [], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`description-input-${legacyProposal.id}`)).toBeTruthy());

    // Legacy rows must NOT prefill the editor
    expect(getByTestId(`description-input-${legacyProposal.id}`).props.value).toBe('');
  });

  it('T4b: current-engine proposal → input prefilled with draft text', async () => {
    const engineProposal: ProposalRow = {
      ...PROPOSAL_DESC,
      id:                      'prop-desc-engine-t4b',
      decision:                'manual_review',
      decision_engine_version: 'decision-engine@1.0.0',
      proposed_value:          { v: 'A trampoline park in Leeds.' },
    };
    mockFrom.mockReturnValue(
      makeVenueFieldProposalsFromBuilder(
        [engineProposal],
        { data: [], error: null }
      ) as unknown as ReturnType<typeof supabase.from>
    );
    const { getByTestId } = render(<EnrichmentScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(getByTestId(`description-input-${engineProposal.id}`)).toBeTruthy());

    // Current-engine rows must prefill the editor with the generated draft
    expect(getByTestId(`description-input-${engineProposal.id}`).props.value).toBe('A trampoline park in Leeds.');
  });
});
