/**
 * v2 dark Auth ecosystem test suite (Step 6, feat/exact-v2-design).
 *
 * Covers behavioural invariants across app/(auth)/: sign-in validation +
 * submission call args, register consent gating, password-visibility
 * toggles, loading/disabled states, forgot-password anti-enumeration (the
 * SAME neutral message whether resetPasswordForEmail succeeds or errors —
 * the code never branches on the result), terms/privacy navigation from
 * login/register/welcome, and — via source scans (same technique as
 * app/profile/__tests__/profileAtmosphere.test.tsx) — that every content
 * screen mounts <V2Background/> behind a transparent root, that no screen
 * resolves weather/atmosphere locally, that the legacy WeatherBackground/
 * light-mode classes are fully gone, that V2AtmosphereProvider is never
 * imported here, and that BlurView never sneaks in.
 *
 * Screen-specific behavioural coverage that already exists elsewhere is NOT
 * duplicated here:
 *   - onboarding navigation + SecureStore writes → onboarding.test.tsx
 *   - full register validation/consent/audit-log/error-handling suite →
 *     register.test.tsx
 *   - V2Background's own atmosphere behaviour → V2Background.test.tsx
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import '@testing-library/react-native/extend-expect';

import LoginScreen from '../login';
import RegisterScreen from '../register';
import PrivacyScreen from '../privacy';
import TermsScreen from '../terms';
import WelcomeScreen from '../welcome';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

// V2Background is stubbed here — its own atmosphere behaviour has dedicated
// coverage in components/ui/__tests__/V2Background.test.tsx. Stubbing it
// keeps this suite focused on auth/consent logic and avoids pulling in the
// real useWeather()/react-native-svg dependency chain.
jest.mock('@/components/ui/V2Background', () => ({
  V2Background: () => null,
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

jest.mock('@/services/audit/gdprAuditLog', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/services/consent/locationConsent', () => ({
  migratePendingLocationConsent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/hooks/useAuth', () => ({
  useUser: () => null,
}));

const mockSignInWithPassword    = jest.fn();
const mockResetPasswordForEmail = jest.fn();
const mockSignUp                = jest.fn();
const mockUpdate                = jest.fn();
const mockEq                    = jest.fn().mockReturnThis();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword:   (...args: unknown[]) => mockSignInWithPassword(...args),
      resetPasswordForEmail: (...args: unknown[]) => mockResetPasswordForEmail(...args),
      signUp:               (...args: unknown[]) => mockSignUp(...args),
    },
    from: jest.fn(() => ({
      update: (...args: unknown[]) => { mockUpdate(...args); return { eq: mockEq }; },
    })),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSignInWithPassword.mockResolvedValue({ error: null });
  mockResetPasswordForEmail.mockResolvedValue({ error: null });
});

// ---------------------------------------------------------------------------
// LoginScreen — validation + submission call args
// ---------------------------------------------------------------------------

describe('LoginScreen — validation + submission', () => {
  it('shows an alert and does not call signInWithPassword when fields are empty', () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert');
    render(<LoginScreen />);
    fireEvent.press(screen.getByLabelText('Sign in to your account'));
    expect(alertSpy).toHaveBeenCalledWith('Missing details', 'Please fill in both fields.');
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it('shows an alert and does not call signInWithPassword for an invalid email', () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert');
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByLabelText('Email address'), 'not-an-email');
    fireEvent.changeText(screen.getByLabelText('Password'), 'password123');
    fireEvent.press(screen.getByLabelText('Sign in to your account'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Invalid email',
      'Please enter a valid email address (e.g. you@example.com).',
    );
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it('calls signInWithPassword with the trimmed email + raw password on valid submission', async () => {
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByLabelText('Email address'), '  jane@example.com  ');
    fireEvent.changeText(screen.getByLabelText('Password'), 'Password1!');
    fireEvent.press(screen.getByLabelText('Sign in to your account'));
    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'jane@example.com',
        password: 'Password1!',
      });
    });
  });

  it('shows the anti-enumeration neutral message on invalid credentials, never a raw Supabase error', async () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert');
    mockSignInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } });
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByLabelText('Email address'), 'jane@example.com');
    fireEvent.changeText(screen.getByLabelText('Password'), 'wrongpass');
    fireEvent.press(screen.getByLabelText('Sign in to your account'));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Sign in failed',
        'The email or password you entered is incorrect. Please try again.',
      );
    });
  });
});

describe('LoginScreen — loading/disabled state', () => {
  it('disables the sign-in button while a request is in flight, then re-enables it', async () => {
    let resolveFn: (v: { error: null }) => void = () => {};
    mockSignInWithPassword.mockReturnValueOnce(
      new Promise((resolve) => { resolveFn = resolve; }),
    );
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByLabelText('Email address'), 'jane@example.com');
    fireEvent.changeText(screen.getByLabelText('Password'), 'Password1!');
    fireEvent.press(screen.getByLabelText('Sign in to your account'));

    expect(screen.getByLabelText('Sign in to your account')).toBeDisabled();

    resolveFn({ error: null });
    await waitFor(() => {
      expect(screen.getByLabelText('Sign in to your account')).toBeEnabled();
    });
  });
});

// ---------------------------------------------------------------------------
// LoginScreen — forgot password anti-enumeration
// ---------------------------------------------------------------------------

describe('LoginScreen — forgot password (anti-enumeration)', () => {
  it('requires an email before sending a reset link', () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert');
    render(<LoginScreen />);
    fireEvent.press(screen.getByLabelText('Forgot your password — tap to receive a reset link'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Enter your email first',
      'Type your email address above, then tap "Forgot password?".',
    );
    expect(mockResetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('calls resetPasswordForEmail with the trimmed email and shows the neutral message on success', async () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert');
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByLabelText('Email address'), '  jane@example.com  ');
    fireEvent.press(screen.getByLabelText('Forgot your password — tap to receive a reset link'));
    await waitFor(() => {
      expect(mockResetPasswordForEmail).toHaveBeenCalledWith('jane@example.com');
      expect(alertSpy).toHaveBeenCalledWith(
        'Check your inbox',
        "If an account exists for that email, we've sent a reset link. It may take a minute to arrive.",
      );
    });
  });

  it('shows the SAME neutral message even when resetPasswordForEmail errors — no account-existence hint', async () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert');
    mockResetPasswordForEmail.mockResolvedValueOnce({ error: { message: 'User not found' } });
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByLabelText('Email address'), 'nobody@example.com');
    fireEvent.press(screen.getByLabelText('Forgot your password — tap to receive a reset link'));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Check your inbox',
        "If an account exists for that email, we've sent a reset link. It may take a minute to arrive.",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Password-visibility toggles (new, presentational only)
// ---------------------------------------------------------------------------

describe('LoginScreen — password visibility toggle', () => {
  it('starts hidden and toggles to visible and back on press, without changing the typed value', () => {
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByLabelText('Password'), 'Password1!');
    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);

    fireEvent.press(screen.getByLabelText('Show password'));
    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(false);
    expect(screen.getByLabelText('Password').props.value).toBe('Password1!');

    fireEvent.press(screen.getByLabelText('Hide password'));
    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
  });
});

describe('RegisterScreen — password visibility toggle', () => {
  const PASSWORD_LABEL = 'Password — must be at least 8 characters, no spaces';

  it('starts hidden and toggles to visible on press', () => {
    render(<RegisterScreen />);
    fireEvent.changeText(screen.getByLabelText(PASSWORD_LABEL), 'Password1!');
    expect(screen.getByLabelText(PASSWORD_LABEL).props.secureTextEntry).toBe(true);

    fireEvent.press(screen.getByLabelText('Show password'));
    expect(screen.getByLabelText(PASSWORD_LABEL).props.secureTextEntry).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RegisterScreen — consent gating + marketing not pre-ticked
// ---------------------------------------------------------------------------

describe('RegisterScreen — consent gating + marketing not pre-ticked', () => {
  it('marketing checkbox starts unticked (opt-in, not pre-ticked)', () => {
    render(<RegisterScreen />);
    const checkbox = screen.getByLabelText('Optional: receive tips and venue recommendations by email');
    expect(checkbox.props.accessibilityState.checked).toBe(false);
  });

  it('submit button stays disabled until BOTH required checkboxes are ticked', () => {
    render(<RegisterScreen />);
    const button = screen.getByLabelText('Create your Play Planner account');
    expect(button).toBeDisabled();

    fireEvent.press(screen.getByLabelText('Tap to confirm you are 18 or over, or a parent or guardian'));
    expect(screen.getByLabelText('Create your Play Planner account')).toBeDisabled();

    fireEvent.press(screen.getByLabelText('Tap to accept the Terms of Service and Privacy Policy'));
    expect(screen.getByLabelText('Create your Play Planner account')).toBeEnabled();
  });
});

describe('RegisterScreen — loading/disabled state', () => {
  it('disables the create-account button while signUp is in flight', async () => {
    let resolveFn: (v: { data: { user: null }; error: null }) => void = () => {};
    mockSignUp.mockReturnValueOnce(new Promise((resolve) => { resolveFn = resolve; }));

    render(<RegisterScreen />);
    fireEvent.changeText(screen.getByLabelText('Your name'), 'Jane Doe');
    fireEvent.changeText(screen.getByLabelText('Email address'), 'jane@example.com');
    fireEvent.changeText(screen.getByLabelText(
      'Password — must be at least 8 characters, no spaces'), 'Password1!',
    );
    fireEvent.press(screen.getByLabelText('Tap to confirm you are 18 or over, or a parent or guardian'));
    fireEvent.press(screen.getByLabelText('Tap to accept the Terms of Service and Privacy Policy'));
    fireEvent.press(screen.getByLabelText('Create your Play Planner account'));

    expect(screen.getByLabelText('Create your Play Planner account')).toBeDisabled();

    resolveFn({ data: { user: null }, error: null });
    await waitFor(() => {
      expect(screen.getByLabelText('Create your Play Planner account')).toBeEnabled();
    });
  });
});

// ---------------------------------------------------------------------------
// Terms/Privacy navigation from Login, Register, Welcome
// ---------------------------------------------------------------------------

describe('Terms/Privacy navigation', () => {
  it('Login: "Terms of Service" link navigates to /(auth)/terms', () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    render(<LoginScreen />);
    fireEvent.press(screen.getByText('Terms of Service'));
    expect(router.push).toHaveBeenCalledWith('/(auth)/terms');
  });

  it('Login: "Privacy Policy" link navigates to /(auth)/privacy', () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    render(<LoginScreen />);
    fireEvent.press(screen.getByText('Privacy Policy'));
    expect(router.push).toHaveBeenCalledWith('/(auth)/privacy');
  });

  it('Register: "Terms of Service" link navigates to /(auth)/terms', () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    render(<RegisterScreen />);
    fireEvent.press(screen.getByText('Terms of Service'));
    expect(router.push).toHaveBeenCalledWith('/(auth)/terms');
  });

  it('Register: "Privacy Policy" link navigates to /(auth)/privacy', () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    render(<RegisterScreen />);
    fireEvent.press(screen.getByText('Privacy Policy'));
    expect(router.push).toHaveBeenCalledWith('/(auth)/privacy');
  });

  it('Welcome: Terms of Service link navigates to /(auth)/terms', () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    render(<WelcomeScreen />);
    fireEvent.press(screen.getByLabelText('Read Terms of Service'));
    expect(router.push).toHaveBeenCalledWith('/(auth)/terms');
  });

  it('Welcome: Privacy Policy link navigates to /(auth)/privacy', () => {
    const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };
    render(<WelcomeScreen />);
    fireEvent.press(screen.getByLabelText('Read Privacy Policy'));
    expect(router.push).toHaveBeenCalledWith('/(auth)/privacy');
  });
});

// ---------------------------------------------------------------------------
// Privacy/Terms — single header + exact "Last updated" line (wording guard)
// ---------------------------------------------------------------------------

describe('Privacy/Terms — single header + exact Last updated line', () => {
  it('PrivacyScreen renders exactly one "Privacy Policy" header and the exact Last updated line', () => {
    render(<PrivacyScreen />);
    expect(screen.getAllByText('Privacy Policy')).toHaveLength(1);
    expect(screen.getByText('Last updated: June 2026')).toBeTruthy();
  });

  it('TermsScreen renders exactly one "Terms of Service" header and the exact Last updated line', () => {
    render(<TermsScreen />);
    expect(screen.getAllByText('Terms of Service')).toHaveLength(1);
    expect(screen.getByText('Last updated: April 2026')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Source scans — background architecture + legacy-cleanup invariants
// (same technique as app/profile/__tests__/profileAtmosphere.test.tsx)
// ---------------------------------------------------------------------------

const BG_SCREEN_FILES = [
  'app/(auth)/onboarding-1.tsx',
  'app/(auth)/onboarding-2.tsx',
  'app/(auth)/onboarding-3.tsx',
  'app/(auth)/welcome.tsx',
  'app/(auth)/login.tsx',
  'app/(auth)/register.tsx',
  'app/(auth)/privacy.tsx',
  'app/(auth)/terms.tsx',
];

const ALL_AUTH_FILES = [
  ...BG_SCREEN_FILES,
  'app/(auth)/index.tsx',
  'app/(auth)/_layout.tsx',
];

function readScreen(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../', relPath), 'utf8');
}

describe('Auth ecosystem — every content screen mounts its own background; roots stay transparent', () => {
  it.each(BG_SCREEN_FILES)('%s imports and mounts <V2Background/>', (file) => {
    const src = readScreen(file);
    expect(src).toMatch(/import\s*{\s*V2Background\s*}\s*from\s*'@\/components\/ui\/V2Background'/);
    expect(src).toMatch(/<V2Background\s*\/>/);
  });

  it.each(BG_SCREEN_FILES)('%s keeps a transparent root and safe area so V2Background shows through', (file) => {
    const src = readScreen(file);
    expect(src).toMatch(/root:\s*{\s*flex:\s*1,\s*backgroundColor:\s*'transparent'/);
    expect(src).toMatch(/safe:\s*{\s*flex:\s*1,\s*backgroundColor:\s*'transparent'/);
  });
});

describe('Auth ecosystem — atmosphere is resolved only inside V2Background, never re-derived locally', () => {
  it.each(ALL_AUTH_FILES)('%s has no screen-local useWeather()/resolveAtmosphere() call', (file) => {
    const src = readScreen(file);
    expect(src).not.toMatch(/\buseWeather\(/);
    expect(src).not.toMatch(/\bresolveAtmosphere\(/);
  });
});

describe('Auth ecosystem — legacy background/design-language fully removed', () => {
  it.each(ALL_AUTH_FILES)('%s never imports the legacy <WeatherBackground/>', (file) => {
    const src = readScreen(file);
    expect(src).not.toMatch(/WeatherBackground/);
  });

  it.each(ALL_AUTH_FILES)('%s never imports V2AtmosphereProvider (exists but is unused/inert)', (file) => {
    const src = readScreen(file);
    expect(src).not.toMatch(/V2AtmosphereProvider/);
  });

  it.each(ALL_AUTH_FILES)('%s never mounts expo-blur/BlurView (missing native module — crashes)', (file) => {
    const src = readScreen(file);
    expect(src).not.toMatch(/expo-blur|BlurView/);
  });

  it.each(ALL_AUTH_FILES)('%s has no leftover legacy light-mode hex or NativeWind classnames', (file) => {
    const src = readScreen(file);
    expect(src).not.toMatch(/#FF6B6B|#FBF6EC|#2FB8B0/);
    expect(src).not.toMatch(/bg-white|text-sky/);
  });
});
