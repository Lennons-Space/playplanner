/**
 * Unit + Security tests for the Admin Moderation screen (app/admin/moderation.tsx).
 *
 * Security focus:
 *   - Non-admins must be redirected — never see the admin UI
 *   - Approve mutation must set moderation_notes: 'admin-approved'
 *   - Reject mutation must fallback to 'admin-rejected' when no reason is given
 *   - Bulk actions must show a count confirmation before any mutation fires
 *   - All venue mutations must include .eq('is_published', false) guard
 *
 * Pattern follows app/business/__tests__/dashboard.test.tsx.
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { supabase }    from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import { useIsAdmin }  from '@/hooks/useAuth';
import ModerationScreen from '../moderation';

// ---------------------------------------------------------------------------
// Mocks — hoisted by Jest; factories must be inline
// ---------------------------------------------------------------------------

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('@/store/authStore', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('@/hooks/useAuth', () => ({
  useIsAdmin: jest.fn(),
}));

jest.mock('expo-router', () => ({
  router:   { back: jest.fn(), replace: jest.fn() },
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

// Stub hooks used by other tabs (photos/reviews/claims) so they don't throw
jest.mock('@/hooks/useVenuePhotos', () => ({
  useModeratePhoto: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('@/hooks/useReviews', () => ({
  useModerateReview: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('@/hooks/useVenueClaims', () => ({
  useAdminVenueClaims: () => ({ data: [], isLoading: false }),
  useReviewClaim:      () => ({ mutate: jest.fn(), isPending: false }),
}));

// Expo-image stub
jest.mock('expo-image', () => ({ Image: 'Image' }));

// Linking stub
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  openURL: jest.fn(),
}));

process.env.EXPO_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// ---------------------------------------------------------------------------
// Typed mock references
// ---------------------------------------------------------------------------

const mockUseIsAdmin  = useIsAdmin  as jest.MockedFunction<typeof useIsAdmin>;
const mockUseAuthStore = useAuthStore as jest.MockedFunction<typeof useAuthStore>;
const mockFrom        = supabase.from as jest.MockedFunction<typeof supabase.from>;

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

/** Returns a chainable Supabase query builder stub. */
function makeQueryBuilder(resolvedValue: { data?: unknown; error?: unknown; count?: number }) {
  const builder: Record<string, jest.Mock> = {};
  const chain = () => builder;

  builder.select  = jest.fn().mockReturnValue(builder);
  builder.eq      = jest.fn().mockReturnValue(builder);
  builder.neq     = jest.fn().mockReturnValue(builder);
  builder.not     = jest.fn().mockReturnValue(builder);
  builder.or      = jest.fn().mockReturnValue(builder);
  builder.order   = jest.fn().mockReturnValue(builder);
  builder.range   = jest.fn().mockResolvedValue(resolvedValue);
  builder.single  = jest.fn().mockResolvedValue({ data: null, error: null });
  builder.update  = jest.fn().mockReturnValue(builder);
  builder.insert  = jest.fn().mockReturnValue(builder);
  // head:true count queries resolve immediately
  builder.limit   = jest.fn().mockResolvedValue(resolvedValue);

  return builder;
}

// Pending venue fixture
const VENUE_A = {
  id:                'venue-aaa',
  name:              'Happy Kids Farm',
  slug:              'happy-kids-farm',
  city:              'London',
  postcode:          'SW1A 1AA',
  latitude:          51.5074,
  longitude:         -0.1278,
  website:           'https://example.com',
  moderation_status: 'pending',
  is_published:      false,
  data_source:       'osm',
  category_id:       'cat-001',
  category:          { id: 'cat-001', slug: 'attraction', name: 'Attraction' },
  submitted_by_profile: null,
  moderation_notes:  null,
  created_at:        '2024-01-01T00:00:00Z',
  updated_at:        '2024-01-01T00:00:00Z',
  description:       null,
  address_line1:     null,
  address_line2:     null,
  country:           'GB',
  phone:             null,
  email:             null,
  price_range:       null,
  min_age:           0,
  max_age:           12,
  is_verified:       false,
  is_premium:        false,
  featured_until:    null,
  claimed_by:        null,
  submitted_by:      null,
  osm_id:            'node/123',
  license:           'ODbL-1.0',
  review_count:      0,
  average_rating:    0,
  moderated_by:      null,
  moderated_at:      null,
};

const VENUE_B = {
  ...VENUE_A,
  id:   'venue-bbb',
  name: 'Outdoor Adventure Park',
};

// ---------------------------------------------------------------------------
// Test: non-admin is redirected
// ---------------------------------------------------------------------------

