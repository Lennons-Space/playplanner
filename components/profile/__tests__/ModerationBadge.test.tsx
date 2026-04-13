/**
 * Tests for components/profile/ModerationBadge.tsx
 *
 * Verifies that all three statuses render the correct label text and that
 * the accessibility label matches the displayed text.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { ModerationBadge } from '../ModerationBadge';

describe('ModerationBadge', () => {
  it('renders "Pending review" for status pending', () => {
    render(<ModerationBadge status="pending" />);
    expect(screen.getByText('Pending review')).toBeTruthy();
  });

  it('renders "Approved" for status approved', () => {
    render(<ModerationBadge status="approved" />);
    expect(screen.getByText('Approved')).toBeTruthy();
  });

  it('renders "Not approved" for status rejected', () => {
    render(<ModerationBadge status="rejected" />);
    expect(screen.getByText('Not approved')).toBeTruthy();
  });

  it('sets accessibilityLabel to "Pending review" for pending', () => {
    const { getByLabelText } = render(<ModerationBadge status="pending" />);
    expect(getByLabelText('Pending review')).toBeTruthy();
  });

  it('sets accessibilityLabel to "Approved" for approved', () => {
    const { getByLabelText } = render(<ModerationBadge status="approved" />);
    expect(getByLabelText('Approved')).toBeTruthy();
  });

  it('sets accessibilityLabel to "Not approved" for rejected', () => {
    const { getByLabelText } = render(<ModerationBadge status="rejected" />);
    expect(getByLabelText('Not approved')).toBeTruthy();
  });
});
