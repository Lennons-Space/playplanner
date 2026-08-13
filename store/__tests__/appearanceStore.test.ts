/**
 * Tests for store/appearanceStore.ts — the live, process-wide light/dark
 * THEME state built on lib/timeAppearance.ts (2026-08-13, automatic
 * day/night theme).
 *
 * Covers: date-injectable recompute() (boundary matrix), live boundary
 * switching via a scheduled timer (not a per-second poll — asserts the
 * timer fires once, at the right delay), and foreground/resume resync via
 * AppState. Follows the same AppState.addEventListener spy pattern already
 * established in hooks/__tests__/useProfileForegroundRefresh.test.ts, so
 * this never depends on react-native's real native AppState module.
 *
 * jest.setup.js forces `useAppearanceStore.setState({ mode: 'dark' })`
 * before every test app-wide — this file explicitly overrides `mode` in
 * every test via recompute()/direct setState, so that global default is
 * irrelevant here and never a source of flakiness.
 */
import { AppState, type AppStateStatus } from 'react-native';
import {
  useAppearanceStore,
  startAppearanceScheduler,
  stopAppearanceScheduler,
} from '../appearanceStore';

function at(hour: number, minute = 0): Date {
  return new Date(2026, 0, 15, hour, minute, 0, 0);
}

let capturedCallback: ((state: AppStateStatus) => void) | null = null;
const mockRemove = jest.fn();
let addEventListenerSpy: jest.SpyInstance;

beforeEach(() => {
  capturedCallback = null;
  mockRemove.mockClear();
  addEventListenerSpy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event: string, cb: (state: AppStateStatus) => void) => {
      capturedCallback = cb;
      return { remove: mockRemove } as ReturnType<typeof AppState.addEventListener>;
    });
});

afterEach(() => {
  stopAppearanceScheduler();
  addEventListenerSpy.mockRestore();
  jest.useRealTimers();
});

describe('appearanceStore — recompute() is date-injectable (full boundary matrix)', () => {
  it.each([
    [6, 59, 'dark'],
    [7, 0, 'light'],
    [12, 0, 'light'],
    [18, 59, 'light'],
    [19, 0, 'dark'],
    [23, 30, 'dark'],
    [0, 0, 'dark'],
  ] as const)('recompute(%i:%s) resolves mode to %s', (hour, minute, expected) => {
    useAppearanceStore.getState().recompute(at(hour, minute));
    expect(useAppearanceStore.getState().mode).toBe(expected);
  });

  it('notifies subscribers immediately — mounted consumers re-render on recompute', () => {
    const listener = jest.fn();
    const unsubscribe = useAppearanceStore.subscribe(listener);
    useAppearanceStore.getState().recompute(at(19, 0));
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});

describe('appearanceStore — real device colour scheme has zero effect (guard)', () => {
  it('source guard: this module never imports react-native useColorScheme (only AppState, for foreground resync)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../appearanceStore.ts'), 'utf8');
    const importLines = src.split('\n').filter((line: string) => line.trim().startsWith('import'));
    for (const line of importLines) {
      expect(line).not.toMatch(/useColorScheme/);
    }
  });
});

describe('appearanceStore — live boundary switching (single scheduled timer, not a poll)', () => {
  it('schedules exactly one timer at boundary-crossing time, not a per-second interval', () => {
    jest.useFakeTimers();
    jest.setSystemTime(at(18, 59));
    useAppearanceStore.getState().recompute();
    expect(useAppearanceStore.getState().mode).toBe('light');

    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    startAppearanceScheduler({ force: true });

    // Exactly one timer scheduled on start (the initial boundary timer).
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    // Scheduled ~1 minute out (18:59 → 19:00), never a 1s poll interval.
    expect(setTimeoutSpy.mock.calls[0][1]).toBe(60 * 1000);
    setTimeoutSpy.mockRestore();
  });

  it('crossing 19:00 while the app stays open switches to dark without a restart', () => {
    jest.useFakeTimers();
    jest.setSystemTime(at(18, 59));
    useAppearanceStore.getState().recompute();
    expect(useAppearanceStore.getState().mode).toBe('light');

    startAppearanceScheduler({ force: true });

    jest.setSystemTime(at(19, 0));
    jest.advanceTimersByTime(60 * 1000);

    expect(useAppearanceStore.getState().mode).toBe('dark');
  });

  it('crossing 07:00 while the app stays open switches to light without a restart', () => {
    jest.useFakeTimers();
    jest.setSystemTime(at(6, 59));
    useAppearanceStore.getState().recompute();
    expect(useAppearanceStore.getState().mode).toBe('dark');

    startAppearanceScheduler({ force: true });

    jest.setSystemTime(at(7, 0));
    jest.advanceTimersByTime(60 * 1000);

    expect(useAppearanceStore.getState().mode).toBe('light');
  });

  it('is idempotent — calling startAppearanceScheduler twice registers only one AppState listener', () => {
    jest.useFakeTimers();
    startAppearanceScheduler({ force: true });
    startAppearanceScheduler({ force: true });
    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
  });

  it('is a no-op under NODE_ENV=test without { force: true } — never leaks a real timer into unrelated suites', () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    startAppearanceScheduler();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(addEventListenerSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });
});

