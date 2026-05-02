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

/** Fill in all required fields and accept terms. */
function fillValidForm() {
  fireEvent.changeText(screen.getByLabelText('Your name'), 'Jane Doe');
  fireEvent.changeText(screen.getByLabelText('Email address'), 'jane@example.com');
  fireEvent.changeText(
    screen.getByLabelText('Password — must be at least 8 characters, no spaces'),
    'Password1!'
  );
  // Accept terms (required checkbox)
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
  it('shows an error alert when required fields are empty', () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert');

    renderScreen();
    pressCreate();

    expect(alertSpy).toHaveBeenCalledWith('Missing details', 'Please fill in all fields.');
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('does not call signUp when terms are not accepted', () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert');

    renderScreen();
    fireEvent.changeText(screen.getByLabelText('Your name'), 'Jane Doe');
    fireEvent.changeText(screen.getByLabelText('Email address'), 'jane@example.com');
    fireEvent.changeText(
      screen.getByLabelText('Password — must be at least 8 characters, no spaces'),
      'Password1!'
    );
    // Do NOT accept terms
    pressCreate();

    expect(alertSpy).toHaveBeenCalledWith(
      'Terms required',
      'Please accept the Terms of Service and Privacy Policy to continue.'
    );
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('allows resubmission after a validation error (submitLocked is released)', () => {
    // Regression guard: a validation early-return must never leave submitLocked=true.
    // If the lock were left set, the second press would be silently swallowed and
    // the Alert spy would only fire once. We assert it fires twice, proving the form
    // remains responsive after a failed validation attempt.
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert');

    renderScreen();
    // Leave fullName blank so the first validation check fires ("Missing details").

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
