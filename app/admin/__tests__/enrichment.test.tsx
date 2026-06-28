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

  // Select chain: select().in().order().limit() → resolved promise
  // Also supports .eq() after select for any path that still uses it.
  const limitMock  = jest.fn().mockResolvedValue({ data: proposals, error: null });
  const orderMock  = jest.fn().mockReturnValue({ limit: limitMock });
  const inMock     = jest.fn().mockReturnValue({ order: orderMock });
  const eqForQuery = jest.fn().mockReturnValue({ order: orderMock }); // back-compat
  const selectMock = jest.fn().mockReturnValue({ in: inMock, eq: eqForQuery });

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
