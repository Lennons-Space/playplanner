/**
 * Tests for ReviewCard (components/reviews/ReviewCard.tsx).
 *
 * ReviewCard renders a single review in the venue detail list.
 * The component has significant privacy logic: it must always respect
 * show_reviews_publicly — if a user has set that to false, their name must
 * never appear, even if a username is present in the database row.
 *
 * We let lib/utils (formatMonthYear, getInitials, AVATAR_COLOURS) run as real
 * functions — mocking them would just be testing the mock, not the component.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ReviewCard } from '../ReviewCard';
import type { Review } from '@/types';

// ---------------------------------------------------------------------------
// makeReview — reduces boilerplate in each test.
// All required Review fields are set to safe defaults; individual tests
// can override only the fields they care about via the overrides parameter.
// ---------------------------------------------------------------------------

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: 'rev-1',
    venue_id: 'venue-1',
    user_id: 'user-1',
    rating: 4,
    title: null,
    body: 'Great park for kids',
    visit_date: null,
    children_ages: null,
    // is_anonymous defaults to false — all existing reviews remain non-anonymous
    // (migration 038 DB DEFAULT false keeps backwards compatibility).
    is_anonymous: false,
    moderation_status: 'approved',
    helpful_count: 0,
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T10:00:00Z',
    profile: {
      id: 'user-1',
      username: 'janeparent',
      full_name: 'Jane Parent',
      avatar_url: null,
      bio: null,
      is_business_owner: false,
      show_reviews_publicly: true,
      created_at: '2025-01-01T00:00:00Z',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Privacy — display name derivation
// ---------------------------------------------------------------------------

describe('ReviewCard — privacy: display name', () => {
  // This is the most safety-critical test in this file.
  // If show_reviews_publicly is false, the user has explicitly opted out of
  // being identified on reviews. Showing their real username would be a GDPR
  // breach — they have not consented to this particular use of their data.
  it('shows "Anonymous parent" when show_reviews_publicly is false, even if username exists', () => {
    const review = makeReview({
      profile: {
        id: 'user-1',
        username: 'janeparent',       // username exists but must be hidden
        full_name: 'Jane Parent',
        avatar_url: null,
        bio: null,
        is_business_owner: false,
        show_reviews_publicly: false, // user opted out
        created_at: '2025-01-01T00:00:00Z',
      },
    });

    render(<ReviewCard review={review} />);

    // The username must NOT appear anywhere
    expect(screen.queryByText('janeparent')).toBeNull();
    // "Anonymous parent" must be shown instead
    expect(screen.getByText('Anonymous parent')).toBeTruthy();
  });

  // A null profile means the reviewer's account was deleted.
  // The component must gracefully fall back to "Anonymous parent" — not crash.
  // Without this guard a deleted account would cause a TypeError on profile.username.
  it('shows "Anonymous parent" when profile is null', () => {
    const review = makeReview({ profile: undefined }); // no joined profile row

    render(<ReviewCard review={review} />);

    expect(screen.getByText('Anonymous parent')).toBeTruthy();
  });

  // When the user has allowed public identification, their username should
  // appear so other parents can recognise repeat reviewers they trust.
  it('shows the username when show_reviews_publicly is true', () => {
    const review = makeReview(); // default has show_reviews_publicly: true

    render(<ReviewCard review={review} />);

    expect(screen.getByText('janeparent')).toBeTruthy();
  });

  // If username is null but full_name exists, fall back to full_name.
  // Without this, a user who has a name but no username would appear as "Anonymous parent"
  // even though they want to be publicly identified.
  it('falls back to full_name when username is null and show_reviews_publicly is true', () => {
    const review = makeReview({
      profile: {
        id: 'user-1',
        username: null,
        full_name: 'Jane Parent',
        avatar_url: null,
        bio: null,
        is_business_owner: false,
        show_reviews_publicly: true,
        created_at: '2025-01-01T00:00:00Z',
      },
    });

    render(<ReviewCard review={review} />);

    expect(screen.getByText('Jane Parent')).toBeTruthy();
    expect(screen.queryByText('Anonymous parent')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Star display
// ---------------------------------------------------------------------------

describe('ReviewCard — star display', () => {
  // StarDisplay renders filled (★) and empty (☆) stars.
  // If the rating integer is incorrectly mapped to the wrong number of filled
  // stars, parents see misleading quality signals when choosing venues.
  it('renders the correct number of filled and empty stars for rating 3', () => {
    const review = makeReview({ rating: 3 });

    render(<ReviewCard review={review} />);

    // Three filled stars followed by two empty stars
    expect(screen.getByText('★★★☆☆')).toBeTruthy();
  });

  // Rating 5 — all filled, none empty. Boundary check.
  it('renders five filled stars for a perfect rating of 5', () => {
    const review = makeReview({ rating: 5 });

    render(<ReviewCard review={review} />);

    expect(screen.getByText('★★★★★')).toBeTruthy();
  });

  // Rating 1 — one filled, four empty. Opposite boundary.
  it('renders one filled star and four empty stars for a rating of 1', () => {
    const review = makeReview({ rating: 1 });

    render(<ReviewCard review={review} />);

    expect(screen.getByText('★☆☆☆☆')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Moderation badge
// ---------------------------------------------------------------------------

describe('ReviewCard — moderation badge', () => {
  // A pending review is only visible to the reviewer themselves.
  // The badge warns them it hasn't been approved yet.  If this badge is missing
  // the user might think something went wrong with their submission and resubmit.
  it('shows the "Awaiting moderation" badge when moderation_status is "pending"', () => {
    const review = makeReview({ moderation_status: 'pending' });

    render(<ReviewCard review={review} />);

    expect(screen.getByText('Awaiting moderation')).toBeTruthy();
  });

  // An approved review has already passed moderation — showing the badge would
  // be misleading and undermine user trust in the review's authenticity.
  it('does not show the "Awaiting moderation" badge when moderation_status is "approved"', () => {
    const review = makeReview({ moderation_status: 'approved' });

    render(<ReviewCard review={review} />);

    expect(screen.queryByText('Awaiting moderation')).toBeNull();
  });

  // Rejected reviews should also not show "Awaiting moderation" — they have
  // already been processed (albeit negatively).
  it('does not show the "Awaiting moderation" badge when moderation_status is "rejected"', () => {
    const review = makeReview({ moderation_status: 'rejected' });

    render(<ReviewCard review={review} />);

    expect(screen.queryByText('Awaiting moderation')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Helpful count
// ---------------------------------------------------------------------------

describe('ReviewCard — helpful count', () => {
  // The helpful count gives social proof — other parents can see how many
  // people found a review useful.  Without showing this, the information is
  // collected but never surfaced to the reader.
  it('shows helpful count text when helpful_count is greater than 0', () => {
    const review = makeReview({ helpful_count: 2 });

    render(<ReviewCard review={review} />);

    expect(screen.getByText('2 people found this helpful')).toBeTruthy();
  });

  // Singular grammar: "1 person", not "1 people".
  // If this test didn't exist, a developer might refactor the ternary and
  // accidentally produce "1 people found this helpful" — incorrect English
  // that erodes trust in the app's polish.
  it('uses singular "person" when helpful_count is 1', () => {
    const review = makeReview({ helpful_count: 1 });

    render(<ReviewCard review={review} />);

    expect(screen.getByText('1 person found this helpful')).toBeTruthy();
  });

  // When no one has marked the review helpful (the default), the count text
  // must not appear — showing "0 people found this helpful" adds noise.
  it('does not show helpful count text when helpful_count is 0', () => {
    const review = makeReview({ helpful_count: 0 });

    render(<ReviewCard review={review} />);

    expect(screen.queryByText(/found this helpful/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tappable reviewer block (navigation interaction)
// ---------------------------------------------------------------------------

describe('ReviewCard — tappable reviewer block', () => {
  // When onPressReviewer is provided and the reviewer is not anonymous,
  // tapping the avatar/name should call the handler so the parent screen can
  // navigate to the reviewer's public profile.
  it('calls onPressReviewer when the reviewer block is tapped for a named reviewer', () => {
    const onPressReviewer = jest.fn();
    const review = makeReview(); // default: janeparent, show_reviews_publicly=true

    render(<ReviewCard review={review} onPressReviewer={onPressReviewer} />);

    fireEvent.press(screen.getByLabelText("View janeparent's profile"));

    expect(onPressReviewer).toHaveBeenCalledTimes(1);
  });

  // Privacy: an anonymous reviewer has opted out of being publicly identified.
  // Making their reviewer block tappable would let users attempt to navigate
  // to an "anonymous" profile, which should not exist or could expose data.
  // The block must be a plain View (non-interactive) for anonymous reviewers.
  it('does not render a tappable button when the reviewer display name is "Anonymous parent"', () => {
    const onPressReviewer = jest.fn();
    const review = makeReview({
      profile: {
        id: 'user-1',
        username: 'janeparent',
        full_name: 'Jane Parent',
        avatar_url: null,
        bio: null,
        is_business_owner: false,
        show_reviews_publicly: false, // → displayName becomes 'Anonymous parent'
        created_at: '2025-01-01T00:00:00Z',
      },
    });

    render(<ReviewCard review={review} onPressReviewer={onPressReviewer} />);

    // The profile navigation button must not exist for anonymous reviewers
    expect(screen.queryByLabelText(/profile/i)).toBeNull();

    // And the handler must never fire (no element to tap)
    expect(onPressReviewer).not.toHaveBeenCalled();
  });

  // When onPressReviewer is omitted entirely, the reviewer block must still
  // render (showing name and date) but must not be interactive.  The component
  // should not throw when the prop is absent.
  it('renders reviewer information without error when onPressReviewer is not provided', () => {
    const review = makeReview();

    // Must not throw
    render(<ReviewCard review={review} />);

    expect(screen.getByText('janeparent')).toBeTruthy();
    // No navigation button should exist without the handler
    expect(screen.queryByLabelText(/profile/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Review body and title rendering
// ---------------------------------------------------------------------------

describe('ReviewCard — content rendering', () => {
  // The body is the core content of the review — it must always be shown.
  it('renders the review body text', () => {
    const review = makeReview({ body: 'Fantastic soft play area, very clean!' });

    render(<ReviewCard review={review} />);

    expect(screen.getByText('Fantastic soft play area, very clean!')).toBeTruthy();
  });

  // Title is optional — when present it should appear above the body.
  it('renders the review title when one is provided', () => {
    const review = makeReview({ title: 'Best park in town', body: 'Great park for kids' });

    render(<ReviewCard review={review} />);

    expect(screen.getByText('Best park in town')).toBeTruthy();
  });

  // When title is null the component must not crash or render an empty element
  // that adds unexpected whitespace to the layout.
  it('renders without error when title is null', () => {
    const review = makeReview({ title: null });

    render(<ReviewCard review={review} />);

    // Body must still be present
    expect(screen.getByText('Great park for kids')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// is_anonymous flag — per-review anonymity (migration 038)
//
// The "Post anonymously" toggle in ReviewForm now persists is_anonymous to the
// DB. ReviewCard must honour this flag by showing "Anonymous parent" instead of
// the reviewer's real display name, and by blocking profile navigation.
//
// This is the end-to-end privacy test for the toggle — it closes the gap where
// the flag was collected in the UI but never persisted or rendered.
// ---------------------------------------------------------------------------

describe('ReviewCard — is_anonymous flag', () => {
  // Core privacy test: when is_anonymous is true, show "Anonymous parent"
  // regardless of what the profile says — the reviewer explicitly asked
  // to be hidden for this specific review.
  it('shows "Anonymous parent" when is_anonymous is true, even if profile is public', () => {
    const review = makeReview({
      is_anonymous: true,
      // Profile is public (show_reviews_publicly=true) but is_anonymous takes priority
      profile: {
        id: 'user-1',
        username: 'janeparent',
        full_name: 'Jane Parent',
        avatar_url: null,
        bio: null,
        is_business_owner: false,
        show_reviews_publicly: true,
        created_at: '2025-01-01T00:00:00Z',
      },
    });

    render(<ReviewCard review={review} />);

    // Real username must NOT appear — that would violate the reviewer's choice
    expect(screen.queryByText('janeparent')).toBeNull();
    expect(screen.queryByText('Jane Parent')).toBeNull();
    // "Anonymous parent" must appear in its place
    expect(screen.getByText('Anonymous parent')).toBeTruthy();
  });

  // Confirm the profile navigation button is suppressed when is_anonymous is true.
  // An anonymous reviewer has opted out of identification — letting a user
  // tap through to their profile would undermine that choice.
  it('does not render the tappable profile button when is_anonymous is true', () => {
    const onPressReviewer = jest.fn();
    const review = makeReview({
      is_anonymous: true,
      profile: {
        id: 'user-1',
        username: 'janeparent',
        full_name: 'Jane Parent',
        avatar_url: null,
        bio: null,
        is_business_owner: false,
        show_reviews_publicly: true,
        created_at: '2025-01-01T00:00:00Z',
      },
    });

    render(<ReviewCard review={review} onPressReviewer={onPressReviewer} />);

    // No profile navigation button should exist
    expect(screen.queryByLabelText(/profile/i)).toBeNull();
    // The handler must never be called
    expect(onPressReviewer).not.toHaveBeenCalled();
  });

  // Verify that is_anonymous=false (the default) still shows the real
  // display name normally — existing non-anonymous reviews must be unaffected.
  it('shows the real display name when is_anonymous is false', () => {
    const review = makeReview({
      is_anonymous: false,
      profile: {
        id: 'user-1',
        username: 'janeparent',
        full_name: 'Jane Parent',
        avatar_url: null,
        bio: null,
        is_business_owner: false,
        show_reviews_publicly: true,
        created_at: '2025-01-01T00:00:00Z',
      },
    });

    render(<ReviewCard review={review} />);

    expect(screen.getByText('janeparent')).toBeTruthy();
    expect(screen.queryByText('Anonymous parent')).toBeNull();
  });
});
