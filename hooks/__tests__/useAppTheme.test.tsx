/**
 * Tests for hooks/useAppTheme.ts (2026-08-13, automatic day/night theme).
 *
 * Covers the resolution rule: mode is read from store/appearanceStore.ts,
 * which itself resolves purely from local time (lib/timeAppearance.ts). The
 * OS colour scheme (useColorScheme) and the legacy store/themeStore.ts
 * System/Light/Dark preference must have ZERO effect — this file proves
 * both, explicitly, since that's the exact "hidden path" the automatic-theme
 * spec forbids (phone dark mode by day, or an old saved preference, must
 * never override the resolved appearance).
 */
import { renderHook, act } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useAppearanceStore } from '@/store/appearanceStore';
import { useThemeStore } from '@/store/themeStore';
import { Themes, ocean } from '@/constants/theme';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

const mockUseColorScheme = useColorScheme as jest.Mock;

beforeEach(() => {
  mockUseColorScheme.mockReset();
  mockUseColorScheme.mockReturnValue(null);
  useAppearanceStore.setState({ mode: 'dark' });
  useThemeStore.setState({ preference: 'system', hasHydrated: true });
});

describe('useAppTheme — resolves mode from the shared appearanceStore (time-based)', () => {
  it('returns "dark" when appearanceStore.mode is "dark"', () => {
    useAppearanceStore.setState({ mode: 'dark' });
    const { result } = renderHook(() => useAppTheme());
    expect(result.current.mode).toBe('dark');
    expect(result.current.tokens).toBe(Themes.dark);
  });

  it('returns "light" when appearanceStore.mode is "light"', () => {
    useAppearanceStore.setState({ mode: 'light' });
    const { result } = renderHook(() => useAppTheme());
    expect(result.current.mode).toBe('light');
    expect(result.current.tokens).toBe(Themes.light);
  });

  it('re-renders a mounted consumer when the store recomputes (e.g. a boundary crossing or foreground resync)', () => {
    useAppearanceStore.setState({ mode: 'dark' });
    const { result } = renderHook(() => useAppTheme());
    expect(result.current.mode).toBe('dark');

    act(() => {
      useAppearanceStore.getState().recompute(new Date(2026, 0, 15, 12, 0));
    });

    expect(result.current.mode).toBe('light');
    expect(result.current.tokens).toBe(Themes.light);
  });
});

describe('useAppTheme — the OS colour scheme is never consulted', () => {
  it('an OS "light" report does not change a resolved "dark" mode', () => {
    mockUseColorScheme.mockReturnValue('light');
    useAppearanceStore.setState({ mode: 'dark' });
    const { result } = renderHook(() => useAppTheme());
    expect(result.current.mode).toBe('dark');
  });

  it('an OS "dark" report does not change a resolved "light" mode', () => {
    mockUseColorScheme.mockReturnValue('dark');
    useAppearanceStore.setState({ mode: 'light' });
    const { result } = renderHook(() => useAppTheme());
    expect(result.current.mode).toBe('light');
  });

  it('never calls useColorScheme at all — production code has no read path to it', () => {
    renderHook(() => useAppTheme());
    expect(mockUseColorScheme).not.toHaveBeenCalled();
  });
});

describe('useAppTheme — the legacy themeStore System/Light/Dark preference is never consulted', () => {
  it('an explicit legacy "light" preference does not change a resolved "dark" mode', () => {
    useThemeStore.setState({ preference: 'light' });
    useAppearanceStore.setState({ mode: 'dark' });
    const { result } = renderHook(() => useAppTheme());
    expect(result.current.mode).toBe('dark');
  });

  it('an explicit legacy "dark" preference does not change a resolved "light" mode', () => {
    useThemeStore.setState({ preference: 'dark' });
    useAppearanceStore.setState({ mode: 'light' });
    const { result } = renderHook(() => useAppTheme());
    expect(result.current.mode).toBe('light');
  });
});

describe('useAppTheme — route navigation never changes the resolved mode at the same moment', () => {
  it('two hook instances mounted simultaneously (simulating two screens) always agree', () => {
    useAppearanceStore.setState({ mode: 'dark' });
    const a = renderHook(() => useAppTheme());
    const b = renderHook(() => useAppTheme());
    expect(a.result.current.mode).toBe(b.result.current.mode);
    expect(a.result.current.mode).toBe('dark');
  });
});

describe('useAppTheme — accent + reactivity', () => {
  it('always returns the Ocean accent palette (only palette wired up so far)', () => {
    const { result } = renderHook(() => useAppTheme());
    expect(result.current.accent).toBe(ocean);
  });
});

describe('useAppTheme — no PII, no location, no auth', () => {
  it('does not read location, profile, or auth data (source guard)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../useAppTheme.ts'), 'utf8');
    const importLines = src.split('\n').filter((line: string) => line.trim().startsWith('import'));
    for (const line of importLines) {
      expect(line).not.toMatch(/useLocation|authStore|supabase|useProfile/i);
    }
  });
});