describe('appearanceStore — foreground/resume resync (AppState)', () => {
  it('recomputes immediately when AppState becomes "active" — e.g. backgrounded at 18:30, resumed at 20:00, must resolve dark on resume', () => {
    jest.useFakeTimers();
    jest.setSystemTime(at(18, 30));
    useAppearanceStore.getState().recompute();
    expect(useAppearanceStore.getState().mode).toBe('light');

    startAppearanceScheduler({ force: true });

    // Simulate the device sleeping/suspending timers while backgrounded —
    // jump the clock straight to 20:00 WITHOUT letting the boundary timer
    // fire, then simulate the OS reporting the app as foregrounded again.
    jest.setSystemTime(at(20, 0));
    expect(capturedCallback).not.toBeNull();
    capturedCallback!('active');

    expect(useAppearanceStore.getState().mode).toBe('dark');
  });

  it('does not recompute on background/inactive transitions, only on "active"', () => {
    jest.useFakeTimers();
    jest.setSystemTime(at(10, 0));
    useAppearanceStore.getState().recompute();
    expect(useAppearanceStore.getState().mode).toBe('light');

    startAppearanceScheduler({ force: true });

    jest.setSystemTime(at(20, 0));
    capturedCallback!('background');

    // Still light — a background transition must never itself trigger a
    // recompute (only 'active' does).
    expect(useAppearanceStore.getState().mode).toBe('light');
  });

  it('removes the AppState subscription on stopAppearanceScheduler — no listener leak', () => {
    jest.useFakeTimers();
    startAppearanceScheduler({ force: true });
    stopAppearanceScheduler();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});

describe('appearanceStore — route navigation preserves the same resolved mode', () => {
  it('two simultaneous consumers of the store read the identical mode value (single shared source of truth)', () => {
    useAppearanceStore.getState().recompute(at(21, 0));
    const readA = useAppearanceStore.getState().mode;
    const readB = useAppearanceStore.getState().mode;
    expect(readA).toBe('dark');
    expect(readA).toBe(readB);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 2026-08-13 audit pass (Liam, pre-device-acceptance) — additional lifecycle
// proof requested beyond the original test set above. Each block below maps
// to one specific audit item; nothing here duplicates coverage already
// proven above.
// ═════════════════════════════════════════════════════════════════════════

describe('appearanceStore — audit: rescheduled boundary always targets the OPPOSITE boundary type', () => {
  it('crossing 19:00 reschedules for the NEXT 07:00 (12h), not another 19:00', () => {
    jest.useFakeTimers();
    jest.setSystemTime(at(18, 59));
    useAppearanceStore.getState().recompute();

    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    startAppearanceScheduler({ force: true });
    expect(setTimeoutSpy.mock.calls[0][1]).toBe(60 * 1000); // initial: to 19:00

    jest.advanceTimersByTime(60 * 1000); // fires exactly at 19:00, reschedules

    expect(useAppearanceStore.getState().mode).toBe('dark');
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
    // The reschedule must target 07:00 the NEXT day (12h), never another
    // 19:00 (which would be 24h) and never the old 1-minute delay.
    expect(setTimeoutSpy.mock.calls[1][1]).toBe(12 * 60 * 60 * 1000);
    setTimeoutSpy.mockRestore();
  });

  it('crossing 07:00 reschedules for the NEXT 19:00 (12h), not another 07:00', () => {
    jest.useFakeTimers();
    jest.setSystemTime(at(6, 59));
    useAppearanceStore.getState().recompute();

    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    startAppearanceScheduler({ force: true });
    expect(setTimeoutSpy.mock.calls[0][1]).toBe(60 * 1000); // initial: to 07:00

    jest.advanceTimersByTime(60 * 1000); // fires exactly at 07:00, reschedules

    expect(useAppearanceStore.getState().mode).toBe('light');
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
    // The reschedule must target 19:00 the SAME day (12h), never another
    // 07:00 (which would be 24h).
    expect(setTimeoutSpy.mock.calls[1][1]).toBe(12 * 60 * 60 * 1000);
    setTimeoutSpy.mockRestore();
  });
});

describe('appearanceStore — audit: no timer accumulation across repeated crossings/foregrounds', () => {
  it('each of two consecutive boundary crossings clears the previous timer before scheduling the next — exactly one live timer at any moment', () => {
    jest.useFakeTimers();
    jest.setSystemTime(at(18, 59));
    useAppearanceStore.getState().recompute();

    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    startAppearanceScheduler({ force: true });

    // Starting never clears anything — there was nothing pending yet.
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(0);

    jest.advanceTimersByTime(60 * 1000); // crossing 1: 18:59 -> 19:00
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1); // the fired timer's own ID is cleared before the reschedule

    jest.advanceTimersByTime(12 * 60 * 60 * 1000); // crossing 2: 19:00 -> next 07:00
    expect(setTimeoutSpy).toHaveBeenCalledTimes(3);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);

    // Invariant across every step: exactly one net-live timer (calls differ by exactly 1).
    expect(setTimeoutSpy.mock.calls.length - clearTimeoutSpy.mock.calls.length).toBe(1);

    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  it('two consecutive foreground ("active") events each replace, never stack, the pending boundary timer', () => {
    jest.useFakeTimers();
    jest.setSystemTime(at(10, 0));
    useAppearanceStore.getState().recompute();

    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    startAppearanceScheduler({ force: true });
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(0);

    jest.setSystemTime(at(15, 0));
    capturedCallback!('active'); // foreground event 1 — replaces the still-pending timer
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

    jest.setSystemTime(at(17, 0));
    capturedCallback!('active'); // foreground event 2 — replaces again, does not stack
    expect(setTimeoutSpy).toHaveBeenCalledTimes(3);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);

    expect(setTimeoutSpy.mock.calls.length - clearTimeoutSpy.mock.calls.length).toBe(1);

    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });
});

describe('appearanceStore — audit: local-clock/timezone change is picked up on foreground, not just elapsed duration', () => {
  it('a jump in the OS-reported local hour (e.g. a timezone change on landing, not a simulated wait) is resolved correctly on the next foreground', () => {
    jest.useFakeTimers();
    // Device shows 10:00 local (light) before the change.
    jest.setSystemTime(at(10, 0));
    useAppearanceStore.getState().recompute();
    expect(useAppearanceStore.getState().mode).toBe('light');

    startAppearanceScheduler({ force: true });

    // The OS now reports 22:00 local — this module has no notion of "how
    // much real time elapsed"; it only ever asks the OS for the CURRENT
    // local hour via `new Date()`, so a timezone change presents to this
    // code identically to any other local-hour change. Modelled here as a
    // discontinuous jump (not a duration advance) to make that explicit.
    jest.setSystemTime(at(22, 0));
    capturedCallback!('active');

    expect(useAppearanceStore.getState().mode).toBe('dark');
  });
});

describe('appearanceStore — audit: module re-evaluation (Fast Refresh) caveat — documented, not silently assumed safe', () => {
  it('a fresh module instance (simulating Metro Fast Refresh re-evaluating THIS file specifically) does not know about a still-running previous instance — starting it registers a SECOND AppState listener rather than replacing the first', () => {
    jest.useFakeTimers();
    startAppearanceScheduler({ force: true }); // the module instance imported at the top of this file
    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);

    let freshModule: typeof import('../appearanceStore');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      freshModule = require('../appearanceStore');
    });
    freshModule!.startAppearanceScheduler({ force: true });

    // KNOWN, NARROW, DEV-ONLY CAVEAT (not a production or device-acceptance
    // concern): module-scope `started`/`boundaryTimer`/`appStateSubscription`
    // state does not survive a fresh evaluation of this exact file, so if a
    // developer live-edits store/appearanceStore.ts (or lib/timeAppearance.ts)
    // during an active Metro session, Fast Refresh could orphan the previous
    // instance's timer/listener instead of replacing it. This is NOT
    // exercised by a normal app launch, by backgrounding/foregrounding the
    // app, or by editing any OTHER file — Metro only re-evaluates the files
    // that actually changed, and this module is otherwise a process-wide
    // singleton for the lifetime of the app. Recorded here so the risk is
    // explicit rather than silently assumed away.
    expect(addEventListenerSpy).toHaveBeenCalledTimes(2);

    freshModule!.stopAppearanceScheduler();
  });
});

describe('appearanceStore — audit: no polling anywhere', () => {
  it('source guard: this module never calls setInterval', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../appearanceStore.ts'), 'utf8');
    expect(src).not.toMatch(/setInterval/);
  });
});
