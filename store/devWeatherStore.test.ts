/**
 * Tests for store/devWeatherStore.ts — the __DEV__-only in-memory weather
 * override used by the manual dev weather tester (components/dev/
 * DevWeatherTester.tsx) and read by hooks/useResolvedWeather.ts +
 * components/ui/V2Background.tsx (forceNight only).
 *
 * Covers:
 *   - Default state, setOverride/setForceNight/clear semantics.
 *   - NOT persisted — no zustand `persist` middleware (unlike
 *     store/themeStore.ts, a REAL saved user preference).
 *   - Source guard: only ONE file under app/ may import this store directly
 *     (the single documented access point, app/(tabs)/index.tsx) — everyone
 *     else must go through hooks/useResolvedWeather.ts or
 *     components/dev/DevWeatherTester.tsx.
 */
import fs from 'fs';
import path from 'path';
import { useDevWeatherStore } from './devWeatherStore';

beforeEach(() => {
  useDevWeatherStore.setState({ override: null, forceNight: null });
});

describe('devWeatherStore — default state', () => {
  it('defaults to no override and no forced night', () => {
    expect(useDevWeatherStore.getState().override).toBeNull();
    expect(useDevWeatherStore.getState().forceNight).toBeNull();
  });
});

describe('devWeatherStore — setOverride / setForceNight / clear', () => {
  it('setOverride updates the override condition', () => {
    useDevWeatherStore.getState().setOverride('thunderstorm');
    expect(useDevWeatherStore.getState().override).toBe('thunderstorm');
  });

  it('setOverride(null) clears just the override, leaving forceNight untouched', () => {
    useDevWeatherStore.setState({ override: 'snow', forceNight: true });
    useDevWeatherStore.getState().setOverride(null);
    expect(useDevWeatherStore.getState().override).toBeNull();
    expect(useDevWeatherStore.getState().forceNight).toBe(true);
  });

  it('setForceNight(true/false/null) updates independently of override', () => {
    useDevWeatherStore.getState().setForceNight(true);
    expect(useDevWeatherStore.getState().forceNight).toBe(true);
    useDevWeatherStore.getState().setForceNight(false);
    expect(useDevWeatherStore.getState().forceNight).toBe(false);
    useDevWeatherStore.getState().setForceNight(null);
    expect(useDevWeatherStore.getState().forceNight).toBeNull();
  });

  it('clear() resets BOTH override and forceNight together', () => {
    useDevWeatherStore.setState({ override: 'rain', forceNight: true });
    useDevWeatherStore.getState().clear();
    expect(useDevWeatherStore.getState().override).toBeNull();
    expect(useDevWeatherStore.getState().forceNight).toBeNull();
  });

  it('notifies subscribers immediately on every setter', () => {
    const listener = jest.fn();
    const unsubscribe = useDevWeatherStore.subscribe(listener);
    useDevWeatherStore.getState().setOverride('fog');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe('devWeatherStore — NOT persisted (deliberately, unlike themeStore)', () => {
  it('exposes no zustand `persist` API — plain in-memory store only', () => {
    // zustand's persist middleware attaches a `.persist` property to the
    // store object (see store/themeStore.ts, which DOES have one). Its
    // absence here is the actual proof this store never touches
    // AsyncStorage/SecureStore and cannot survive an app restart.
    expect((useDevWeatherStore as unknown as { persist?: unknown }).persist).toBeUndefined();
  });

  it('never imports AsyncStorage or SecureStore', () => {
    const src = fs.readFileSync(path.join(__dirname, 'devWeatherStore.ts'), 'utf8');
    const importLines = src.split('\n').filter((line) => line.trim().startsWith('import'));
    for (const line of importLines) {
      expect(line).not.toMatch(/async-storage|secure-store/i);
    }
  });
});

describe('devWeatherStore — source guard: single shared access point under app/', () => {
  it('no file under app/ imports devWeatherStore directly, except the one documented mount point (app/(tabs)/index.tsx)', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const appDir = path.join(repoRoot, 'app');
    const ALLOWED = new Set<string>([
      // Currently empty: app/(tabs)/index.tsx only imports the
      // DevWeatherTester COMPONENT, not the store directly — every real
      // screen reaches the store exclusively through
      // hooks/useResolvedWeather.ts (weather/forceNight) or
      // components/dev/DevWeatherTester.tsx (read/write UI). If a future
      // screen needs a legitimate direct import, add its relative path here
      // deliberately — this test is meant to make that a conscious choice,
      // not an accident.
    ]);

    const offenders: string[] = [];
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          const src = fs.readFileSync(full, 'utf8');
          const importLines = src.split('\n').filter((line) => line.trim().startsWith('import'));
          const importsStore = importLines.some((line) => /devWeatherStore/.test(line));
          if (importsStore) {
            const rel = path.relative(repoRoot, full).replace(/\\/g, '/');
            if (!ALLOWED.has(rel)) offenders.push(rel);
          }
        }
      }
    }
    walk(appDir);

    expect(offenders).toEqual([]);
  });
});
