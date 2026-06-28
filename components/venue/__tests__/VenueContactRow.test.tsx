/**
 * Tests for components/venue/VenueContactRow.tsx
 *
 * Covers:
 *  - Phone row renders when a phone exists
 *  - Row is absent (null) when phone is null, '', or whitespace-only
 *  - Pressing the row calls Linking.openURL with the correct sanitized tel: URL
 *  - Leading + is preserved for international numbers
 *  - Formatted numbers with spaces/brackets are sanitized correctly
 *  - A failing/rejecting Linking.openURL does NOT crash the screen
 *  - accessibilityLabel is `Call <venueName> on <phone>`
 *  - Stored phone string is displayed verbatim (not reformatted)
 *  - Unit tests for sanitizePhoneForTel
 *
 * WHY __esModule + default on the Linking mock:
 *   react-native/index.js exports Linking via a getter:
 *     `get Linking() { return require('./Libraries/Linking/Linking').default; }`
 *   Without `__esModule: true` + `default:`, `.default` is undefined and
 *   `Linking` is undefined inside the component. Adding both makes the mock
 *   visible as `Linking` to all consumers (test + component).
 *
 * WHY jest.mock after imports:
 *   Babel/jest-expo hoists jest.mock() calls before any imports regardless of
 *   source order, so placing the call here (after imports) is functionally
 *   identical to placing it at the top — and satisfies the `import/first` rule.
 */

import React from 'react';
import { Linking } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { VenueContactRow, sanitizePhoneForTel } from '../VenueContactRow';

// ── Mock (hoisted by Babel/Jest before imports at runtime) ────────────────────
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  __esModule: true,
  default: {
    openURL: jest.fn().mockResolvedValue(undefined),
  },
}));

// Linking = require('./Libraries/Linking/Linking').default via react-native/index.js getter
// → the mock's `default` object, so Linking.openURL is the jest.fn() above.
const mockOpenURL = Linking.openURL as jest.Mock;

// ── Fixtures ──────────────────────────────────────────────────────────────────
const VENUE_NAME = 'Kiddie World Soft Play';

// ── beforeEach ────────────────────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  mockOpenURL.mockResolvedValue(undefined);
});

// ══════════════════════════════════════════════════════════════════════════════
// describe: VenueContactRow
// ══════════════════════════════════════════════════════════════════════════════

describe('VenueContactRow', () => {

  // ── Render conditions ──────────────────────────────────────────────────────

  it('renders the phone row when a valid phone number is provided', () => {
    const { toJSON } = render(
      <VenueContactRow phone="01228829570" venueName={VENUE_NAME} />
    );
    expect(toJSON()).not.toBeNull();
    expect(screen.getByText('01228829570')).toBeTruthy();
  });

  it('renders nothing when phone is null', () => {
    const { toJSON } = render(
      <VenueContactRow phone={null} venueName={VENUE_NAME} />
    );
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when phone is an empty string', () => {
    const { toJSON } = render(
      <VenueContactRow phone="" venueName={VENUE_NAME} />
    );
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when phone is whitespace only', () => {
    const { toJSON } = render(
      <VenueContactRow phone="   " venueName={VENUE_NAME} />
    );
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when phone is undefined', () => {
    const { toJSON } = render(
      <VenueContactRow phone={undefined} venueName={VENUE_NAME} />
    );
    expect(toJSON()).toBeNull();
  });

  // ── onPress: Linking.openURL ───────────────────────────────────────────────

  it('calls Linking.openURL with the correct sanitized tel: URL when pressed', () => {
    render(
      <VenueContactRow phone="(01228) 829570" venueName={VENUE_NAME} />
    );

    fireEvent.press(
      screen.getByLabelText(`Call ${VENUE_NAME} on (01228) 829570`)
    );

    expect(mockOpenURL).toHaveBeenCalledWith('tel:01228829570');
  });

  it('preserves the leading + for international numbers', () => {
    render(
      <VenueContactRow phone="+44 20 7946 0958" venueName={VENUE_NAME} />
    );

    fireEvent.press(
      screen.getByLabelText(`Call ${VENUE_NAME} on +44 20 7946 0958`)
    );

    expect(mockOpenURL).toHaveBeenCalledWith('tel:+442079460958');
  });

  it('does NOT crash when Linking.openURL rejects', () => {
    // The component attaches .catch(() => {}) so a rejected promise must be swallowed.
    mockOpenURL.mockRejectedValueOnce(new Error('tel: not supported'));

    render(
      <VenueContactRow phone="01228829570" venueName={VENUE_NAME} />
    );

    expect(() => {
      fireEvent.press(
        screen.getByLabelText(`Call ${VENUE_NAME} on 01228829570`)
      );
    }).not.toThrow();
  });

  // ── Accessibility ──────────────────────────────────────────────────────────

  it('has accessibilityLabel "Call <venueName> on <phone>"', () => {
    const phone = '01228 829570';
    render(<VenueContactRow phone={phone} venueName={VENUE_NAME} />);

    expect(
      screen.getByLabelText(`Call ${VENUE_NAME} on ${phone}`)
    ).toBeTruthy();
  });

  // ── Display ────────────────────────────────────────────────────────────────

  it('displays the stored phone string verbatim, not reformatted', () => {
    // The stored human-readable form must appear unchanged in the UI.
    const storedPhone = '+44 (0)20 7946 0958';
    render(<VenueContactRow phone={storedPhone} venueName={VENUE_NAME} />);
    expect(screen.getByText(storedPhone)).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// describe: sanitizePhoneForTel
// ══════════════════════════════════════════════════════════════════════════════

describe('sanitizePhoneForTel', () => {

  it('sanitizes a UK number with spaces and brackets', () => {
    expect(sanitizePhoneForTel('(01228) 829570')).toBe('01228829570');
  });

  it('preserves the leading + and strips (0) trunk code on an international number', () => {
    // (0) is UK trunk notation that disappears in international format.
    expect(sanitizePhoneForTel('+44 (0)20 7946 0958')).toBe('+442079460958');
  });

  it('preserves the leading + on an international number without (0)', () => {
    expect(sanitizePhoneForTel('+44 20 7946 0958')).toBe('+442079460958');
  });

  it('returns an already-clean number unchanged', () => {
    expect(sanitizePhoneForTel('01228829570')).toBe('01228829570');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(sanitizePhoneForTel('   ')).toBe('');
  });

  it('returns empty string for a string with no digits', () => {
    expect(sanitizePhoneForTel('no digits here!')).toBe('');
  });

  it('does not add a + prefix when input starts with 00 instead of +', () => {
    expect(sanitizePhoneForTel('0044 20 7946 0958')).toBe('00442079460958');
  });
});
