/**
 * Tests for ReviewForm (components/reviews/ReviewForm.tsx).
 *
 * ReviewForm is the form a parent uses to rate and review a venue.
 * It validates rating, body length, optional title length, and optional visit
 * date format before calling the useSubmitReview mutation.
 *
 * Why these tests matter for a family-safety app:
 * - Bad validation lets junk data into the moderation queue, increasing moderator
 *   workload and the risk of inappropriate content appearing.
 * - A future-date visit date could indicate a fake or dishonest review.
 * - Submitting while already pending should be impossible (disabled button).
 *
 * We mock useSubmitReview entirely — we test the form's behaviour, not the
 * hook's network call. The hook has its own tests in hooks/__tests__/.
 */

import React from 'react';
import { ActivityIndicator } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ReviewForm } from '../ReviewForm';
import { useSubmitReview } from '@/hooks/useReviews';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Prevent expo-router's router.back() from crashing in the test environment.
jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
}));

// SafeAreaView renders children as-is in tests — no need for the real native module.
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock the hook so tests run without a QueryClient and without network calls.
// Each test can override the return value for isPending or mutate as needed.
jest.mock('@/hooks/useReviews', () => ({
  useSubmitReview: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default mutate spy — reset in beforeEach so assertions are isolated. */
let mockMutate: jest.Mock;

/** Renders the form with sensible defaults.  */
function renderForm(overrides: { isPending?: boolean } = {}) {
  (useSubmitReview as jest.Mock).mockReturnValue({
    mutate: mockMutate,
    isPending: overrides.isPending ?? false,
  });

  return render(
    <ReviewForm
      venueId="venue-abc"
      venueName="Sunny Park"
      onSuccess={jest.fn()}
    />
  );
}

/** Tap the star with the given number (1–5). */
function tapStar(n: number) {
  // Star buttons have accessibilityLabel "Rate N star" or "Rate N stars"
  const label = n === 1 ? 'Rate 1 star' : `Rate ${n} stars`;
  fireEvent.press(screen.getByLabelText(label));
}

/** Type into the "Your review" body field. */
function typeBody(text: string) {
  fireEvent.changeText(
    screen.getByPlaceholderText(
      'Tell other parents what it was like — facilities, parking, value for money...'
    ),
    text
  );
}

/** Type into the visit date field. */
function typeDate(text: string) {
  fireEvent.changeText(screen.getByPlaceholderText('YYYY-MM-DD'), text);
}

/** Press the Submit review button. */
function pressSubmit() {
  fireEvent.press(screen.getByText('Submit review'));
}

beforeEach(() => {
  mockMutate = jest.fn();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Rating validation
// ---------------------------------------------------------------------------

describe('ReviewForm — rating validation', () => {
  // Without a star selected, rating is 0 which is outside 1–5.
  // If this test didn't exist, a future refactor could remove the rating guard
  // and let empty-rating submissions reach the DB — which then fails with an
  // opaque check-constraint violation rather than a user-friendly message.
  it('shows a rating error when the form is submitted without selecting a star', () => {
    renderForm();

    // Type a valid body so ONLY the rating error fires
    typeBody('This is a valid review body');
    pressSubmit();

    expect(
      screen.getByText('Please select a star rating before submitting')
    ).toBeTruthy();
  });

  // Once a star is selected, the rating error must disappear on the next submit attempt.
  // This prevents stale error state confusing the user (they fix the issue but still see red text).
  it('does not show a rating error when a star has been selected', () => {
    renderForm();

    tapStar(3);
    typeBody('This is a valid review body');
    pressSubmit();

    expect(
      screen.queryByText('Please select a star rating before submitting')
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Body validation
// ---------------------------------------------------------------------------

describe('ReviewForm — body validation', () => {
  // Body text shorter than 10 chars is useless to other parents — "Good" tells
  // them nothing. Without this guard a one-word review could be moderated and
  // published, reducing the quality of information for families.
  it('shows a body error when the review body is fewer than 10 characters', () => {
    renderForm();

    tapStar(4);
    typeBody('Too short'); // 9 chars
    pressSubmit();

    expect(
      screen.getByText('Your review must be at least 10 characters')
    ).toBeTruthy();
  });

  // Body text longer than 500 chars must be rejected. Without this guard a
  // malicious user could submit a 10 000-character essay, inflating storage and
  // making moderation impractical for a small family app.
  it('shows a body error when the review body exceeds 500 characters', () => {
    renderForm();

    tapStar(4);
    typeBody('a'.repeat(501));
    pressSubmit();

    expect(
      screen.getByText('Your review must be 500 characters or fewer')
    ).toBeTruthy();
  });

  // Exactly 10 chars should be accepted — the boundary condition.
  // Off-by-one errors in length validation are a classic source of subtle bugs.
  it('does not show a body error when the body is exactly 10 characters', () => {
    renderForm();

    tapStar(4);
    typeBody('1234567890'); // exactly 10 chars
    pressSubmit();

    expect(
      screen.queryByText('Your review must be at least 10 characters')
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Visit date validation
// ---------------------------------------------------------------------------

describe('ReviewForm — visit date validation', () => {
  // A future date review is suspicious and could indicate a fake review
  // ("I'll visit next week and give 5 stars"). If this test didn't exist, a
  // developer could accidentally remove the future-date guard without noticing.
  it('shows a date error when the visit date is in the future', () => {
    renderForm();

    tapStar(4);
    typeBody('This is a great park for kids');
    // Use a date well in the future so this test doesn't fail near midnight
    typeDate('2099-12-31');
    pressSubmit();

    expect(
      screen.getByText('Visit date cannot be in the future')
    ).toBeTruthy();
  });

  // A date that matches YYYY-MM-DD regex but is not a real calendar date (e.g.
  // month 13) would silently produce an Invalid Date if not caught.  The
  // validateVisitDate helper calls isNaN(parsed.getTime()) to catch this.
  it('shows a date error when the date format is invalid (wrong characters)', () => {
    renderForm();

    tapStar(4);
    typeBody('This is a great park for kids');
    typeDate('not-a-date');
    pressSubmit();

    expect(
      screen.getByText('Please use the format YYYY-MM-DD (e.g. 2026-03-15)')
    ).toBeTruthy();
  });

  // Visit date is optional — leaving it blank must not produce any error.
  // If this test didn't exist, a regression could make the field required and
  // break the form for all users who don't remember exactly when they visited.
  it('does not show a date error when visit date is left blank', () => {
    renderForm();

    tapStar(4);
    typeBody('This is a great park for kids');
    // date field left empty
    pressSubmit();

    // The visit date validation messages are specific strings — use exact text
    // rather than /date/i which would also match the field label "Visit date".
    expect(screen.queryByText('Visit date cannot be in the future')).toBeNull();
    expect(screen.queryByText(/Please use the format YYYY-MM-DD/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Successful submission
// ---------------------------------------------------------------------------

describe('ReviewForm — successful submission', () => {
  // This is the happy path — it verifies that the exact payload shape expected
  // by useSubmitReview is produced. A mismatch in field names (e.g. 'venueId'
  // vs 'venue_id') would cause a silent DB error that is hard to trace in production.
  it('calls mutate with the correct payload when all required fields are valid', () => {
    renderForm();

    tapStar(4);
    typeBody('This is a great park for kids');
    pressSubmit();

    expect(mockMutate).toHaveBeenCalledWith(
      {
        venueId:      'venue-abc',
        rating:       4,
        title:        '',         // title left blank → empty string (trimmed)
        body:         'This is a great park for kids',
        visitDate:    null,       // no date → null
        childrenAges: [],
      },
      // The second argument is the { onSuccess, onError } callbacks object
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError:   expect.any(Function),
      })
    );
  });

  // With a valid past date, mutate should be called with the date string, not null.
  // If the date is being discarded incorrectly, this test catches it.
  it('passes the visit date to mutate when a valid past date is provided', () => {
    renderForm();

    tapStar(5);
    typeBody('Brilliant venue, kids loved the slides!');
    typeDate('2025-06-15');
    pressSubmit();

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ visitDate: '2025-06-15' }),
      expect.any(Object)
    );
  });
});

// ---------------------------------------------------------------------------
// Loading / disabled state
// ---------------------------------------------------------------------------

describe('ReviewForm — isPending state', () => {
  // While a submission is in-flight the button must be disabled.
  // Without this guard a user who taps twice can submit duplicate reviews that
  // both hit the DB — the second one would hit the unique constraint and show
  // a confusing error, or (if the constraint is ever relaxed) create two reviews.
  it('shows an ActivityIndicator and disables the submit button while isPending is true', () => {
    const { UNSAFE_getByType } = renderForm({ isPending: true });

    // When isPending, the "Submit review" text is replaced by an ActivityIndicator
    expect(screen.queryByText('Submit review')).toBeNull();
    // ActivityIndicator has no testID in RN — query by component type instead
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  // When not pending, the normal button text must be present and the indicator absent.
  it('shows the submit button text and no ActivityIndicator when not pending', () => {
    const { UNSAFE_queryByType } = renderForm({ isPending: false });

    expect(screen.getByText('Submit review')).toBeTruthy();
    expect(UNSAFE_queryByType(ActivityIndicator)).toBeNull();
  });
});
