/**
 * Profile-ecosystem atmosphere regression test.
 *
 * BUG THIS GUARDS (Step 5 on-device follow-up, feat/exact-v2-design):
 * All 8 Profile-ecosystem screens (Edit Profile, Children's Ages,
 * Notifications, Privacy & Data, Download My Data, My Reviews, My Submitted
 * Venues, Add a Venue) mount their OWN <V2Background/> atmosphere at each
 * screen's root — but several of them then stacked multiple <GlassSurface/>
 * cards at the component's default 0.82-opacity tint back-to-back with only
 * small gaps, covering nearly the whole scrollable area. The background was
 * still mounted and animating underneath, but visually smothered — the same
 * failure class as the earlier Venue Detail "monolithic opaque sheet"
 * regression (see ../../venue/__tests__/venueDetailBackground.test.tsx),
 * just at the per-card level instead of a single full-bleed sheet. The fix:
 * every content-card GlassSurface call site in these screens explicitly
 * overrides `tintColor` to a lighter, already-precedented value (matching
 * Venue Detail's sheet at 0.5 and SmartFeaturedCard's secondary card at
 * 0.55) rather than relying on the risky opaque-reading 0.82 default.
 *
 * A same-branch attempt to replace these per-screen mounts with ONE global
 * instance (shared via context) was tried and then REVERTED after on-device
 * testing showed the global background did not render at all — not even on
 * Home, the accepted source-of-truth screen. Liam's ruling: the known-good
 * per-screen architecture is the accepted, frozen one (every screen mounts
 * its own <V2Background/>, each independently reading the same cached
 * `useWeather(FALLBACK_LOCATION)` query — same DATA, verified stable
 * across all routes on-device 2026-07-15). Do not re-attempt a global
 * mount unless a proven shared bug requires it. This file guards the
 * per-screen invariants: every screen mounts <V2Background/>, roots stay
 * transparent so it shows through, no screen resolves weather/time itself
 * (that stays inside V2Background), and the GlassSurface tint fix above.
 *
 * WHY THIS TEST READS SOURCE FILES INSTEAD OF RENDERING:
 * Each of the 8 screens already has its own dedicated behavioural test file
 * (editRegression, children-ages, notifications, privacy-settings,
 * data-download, my-reviews, my-venues, plus venue/__tests__/add.test.tsx)
 * with its own bespoke mocks for that screen's hooks/queries. Re-mounting
 * all 8 here would mean duplicating that mock surface for no behavioural
 * benefit. The invariants this bug is actually about — "does this screen
 * mount its own <V2Background/>", "is the root/safe area transparent so it
 * shows through", "does any screen resolve weather/time independently
 * instead of delegating to V2Background", and "does every content card
 * override the smothering default tint" — are structural properties of the
 * JSX/style source, so asserting them directly against source text is
 * robust, fast, and can't be fooled by a mock hiding the real component
 * tree.
 */
import fs from 'fs';
import path from 'path';

// Light-theme correction (feat/exact-v2-design, v2 Light pass): every
// Profile-ecosystem screen (plus venue/add.tsx) has now been migrated to
// mount <ThemedBackground/> instead of a direct <V2Background/> — same
// pattern as the notifications.tsx proof-set screen from Step 10A Part 2
// (dark path stays byte-identical — see components/ui/ThemedBackground.tsx,
// a thin pass-through). This lets each screen's chrome (labels/surfaces/
// separators) resolve via useAppTheme() instead of a hard-coded Themes.dark
// import. V2_DIRECT_SCREEN_FILES is kept (now empty) so the regression
// coverage below stays in place if a future screen is ever added back as a
// direct-V2Background exception.
const V2_DIRECT_SCREEN_FILES: string[] = [];

const THEMED_BACKGROUND_SCREEN_FILES = [
  'app/profile/edit.tsx',
  'app/profile/children-ages.tsx',
  'app/profile/privacy-settings.tsx',
  'app/profile/data-download.tsx',
  'app/profile/my-reviews.tsx',
  'app/profile/my-venues.tsx',
  'app/profile/notifications.tsx',
  'app/venue/add.tsx',
];

const SCREEN_FILES = [...V2_DIRECT_SCREEN_FILES, ...THEMED_BACKGROUND_SCREEN_FILES];

function readScreen(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../../', relPath), 'utf8');
}

describe('Profile ecosystem — each screen mounts its own background; roots stay transparent', () => {
  // V2_DIRECT_SCREEN_FILES is currently empty (every screen has been
  // migrated to ThemedBackground) — `it.each` throws on an empty array, so
  // this guard only runs when there is something to assert. Add a screen
  // back here (and drop it from THEMED_BACKGROUND_SCREEN_FILES) if a future
  // change ever needs a direct-V2Background exception again.
  if (V2_DIRECT_SCREEN_FILES.length > 0) {
    it.each(V2_DIRECT_SCREEN_FILES)('%s imports and mounts <V2Background/> (restored per-screen architecture)', (file) => {
      const src = readScreen(file);
      expect(src).toMatch(/import\s*{\s*V2Background\s*}\s*from\s*'@\/components\/ui\/V2Background'/);
      expect(src).toMatch(/<V2Background\s*\/>/);
    });
  }

  it.each(THEMED_BACKGROUND_SCREEN_FILES)('%s imports and mounts <ThemedBackground/> (mode-aware chrome)', (file) => {
    const src = readScreen(file);
    expect(src).toMatch(/import\s*{\s*ThemedBackground\s*}\s*from\s*'@\/components\/ui\/ThemedBackground'/);
    expect(src).toMatch(/<ThemedBackground\s*\/>/);
  });

  it.each(SCREEN_FILES)('%s keeps a transparent root and SafeAreaView so the background shows through', (file) => {
    const src = readScreen(file);
    expect(src).toMatch(/root:\s*{\s*flex:\s*1,\s*backgroundColor:\s*'transparent'/);
    expect(src).toMatch(/safe:\s*{\s*flex:\s*1,\s*backgroundColor:\s*'transparent'/);
  });
});

describe('Profile ecosystem — atmosphere is resolved only inside V2Background, never re-derived locally', () => {
  it.each(SCREEN_FILES)('%s has no screen-local useWeather()/resolveAtmosphere() call (V2Background owns that)', (file) => {
    const src = readScreen(file);
    // Each screen mounts <V2Background/>, which internally reads the coarse,
    // cached weather fetch and the pure resolveAtmosphere() mapping — a
    // screen-local call here would mean a second, redundant resolution
    // instead of delegating to the shared component.
    expect(src).not.toMatch(/\buseWeather\(/);
    expect(src).not.toMatch(/\bresolveAtmosphere\(/);
  });

  it.each(SCREEN_FILES)('%s never passes Math.random anywhere (no ad-hoc reseeding logic)', (file) => {
    const src = readScreen(file);
    expect(src).not.toMatch(/Math\.random/);
  });
});

describe('Profile ecosystem — GlassSurface content cards no longer smother the background', () => {
  it.each(SCREEN_FILES)('%s: every <GlassSurface> call site explicitly sets tintColor (no bare 0.82-default cards)', (file) => {
    const src = readScreen(file);
    const openTags = src.match(/<GlassSurface\b[\s\S]*?>/g) ?? [];
    // Sanity check the extraction itself found real call sites — an empty
    // match here would mean the regex silently stopped guarding anything.
    expect(openTags.length).toBeGreaterThan(0);
    for (const tag of openTags) {
      expect(tag).toMatch(/tintColor=/);
    }
  });
});
