/**
 * Tests for components/venue/VenuePhotoUpload.tsx
 *
 * VenuePhotoUpload is the entry point for user-submitted venue photos. It gates
 * access behind authentication and behind a safety guidelines alert before the
 * image picker opens. Each test verifies a distinct user-facing behaviour so
 * that a new developer can read the file and understand exactly how the
 * component is supposed to behave.
 *
 * Privacy/safety design being tested:
 *   - Unauthenticated users see nothing (no upload surface).
 *   - A guidelines alert must be acknowledged before the picker opens.
 *   - If the user cancels the picker, mutate is never called.
 *   - Success and error outcomes are communicated via Alert, not silent state.
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { useAuthStore }           from '@/store/authStore';
import { useUploadVenuePhoto }    from '@/hooks/useVenuePhotos';
import * as ImagePicker           from 'expo-image-picker';
import { VenuePhotoUpload }       from '../VenuePhotoUpload';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Must all appear before imports so Jest can hoist them.

// authStore — control whether a user is signed in.
jest.mock('@/store/authStore', () => ({
  useAuthStore: jest.fn(),
}));

// useUploadVenuePhoto — the component only calls mutate(); we control isPending,
// isSuccess, isError, and mutate through this mock. We do NOT mock the full
// React Query mutation object — only the shape the component accesses.
jest.mock('@/hooks/useVenuePhotos', () => ({
  useUploadVenuePhoto: jest.fn(),
}));

// expo-image-picker — prevent real device picker from opening in tests.
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: 'Images' },
}));

// ─── Type helpers ─────────────────────────────────────────────────────────────

const mockUseAuthStore        = useAuthStore        as jest.MockedFunction<typeof useAuthStore>;
const mockUseUploadVenuePhoto = useUploadVenuePhoto as jest.MockedFunction<typeof useUploadVenuePhoto>;
const mockLaunchPicker        = ImagePicker.launchImageLibraryAsync as jest.Mock;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FAKE_USER = {
  id:    'user-abc',
  email: 'parent@example.com',
};

const VENUE_ID = 'venue-123';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the minimal useMutation-shaped object that VenuePhotoUpload reads.
 * Only the fields the component actually accesses are included.
 */
function buildMutationMock(overrides: {
  isPending?: boolean;
  mutate?: jest.Mock;
} = {}) {
  return {
    isPending: overrides.isPending ?? false,
    mutate:    overrides.mutate    ?? jest.fn(),
  };
}

/**
 * Simulate the user pressing a button in an Alert by calling the onPress
 * handler of the button with matching text.
 *
 * React Native's Alert does not render into the component tree in tests;
 * instead we spy on Alert.alert and inspect the buttons array that was passed.
 */
function pressAlertButton(alertSpy: jest.SpyInstance, buttonText: string) {
  const lastCall = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
  // lastCall = [title, message, buttons, options]
  const buttons: { text: string; onPress?: () => void }[] = lastCall[2] ?? [];
  const button = buttons.find((b) => b.text === buttonText);
  if (!button) throw new Error(`Alert button "${buttonText}" not found`);
  if (button.onPress) button.onPress();
}

// ─── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  // Default: signed in, no pending mutation.
  mockUseAuthStore.mockReturnValue(FAKE_USER as any);
  mockUseUploadVenuePhoto.mockReturnValue(buildMutationMock() as any);

  // Default picker: cancelled immediately — each test that needs a picked image
  // overrides this.
  mockLaunchPicker.mockResolvedValue({ canceled: true, assets: [] });
});

// ══════════════════════════════════════════════════════════════════════════════
// describe: VenuePhotoUpload
// ══════════════════════════════════════════════════════════════════════════════

