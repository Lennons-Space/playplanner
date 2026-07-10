---
name: V2 background consistency fix
description: Home/Venue Detail/Plan Visit now share the same animated v2 background
type: session
date: 2026-07-09
---

# V2 background consistency — FIXED, uncommitted

Branch: `feat/exact-v2-design`. Bug: Home showed the animated v2 weather/time
background (`components/ui/V2Background.tsx` → `V2WeatherMotion.tsx`); Venue
Detail (`app/venue/[id].tsx`) and Plan Visit (`app/venue/plan-visit.tsx`)
showed a flat opaque dark fill instead, because both are root-Stack siblings
of `(tabs)` and never mounted `V2Background`.

## Fix (via Main-coder agent, verified independently)
Per-screen wrapper — NOT a root-mount in `app/_layout.tsx` (root-mount was
explicitly rejected: `V2WeatherMotion`'s continuous UI-thread `useLoop`
reanimated repeats previously caused a Fabric `IllegalViewOperationException`
crash under admin; there's no sub-layout covering just the v2 screens).

- `app/venue/[id].tsx`: `<V2Background />` mounted as first child of
  `styles.root` (line ~389); `styles.root.backgroundColor` → `'transparent'`
  (was `T.bg`). Sticky-bar padding fix and Directions-name-in-URL fix both
  confirmed intact (lines ~400-404, ~739-742; ~287-294).
- `app/venue/plan-visit.tsx`: `<V2Background />` mounted in `LoadingScreen`,
  `ErrorScreen`, and the main render; root `backgroundColor` → `'transparent'`
  (was `pp.sand`).
- Home (`app/(tabs)/index.tsx`) untouched — already correct.
- Consistency guaranteed by the shared React Query cache key
  (`useWeather(FALLBACK_LOCATION.lat, .lon)` → same query key everywhere) +
  pure `resolveAtmosphere()` + deterministic seeded node positions in
  `V2WeatherMotion.tsx` (module-level `seededNodes(count, seed)`). No global
  provider added, no `useLocation` introduced anywhere in the path.

## Known minor gap (not fixed, out of this task's scope)
`app/venue/[id].tsx`'s `LoadingSkeleton` component (line ~136, shown briefly
while venue data loads) still uses an opaque `SafeAreaView` with
`backgroundColor: T.bg` — it does NOT mount `V2Background`. Plan Visit's
Loading/Error states DO get the background; Venue Detail's loading skeleton
doesn't. Cosmetic, low-risk, brief transient state — flag if full consistency
is wanted later.

## Verification (I re-ran these myself, not just trusting the agent)
- `git status`/`diff --stat`: only `app/venue/[id].tsx`, `app/venue/plan-visit.tsx`
  changed beyond what was already dirty at session start (that pre-existing
  dirt: `.claude/memory/*`, `ReviewCard.tsx`, `FacilityChips.tsx`,
  `VenueContactRow.tsx`, `RecommendationExplanation.tsx` — untouched by this task).
  3 new test files added under `app/venue/__tests__/`.
- Targeted jest re-run (venue + background + atmosphereConsistency + plan-visit):
  18 suites / 236 tests, all pass.
- `npx tsc --noEmit`: 31 errors, byte-identical to the no-new-files baseline
  (confirmed by diffing a run with the 3 new test files temporarily moved out
  vs. left in — identical list, zero regressions).
- `npx eslint` on the 5 touched files: 0 errors, 8 warnings (1 pre-existing
  `_myReview` unused-var warning in `[id].tsx`; 7 are `no-require-imports`/
  `react/display-name` warnings in the new test files, matching the existing
  accepted pattern already used elsewhere in the test suite).
- No `useLocation` import/call anywhere in `V2Background.tsx` or the two
  edited screens (grep-verified).

## Status
NOT committed, NOT pushed (as instructed). Full `npm run test:ci` was run by
the Main-coder agent (103 suites / 1838 tests, all passing) — not indepedently
re-run in full by me due to time, but targeted re-run above corroborates it.

Next: Liam to review on-device, then decide whether to also patch the Venue
Detail loading-skeleton gap, then commit.
