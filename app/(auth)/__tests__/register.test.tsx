/**
 * Tests for app/(auth)/register.tsx — RegisterScreen.
 *
 * Why this test file exists:
 * Registration is a high-risk flow. It collects the user's name, email,
 * and password, records GDPR consent, and calls supabase.auth.signUp().
 * Bugs here can permanently lock a user out (form disabled), silently skip
 * consent recording, or expose raw error messages.
 *
 * We mock Supabase and all services so tests run without network calls.
 * Each test is focused on a single behaviour so failures are easy to diagnose.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
// Extends jest.expect with RNTL matchers (toBeDisabled, toBeEnabled, etc.)
// Required for TypeScript to recognise these methods on JestMatchers.
import '@testing-library/react-native/extend-expect';
import RegisterScreen from '../register';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock the audit log so it doesn't try to reach Supabase.
jest.mock('@/services/audit/gdprAuditLog', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

// Mock location consent migration — tested separately.
jest.mock('@/services/consent/locationConsent', () => ({
  migratePendingLocationConsent: jest.fn().mockResolvedValue(undefined),
}));

// Core supabase mock — individual tests override signUp as needed.
const mockSignUp   = jest.fn();
const mockUpdate   = jest.fn();
const mockEq       = jest.fn().mockReturnThis();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signUp: (...args: unknown[]) => mockSignUp(...args),
    },
    from: jest.fn(() => ({
      update: (...args: unknown[]) => { mockUpdate(...args); return { eq: mockEq }; },
    })),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Re-render a fresh RegisterScreen for each test. */
function renderScreen() {
  return render(<RegisterScreen />);
}

/** Fill in all required fields, tick age affirmation, and accept terms. */
function fillValidForm() {
  fireEvent.changeText(screen.getByLabelText('Your name'), 'Jane Doe');
  fireEvent.changeText(screen.getByLabelText('Email address'), 'jane@example.com');
  fireEvent.changeText(
    screen.getByLabelText('Password — must be at least 8 characters, no spaces'),
    'Password1!'
  );
  // Tick age affirmation (ICO Children's Code Standard 4 — required)
  fireEvent.press(screen.getByLabelText('Tap to confirm you are 18 or over, or a parent or guardian'));
  // Accept terms (required checkbox — UK GDPR Art.7)
  fireEvent.press(screen.getByLabelText('Tap to accept the Terms of Service and Privacy Policy'));
}

function pressCreate() {
  fireEvent.press(screen.getByLabelText("Create your Play Planner account"));
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// BUG D fix: loading state released when signUp throws unexpectedly
// ---------------------------------------------------------------------------

describe('RegisterScreen — try/catch/finally wrapping signUp', () => {
  /**
   * BUG D: before the fix, supabase.auth.signUp() was called with a bare
   * await (no try/catch). If signUp threw instead of returning { error }
   * (e.g. due to a network failure at the fetch() level), the code jumped
   * past the setLoading(false) and submitLocked.current = false lines.
   * The button stayed disabled and the loading spinner stayed visible for
   * the rest of the session — the form was permanently broken.
   *
   * After the fix, the finally block always resets loading and the lock.
   */
  it('releases loading state if signUp throws unexpectedly', async () => {
    // Make signUp throw (not return { error }) to simulate a network-level crash.
    mockSignUp.mockRejectedValueOnce(new Error('Network request failed'));

    renderScreen();
    fillValidForm();
    pressCreate();

    // The button should briefly show a spinner…
    // …and then recover. After the throw is caught, loading must be false.
    await waitFor(() => {
      // The button text reappears when loading is false.
      expect(screen.getByLabelText("Create your Play Planner account")).toBeTruthy();
      // Specifically, the "Create account" text must be visible (not a spinner).
      expect(screen.getByText('Create account')).toBeTruthy();
    });
  });

  it('shows a generic error alert if signUp throws unexpectedly', async () => {
    // Spy on Alert so we can check the message without a real dialog.
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert');

    mockSignUp.mockRejectedValueOnce(new Error('Network request failed'));

    renderScreen();
    fillValidForm();
    pressCreate();

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Error', 'Something went wrong. Please try again.');
    });
  });

  it('allows resubmission after signUp throws (lock is released)', async () => {
    // First call throws, second call succeeds with a Supabase error response.
    mockSignUp
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: 'Sign up failed' } });

    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert');

    renderScreen();
    fillValidForm();

    // First press — throws
    pressCreate();
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Error', 'Something went wrong. Please try again.');
    });

    // Second press — should work (lock was released), this time gets a Supabase error
    alertSpy.mockClear();
    pressCreate();
    await waitFor(() => {
      // The form submitted again (lock was released) and got a Supabase error response.
      expect(mockSignUp).toHaveBeenCalledTimes(2);
    });
  });
});

// ---------------------------------------------------------------------------
// Baseline validation — ensure the form guards are intact after the refactor
// ---------------------------------------------------------------------------

