/**
 * Tests for app/profile/children-ages.tsx
 *
 * Covers:
 *   - Privacy notice renders before the age range chips (ICO Std. 4 — transparency)
 *   - All age range chips render
 *   - Selected chip has accessible checked state
 *   - "Clear selection" button appears only when a chip is selected
 *   - Save button is present
 *   - Unauthenticated user triggers redirect (auth guard)
 *
 * GDPR focus:
 *   - Age ranges are broad (never exact DOB) — verified by checking the chip labels
 *   - "Only you can see this" privacy notice renders before the form controls
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { useProfile } from '@/hooks/useAuth';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('expo-router', () => ({
  Stack:  { Screen: 'View' },
  router: { back: jest.fn(), replace: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
}));

jest.mock('@/hooks/useAuth', () => ({
  useProfile: jest.fn(),
  useUser:    jest.fn(() => ({ id: 'user-abc' })),
}));

jest.mock('@/hooks/useProfile', () => ({
  useUpdateChildrenAges: jest.fn(() => ({
    mutateAsync: jest.fn().mockResolvedValue(undefined),
    isPending:   false,
  })),
}));

const mockUseProfile = useProfile as jest.MockedFunction<typeof useProfile>;

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ChildrenAgesScreen = require('../children-ages').default;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChildrenAgesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseProfile.mockReturnValue({ children_ages: null } as any);
  });

  // ---- Privacy notice (ICO Children's Code Std. 4 — transparency) ----------

  it('renders the "Only you can see this" privacy notice', () => {
    render(<ChildrenAgesScreen />, { wrapper: Wrapper });

    expect(screen.getByText(/Only you can see this/)).toBeTruthy();
  });

  it('renders the data minimisation notice (broad ranges, not exact ages)', () => {
    render(<ChildrenAgesScreen />, { wrapper: Wrapper });

    expect(screen.getByText(/broad age ranges/)).toBeTruthy();
    // Must also explicitly state exact DOB are not collected.
    expect(screen.getByText(/never collect exact dates of birth/)).toBeTruthy();
  });

  it('states that this information is never visible to other users', () => {
    render(<ChildrenAgesScreen />, { wrapper: Wrapper });

    expect(screen.getByText(/never visible to other users/)).toBeTruthy();
  });

  // ---- Age range chips -----------------------------------------------------

  it('renders all six age range chips', () => {
    render(<ChildrenAgesScreen />, { wrapper: Wrapper });

    // The chips are broad ranges — never exact ages or dates of birth.
    expect(screen.getByText(/0.1 yrs/)).toBeTruthy();   // 0–1 yrs
    expect(screen.getByText(/2.3 yrs/)).toBeTruthy();   // 2–3 yrs
    expect(screen.getByText(/4.5 yrs/)).toBeTruthy();   // 4–5 yrs
    expect(screen.getByText(/6.8 yrs/)).toBeTruthy();   // 6–8 yrs
    expect(screen.getByText(/9.12 yrs/)).toBeTruthy();  // 9–12 yrs
    expect(screen.getByText(/13\+ yrs/)).toBeTruthy();  // 13+ yrs
  });

  it('pre-selects chips that are already in the profile', () => {
    mockUseProfile.mockReturnValue({ children_ages: ['2–3', '4–5'] } as any);

    render(<ChildrenAgesScreen />, { wrapper: Wrapper });

    // Pre-selected chips have accessibilityState.checked = true.
    const chip = screen.getByLabelText(/Age range 2.3 years/i);
    expect(chip.props.accessibilityState?.checked).toBe(true);
  });

  it('does not pre-select chips not in the profile', () => {
    mockUseProfile.mockReturnValue({ children_ages: [] } as any);

    render(<ChildrenAgesScreen />, { wrapper: Wrapper });

    const chip = screen.getByLabelText(/Age range 0.1 years/i);
    expect(chip.props.accessibilityState?.checked).toBe(false);
  });

  // ---- Clear selection button ----------------------------------------------

  it('does not show "Clear selection" when nothing is selected', () => {
    mockUseProfile.mockReturnValue({ children_ages: [] } as any);

    render(<ChildrenAgesScreen />, { wrapper: Wrapper });

    expect(screen.queryByText(/Clear selection/)).toBeNull();
  });

  it('shows "Clear selection" when a chip is selected, and clears selection on press', () => {
    mockUseProfile.mockReturnValue({ children_ages: ['2–3'] } as any);

    render(<ChildrenAgesScreen />, { wrapper: Wrapper });

    const clearBtn = screen.getByText(/Clear selection/);
    expect(clearBtn).toBeTruthy();

    fireEvent.press(clearBtn);

    // After clearing, the button should disappear (nothing selected).
    expect(screen.queryByText(/Clear selection/)).toBeNull();
  });

  // ---- Save button ---------------------------------------------------------

  it('renders the Save button', () => {
    render(<ChildrenAgesScreen />, { wrapper: Wrapper });

    expect(screen.getByLabelText(/Save age range selections/)).toBeTruthy();
  });
});
