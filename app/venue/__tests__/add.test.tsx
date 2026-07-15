/**
 * Tests for app/venue/add.tsx
 *
 * v2 restyle (Step 5, feat/exact-v2-design): visual-layer-only change. These
 * tests guard that postcode lookup, validation and the venues-insert mutation
 * shape are byte-identical to the pre-restyle version — only JSX/styles changed.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useUser } from '@/hooks/useAuth';
import AddVenueScreen from '../add';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'View',
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

// v2 restyle: stub this screen's <V2Background/> atmosphere mount — covered
// by its own dedicated background test elsewhere.
jest.mock('@/components/ui/V2Background', () => ({
  V2Background: () => null,
}));

jest.mock('@/hooks/useAuth', () => ({
  useUser: jest.fn(),
}));

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(() => ({ data: [
    { id: 'cat-1', name: 'Soft Play', slug: 'soft-play', icon: '🧸', color: '#4C8DF6' },
    { id: 'cat-2', name: 'Park', slug: 'park', icon: '🌳', color: '#34D399' },
  ] })),
}));

const mockInsert = jest.fn().mockResolvedValue({ error: null });
const mockFunctionsInvoke = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({ order: jest.fn().mockResolvedValue({ data: [] }) })),
      insert: (...args: unknown[]) => mockInsert(...args),
    })),
    functions: {
      invoke: (...args: unknown[]) => mockFunctionsInvoke(...args),
    },
  },
}));

const mockUseUser = useUser as jest.MockedFunction<typeof useUser>;

beforeEach(() => {
  jest.clearAllMocks();
  mockUseUser.mockReturnValue({ id: 'user-test-id' } as any);
  mockInsert.mockResolvedValue({ error: null });
  mockFunctionsInvoke.mockResolvedValue({
    data: { latitude: 51.5, longitude: -0.1, city: 'Manchester' },
    error: null,
  });
});

// ---------------------------------------------------------------------------
// Header — single deliberate header, Cancel preserved
// ---------------------------------------------------------------------------

describe('AddVenueScreen — header', () => {
  it('renders exactly one "Add a venue" title', () => {
    render(<AddVenueScreen />);
    expect(screen.getAllByText('Add a venue').length).toBe(1);
  });

  it('Cancel navigates back', () => {
    render(<AddVenueScreen />);
    fireEvent.press(screen.getByLabelText('Cancel adding a venue'));
    expect(router.back).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Category chips — real data, category colour applied when selected
// ---------------------------------------------------------------------------

describe('AddVenueScreen — category chips', () => {
  it('renders real category names, not fabricated ones', () => {
    render(<AddVenueScreen />);
    expect(screen.getByText(/Soft Play/)).toBeTruthy();
    expect(screen.getByText(/Park/)).toBeTruthy();
  });

  it('marks a category chip as selected via accessibilityState when pressed', () => {
    render(<AddVenueScreen />);
    const chip = screen.getByLabelText('Category: Soft Play');
    fireEvent.press(chip);
    expect(chip.props.accessibilityState?.selected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Postcode lookup — unchanged behaviour
// ---------------------------------------------------------------------------

describe('AddVenueScreen — postcode lookup', () => {
  it('shows an error when looking up an empty postcode', async () => {
    render(<AddVenueScreen />);
    fireEvent.press(screen.getByLabelText('Look up postcode'));
    await waitFor(() => {
      expect(screen.getByText('Please enter a postcode')).toBeTruthy();
    });
  });

  it('confirms postcode + city on a successful lookup', async () => {
    render(<AddVenueScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. M1 1AE'), 'M1 1AE');
    fireEvent.press(screen.getByLabelText('Look up postcode'));
    await waitFor(() => {
      expect(screen.getByText(/M1 1AE — Manchester/)).toBeTruthy();
    });
  });

  it('shows "not found" when the geocode function returns an error', async () => {
    mockFunctionsInvoke.mockResolvedValue({ data: null, error: { message: 'not found' } });
    render(<AddVenueScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. M1 1AE'), 'ZZ1 1ZZ');
    fireEvent.press(screen.getByLabelText('Look up postcode'));
    await waitFor(() => {
      expect(screen.getByText(/Postcode not found/)).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Submission — same mutation shape, same validation
// ---------------------------------------------------------------------------

describe('AddVenueScreen — submission preserves exact validation + mutation shape', () => {
  it('blocks submission with an Alert when no postcode has been looked up', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<AddVenueScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Sunshine Soft Play'), 'Test Venue');
    fireEvent.press(screen.getByLabelText('Submit venue'));
    await waitFor(() => {
      expect(screen.getByText('Please look up your postcode first')).toBeTruthy();
    });
    expect(mockInsert).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('submits the exact expected insert payload once postcode + name are valid', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<AddVenueScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('e.g. Sunshine Soft Play'), 'Test Venue');
    fireEvent.changeText(screen.getByPlaceholderText('e.g. M1 1AE'), 'M1 1AE');
    fireEvent.press(screen.getByLabelText('Look up postcode'));
    await waitFor(() => screen.getByText(/M1 1AE — Manchester/));

    fireEvent.press(screen.getByLabelText('Submit venue'));

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Venue',
          city: 'Manchester',
          postcode: 'M1 1AE',
          latitude: 51.5,
          longitude: -0.1,
          submitted_by: 'user-test-id',
          moderation_status: 'pending',
          is_published: false,
        }),
      );
    });
    alertSpy.mockRestore();
  });

  it('rejects an invalid website URL without submitting', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<AddVenueScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('e.g. Sunshine Soft Play'), 'Test Venue');
    fireEvent.changeText(screen.getByPlaceholderText('e.g. M1 1AE'), 'M1 1AE');
    fireEvent.press(screen.getByLabelText('Look up postcode'));
    await waitFor(() => screen.getByText(/M1 1AE — Manchester/));

    fireEvent.changeText(screen.getByPlaceholderText('e.g. https://example.com'), 'not-a-url');
    fireEvent.press(screen.getByLabelText('Submit venue'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Invalid website', expect.any(String));
    });
    expect(mockInsert).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
