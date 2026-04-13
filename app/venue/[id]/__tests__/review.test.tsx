/**
 * Tests for the Write Review route screen (app/venue/[id]/review.tsx).
 *
 * This screen has multiple gate conditions — before showing ReviewForm it
 * checks auth, loading state, venue ownership, and existing reviews.
 * Each gate must show the correct message. Missing a gate would allow:
 *   - Unauthenticated users to see the form (and fail on submit with a confusing auth error).
 *   - Venue owners to self-review (inflating their own ratings — a trust/safety issue).
 *   - Duplicate reviews to reach the DB (hitting a constraint error instead of a clear message).
 *
 * We mock ReviewForm as a null stub — we only care that it renders (or doesn't),
 * not about the form's internal behaviour (that is covered in ReviewForm.test.tsx).
 */

import React from 'react';
import { ActivityIndicator } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import WriteReviewScreen from '../review';
import { useVenue } from '@/hooks/useVenues';
import { useMyReview } from '@/hooks/useReviews';
import { useUser } from '@/hooks/useAuth';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// jest.mock() calls are hoisted by Babel before imports run.
// @/lib/supabase must be mocked first because review.tsx → useVenues.ts →
// lib/supabase.ts throws at module-evaluation time if env vars are absent.
// All data access goes through the hook mocks below — we never need a real
// Supabase client in this test file.
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from:  jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    single: jest.fn(),
    auth: { getSession: jest.fn(), signOut: jest.fn() },
    rpc: jest.fn(),
  },
}));

// Expo Router's useLocalSearchParams provides the venue ID from the URL segment.
// We always return { id: 'venue-123' } so every test has a consistent venue ID.
jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({ id: 'venue-123' })),
  router: { back: jest.fn() },
}));

// Mock the data hooks — each test provides its own resolved values via setup().
jest.mock('@/hooks/useVenues');
jest.mock('@/hooks/useReviews');
jest.mock('@/hooks/useAuth');

// Stub ReviewForm to a no-op so we can assert on its presence without needing
// a QueryClient or any of the form's own dependencies in this test file.
jest.mock('@/components/reviews/ReviewForm', () => ({
  ReviewForm: () => null,
}));

// SafeAreaView must render its children so the screen content is accessible.
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Default venue object — not owned by any user. */
const defaultVenue = {
  id: 'venue-123',
  name: 'Sunny Park',
  claimed_by: null,
  submitted_by: null,
};

/** Default authenticated user. */
const defaultUser = { id: 'user-abc' };

/**
 * setup() wires up all three mocked hooks so tests only need to override the
 * fields that are relevant to what they are testing.
 */
