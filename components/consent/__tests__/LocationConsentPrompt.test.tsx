/**
 * Unit + GDPR + Regression tests for LocationConsentPrompt.
 *
 * ICO Children's Code Standard 10: the consent prompt must be honest,
 * clear, and not mislead users about what data is collected or stored.
 *
 * Regression: a previous bug used the phrase "never stored" which is
 * technically inaccurate (network logs may retain data briefly). The
 * correct phrase is "we do not store your coordinates on our servers".
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { LocationConsentPrompt } from '../LocationConsentPrompt';

// NativeWind className props are not evaluated in the test environment —
// no mock needed; the component still renders and fires events correctly.

describe('LocationConsentPrompt', () => {
  const onAccept  = jest.fn();
  const onDecline = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ======================================================================
  // Rendering
  // ======================================================================

  it('renders the Allow location button', () => {
    const { getByText } = render(
      <LocationConsentPrompt onAccept={onAccept} onDecline={onDecline} />,
    );
    expect(getByText('Allow location')).toBeTruthy();
  });

  it('renders the "Not now" decline button', () => {
    const { getByText } = render(
      <LocationConsentPrompt onAccept={onAccept} onDecline={onDecline} />,
    );
    expect(getByText(/not now/i)).toBeTruthy();
  });

  it('renders an explanation of why location is needed', () => {
    const { getAllByText } = render(
      <LocationConsentPrompt onAccept={onAccept} onDecline={onDecline} />,
    );
    // The word "location" must appear in at least one text element
    const matches = getAllByText(/location/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  // ======================================================================
  // Interaction
  // ======================================================================

  it('calls onAccept when the Allow button is pressed', () => {
    const { getByLabelText } = render(
      <LocationConsentPrompt onAccept={onAccept} onDecline={onDecline} />,
    );
    fireEvent.press(getByLabelText('Allow location access'));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('calls onDecline when the "Not now" button is pressed', () => {
    const { getByLabelText } = render(
      <LocationConsentPrompt onAccept={onAccept} onDecline={onDecline} />,
    );
    fireEvent.press(getByLabelText('Browse without location'));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('does not call onAccept when the decline button is pressed', () => {
    const { getByLabelText } = render(
      <LocationConsentPrompt onAccept={onAccept} onDecline={onDecline} />,
    );
    fireEvent.press(getByLabelText('Browse without location'));
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('does not call onDecline when the Accept button is pressed', () => {
    const { getByLabelText } = render(
      <LocationConsentPrompt onAccept={onAccept} onDecline={onDecline} />,
    );
    fireEvent.press(getByLabelText('Allow location access'));
    expect(onDecline).not.toHaveBeenCalled();
  });

  it('does not call either callback on initial render (no auto-accept)', () => {
    render(<LocationConsentPrompt onAccept={onAccept} onDecline={onDecline} />);
    expect(onAccept).not.toHaveBeenCalled();
    expect(onDecline).not.toHaveBeenCalled();
  });

  // ======================================================================
  // Accessibility
  // ======================================================================

  it('has accessibilityRole="button" on the Accept button', () => {
    const { getByLabelText } = render(
      <LocationConsentPrompt onAccept={onAccept} onDecline={onDecline} />,
    );
    const btn = getByLabelText('Allow location access');
    expect(btn.props.accessibilityRole).toBe('button');
  });

  it('has accessibilityRole="button" on the Decline button', () => {
    const { getByLabelText } = render(
      <LocationConsentPrompt onAccept={onAccept} onDecline={onDecline} />,
    );
    const btn = getByLabelText('Browse without location');
    expect(btn.props.accessibilityRole).toBe('button');
  });

  // ======================================================================
  // GDPR compliance — wording regression
  // ======================================================================

  it('REGRESSION: does not use the phrase "never stored" (inaccurate GDPR wording)', () => {
    // "never stored" is a claim we cannot guarantee — network/server logs exist.
    // The accurate phrasing is "we do not store your coordinates on our servers".
    const { toJSON } = render(
      <LocationConsentPrompt onAccept={onAccept} onDecline={onDecline} />,
    );
    const rendered = JSON.stringify(toJSON());
    expect(rendered.toLowerCase()).not.toContain('never stored');
  });

  it('tells the user their coordinates are not stored on servers', () => {
    const { getByText } = render(
      <LocationConsentPrompt onAccept={onAccept} onDecline={onDecline} />,
    );
    // The consent text must explain the data use accurately
    expect(getByText(/do not store your coordinates/i)).toBeTruthy();
  });

  it('mentions that location can be changed in Settings', () => {
    const { getByText } = render(
      <LocationConsentPrompt onAccept={onAccept} onDecline={onDecline} />,
    );
    expect(getByText(/settings/i)).toBeTruthy();
  });
});
