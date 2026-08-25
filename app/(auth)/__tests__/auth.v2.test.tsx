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

import { Image } from 'react-native';
import { GlassSurface } from '@/components/ui/GlassSurface';
import LoginScreen from '../login';
import RegisterScreen from '../register';
import PrivacyScreen from '../privacy';
import TermsScreen from '../terms';
import WelcomeScreen from '../welcome';
import { useAppearanceStore } from '@/store/appearanceStore';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PP2_TRANSPARENT_SOURCE = require('../../../assets/design/PP2-transparent.png');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PP2_RAW_SOURCE = require('../../../assets/design/PP2.png');

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
  retirePendingLocationConsent: jest.fn().mockResolvedValue(undefined),
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
  // Step 10A Part 2 (dual-theme foundation): reset to the default so tests
  // above (written before theming existed) stay unaffected by the
  // light/dark-specific Welcome block added below.
  useAppearanceStore.setState({ mode: 'dark' });
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
// Welcome — renders in both light and dark (Step 10A Part 2 proof set)
// ---------------------------------------------------------------------------

describe('Welcome — renders in both light and dark (Step 10A Part 2 proof set)', () => {
  it('renders without crashing in dark mode, with real copy intact', () => {
    useAppearanceStore.setState({ mode: 'dark' });
    render(<WelcomeScreen />);
    expect(screen.getByText('Create free account')).toBeTruthy();
    expect(screen.getByText('Sign in')).toBeTruthy();
  });

  it('hero card keeps the original dark charcoal tint in dark mode (byte-identical to before the fix)', () => {
    useAppearanceStore.setState({ mode: 'dark' });
    render(<WelcomeScreen />);
    const heroCard = screen.UNSAFE_getAllByType(GlassSurface)[0];
    expect(heroCard.props.tintColor).toBe('rgba(18,18,26,0.86)');
  });

  it('hero card gets the warm sand/cream tint in light mode, not the dark charcoal literal (2026-08-13 fix)', () => {
    useAppearanceStore.setState({ mode: 'light' });
    render(<WelcomeScreen />);
    const heroCard = screen.UNSAFE_getAllByType(GlassSurface)[0];
    expect(heroCard.props.tintColor).toBe('rgba(246,241,230,0.86)');
    expect(heroCard.props.tintColor).not.toBe('rgba(18,18,26,0.86)');
  });

  it('renders without crashing in light mode, with real copy intact', () => {
    useAppearanceStore.setState({ mode: 'light' });
    render(<WelcomeScreen />);
    expect(screen.getByText('Create free account')).toBeTruthy();
    expect(screen.getByText('Sign in')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Welcome hero — PP2 logo sizing (2026-08-12 device-review fix, then the
// transparency + larger-sizing correction later the same day)
//
// Guards against the regression a real device caught: the Image itself must
// never carry a percentage width + aspectRatio directly (that combination is
// what made PP2 render huge/cropped on Android — the Image's Yoga box was
// resolved off the source's raw pixel size instead of the percentage). The
// safe pattern is a bounded plain View sized by aspectRatio + maxWidth, with
// the Image filling it at 100%/100% + resizeMode="contain".
//
// Asset: explicit instruction to use PP2-transparent.png here (real alpha,
// so the hero's own background shows through — no checkerboard box), NOT the
// raw PP2.png (that stays Home-only). Sizing: a later explicit instruction
// asked for a visibly larger logo filling the hero's top area, so the bound
// widened from the initial 85%/230dp-capped pass to 95%/420dp-capped.
// ---------------------------------------------------------------------------

describe('Welcome hero — PP2 logo is a bounded, contained, transparent logo (not a full-card background)', () => {
  it('renders PP2-transparent.png via <Image> — never the raw PP2.png with the baked checkerboard', () => {
    render(<WelcomeScreen />);
    const image = screen.UNSAFE_getByType(Image);
    expect(image.props.source).toBe(PP2_TRANSPARENT_SOURCE);
    expect(image.props.source).not.toBe(PP2_RAW_SOURCE);
  });

  it('uses resizeMode="contain" (no crop, no cover)', () => {
    render(<WelcomeScreen />);
    expect(screen.UNSAFE_getByType(Image).props.resizeMode).toBe('contain');
  });

  it('the Image itself has no percentage width/aspectRatio (the bug pattern) — it just fills its container', () => {
    render(<WelcomeScreen />);
    const style = screen.UNSAFE_getByType(Image).props.style;
    expect(style.width).toBe('100%');
    expect(style.height).toBe('100%');
    expect(style.aspectRatio).toBeUndefined();
  });

  it('the logo sits in a bounded container sized generously off the card width (95%, real aspect ratio) — not stretched full-bleed', () => {
    // 2026-08-20: the wordmark clip added an OUTER box, so the properties this
    // test guards now live one level up. Every original assertion is kept and
    // both levels are checked, so the guarantee is unchanged (and stronger):
    //   heroLogoClip  -> the 95% / maxWidth 420 bound, plus overflow hidden
    //   heroLogoBox   -> the artwork's true 1448/1086 ratio
    render(<WelcomeScreen />);
    const image = screen.UNSAFE_getByType(Image);
    const innerBox = image.parent!;

    // Walk up to the clipping box rather than assuming a fixed depth — the
    // test renderer inserts wrapper nodes that are not stable across versions.
    let clipBox: any = innerBox.parent;
    while (clipBox && clipBox.props?.style?.overflow !== 'hidden') clipBox = clipBox.parent;
    expect(clipBox).toBeTruthy();

    // The bounded container.
    expect(clipBox.props.style.width).toBe('95%');
    expect(clipBox.props.style.maxWidth).toBe(420);
    expect(clipBox.props.style.overflow).toBe('hidden');
    expect(clipBox.props.style.position).not.toBe('absolute');

    // The artwork still keeps its own real aspect ratio — it is clipped, never
    // squashed or stretched to fit.
    expect(innerBox.props.style.aspectRatio).toBeCloseTo(1448 / 1086, 3);
    expect(innerBox.props.style.width).toBe('100%');
    expect(innerBox.props.style.position).not.toBe('absolute');
  });

  it('the hero copy ("Family days out...") still renders alongside the logo, not replaced by it', () => {
    render(<WelcomeScreen />);
    expect(screen.getByText(/Family days out/)).toBeTruthy();
    expect(screen.getByText(/Find soft plays, parks and cafés/)).toBeTruthy();
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

// Light-theme correction (feat/exact-v2-design, v2 Light pass): every auth
// content screen (welcome.tsx from the Step 10A Part 2 proof set, plus
// onboarding-1/2/3, privacy.tsx, terms.tsx, login.tsx and register.tsx) has
// now been migrated to mount <ThemedBackground/> instead of a direct
// <V2Background/> (dark path stays byte-identical — see
// components/ui/ThemedBackground.tsx, a thin pass-through). V2_DIRECT_BG_FILES
// is kept (now empty) so the regression coverage below stays in place if a
// future screen is ever added back as a direct-V2Background exception.
const V2_DIRECT_BG_FILES: string[] = [];

const THEMED_BACKGROUND_BG_FILES = [
  'app/(auth)/onboarding-1.tsx',
  'app/(auth)/onboarding-2.tsx',
  'app/(auth)/onboarding-3.tsx',
  'app/(auth)/privacy.tsx',
  'app/(auth)/terms.tsx',
  'app/(auth)/welcome.tsx',
  'app/(auth)/login.tsx',
  'app/(auth)/register.tsx',
];

const BG_SCREEN_FILES = [...V2_DIRECT_BG_FILES, ...THEMED_BACKGROUND_BG_FILES];

const ALL_AUTH_FILES = [
  ...BG_SCREEN_FILES,
  'app/(auth)/index.tsx',
  'app/(auth)/_layout.tsx',
];

function readScreen(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../', relPath), 'utf8');
}

describe('Auth ecosystem — every content screen mounts its own background; roots stay transparent', () => {
  // V2_DIRECT_BG_FILES is currently empty (every auth screen has been
  // migrated to ThemedBackground) — `it.each` throws on an empty array, so
  // this guard only runs when there is something to assert.
  if (V2_DIRECT_BG_FILES.length > 0) {
    it.each(V2_DIRECT_BG_FILES)('%s imports and mounts <V2Background/>', (file) => {
      const src = readScreen(file);
      expect(src).toMatch(/import\s*{\s*V2Background\s*}\s*from\s*'@\/components\/ui\/V2Background'/);
      expect(src).toMatch(/<V2Background\s*\/>/);
    });
  }

  it.each(THEMED_BACKGROUND_BG_FILES)('%s imports and mounts <ThemedBackground/> (mode-aware chrome)', (file) => {
    const src = readScreen(file);
    expect(src).toMatch(/import\s*{\s*ThemedBackground\s*}\s*from\s*'@\/components\/ui\/ThemedBackground'/);
    expect(src).toMatch(/<ThemedBackground\s*\/>/);
  });

  it.each(BG_SCREEN_FILES)('%s keeps a transparent root and safe area so its background shows through', (file) => {
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

// -----------------------------------------------------------------------
// Cross-Screen Visual Consistency checkpoint — primary CTAs use GlassButton,
// never a heavy solid-blue TouchableOpacity fill. Scoped to the 6 files
// converted this checkpoint (Login/Register/Welcome/Onboarding 1-3) — not
// privacy.tsx/terms.tsx, which weren't part of this pass.
// -----------------------------------------------------------------------
const GLASS_BUTTON_ROLLOUT_FILES = [
  'app/(auth)/login.tsx',
  'app/(auth)/register.tsx',
  'app/(auth)/welcome.tsx',
  'app/(auth)/onboarding-1.tsx',
  'app/(auth)/onboarding-2.tsx',
  'app/(auth)/onboarding-3.tsx',
];

describe('Auth ecosystem — primary CTAs use the shared GlassButton, not a solid-blue fill', () => {
  it.each(GLASS_BUTTON_ROLLOUT_FILES)('%s imports GlassButton', (file) => {
    const src = readScreen(file);
    expect(src).toMatch(/import\s*{\s*GlassButton\s*}\s*from\s*'@\/components\/ui\/GlassButton'/);
  });

  it.each(GLASS_BUTTON_ROLLOUT_FILES)('%s has no leftover solid ACCENT.accent button-background style', (file) => {
    const src = readScreen(file);
    // Decorative, non-button accent fills (map-pin illustrations, active
    // pagination dots) are untouched by this checkpoint and legitimately
    // keep backgroundColor: ACCENT.accent — this guard only checks that no
    // *button*-shaped style object (one with alignItems/justifyContent
    // centering, i.e. a tappable CTA container) still hardcodes it.
    const buttonShapedAccentFill =
      /(?:Btn|[Bb]utton)[a-zA-Z]*:\s*{[^}]*backgroundColor:\s*ACCENT\.accent/s;
    expect(src).not.toMatch(buttonShapedAccentFill);
  });

  it('LoginScreen renders "Sign in" via GlassButton, not a raw TouchableOpacity', () => {
    render(<LoginScreen />);
    const signInBtn = screen.getByLabelText('Sign in to your account');
    // GlassButton is a Pressable under the hood — its minHeight/minWidth 44
    // floor is a reliable fingerprint distinguishing it from the old
    // TouchableOpacity, which had no such floor set.
    const { StyleSheet } = require('react-native');
    const style = StyleSheet.flatten(signInBtn.props.style);
    expect(style.minHeight).toBe(44);
  });
});

// ===========================================================================
// Welcome hero wordmark (2026-08-20)
//
// PP2-transparent.png bakes a "PlayPlanner" wordmark into the artwork in which
// "Play" is near-black. On this screen's night background that read as muddy and
// low-contrast, and being a scaled raster its edges were soft next to real text.
// The artwork is now clipped to its icon region and the wordmark is rendered as
// live text, so it stays sharp and theme-aware.
// ===========================================================================
describe('Welcome hero — the wordmark is live text, not baked raster', () => {
  it('renders "Play" and "Planner" as real text nodes', () => {
    render(<WelcomeScreen />);
    expect(screen.getByText('Play')).toBeTruthy();
    expect(screen.getByText('Planner')).toBeTruthy();
  });

  it('keeps the existing map/sun brand icon — the artwork is not replaced', () => {
    render(<WelcomeScreen />);
    expect(screen.UNSAFE_getByType(Image).props.source).toBe(PP2_TRANSPARENT_SOURCE);
  });

  it('clips the artwork above its baked-in wordmark so the text is not duplicated', () => {
    const { StyleSheet } = require('react-native');
    render(<WelcomeScreen />);
    const image = screen.UNSAFE_getByType(Image);

    // The Image still fills a plain box at 100%/100% — it must never be the
    // element carrying aspectRatio (Android sizes such an Image from the source
    // file's pixel dimensions instead, which is the original hero-size bug).
    const imgStyle = StyleSheet.flatten(image.props.style);
    expect(imgStyle.width).toBe('100%');
    expect(imgStyle.height).toBe('100%');
    expect(imgStyle.aspectRatio).toBeUndefined();

    // Somewhere above it there is a clipping box whose ratio is shorter than the
    // artwork's own 1448/1086, i.e. the baked wordmark is cropped away.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'welcome.tsx'), 'utf8');
    expect(src).toMatch(/heroLogoClip:\s*{[^}]*overflow:\s*'hidden'/s);
    expect(src).toMatch(/aspectRatio:\s*1448\s*\/\s*760/);
    expect(1448 / 760).toBeGreaterThan(1448 / 1086); // shorter box => wordmark clipped
  });

  it('"Play" uses the theme label colour so it has contrast in BOTH themes', () => {
    const { StyleSheet } = require('react-native');

    useAppearanceStore.setState({ mode: 'dark' });
    render(<WelcomeScreen />);
    const darkPlay = StyleSheet.flatten(screen.getByText('Play').props.style);
    screen.unmount();

    useAppearanceStore.setState({ mode: 'light' });
    render(<WelcomeScreen />);
    const lightPlay = StyleSheet.flatten(screen.getByText('Play').props.style);

    // The whole point: the raster could only ever be one colour. Live text
    // changes with the theme, so "Play" is never dark-on-dark.
    expect(darkPlay.color).toBeTruthy();
    expect(lightPlay.color).toBeTruthy();
    expect(darkPlay.color).not.toBe(lightPlay.color);
  });

  it('"Planner" keeps the brand amber in both themes', () => {
    const { StyleSheet } = require('react-native');

    useAppearanceStore.setState({ mode: 'dark' });
    render(<WelcomeScreen />);
    const darkPlanner = StyleSheet.flatten(screen.getByText('Planner').props.style);
    screen.unmount();

    useAppearanceStore.setState({ mode: 'light' });
    render(<WelcomeScreen />);
    const lightPlanner = StyleSheet.flatten(screen.getByText('Planner').props.style);

    expect(darkPlanner.color).toBe('#F5A623');
    expect(lightPlanner.color).toBe('#F5A623');
  });

  it('the clipped artwork is hidden from screen readers so the name is announced once', () => {
    render(<WelcomeScreen />);
    const image = screen.UNSAFE_getByType(Image);
    expect(image.props.accessible).toBe(false);
    // The live text carries the brand name for assistive tech instead.
    expect(screen.getByText('Play')).toBeTruthy();
  });
});
