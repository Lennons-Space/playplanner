/**
 * Tests for app/venue/add.tsx
 *
 * v2 restyle (Step 5, feat/exact-v2-design): visual-layer-only change. These
 * tests guard that postcode lookup, validation and the venues-insert mutation
 * shape are byte-identical to the pre-restyle version — only JSX/styles changed.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert, StyleSheet, KeyboardAvoidingView, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { FunctionsHttpError, FunctionsFetchError } from '@supabase/supabase-js';
import { useUser } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import { GlassButton } from '@/components/ui/GlassButton';
import { useAppearanceStore } from '@/store/appearanceStore';
import AddVenueScreen from '../add';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  Redirect: () => null,
}));

// authStore: AddVenueScreen's default export is now wrapped in RequireSession
// (deep-link auth guard — see components/auth/RequireSession.tsx), which
// reads session/isLoading straight from this store, independently of
// useUser() (mocked separately below). Default to an authenticated, settled
// session so every existing test in this file still reaches the real form.
// Signed-out/loading guard behaviour is covered by add.authGuard.test.tsx.
jest.mock('@/store/authStore', () => ({
  useAuthStore: jest.fn(),
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
const mockUseAuthStore = useAuthStore as jest.MockedFunction<typeof useAuthStore>;
// Derive the store state type without importing AuthState directly (it is not exported).
type AuthStoreState = ReturnType<typeof useAuthStore.getState>;

/** Drives RequireSession to its authenticated, settled-loading branch. */
function mockAuthenticatedSession() {
  mockUseAuthStore.mockImplementation((selector) =>
    selector({
      session: { access_token: 'tok', user: { id: 'user-test-id' } },
      isLoading: false,
    } as unknown as AuthStoreState),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthenticatedSession();
  mockUseUser.mockReturnValue({ id: 'user-test-id' } as any);
  mockInsert.mockResolvedValue({ error: null });
  mockFunctionsInvoke.mockResolvedValue({
    data: { latitude: 51.5, longitude: -0.1, city: 'Manchester' },
    error: null,
  });
  useAppearanceStore.setState({ mode: 'dark' });
});

