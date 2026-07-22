/**
 * Tests for hooks/useAppTheme.ts (Step 10A Part 2, dual-theme foundation).
 *
 * Covers the resolution rule: mode = preference === 'system'
 *   ? (OS colour scheme ?? 'dark')
 *   : preference
 *
 * useColorScheme is mocked locally in this file (overriding the jest.setup.js
 * global default of 'dark') so every case below is deterministic and
 * independent of that global default.
 */
import { renderHook, act } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useThemeStore } from '@/store/themeStore';
import { Themes, ocean } from '@/constants/theme';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

const mockUseColorScheme = useColorScheme as jest.Mock;

beforeEach(() => {
  mockUseColorScheme.mockReset();
  mockUseColorScheme.mockReturnValue(null);
  useThemeStore.setState({ preference: 'system', hasHydrated: true });
});

describe('useAppTheme — "system" preference resolves from the OS', () => {
  it('resolves to dark when the OS reports "dark"', () => {
    mockUseColorScheme.mockReturnValue('dark');
    const { result } = renderHook(() => useAppTheme());
    expect(result.current.mode).toBe('dark');
    expect(result.current.tokens).toBe(Themes.dark);
  });

  it('resolves to light when the OS reports "light"', () => {
    mockUseColorScheme.mockReturnValue('light');
    const { result } = renderHook(() => useAppTheme());
    expect(result.current.mode).toBe('light');
    expect(result.current.tokens).toBe(Themes.light);
  });

  it('falls back to dark when the OS reports no preference (null)', () => {
    mockUseColorScheme.mockReturnValue(null);
    const { result } = renderHook(() => useAppTheme());
    expect(result.current.mode).toBe('dark');
    expect(result.current.tokens).toBe(Themes.dark);
  });
});

describe('useAppTheme — explicit preference overrides the OS', () => {
  it('an explicit "light" preference wins even when the OS reports "dark"', () => {
    mockUseColorScheme.mockReturnValue('dark');
    useThemeStore.setState({ preference: 'light' });
    const { result } = renderHook(() => useAppTheme());
    expect(result.current.mode).toBe('light');
    expect(result.current.tokens).toBe(Themes.light);
  });

  it('an explicit "dark" preference wins even when the OS reports "light"', () => {
    mockUseColorScheme.mockReturnValue('light');
    useThemeStore.setState({ preference: 'dark' });
    const { result } = renderHook(() => useAppTheme());
    expect(result.current.mode).toBe('dark');
    expect(result.current.tokens).toBe(Themes.dark);
  });
});

describe('useAppTheme — accent + reactivity', () => {
  it('always returns the Ocean accent palette (only palette wired up so far)', () => {
    const { result } = renderHook(() => useAppTheme());
    expect(result.current.accent).toBe(ocean);
  });

  it('re-renders a mounted consumer when setPreference is called (Zustand reactivity)', () => {
    mockUseColorScheme.mockReturnValue('dark'); // irrelevant once preference is explicit
    const { result } = renderHook(() => useAppTheme());
    expect(result.current.mode).toBe('dark');

    act(() => {
      useThemeStore.getState().setPreference('light');
    });

    expect(result.current.mode).toBe('light');
    expect(result.current.tokens).toBe(Themes.light);
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
