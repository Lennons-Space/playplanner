/**
 * Tests for FacilityChips (components/venue/FacilityChips.tsx)
 *
 * Parent Contribution MVP — Phase 1 (venue-detail only, one-tap, three
 * facilities: Toilets, Baby change, Parking — no text/photos/gamification).
 *
 * We mock the data hooks (useVenueFacilityStats / useCastFacilityVote) rather
 * than supabase directly — those hooks have their own dedicated test suite
 * (hooks/__tests__/useFacilities.test.ts). This file focuses purely on the
 * UI: which of the three documented states each chip renders, and that a tap
 * fires the mutation.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { FacilityChips } from '../FacilityChips';
import { useVenueFacilityStats, useCastFacilityVote, FacilityVoteAuthError } from '@/hooks/useFacilities';
import { useUser } from '@/hooks/useAuth';
import { router } from 'expo-router';

// We mock the ENTIRE hooks module — including the FacilityVoteAuthError class
// — rather than using jest.requireActual. requireActual would force a real
// load of useFacilities.ts, which transitively imports lib/supabase.ts and
// throws "Missing Supabase environment variables" outside of the dedicated
// hook test file's controlled setup. FacilityChips only needs to recognise
// the error BY TYPE (instanceof check), so the mock class must be the exact
// same reference the component imports — which it is, since the component
// also imports it from this mocked module.
jest.mock('@/hooks/useFacilities', () => {
  class FacilityVoteAuthError extends Error {
    constructor() {
      super('Please sign in to confirm facilities at this venue.');
      this.name = 'FacilityVoteAuthError';
    }
  }
  return {
    FACILITY_SLUGS: ['toilets', 'baby-change', 'parking'],
    FacilityVoteAuthError,
    useVenueFacilityStats: jest.fn(),
    useCastFacilityVote: jest.fn(),
  };
});

jest.mock('@/hooks/useAuth', () => ({
  useUser: jest.fn(),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

const mockUseStats   = useVenueFacilityStats as jest.MockedFunction<typeof useVenueFacilityStats>;
const mockUseCast    = useCastFacilityVote   as jest.MockedFunction<typeof useCastFacilityVote>;
const mockUseUser    = useUser               as jest.MockedFunction<typeof useUser>;
const mockRouterPush = router.push           as jest.MockedFunction<typeof router.push>;

const VENUE_ID = 'venue-1';

function unknownStat(slug: string) {
  return { slug, confidence: 'low' as const, present: null, total: 0 };
}

function statsMap(overrides: Record<string, any> = {}) {
  return {
    toilets: unknownStat('toilets'),
    'baby-change': unknownStat('baby-change'),
    parking: unknownStat('parking'),
    ...overrides,
  };
}

let mutateMock: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mutateMock = jest.fn();
  mockUseUser.mockReturnValue({ id: 'user-1' } as any);
  mockUseCast.mockReturnValue({ mutate: mutateMock } as any);
  mockUseStats.mockReturnValue({ data: statsMap() } as any);
});

// ============================================================================
// Renders three chips
// ============================================================================

it('renders exactly three facility chips: Toilets, Baby change, Parking', () => {
  render(<FacilityChips venueId={VENUE_ID} />);

  expect(screen.getByText('Toilets')).toBeTruthy();
  expect(screen.getByText('Baby change')).toBeTruthy();
  expect(screen.getByText('Parking')).toBeTruthy();

  // Scope check: no café/buggy/other facility text — strictly the three.
  expect(screen.queryByText(/café|cafe|buggy/i)).toBeNull();
});

// ============================================================================
// Per-chip states
// ============================================================================

describe('chip states', () => {
  it('shows "Unknown" (tappable, outline) when there are no votes yet', () => {
    mockUseStats.mockReturnValue({ data: statsMap() } as any);
    render(<FacilityChips venueId={VENUE_ID} />);

    const chip = screen.getByLabelText(/Toilets\. Unknown/i);
    expect(chip).toBeTruthy();
    expect(chip.props.accessibilityRole).toBe('button');
  });

  it('shows "You confirmed this" when a vote exists but confidence is still low', () => {
    mockUseStats.mockReturnValue({
      data: statsMap({
        toilets: { slug: 'toilets', confidence: 'low', present: true, total: 1 },
      }),
    } as any);
    render(<FacilityChips venueId={VENUE_ID} />);

    expect(screen.getByLabelText(/Toilets\. You confirmed this/i)).toBeTruthy();
    expect(screen.getByText('✓')).toBeTruthy();
  });

  it('shows "Confirmed by N parents" once confidence reaches medium/high with present=true', () => {
    mockUseStats.mockReturnValue({
      data: statsMap({
        'baby-change': { slug: 'baby-change', confidence: 'high', present: true, total: 6 },
      }),
    } as any);
    render(<FacilityChips venueId={VENUE_ID} />);

    expect(screen.getByLabelText(/Baby change\. Confirmed by 6 parents/i)).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
  });

  it('uses singular "parent" when the confirmed count is exactly 1 (edge case)', () => {
    // Not realistically reachable given thresholds (medium needs total>=3),
    // but the label must still degrade gracefully if stats ever report this.
    mockUseStats.mockReturnValue({
      data: statsMap({
        parking: { slug: 'parking', confidence: 'medium', present: true, total: 1 },
      }),
    } as any);
    render(<FacilityChips venueId={VENUE_ID} />);

    expect(screen.getByLabelText(/Parking\. Confirmed by 1 parent$/i)).toBeTruthy();
  });

  it('does not show "Confirmed by parents" when the majority verdict is absent, even with votes', () => {
    mockUseStats.mockReturnValue({
      data: statsMap({
        toilets: { slug: 'toilets', confidence: 'high', present: false, total: 6 },
      }),
    } as any);
    render(<FacilityChips venueId={VENUE_ID} />);

    expect(screen.queryByLabelText(/Toilets\. Confirmed by/i)).toBeNull();
    expect(screen.getByLabelText(/Toilets\. Unknown/i)).toBeTruthy();
  });
});

// ============================================================================
// Tap behaviour
// ============================================================================

describe('tapping a chip', () => {
  it('fires the cast-vote mutation with the venue id and facility slug', () => {
    render(<FacilityChips venueId={VENUE_ID} />);

    fireEvent.press(screen.getByLabelText(/Toilets\./i));

    expect(mutateMock).toHaveBeenCalledWith(
      { venueId: VENUE_ID, slug: 'toilets' },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('routes to sign-in when the mutation reports a FacilityVoteAuthError', () => {
    render(<FacilityChips venueId={VENUE_ID} />);

    fireEvent.press(screen.getByLabelText(/Parking\./i));

    // Pull the onError handler passed to mutate and simulate the auth error.
    const [, options] = mutateMock.mock.calls[0];
    options.onError(new FacilityVoteAuthError());

    expect(mockRouterPush).toHaveBeenCalledWith('/(auth)/login');
  });

  it('does not navigate for non-auth errors', () => {
    render(<FacilityChips venueId={VENUE_ID} />);

    fireEvent.press(screen.getByLabelText(/Toilets\./i));
    const [, options] = mutateMock.mock.calls[0];
    options.onError(new Error('network blip'));

    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Accessibility
// ============================================================================

describe('accessibility', () => {
  it('exposes each chip as an accessible button with a descriptive label', () => {
    render(<FacilityChips venueId={VENUE_ID} />);

    for (const label of [/Toilets\./i, /Baby change\./i, /Parking\./i]) {
      const chip = screen.getByLabelText(label);
      expect(chip.props.accessibilityRole).toBe('button');
      expect(chip.props.accessibilityHint).toBeTruthy();
    }
  });
});
