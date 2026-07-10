---
name: V2 background — real fix (opaque sheet was the occluder)
description: Third attempt at Venue Detail "looks flat" bug — actual root cause found and fixed
type: session
date: 2026-07-09
---

# Venue Detail atmosphere bug — THIRD attempt, actually fixed

Branch: `feat/exact-v2-design`. Two prior sessions "fixed" this by mounting
`<V2Background/>` and making outer roots transparent (see
[v2_background_consistency_2026_07_09.md](v2_background_consistency_2026_07_09.md)).
That architecture was correct but the bug persisted on device: Venue Detail
still rendered as a flat opaque dark block.

## Actual root cause
`app/venue/[id].tsx`'s `styles.sheet` — a single `<View>` wrapping every
content section from the drag handle (line ~454) down through the ODbL
attribution (line ~678) — had `backgroundColor: T.surface` (`#17171F`, fully
opaque). It spans full width and nearly the full scrollable height, sitting
directly on top of the already-correctly-mounted `V2Background`. The
background was architecturally shared but 100% visually buried by this one
opaque full-bleed layer.

## Fix (via Main-coder agent, independently re-verified line-by-line)
- `app/venue/[id].tsx` lines 829-836: `styles.sheet.backgroundColor` →
  `'rgba(14,14,20,0.5)'` (was opaque `T.surface`); added
  `borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.08)'` hairline so the
  sheet edge still reads over the hero photo. 20px top radius / −20 overlap
  unchanged.
- Same file, lines 312-346: error-state `SafeAreaView` was opaque `T.bg` with
  no background mounted — added `<V2Background/>` as first child, changed to
  `backgroundColor: 'transparent'`.
- Island cards already opaque and untouched (confirmed by reading the file,
  not assumed): `statTile` (T.bg), `infoCard` (T.bg), `hoursCard` (T.bg),
  `ReviewCard`/`RecommendationExplanation` (their own opaque/tinted card
  backgrounds) — these keep full text legibility on top of the now-translucent
  sheet.
- `app/venue/plan-visit.tsx`: audited, NOT changed. Already correct — transparent
  root, `V2Background` mounted as sibling in main render + Loading/Error
  states, and every card (`venueCard`, checklist tiles, etc.) has its own
  `marginHorizontal` + opaque `pp.paper` background with no full-bleed wrapper
  enclosing them all. Grepped for one — none found.
- New test: `app/venue/__tests__/venueDetailBackground.test.tsx` — regression
  guard asserting the sheet's rendered `backgroundColor` matches
  `rgba(...)` with `0 < alpha < 1` (fails loudly if someone reverts to
  opaque), plus asserts `<V2Background/>` mounts in both the main render and
  the error state, asserts `useLocation` is never called, and asserts the
  sticky bar / venue name still render (screen not broken).

## Layering stack (confirmed, no gaps)
root (transparent) → `V2Background` (absolute-fill) → `ScrollView`
(transparent) → hero (opaque, 300px, allowed) → sheet (now
`rgba(14,14,20,0.5)`, translucent) → island cards (opaque, unchanged). No
remaining full-bleed opaque layer between `V2Background` and the viewport in
either the main render or the error state.

## Verification (I re-ran every gate myself, not just trusting the agent)
- `git diff --stat`: only `app/venue/[id].tsx` (836 lines changed — includes
  this session's edits plus the PRIOR uncommitted v2-dark-rewrite diff from
  Step 2, not all from this task) + 3 new/untouched test files under
  `app/venue/__tests__/`. `app/venue/plan-visit.tsx`'s diff in the working
  tree is pre-existing dirt from the prior session, confirmed NOT touched by
  this task (grep/diff-checked).
- Targeted jest (`venue|plan-visit|home|tabsLayout|ReviewCard|FacilityChips|
  VenueContactRow|RecommendationExplanation`): 26 suites / 329 tests, all pass
  (re-run independently, matches agent's report exactly).
- Full `npm run test:ci`: 103 suites / 1841 tests, all pass (re-run
  independently).
- `npx tsc --noEmit`: 31 errors total, byte-matches the documented baseline;
  independently grep-counted (`grep -c "error TS"` → 31). The one error inside
  `app/venue/[id].tsx` (line 562, `Facility[]` cast) is pre-existing and
  unrelated to this task's edits (error-state block + `styles.sheet` only).
- `npx eslint` on both touched files: 0 errors, 4 warnings, all pre-existing
  patterns (1 unused-var predating this change in `[id].tsx`; 2
  `no-require-imports` + 1 `react/display-name` in test-helper code, matching
  the accepted pattern used elsewhere in the suite).
- `grep useLocation` across touched files: only appears in the new test's own
  mock + assertion that it's never called — no real usage introduced.
- `git log --oneline -3` / `git diff --cached --stat`: no new commits, nothing
  staged.

## Status
NOT committed, NOT pushed (as instructed). Next: Liam to review Venue Detail
on-device to confirm the atmosphere is now visibly matching Home, then decide
whether to also patch the still-open minor gap (Venue Detail's
`LoadingSkeleton` opaque loading state — flagged in the prior session, still
not fixed, out of scope for both sessions), then commit everything from Step
2 + both background fixes together.