describe('VenuePhotoUpload', () => {

  // ── Authentication gate ────────────────────────────────────────────────────

  // If the null guard is removed, an unauthenticated user would see the upload
  // button and could trigger picker flows that hit the mutation (which itself
  // guards, but the UI surface should never appear at all).
  it('renders nothing when the user is not authenticated', () => {
    mockUseAuthStore.mockReturnValue(null as any);

    const { toJSON } = render(<VenuePhotoUpload venueId={VENUE_ID} />);

    expect(toJSON()).toBeNull();
  });

  // ── Upload button ──────────────────────────────────────────────────────────

  // If the button does not render, the user has no way to submit a photo at all.
  it('renders the upload button when the user is authenticated', () => {
    render(<VenuePhotoUpload venueId={VENUE_ID} />);

    // The accessibilityLabel is the stable selector — className/text can change.
    expect(screen.getByLabelText('Add a photo of this venue')).toBeTruthy();
  });

  // ── Guidelines Alert ───────────────────────────────────────────────────────

  // The guidelines alert is a legal/safety requirement — parents must be told
  // not to include identifiable children before submitting. Without this test,
  // a refactor could remove the alert and no CI check would catch it.
  it('shows a guidelines Alert with the correct title when the upload button is tapped', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');

    render(<VenuePhotoUpload venueId={VENUE_ID} />);
    fireEvent.press(screen.getByLabelText('Add a photo of this venue'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Photo guidelines',
      expect.any(String),
      expect.any(Array)
    );
  });

  // The message body must contain the specific warning about children so users
  // understand the content policy before submitting.
  it('shows the correct guideline message about identifiable children', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');

    render(<VenuePhotoUpload venueId={VENUE_ID} />);
    fireEvent.press(screen.getByLabelText('Add a photo of this venue'));

    const message: string = alertSpy.mock.calls[0][1] as string;
    expect(message).toContain('identifiable children');
  });

  // ── Cancel in guidelines Alert ────────────────────────────────────────────

  // If pressing Cancel launched the picker anyway, a user who decides not to
  // proceed would still have their photo library opened — an unwanted behaviour
  // and a privacy concern.
  it('does NOT open the image picker when the user presses Cancel in the guidelines Alert', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');

    render(<VenuePhotoUpload venueId={VENUE_ID} />);
    fireEvent.press(screen.getByLabelText('Add a photo of this venue'));

    // Press the Cancel button (style: 'cancel' — no onPress handler).
    pressAlertButton(alertSpy, 'Cancel');

    // The picker must not have been called.
    expect(mockLaunchPicker).not.toHaveBeenCalled();
  });

  // ── Continue in guidelines Alert launches picker ───────────────────────────

  // If the Continue button did not launch the picker, users could never submit
  // photos after agreeing to the guidelines — the flow would be broken silently.
  it('opens the image picker when the user presses Continue in the guidelines Alert', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');

    render(<VenuePhotoUpload venueId={VENUE_ID} />);
    fireEvent.press(screen.getByLabelText('Add a photo of this venue'));

    await act(async () => {
      pressAlertButton(alertSpy, 'I agree & continue');
    });

    expect(mockLaunchPicker).toHaveBeenCalledTimes(1);
  });

  // ── Picker result handling ────────────────────────────────────────────────

  // If a cancelled picker still called mutate, the upload hook would run with
  // an undefined imageUri, producing a malformed request or a crash.
  it('does NOT call mutate when the picker is cancelled', async () => {
    const mutate   = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert');

    mockLaunchPicker.mockResolvedValue({ canceled: true, assets: [] });
    mockUseUploadVenuePhoto.mockReturnValue(buildMutationMock({ mutate }) as any);

    render(<VenuePhotoUpload venueId={VENUE_ID} />);
    fireEvent.press(screen.getByLabelText('Add a photo of this venue'));

    await act(async () => {
      pressAlertButton(alertSpy, 'I agree & continue');
    });

    expect(mutate).not.toHaveBeenCalled();
  });

  // If mutate is called with the wrong venueId, the photo is associated with
  // the wrong venue — a data integrity bug that is hard to detect after the fact.
  it('calls mutate with the correct venueId and picked imageUri', async () => {
    const mutate   = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert');
    const pickedUri = 'file:///storage/picked.jpg';

    mockLaunchPicker.mockResolvedValue({
      canceled: false,
      assets:   [{ uri: pickedUri }],
    });
    mockUseUploadVenuePhoto.mockReturnValue(buildMutationMock({ mutate }) as any);

    render(<VenuePhotoUpload venueId={VENUE_ID} />);
    fireEvent.press(screen.getByLabelText('Add a photo of this venue'));

    await act(async () => {
      pressAlertButton(alertSpy, 'I agree & continue');
    });

    expect(mutate).toHaveBeenCalledWith(
      { venueId: VENUE_ID, imageUri: pickedUri },
      expect.any(Object)  // onSuccess/onError callbacks
    );
  });

  // ── Loading state ─────────────────────────────────────────────────────────

  // If the button is not disabled during upload, the user could tap again and
  // trigger a duplicate upload. Two uploads of the same photo = wasted storage
  // and a confusing moderation queue for admins.
  it('disables the upload button while the mutation is pending', () => {
    mockUseUploadVenuePhoto.mockReturnValue(
      buildMutationMock({ isPending: true }) as any
    );

    render(<VenuePhotoUpload venueId={VENUE_ID} />);

    const button = screen.getByLabelText('Add a photo of this venue');
    expect(button.props.accessibilityState?.disabled).toBe(true);
  });

  // If the loading indicator is not shown, the user would see the "Add a photo"
  // text while uploading and think their previous tap did nothing, tapping again.
  it('shows an ActivityIndicator instead of button text while isPending is true', () => {
    mockUseUploadVenuePhoto.mockReturnValue(
      buildMutationMock({ isPending: true }) as any
    );

    render(<VenuePhotoUpload venueId={VENUE_ID} />);

    // The static text must not be visible during loading.
    expect(screen.queryByText('Add a photo')).toBeNull();
  });

  // ── Success Alert ─────────────────────────────────────────────────────────

  // Without a success alert, the parent has no way to know their photo was
  // received — they might tap the button multiple times thinking it did nothing.
  it('shows a "Photo submitted for review" Alert on upload success', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const pickedUri = 'file:///storage/picked.jpg';

    // mutate that immediately calls onSuccess.
    const mutate = jest.fn((_vars, callbacks: any) => {
      callbacks?.onSuccess?.();
    });

    mockLaunchPicker.mockResolvedValue({
      canceled: false,
      assets:   [{ uri: pickedUri }],
    });
    mockUseUploadVenuePhoto.mockReturnValue(buildMutationMock({ mutate }) as any);

    render(<VenuePhotoUpload venueId={VENUE_ID} />);
    fireEvent.press(screen.getByLabelText('Add a photo of this venue'));

    await act(async () => {
      pressAlertButton(alertSpy, 'I agree & continue');
    });

    // The guidelines Alert was the first call; we need the success Alert.
    await waitFor(() => {
      const titles = alertSpy.mock.calls.map((c) => c[0]);
      expect(titles).toContain('Photo submitted');
    });

    // The message must mention "review" so the user understands it is not live yet.
    const successCall = alertSpy.mock.calls.find((c) => c[0] === 'Photo submitted');
    expect(successCall?.[1]).toContain('review');
  });

  // ── Error Alert ───────────────────────────────────────────────────────────

  // If no error alert is shown, the parent receives no feedback when their
  // upload fails (e.g. poor connectivity) and would not know to try again.
  it('shows an "Upload failed" Alert when the mutation errors', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const pickedUri = 'file:///storage/picked.jpg';

    // mutate that immediately calls onError.
    const mutate = jest.fn((_vars, callbacks: any) => {
      callbacks?.onError?.();
    });

    mockLaunchPicker.mockResolvedValue({
      canceled: false,
      assets:   [{ uri: pickedUri }],
    });
    mockUseUploadVenuePhoto.mockReturnValue(buildMutationMock({ mutate }) as any);

    render(<VenuePhotoUpload venueId={VENUE_ID} />);
    fireEvent.press(screen.getByLabelText('Add a photo of this venue'));

    await act(async () => {
      pressAlertButton(alertSpy, 'I agree & continue');
    });

    await waitFor(() => {
      const titles = alertSpy.mock.calls.map((c) => c[0]);
      expect(titles).toContain('Upload failed');
    });
  });

  // ── Picker result: empty assets array ─────────────────────────────────────

  // If the result has canceled=false but an empty assets array (edge case on
  // some Android versions), mutate must still not be called. An empty assets
  // array with no URI would cause a crash inside the mutation function.
  it('does NOT call mutate when result.assets is empty', async () => {
    const mutate   = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert');

    mockLaunchPicker.mockResolvedValue({ canceled: false, assets: [] });
    mockUseUploadVenuePhoto.mockReturnValue(buildMutationMock({ mutate }) as any);

    render(<VenuePhotoUpload venueId={VENUE_ID} />);
    fireEvent.press(screen.getByLabelText('Add a photo of this venue'));

    await act(async () => {
      pressAlertButton(alertSpy, 'I agree & continue');
    });

    expect(mutate).not.toHaveBeenCalled();
  });
});