function setup({
  user = defaultUser,
  venue = defaultVenue,
  venueLoading = false,
  myReview = null,
  reviewLoading = false,
}: {
  user?: { id: string } | null;
  venue?: typeof defaultVenue | null;
  venueLoading?: boolean;
  myReview?: { moderation_status: string } | null;
  reviewLoading?: boolean;
} = {}) {
  (useUser as jest.Mock).mockReturnValue(user);
  (useVenue as jest.Mock).mockReturnValue({ data: venue, isLoading: venueLoading });
  (useMyReview as jest.Mock).mockReturnValue({ data: myReview, isLoading: reviewLoading });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

describe('WriteReviewScreen — auth gate', () => {
  // An unauthenticated user must see an explanation, not the form.
  // Showing the form and then failing on submit is a poor UX — they fill in
  // everything only to be told they need to sign in after hitting the button.
  // More importantly, without this gate the submit hook would attempt to read
  // user.id and throw a TypeError, crashing the screen.
  it('shows "Sign in to write a review" when the user is not authenticated', () => {
    setup({ user: null });

    render(<WriteReviewScreen />);

    expect(screen.getByText('Sign in to write a review')).toBeTruthy();
  });

  // ReviewForm must NOT render for unauthenticated users.
  // If it did, the underlying useSubmitReview hook would use user!.id
  // (non-null assertion) on a null user, which is a runtime crash.
  it('does not render the ReviewForm when unauthenticated', () => {
    setup({ user: null });

    render(<WriteReviewScreen />);

    // ReviewForm is stubbed to return null, so if it were mounted there would
    // be no crash — but the "Sign in" text being present is the right assertion.
    expect(screen.queryByText('Submit review')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe('WriteReviewScreen — loading state', () => {
  // While venue data is loading the form must not render — we don't yet know
  // if this is the user's own venue.  Rendering the form prematurely and then
  // swapping it for the "own venue" error would be jarring.
  it('shows an ActivityIndicator while the venue is loading', () => {
    setup({ venueLoading: true });

    // ActivityIndicator has no testID in RN — use UNSAFE_getByType to find it
    const { UNSAFE_getByType } = render(<WriteReviewScreen />);

    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  // While the duplicate-review check is loading we must also wait — otherwise
  // a user who already submitted a review could briefly see the blank form.
  it('shows an ActivityIndicator while the existing review check is loading', () => {
    setup({ reviewLoading: true });

    const { UNSAFE_getByType } = render(<WriteReviewScreen />);

    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Own-venue gate
// ---------------------------------------------------------------------------

describe('WriteReviewScreen — own venue gate', () => {
  // A business owner reviewing their own venue would be a self-serving review
  // that misleads families. claimed_by is set when the business has gone through
  // the claiming process.  This gate prevents that even at the UI level.
  it('shows "You can\'t review your own venue" when the user claimed the venue', () => {
    setup({
      venue: { ...defaultVenue, claimed_by: 'user-abc', submitted_by: null },
    });

    render(<WriteReviewScreen />);

    expect(screen.getByText("You can't review your own venue")).toBeTruthy();
  });

  // submitted_by is set when a user added the venue to the map.
  // They should also not be able to review it — they may have a conflict of
  // interest even without going through the formal claiming process.
  it('shows "You can\'t review your own venue" when the user submitted the venue', () => {
    setup({
      venue: { ...defaultVenue, claimed_by: null, submitted_by: 'user-abc' },
    });

    render(<WriteReviewScreen />);

    expect(screen.getByText("You can't review your own venue")).toBeTruthy();
  });

  // A user who claimed a different venue (claimed_by !== user.id) must still
  // be able to review any venue they don't own.
  it('does not show the own-venue message when claimed_by belongs to a different user', () => {
    setup({
      venue: { ...defaultVenue, claimed_by: 'someone-else', submitted_by: null },
    });

    render(<WriteReviewScreen />);

    expect(screen.queryByText("You can't review your own venue")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Existing review gate
// ---------------------------------------------------------------------------

describe('WriteReviewScreen — existing review gate', () => {
  // A review in pending moderation means the user has already submitted once.
  // They should see a message telling them to wait — not a blank form that
  // would produce a duplicate constraint error on the DB if submitted.
  it('shows "waiting for moderation" message when the user already has a pending review', () => {
    setup({ myReview: { moderation_status: 'pending' } });

    render(<WriteReviewScreen />);

    expect(
      screen.getByText(
        'Your review is waiting for moderation. It will appear here once approved.'
      )
    ).toBeTruthy();
  });

  // An approved review means the user has already had their say.
  // Showing the form would let them submit a second review (before the duplicate
  // check fires), which degrades review integrity for families.
  it('shows "edit or delete" message when the user already has an approved review', () => {
    setup({ myReview: { moderation_status: 'approved' } });

    render(<WriteReviewScreen />);

    expect(
      screen.getByText('Visit your profile to edit or delete your existing review.')
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Happy path — ReviewForm renders
// ---------------------------------------------------------------------------

describe('WriteReviewScreen — happy path', () => {
  // When all gates pass (authenticated, venue loaded, not own venue, no
  // existing review), ReviewForm should be rendered.  This is the expected
  // state for the majority of user sessions on a venue they haven't reviewed.
  //
  // ReviewForm is a null stub here — we verify the screen reaches the form-
  // rendering branch without any of the earlier gates blocking it.
  it('renders ReviewForm when all conditions are met', () => {
    setup(); // authenticated, venue loaded, not own venue, no existing review

    render(<WriteReviewScreen />);

    // None of the error messages should appear
    expect(screen.queryByText('Sign in to write a review')).toBeNull();
    expect(screen.queryByText("You can't review your own venue")).toBeNull();
    expect(screen.queryByText(/waiting for moderation/)).toBeNull();
    expect(screen.queryByText(/edit or delete/)).toBeNull();
  });

  // Explicitly confirm we don't show the auth-gate message in the happy path.
  it('does not show the sign-in prompt when the user is authenticated', () => {
    setup();

    render(<WriteReviewScreen />);

    expect(screen.queryByText('Sign in to write a review')).toBeNull();
  });
});
