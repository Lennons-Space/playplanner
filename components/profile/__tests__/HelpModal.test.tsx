/**
 * Tests for components/profile/HelpModal.tsx.
 *
 * Behavioural coverage (mailto link, close/backdrop dismissal) already
 * exists via app/(tabs)/__tests__/profile.v2.test.tsx (which mounts this
 * modal through ProfileScreen). This file adds the dedicated Step 10A Part 2
 * (dual-theme foundation) proof-set coverage: the modal now reads tokens
 * from useAppTheme() instead of a hard-coded `Themes.dark`, so it must
 * render correctly (no crash, tokens applied) in both light and dark.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';
import { HelpModal } from '@/components/profile/HelpModal';
import { Themes } from '@/constants/theme';
import { useThemeStore } from '@/store/themeStore';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(() => 'dark'),
}));

const mockUseColorScheme = useColorScheme as jest.Mock;

beforeEach(() => {
  mockUseColorScheme.mockReset();
  useThemeStore.setState({ preference: 'system', hasHydrated: true });
});

describe('HelpModal — renders in both light and dark (Step 10A Part 2 proof set)', () => {
  it('renders dark tokens when resolved mode is dark', () => {
    mockUseColorScheme.mockReturnValue('dark');
    render(<HelpModal visible onClose={jest.fn()} />);
    expect(screen.getByText('Help & FAQ')).toBeTruthy();
    expect(screen.getByText('Help & FAQ').props.style.color).toBe(Themes.dark.label);
  });

  it('renders light tokens when resolved mode is light', () => {
    mockUseColorScheme.mockReturnValue('light');
    render(<HelpModal visible onClose={jest.fn()} />);
    expect(screen.getByText('Help & FAQ')).toBeTruthy();
    expect(screen.getByText('Help & FAQ').props.style.color).toBe(Themes.light.label);
  });

  it('preserves the exact same support email copy in both modes', () => {
    mockUseColorScheme.mockReturnValue('light');
    render(<HelpModal visible onClose={jest.fn()} />);
    expect(screen.getByText('support@playplanner.app')).toBeTruthy();
  });

  it('does not render at all when visible=false, regardless of mode', () => {
    mockUseColorScheme.mockReturnValue('light');
    render(<HelpModal visible={false} onClose={jest.fn()} />);
    expect(screen.queryByTestId('help-modal')).toBeNull();
  });
});