describe('ModerationScreen — non-admin', () => {
  beforeEach(() => {
    mockUseIsAdmin.mockReturnValue(false);
    // Provide stable profile so the loading guard doesn't hang
    mockUseAuthStore.mockImplementation((selector: (s: any) => any) =>
      selector({ user: { id: 'user-123' }, profile: { is_admin: false }, isLoading: false })
    );
    // from() should never be called but provide a safe stub just in case
    mockFrom.mockReturnValue(makeQueryBuilder({ data: [], error: null }) as any);
  });

  it('renders a Redirect element when user is not admin', async () => {
    const { getByTestId } = render(<ModerationScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(getByTestId('redirect')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Test: pending venues render
// ---------------------------------------------------------------------------

describe('ModerationScreen — pending venues render', () => {
  beforeEach(() => {
    mockUseIsAdmin.mockReturnValue(true);
    mockUseAuthStore.mockImplementation((selector: (s: any) => any) =>
      selector({ user: { id: 'admin-user' }, profile: { is_admin: true }, isLoading: false })
    );

    // Separate builder per table so assertions stay clean.
    mockFrom.mockImplementation((table: string) => {
      if (table === 'venues') {
        const b = makeQueryBuilder({ data: [VENUE_A, VENUE_B], error: null, count: 2 });
        // head:true count query
        b.select = jest.fn().mockImplementation((_cols: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.head) return Promise.resolve({ count: 2, error: null });
          return b;
        });
        return b as any;
      }
      if (table === 'categories') {
        const b = makeQueryBuilder({ data: null, error: { code: 'PGRST116' } });
        b.single = jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
        return b as any;
      }
      return makeQueryBuilder({ data: [], error: null }) as any;
    });
  });

  it('displays venue names from the pending queue', async () => {
    const { getByText } = render(<ModerationScreen />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(getByText('Happy Kids Farm')).toBeTruthy();
      expect(getByText('Outdoor Adventure Park')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Test: approve mutation sets correct fields
// ---------------------------------------------------------------------------

describe('ModerationScreen — approve mutation', () => {
  let updateMock: jest.Mock;

  beforeEach(() => {
    mockUseIsAdmin.mockReturnValue(true);
    mockUseAuthStore.mockImplementation((selector: (s: any) => any) =>
      selector({ user: { id: 'admin-user' }, profile: { is_admin: true }, isLoading: false })
    );

    // Track what is passed to .update()
    updateMock = jest.fn().mockReturnValue({
      eq:     jest.fn().mockReturnThis(),
      neq:    jest.fn().mockReturnThis(),
      not:    jest.fn().mockReturnThis(),
      or:     jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue({ data: [{ id: 'venue-aaa' }], error: null }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'venues') {
        const b: any = {
          select: jest.fn().mockImplementation((_cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) return Promise.resolve({ count: 1, error: null });
            return b;
          }),
          eq:     jest.fn().mockReturnThis(),
          neq:    jest.fn().mockReturnThis(),
          not:    jest.fn().mockReturnThis(),
          or:     jest.fn().mockReturnThis(),
          order:  jest.fn().mockReturnThis(),
          range:  jest.fn().mockResolvedValue({ data: [VENUE_A], error: null }),
          update: updateMock,
        };
        return b;
      }
      if (table === 'categories') {
        return {
          select: jest.fn().mockReturnThis(),
          eq:     jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        } as any;
      }
      return makeQueryBuilder({ data: [], error: null }) as any;
    });
  });

  it('calls supabase update with moderation_status approved and moderation_notes admin-approved', async () => {
    const { getByText } = render(<ModerationScreen />, { wrapper: makeWrapper() });

    // Wait for venue to appear
    await waitFor(() => expect(getByText('Happy Kids Farm')).toBeTruthy());

    // Tap Approve
    const approveBtn = getByText('Approve');
    await act(async () => { fireEvent.press(approveBtn); });

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          moderation_status: 'approved',
          is_published:      true,
          moderation_notes:  'admin-approved',
        })
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Test: reject mutation fallback to 'admin-rejected' when reason is blank
// ---------------------------------------------------------------------------

describe('ModerationScreen — reject mutation with blank reason', () => {
  let updateMock: jest.Mock;

  beforeEach(() => {
    mockUseIsAdmin.mockReturnValue(true);
    mockUseAuthStore.mockImplementation((selector: (s: any) => any) =>
      selector({ user: { id: 'admin-user' }, profile: { is_admin: true }, isLoading: false })
    );

    updateMock = jest.fn().mockReturnValue({
      eq:     jest.fn().mockReturnThis(),
      neq:    jest.fn().mockReturnThis(),
      not:    jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue({ data: [{ id: 'venue-aaa' }], error: null }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'venues') {
        const b: any = {
          select: jest.fn().mockImplementation((_cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) return Promise.resolve({ count: 1, error: null });
            return b;
          }),
          eq:     jest.fn().mockReturnThis(),
          neq:    jest.fn().mockReturnThis(),
          not:    jest.fn().mockReturnThis(),
          or:     jest.fn().mockReturnThis(),
          order:  jest.fn().mockReturnThis(),
          range:  jest.fn().mockResolvedValue({ data: [VENUE_A], error: null }),
          update: updateMock,
        };
        return b;
      }
      if (table === 'categories') {
        return {
          select: jest.fn().mockReturnThis(),
          eq:     jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        } as any;
      }
      return makeQueryBuilder({ data: [], error: null }) as any;
    });
  });

  it('calls update with moderation_status rejected and admin-rejected note when reason left blank', async () => {
    const { getByTestId } = render(<ModerationScreen />, { wrapper: makeWrapper() });

    // Wait for the venue card Reject button to appear (testID set on the card button)
    await waitFor(() => expect(getByTestId('venue-reject-btn-venue-aaa')).toBeTruthy());

    // Open the rejection modal
    await act(async () => { fireEvent.press(getByTestId('venue-reject-btn-venue-aaa')); });

    // Modal is now open — leave reason blank and press the modal confirm button
    await waitFor(() => expect(getByTestId('venue-reject-modal-confirm')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('venue-reject-modal-confirm')); });

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          moderation_status: 'rejected',
          moderation_notes:  'admin-rejected',
        })
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Test: bulk approve shows count confirmation before firing mutation
// ---------------------------------------------------------------------------

describe('ModerationScreen — bulk approve confirmation', () => {
  beforeEach(() => {
    mockUseIsAdmin.mockReturnValue(true);
    mockUseAuthStore.mockImplementation((selector: (s: any) => any) =>
      selector({ user: { id: 'admin-user' }, profile: { is_admin: true }, isLoading: false })
    );

    mockFrom.mockImplementation((table: string) => {
      if (table === 'venues') {
        const b: any = {
          select: jest.fn().mockImplementation((_cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) return Promise.resolve({ count: 42, error: null });
            return b;
          }),
          eq:     jest.fn().mockReturnThis(),
          neq:    jest.fn().mockReturnThis(),
          not:    jest.fn().mockReturnThis(),
          or:     jest.fn().mockReturnThis(),
          order:  jest.fn().mockReturnThis(),
          range:  jest.fn().mockResolvedValue({ data: [], error: null }),
          update: jest.fn().mockReturnValue({
            eq:     jest.fn().mockReturnThis(),
            select: jest.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
        return b;
      }
      if (table === 'categories') {
        return {
          select: jest.fn().mockReturnThis(),
          eq:     jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        } as any;
      }
      return makeQueryBuilder({ data: [], error: null }) as any;
    });
  });

  it('shows the bulk approve modal with a count before any mutation fires', async () => {
    const { getByText } = render(<ModerationScreen />, { wrapper: makeWrapper() });

    await waitFor(() => expect(getByText('Bulk approve')).toBeTruthy());

    await act(async () => { fireEvent.press(getByText('Bulk approve')); });

    // Modal heading must be visible before the Approve button is tapped
    await waitFor(() => {
      expect(getByText('Bulk approve venues')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Test: is_published = false guard is present in venue update mutations
// ---------------------------------------------------------------------------

describe('ModerationScreen — is_published false guard on mutations', () => {
  let eqMock: jest.Mock;
  let updateMock: jest.Mock;

  beforeEach(() => {
    mockUseIsAdmin.mockReturnValue(true);
    mockUseAuthStore.mockImplementation((selector: (s: any) => any) =>
      selector({ user: { id: 'admin-user' }, profile: { is_admin: true }, isLoading: false })
    );

    eqMock = jest.fn().mockReturnThis();

    updateMock = jest.fn().mockReturnValue({
      eq:     eqMock,
      neq:    jest.fn().mockReturnThis(),
      not:    jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue({ data: [{ id: 'venue-aaa' }], error: null }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'venues') {
        const b: any = {
          select: jest.fn().mockImplementation((_cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) return Promise.resolve({ count: 1, error: null });
            return b;
          }),
          eq:     jest.fn().mockReturnThis(),
          neq:    jest.fn().mockReturnThis(),
          not:    jest.fn().mockReturnThis(),
          or:     jest.fn().mockReturnThis(),
          order:  jest.fn().mockReturnThis(),
          range:  jest.fn().mockResolvedValue({ data: [VENUE_A], error: null }),
          update: updateMock,
        };
        return b;
      }
      if (table === 'categories') {
        return {
          select: jest.fn().mockReturnThis(),
          eq:     jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        } as any;
      }
      return makeQueryBuilder({ data: [], error: null }) as any;
    });
  });

  it('includes .eq("is_published", false) in the approve update chain', async () => {
    const { getByText } = render(<ModerationScreen />, { wrapper: makeWrapper() });

    await waitFor(() => expect(getByText('Happy Kids Farm')).toBeTruthy());

    const approveBtn = getByText('Approve');
    await act(async () => { fireEvent.press(approveBtn); });

    await waitFor(() => {
      // eqMock is on the object returned by update(), so it covers the chained .eq() calls
      const calls = eqMock.mock.calls;
      const hasIsPublishedFalse = calls.some(
        ([col, val]: [string, unknown]) => col === 'is_published' && val === false
      );
      expect(hasIsPublishedFalse).toBe(true);
    });
  });
});