async function fillValidPostcode() {
  fireEvent.changeText(screen.getByPlaceholderText('e.g. Sunshine Soft Play'), 'Test Venue');
  fireEvent.changeText(screen.getByPlaceholderText('e.g. M1 1AE'), 'M1 1AE');
  fireEvent.press(screen.getByLabelText('Look up postcode'));
  await waitFor(() => screen.getByText(/M1 1AE — Manchester/));
}

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

  it('successfully looks up SY13 1NX — the exact postcode originally reported as broken (root cause: the geocode-postcode Edge Function was not deployed, not a bad postcode)', async () => {
    mockFunctionsInvoke.mockResolvedValue({
      data: { latitude: 52.972411, longitude: -2.676992, city: 'Shropshire' },
      error: null,
    });
    render(<AddVenueScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. M1 1AE'), 'SY13 1NX');
    fireEvent.press(screen.getByLabelText('Look up postcode'));
    await waitFor(() => {
      expect(screen.getByText(/SY13 1NX — Shropshire/)).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Postcode lookup — error classification. Never blame the user's postcode
// for a service failure: each of INVALID / NOT_FOUND / SERVICE_UNAVAILABLE
// must render its own distinct, honest message (see lib/postcode.ts).
// ---------------------------------------------------------------------------

describe('AddVenueScreen — postcode lookup error classification', () => {
  it('INVALID: a malformed postcode is rejected locally and never reaches the network', async () => {
    render(<AddVenueScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. M1 1AE'), 'NOTAPOSTCODE');
    fireEvent.press(screen.getByLabelText('Look up postcode'));
    await waitFor(() => {
      expect(screen.getByText('Enter a valid UK postcode.')).toBeTruthy();
    });
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });

  it('INVALID: an outward-only code is rejected — Add a Venue requires a FULL postcode', async () => {
    render(<AddVenueScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. M1 1AE'), 'SY13');
    fireEvent.press(screen.getByLabelText('Look up postcode'));
    await waitFor(() => {
      expect(screen.getByText('Enter a valid UK postcode.')).toBeTruthy();
    });
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });

  it('NOT_FOUND: the function\'s own 404 body ({"error":"Postcode not found"}) shows the not-found message', async () => {
    mockFunctionsInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError({ status: 404, json: async () => ({ error: 'Postcode not found' }) }),
    });
    render(<AddVenueScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. M1 1AE'), 'ZZ99 9ZZ');
    fireEvent.press(screen.getByLabelText('Look up postcode'));
    await waitFor(() => {
      expect(screen.getByText('Postcode not found. Please check and try again.')).toBeTruthy();
    });
  });

  it('SERVICE_UNAVAILABLE: a gateway 404 ({"code":"NOT_FOUND",...}, function not deployed) is never shown as a bad postcode', async () => {
    mockFunctionsInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError({
        status: 404,
        json: async () => ({ code: 'NOT_FOUND', message: 'Requested function was not found' }),
      }),
    });
    render(<AddVenueScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. M1 1AE'), 'SY13 1NX');
    fireEvent.press(screen.getByLabelText('Look up postcode'));
    await waitFor(() => {
      expect(screen.getByText('Postcode lookup is temporarily unavailable. Please try again.')).toBeTruthy();
    });
    // Must never claim the (perfectly valid) postcode was the problem.
    expect(screen.queryByText(/Postcode not found/)).toBeNull();
  });

  it('SERVICE_UNAVAILABLE: a network failure shows the service-unavailable message, not "not found"', async () => {
    mockFunctionsInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsFetchError(new TypeError('Network request failed')),
    });
    render(<AddVenueScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. M1 1AE'), 'SY13 1NX');
    fireEvent.press(screen.getByLabelText('Look up postcode'));
    await waitFor(() => {
      expect(screen.getByText('Postcode lookup is temporarily unavailable. Please try again.')).toBeTruthy();
    });
  });

  it('SERVICE_UNAVAILABLE: a malformed 2xx response (missing coordinates) is never shown as a bad postcode', async () => {
    mockFunctionsInvoke.mockResolvedValue({ data: { unexpected: 'shape' }, error: null });
    render(<AddVenueScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. M1 1AE'), 'SY13 1NX');
    fireEvent.press(screen.getByLabelText('Look up postcode'));
    await waitFor(() => {
      expect(screen.getByText('Postcode lookup is temporarily unavailable. Please try again.')).toBeTruthy();
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

// ---------------------------------------------------------------------------
// Buttons — the postcode-lookup and submit actions use the shared GlassButton
// system, not a locally-styled solid-fill TouchableOpacity.
// ---------------------------------------------------------------------------

describe('AddVenueScreen — primary actions use GlassButton', () => {
  it('renders the postcode-lookup and submit actions as GlassButton instances', () => {
    render(<AddVenueScreen />);
    expect(screen.UNSAFE_getAllByType(GlassButton).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Submission reliability — duplicate-submit guard, pending state, friendly
// errors, preserved draft on recoverable failure, truthful success copy.
// ---------------------------------------------------------------------------

describe('AddVenueScreen — submission reliability', () => {
  it('rapid repeated submits trigger only one insert', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<AddVenueScreen />);
    await fillValidPostcode();

    const submitButton = screen.getByLabelText('Submit venue');
    fireEvent.press(submitButton);
    fireEvent.press(submitButton);
    fireEvent.press(submitButton);

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });
    alertSpy.mockRestore();
  });

  it('submit remains disabled and busy while the insert is pending', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    let resolveInsert: (value: { error: null }) => void;
    mockInsert.mockReturnValue(
      new Promise((resolve) => {
        resolveInsert = resolve;
      }),
    );
    render(<AddVenueScreen />);
    await fillValidPostcode();

    fireEvent.press(screen.getByLabelText('Submit venue'));

    await waitFor(() => {
      expect(screen.getByLabelText('Submit venue').props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true, busy: true }),
      );
    });

    resolveInsert!({ error: null });
    await waitFor(() => {
      expect(screen.getByLabelText('Submit venue').props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: false, busy: false }),
      );
    });
    alertSpy.mockRestore();
  });

  it('preserves entered form data after a recoverable insert failure', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockInsert.mockResolvedValue({ error: { code: '23505', hint: 'duplicate', message: 'duplicate key value violates unique constraint "venues_pkey"' } });
    render(<AddVenueScreen />);
    await fillValidPostcode();

    fireEvent.press(screen.getByLabelText('Submit venue'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Submission failed', expect.any(String));
    });

    // The entered name is still there — a failed submit must not clear the draft.
    expect(screen.getByDisplayValue('Test Venue')).toBeTruthy();
    alertSpy.mockRestore();
  });

  it('shows friendly error copy, never the raw Supabase error message', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockInsert.mockResolvedValue({ error: { code: '23505', hint: 'duplicate', message: 'duplicate key value violates unique constraint "venues_pkey"' } });
    render(<AddVenueScreen />);
    await fillValidPostcode();

    fireEvent.press(screen.getByLabelText('Submit venue'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Submission failed',
        'Something went wrong. Please check your details and try again.',
      );
    });
    const [, message] = alertSpy.mock.calls[0];
    expect(message).not.toMatch(/constraint|duplicate key|23505/);
    alertSpy.mockRestore();
  });

  it('a successful submission shows truthful pending-review copy and navigates back on acknowledgement', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<AddVenueScreen />);
    await fillValidPostcode();

    fireEvent.press(screen.getByLabelText('Submit venue'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Venue submitted!',
        expect.stringMatching(/review/i),
        expect.any(Array),
      );
    });

    // Does not claim the venue is already live/published — it is pending moderation.
    const [, message] = alertSpy.mock.calls[0];
    expect(message).not.toMatch(/is now live|published|visible to other parents/i);

    const [, , buttons] = alertSpy.mock.calls[0];
    buttons?.[0]?.onPress?.();
    expect(router.back).toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Layout — footer clearance, keyboard-avoidance mounting.
// ---------------------------------------------------------------------------

describe('AddVenueScreen — footer clearance and keyboard layout', () => {
  it('reserves scroll content bottom padding beyond the sticky submit bar height', () => {
    render(<AddVenueScreen />);
    const scrollView = screen.UNSAFE_getByType(ScrollView);
    const contentStyle = StyleSheet.flatten(scrollView.props.contentContainerStyle);
    // insets.bottom is mocked to 34 — content padding must clear the sticky
    // bar (button height 54 + its own vertical padding) plus the safe area.
    expect(contentStyle.paddingBottom).toBeGreaterThanOrEqual(120 + 34);
  });

  it('mounts KeyboardAvoidingView so the active field and submit action stay reachable', () => {
    render(<AddVenueScreen />);
    expect(screen.UNSAFE_getByType(KeyboardAvoidingView)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Theming — Light/Dark readability.
// ---------------------------------------------------------------------------

describe('AddVenueScreen — Light and Dark themes remain readable', () => {
  it('renders in Light mode', () => {
    useAppearanceStore.setState({ mode: 'light' });
    render(<AddVenueScreen />);
    expect(screen.getByText('Add a venue')).toBeTruthy();
  });

  it('renders in Dark mode', () => {
    useAppearanceStore.setState({ mode: 'dark' });
    render(<AddVenueScreen />);
    expect(screen.getByText('Add a venue')).toBeTruthy();
  });

  it('the header title colour actually changes between Light and Dark', () => {
    useAppearanceStore.setState({ mode: 'light' });
    const light = render(<AddVenueScreen />);
    const lightColor = StyleSheet.flatten(light.getByText('Add a venue').props.style).color;
    light.unmount();

    useAppearanceStore.setState({ mode: 'dark' });
    const dark = render(<AddVenueScreen />);
    const darkColor = StyleSheet.flatten(dark.getByText('Add a venue').props.style).color;

    expect(lightColor).not.toBe(darkColor);
  });
});

// ---------------------------------------------------------------------------
// Accessibility labels — regression guard for the labels other tests key off.
// ---------------------------------------------------------------------------

describe('AddVenueScreen — accessibility labels remain present', () => {
  it('exposes the Cancel, postcode-lookup, submit and category-chip labels', () => {
    render(<AddVenueScreen />);
    expect(screen.getByLabelText('Cancel adding a venue')).toBeTruthy();
    expect(screen.getByLabelText('Look up postcode')).toBeTruthy();
    expect(screen.getByLabelText('Submit venue')).toBeTruthy();
    expect(screen.getByLabelText('Category: Soft Play')).toBeTruthy();
  });
});
