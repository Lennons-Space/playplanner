/**
 * Tests for components/favourites/SavedEmptyState.tsx — the Favourites empty
 * state. Proves the recovery CTA routes to the existing Discover tab.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { SavedEmptyState } from '../SavedEmptyState';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

describe('SavedEmptyState', () => {
  it('renders the empty-state title and copy', () => {
    const { getByText } = render(<SavedEmptyState />);
    expect(getByText('Nothing saved yet')).toBeTruthy();
  });

  it('routes to Discover when the Explore places CTA is pressed', () => {
    const { getByLabelText } = render(<SavedEmptyState />);
    fireEvent.press(getByLabelText('Explore places'));
    expect((router.push as jest.Mock)).toHaveBeenCalledWith('/discover');
  });
});