describe('RegisterScreen — validation guards', () => {
  /**
   * The submit button is now disabled until BOTH checkboxes are ticked.
   * To test the server-side field validation guards, we must first enable
   * the button by ticking both checkboxes, then attempt to submit with
   * incomplete fields.
   */

  /** Enable the button by ticking both required checkboxes. */
  function enableButton() {
    fireEvent.press(screen.getByLabelText('Tap to confirm you are 18 or over, or a parent or guardian'));
    fireEvent.press(screen.getByLabelText('Tap to accept the Terms of Service and Privacy Policy'));
  }

  it('shows an error alert when required fields are empty', () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert');

    renderScreen();
    // Enable the button first — both checkboxes required
    enableButton();
    // Attempt to submit with no fields filled
    pressCreate();

    expect(alertSpy).toHaveBeenCalledWith('Missing details', 'Please fill in all fields.');
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('submit button is disabled when neither consent checkbox is ticked', () => {
    // This replaces the old "does not call signUp when terms are not accepted"
    // test. With the new design, unticked checkboxes disable the button entirely
    // — there is no alert path for this state, because the user simply cannot
    // press an disabled button. The ICO Children's Code gate is enforced at
    // the UI level, not just via in-handler validation.
    renderScreen();

    const button = screen.getByLabelText('Create your Play Planner account');
    expect(button).toBeDisabled();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('allows resubmission after a validation error (submitLocked is released)', () => {
    // Regression guard: a validation early-return must never leave submitLocked=true.
    // Both checkboxes are ticked to enable the button before testing this.
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert');

    renderScreen();
    // Enable the button via both checkboxes, but leave fullName blank
    // so the first validation check fires ("Missing details").
    enableButton();

    // First press — validation fails, alert is shown.
    pressCreate();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith('Missing details', 'Please fill in all fields.');

    // Second press — the form must still be responsive (lock was not left set).
    pressCreate();
    expect(alertSpy).toHaveBeenCalledTimes(2);
    expect(alertSpy).toHaveBeenNthCalledWith(2, 'Missing details', 'Please fill in all fields.');

    // signUp must never have been called during either attempt.
    expect(mockSignUp).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ICO Children's Code Standard 4: age affirmation checkbox gate
// ---------------------------------------------------------------------------

describe('RegisterScreen — age affirmation checkbox (ICO Standard 4)', () => {
  /**
   * The submit button must be DISABLED until the age affirmation checkbox is
   * checked. This is the primary ICO Children's Code Standard 4 control.
   *
   * We test disabled state via toBeDisabled() / toBeEnabled() — the RNTL
   * matchers that inspect the accessibility disabled state of host elements.
   */
  it('submit button is disabled when age affirmation is unchecked', () => {
    renderScreen();

    const button = screen.getByLabelText('Create your Play Planner account');
    // Neither age affirmation nor terms are ticked — button must be disabled.
    expect(button).toBeDisabled();
  });

  it('submit button is disabled when age affirmation is unchecked even if terms are accepted', () => {
    renderScreen();

    // Tick terms but NOT the age affirmation
    fireEvent.press(screen.getByLabelText('Tap to accept the Terms of Service and Privacy Policy'));

    const button = screen.getByLabelText('Create your Play Planner account');
    expect(button).toBeDisabled();
  });

  it('submit button is disabled when terms are unchecked even if age is affirmed', () => {
    renderScreen();

    // Tick age affirmation but NOT terms
    fireEvent.press(screen.getByLabelText('Tap to confirm you are 18 or over, or a parent or guardian'));

    const button = screen.getByLabelText('Create your Play Planner account');
    expect(button).toBeDisabled();
  });

  it('submit button is enabled when both age affirmation and terms are checked', () => {
    renderScreen();

    // Tick both required checkboxes
    fireEvent.press(screen.getByLabelText('Tap to confirm you are 18 or over, or a parent or guardian'));
    fireEvent.press(screen.getByLabelText('Tap to accept the Terms of Service and Privacy Policy'));

    const button = screen.getByLabelText('Create your Play Planner account');
    expect(button).toBeEnabled();
  });

  it('age affirmation checkbox label changes to confirmed state after ticking', () => {
    renderScreen();

    // Before ticking — shows the "tap to confirm" label
    expect(
      screen.getByLabelText('Tap to confirm you are 18 or over, or a parent or guardian')
    ).toBeTruthy();

    // Tick it
    fireEvent.press(screen.getByLabelText('Tap to confirm you are 18 or over, or a parent or guardian'));

    // After ticking — label should change to confirmed state
    expect(screen.getByLabelText('Age confirmed — tap to uncheck')).toBeTruthy();
  });

  it('does not call signUp when age affirmation is not ticked', () => {
    renderScreen();

    // Fill fields and tick terms but leave age affirmation unticked
    fireEvent.changeText(screen.getByLabelText('Your name'), 'Jane Doe');
    fireEvent.changeText(screen.getByLabelText('Email address'), 'jane@example.com');
    fireEvent.changeText(
      screen.getByLabelText('Password — must be at least 8 characters, no spaces'),
      'Password1!'
    );
    fireEvent.press(screen.getByLabelText('Tap to accept the Terms of Service and Privacy Policy'));

    // The button is disabled so pressing it should do nothing
    const button = screen.getByLabelText('Create your Play Planner account');
    fireEvent.press(button);

    expect(mockSignUp).not.toHaveBeenCalled();
  });
});
