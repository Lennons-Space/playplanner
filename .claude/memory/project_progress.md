---
name: Project Progress
description: Current state, decisions made, and what needs to happen next for Play Planner
type: project
---

## Decisions Made

**Tech stack confirmed:**
- React Native + Expo SDK 51 + Expo Router v3 (file-based routing)
- Supabase (auth, database, storage, realtime) — NOT Firebase
- NativeWind v4 (Tailwind CSS for React Native)
- Zustand for state, TanStack Query for data fetching
- Stripe for payments
- Expo Notifications for push notifications
- Font: Nunito (must be downloaded and placed in assets/fonts/)

**Why:** Expo is the best choice for a first-time developer — it handles iOS/Android complexity, has great docs, and doesn't require native build tools to get started.

## What's Been Built (2026-04-08)

Foundation files created:
- `package.json` — all dependencies listed
- `app.json` — Expo config with permissions for location, camera, photos
- `tsconfig.json`, `tailwind.config.js`, `.gitignore`, `.env.example`
- `supabase/migrations/001_initial_schema.sql` — full Postgres schema with RLS, triggers, PostGIS
- `supabase/migrations/002_rpc_get_nearby_venues.sql` — PostGIS stored function for map queries
- `supabase/seed.sql` — 12 categories, 20 facilities
- `types/index.ts` — all TypeScript interfaces
- `lib/supabase.ts`, `lib/stripe.ts`
- `constants/theme.ts` — brand colours, fonts, spacing
- `store/authStore.ts`, `store/filterStore.ts`
- `hooks/useAuth.ts`, `hooks/useLocation.ts`, `hooks/useVenues.ts`
- `app/_layout.tsx` — root layout wiring Stripe, QueryClient, auth listener
- `app/(auth)/` — welcome, login, register screens
- `app/(tabs)/` — explore (map), search, favourites, profile tabs
- `app/venue/[id].tsx` — full venue detail screen
- `app/venue/add.tsx` — user venue submission form
- `app/business/dashboard.tsx` — business owner dashboard
- `app/admin/moderation.tsx` — admin approve/reject screen

## Session: 2026-04-09

### What happened this session
- Ran `/init` — CLAUDE.md updated: filled in real commands from `package.json`, removed placeholder text and stale "update this file" note at the bottom.
- Three custom agents created via `/agents` and saved to `C:\Users\Liame\.claude-work\agents\`:
  - `ux-wireframe-designer` — designs screens, wireframes, and user flows; checks ICO Children's Code compliance in every design
  - `fullstack-architect` — architectural guidance, folder structure, data flows, security-first implementation plans
  - `security-compliance-reviewer` — post-code-change reviews across security, UK/EU compliance, completeness, performance, and best practices
- Agent memory bootstrapped for all three agents at `C:\Users\Liame\.claude-work\agent-memory\<agent-name>\`:
  - `user_profile.md` — first-time developer profile
  - `project_playplanner.md` — PlayPlanner context tailored to each agent's focus
  - `MEMORY.md` — index file

### Real commands (confirmed from package.json)
- `npm test` — run tests in watch mode
- `npm run test:ci` — run tests non-interactively (for CI)
- `npm run lint` — check for code style errors
- `npm run lint:fix` — auto-fix code style errors
- `npm run type-check` — check TypeScript types (no output files)
- `npx expo start` — start the dev server (add `--android`/`--ios`/`--web` to target a platform)

## Tools & MCP Setup

**Context7 MCP (2026-04-08):**
- Added to local project config via: `claude mcp add --transport stdio context7 -- npx -y @upstash/context7-mcp@latest`
- Config file: `C:\Users\Liame\.claude.json` (project: D:\PlayPlanner)
- Provides up-to-date library docs (Expo, Supabase, React Native, etc.) inside Claude Code
- After adding, Claude Code must be fully restarted for the MCP to appear under `/mcp`
- If `/mcp` still shows nothing after restart, run `claude doctor` to diagnose
- **Status check (2026-04-08):** `/mcp` showed "No MCP servers configured" — may need to be re-added or Claude Code restarted again

## Session: 2026-04-09 (continued)

### MCP Server Setup
- **context7**: Connected and working
- **Figma MCP**: Abandoned — requires Figma desktop app + Dev Mode (paid feature). Removed.
- **Supabase MCP**: Added (`https://mcp.supabase.com/mcp?project_ref=iftiyxwacptsyachgdus`) but shows "Needs authentication". OAuth flow not triggering from CLI. Next step: restart Claude Code and try using a Supabase tool in conversation to trigger OAuth browser popup.
- **Root issue**: All HTTP MCP servers require OAuth. CLI `claude mcp get` doesn't trigger browser. Browser itself works (`start` opens Chrome). OAuth may only trigger when tool is first used in a conversation.
- **Key rule saved**: Always check if a tool/feature requires payment before suggesting it.

## Session: 2026-04-09 (Schema Review & Fix)

### What SUCCEEDED
- **Full security + GDPR review** of `001_initial_schema.sql` completed (two passes: secom-reviewer agent + manual)
- **Schema fully rewritten and patched** — file is at `D:\PlayPlanner\supabase\migrations\001_initial_schema.sql` (831 lines)
- All critical issues fixed:
  - Moderation bypass closed: venues/reviews/photos now enforce `pending`/`false` on insert via RLS `WITH CHECK`
  - `children_ages` changed from `int[]` to `text[]` (age ranges, not exact ages — ICO data minimisation)
  - `SECURITY DEFINER` functions (`handle_new_user`, `is_admin`) now have locked `search_path`
  - Fake GDPR consent removed — `terms_accepted_at` no longer auto-set by trigger
  - Photos default to `is_approved = false` (not auto-approved)
  - Reviews default to `moderation_status = 'pending'` (not auto-approved)
  - RLS enabled on ALL tables including `categories` and `facilities`
  - All 8 tables that had RLS but no policies now have full working policies
  - Admin bypass policies added for venues, reviews, photos
  - Right to erasure: profile DELETE policy added
  - `gdpr_audit_log` table added (GDPR Art.5(2) accountability)
  - `location_consent_log` table added (GDPR Art.7 + ICO Standard 10)
  - `min_age <= max_age` constraint added
  - 4 missing indexes added
  - `business_subscriptions` updated_at trigger added

### What FAILED / Still Pending
- **Schema NOT yet run in Supabase** — this is the immediate next step
- **Supabase MCP auth** — still unresolved (OAuth not triggering). Not blocking.
- **Profile column exposure** — RLS can't restrict columns, only rows. `stripe_customer_id`, `is_admin`, `children_ages` etc. are visible to any authenticated user who queries another user's profile row. Fix is app-level: only ever select safe columns (`id, username, full_name, avatar_url, bio, is_business_owner`) when loading other users. Documented in schema comment block at bottom of file.
- **`terms_accepted_at` app fix** — `register.tsx` must explicitly set this when user ticks "I accept." Not done yet.

### Known limitation to fix later
- A `public_profiles` VIEW should be created to formally restrict which columns are visible to other users. Deferred to later phase.

## Session: 2026-04-10 — App Running

### What was completed this session

**Infrastructure — all done:**
- ✅ SQL migrations run in Supabase: `001_initial_schema.sql`, `002_rpc_get_nearby_venues.sql`, `seed.sql`
- ✅ Node.js installed
- ✅ `npm install` completed (`--legacy-peer-deps` required due to SDK version conflicts)
- ✅ Nunito fonts downloaded → `assets/fonts/`
- ✅ Google Maps API key obtained and added to `.env`
- ✅ `.env` file created with Supabase URL, anon key, and Google Maps keys
- ✅ Expo account logged in via SSO (`npx expo login --sso`)

**SDK upgrade — Expo SDK 51 → SDK 54:**
- ✅ Upgraded expo to `~54.0.33` (Expo Go on phone was SDK 54, project was SDK 51)
- ✅ Updated all package versions to SDK 54 compatible versions
- ✅ Updated devDependencies (`@types/react`, `eslint-config-expo`, `jest-expo`)
- ✅ Clean reinstall with `--legacy-peer-deps`

**New files created:**
- ✅ `babel.config.js` — minimal Expo babel config (no reanimated plugin — removed in Reanimated v4)
- ✅ `metro.config.js` — Expo default config + NativeWind v4 wiring
- ✅ `global.css` — Tailwind directives for NativeWind v4
- ✅ `assets/images/` — placeholder PNGs (icon, splash, adaptive-icon, favicon, notification-icon)

**Bug fixes:**
- ✅ `tsconfig.json` — fixed `@/` alias from `./src/*` → `./*` (project has no `src/` folder)
- ✅ `app/_layout.tsx` — added `import '../global.css'` for NativeWind
- ✅ Installed `expo-linking` (missing package required by expo-router v6)
- ✅ Installed `react-native-worklets` (required by Reanimated v4 plugin system)
- ✅ `types/index.ts` — `children_ages` type is `number[]` but DB schema uses `text[]` — **NOT YET FIXED** (deferred)

**App status:**
- ✅ **App is running on phone via Expo Go**
- Welcome screen renders with correct content (title, feature list, buttons)
- NativeWind styling not yet applied — screen renders unstyled (plain text, no layout/colours)

### Agent work completed this session
- **secom-reviewer** — reviewed `babel.config.js` and `package.json`: all clear, no issues
- **Archivist** — full folder structure analysis completed; proposed restructure documented below
- **secom-reviewer** — full compliance audit of codebase structure: 2 critical issues, 3 high, 4 medium, 2 low

## Session: 2026-04-11 — Location & Filtering Compliance Review

### Security & Compliance Review Completed

**Files reviewed (4 files, 1,182 lines total):**
1. `components/filters/FilterSheet.tsx` (684 lines) — category filter panel, fully functional
2. `app/(tabs)/index.tsx` (349 lines) — map screen with consent flow, location centering
3. `hooks/location/useLocation.ts` (86 lines) — location request hook (Accuracy.High change)
4. `app/(tabs)/_layout.tsx` (63 lines) — tab bar with safe area fix

**Review results:**
- ✅ No secrets or hard-coded credentials
- ✅ Consent gate is solid — location never accessed without explicit user agreement
- ✅ Coordinates properly rounded to 111m before storage (GDPR data minimisation)
- ✅ All type checks pass (tsc --noEmit)
- ✅ No lint errors in reviewed files

**Issues found:**

🔴 **CRITICAL (1):**
- Consent migration missing on auth: if user grants location consent pre-signup, it's never migrated to DB on registration/login (GDPR Art.7 violation)

🟡 **MEDIUM (3):**
- Accuracy.High + maximumAge:0 requests excessive GPS precision (should use Balanced + cached reads) — battery drain + data minimisation concern
- LocationConsentPrompt text "never stored" is incomplete (consent events are stored; fix phrasing)
- FilterSheet error message says "Pull to retry" with no retry button

🟢 **LOW (1):**
- useLocation.ts JSDoc misleading (claims it logs consent; it doesn't — parent is responsible)

**Positive patterns identified:**
- animateToRegion only called post-consent ✓
- Decline is session-only, not persisted ✓
- SecureStore for encrypted consent persistence ✓
- VenueMarker memoized for performance ✓
- Profile queries exclude sensitive columns ✓
- RLS correctly scoped ✓

**Compliance summary:**
- UK/EU GDPR: PARTIAL (consent migration missing)
- ICO Children's Code: PASS (with text improvement)
- EDPB guidance: PASS
- DPIA triggers: YES — geolocation and children's data processing

**Next steps (before merge):**
1. Fix consent migration in register.tsx and login.tsx (CRITICAL)
2. Create DPIA document (HIGH — compliance requirement)
3. Change Accuracy.Balanced + cache reads (MEDIUM)
4. Fix LocationConsentPrompt text accuracy (MEDIUM)
5. Clarify useLocation.ts JSDoc (LOW)

---

## Critical Compliance Issues to Fix Next Session

### 🔴 Critical
1. **Location consent never logged** — `useLocation.ts` requests permission but never writes to `location_consent_log` table. GDPR Art.7 violation.
2. **`children_ages` column exposed** — all authenticated users can query any profile and see children's ages. ICO Children's Code violation. Fix: audit all profile queries to only select safe columns (`id, username, full_name, avatar_url, bio, is_business_owner`).

### 🟠 High
3. No consent screen before location permission dialog (ICO Children's Code Standard 10)
4. No consent withdrawal UI (GDPR Art.7(3))
5. Stripe webhook handler doesn't exist (venues stay "premium" after subscription cancels)

### 🟡 Medium
6. All profile queries need auditing — `stripe_customer_id` and `subscription_tier` also exposed to other users
7. No consent history UI (GDPR Art.15)
8. No GDPR data subject request workflow (GDPR Arts.15–22)

### 🟢 Low
9. Minor memory leak in `useLocation.ts` — no AbortController on unmount
10. `children_ages` TypeScript type is `number[]` but DB schema is `text[]` — fix in `types/index.ts`

---

## Proposed Folder Restructure (Archivist — do next session)

Key additions (nothing in `app/` changes — routing untouched):
- `hooks/location/` — move `useLocation.ts` here + add `useLocationConsent.ts`, `useLocationPermission.ts`
- `services/consent/` — reusable consent record/withdraw functions
- `services/location/` — coordinate rounding, spoofing checks, consent logging
- `services/audit/` — single reusable GDPR audit log writer
- `components/consent/` — `ConsentCheckbox.tsx` + `LocationConsentPrompt.tsx`
- `constants/location.ts` — fallback coords, radius limits
- `constants/categories.ts` — missing file listed in CLAUDE.md

Only import change needed: `app/(tabs)/index.tsx` line 9 — update `useLocation` import path.

---

## Session: 2026-04-12 — Profile Screen Architecture & Security Review

### Tasks completed
- Full architectural plan for profile section (6 routes designed, build phases defined)
- Full UI design for all 5 profile screens (self-profile, edit, privacy settings, children's ages, public profile)
- Full security review of profile-related code

### Critical finding from security review
- No `public_profiles` database view exists — children_ages and is_admin are column-accessible to any authenticated user who queries another user's profiles row
- Fix: create `supabase/migrations/003_public_profiles_view.sql` before building any profile screens
- Full details: `.claude/memory/profile_architecture.md`

### Decisions made
- Postcode only on profiles (no GPS, no coordinates) — developer's explicit requirement
- children_ages is private to own user only — never in public_profiles view
- public_profiles view exposes only: id, username, full_name, avatar_url, bio, is_business_owner
- Edit profile fields: full_name, username, avatar_url, bio, postcode
- Privacy settings screen contains: location consent, children's ages link, profile visibility, marketing, GDPR rights
- New file needed: hooks/useProfile.ts (useUpdateProfile, usePublicProfile, useUpdateChildrenAges, useWithdrawLocationConsent)

## Session: 2026-04-12 (evening) — Styling fixed, DCG installed, DB confirmed

### Completed this session

**NativeWind styling FIXED ✅**
- Root cause: `SafeAreaView` from `react-native-safe-area-context` was used with `className` across all screens but was never registered with `cssInterop`. NativeWind v4 requires this for any third-party component.
- Fix: added `cssInterop(SafeAreaView, { className: 'style' })` to `app/_layout.tsx` (lines 3–8)
- Confirmed working on device — app now shows correct colours, layout, cards, fonts.
- NativeWind actual installed version is `4.2.3` (not 4.0.1 — the ^ range resolved higher). Fully compatible with RN 0.81.

**All database migrations confirmed applied ✅**
- Migration 003 (public_profiles view): APPLIED — confirmed via SQL query. View exposes only: id, username, full_name, avatar_url, bio, is_business_owner, show_reviews_publicly, created_at. Excludes children_ages, is_admin, stripe_customer_id. WHERE show_in_search = true.
- Migration 006 (GDPR audit log policies): APPLIED — 3 policies confirmed: Admins can view all audit logs, Users can log own audit events, Users can view own audit log.
- All 7 migrations/seeds now confirmed applied. Database is complete.

**Destructive Command Guard (DCG) installed ✅**
- Tool: github.com/Dicklesworthstone/destructive_command_guard v0.4.3
- Protects against accidental destructive commands (rm -rf, git reset --hard, git push --force, etc.)
- Wired into Claude Code as a PreToolUse hook via `dcg install`
- Binary at: /c/Users/Liame/.local/bin/dcg
- **Requires Claude Code restart to activate**
- Install required: MSYS2 + mingw-w64-gcc + mingw-w64-binutils (for dlltool.exe and gcc.exe — the install script forces the GNU Rust toolchain because it detects Git Bash as mingw64)

### Known open issues (carried forward)
- £9.99/mo on profile screen vs £2.99 on upgrade screen — decide correct price before launch
- location consent not logged to DB after permission granted (GDPR Art.7 — critical)
- children_ages TypeScript type is number[] but DB uses text[]
- profile.tsx: Alert.alert wrong argument count (line 83)
- LocationConsentPrompt "never stored" wording inaccurate
- app/profile/children-ages.tsx not built (linked from privacy settings)
- hooks/useProfile.ts missing: usePublicProfile, useUpdateChildrenAges, useWithdrawLocationConsent

## Session: 2026-04-13 — Review Flow Hardening (COMPLETE)

### What was completed
- **Review flow confirmed built** — ReviewForm, ReviewCard, review route screen and useReviews hooks were already in place from prior sessions
- **BODY_MAX confirmed at 500** (data minimisation, easier moderation)
- **Migration 009 written and applied** — `supabase/migrations/009_reviews_own_venue_policy.sql`
  - Closes HIGH: INSERT policy blocks own-venue reviews (NOT EXISTS on claimed_by + submitted_by)
  - Closes HIGH: UPDATE policy now has WITH CHECK — prevents editing approved reviews or status-downgrade attacks
- **3 new test files written:**
  - `components/reviews/__tests__/ReviewForm.test.tsx`
  - `components/reviews/__tests__/ReviewCard.test.tsx`
  - `app/venue/[id]/__tests__/review.test.tsx`
- **All mandatory checks PASS:** lint:fix ✓ type-check ✓ test:ci ✓ (254 tests, 22 suites)
- **secom-reviewer: APPROVED TO SHIP** — security, GDPR, ICO Children's Code all signed off

### Outstanding (carry forward)
- Rate limiting on reviews (MEDIUM) — 10/day server-side via migration 010
- DPIA note: if `children_ages` ever added to reviews (currently stubbed []), triggers ICO Children's Code DPIA — must run before activating

## Session: 2026-06-07 — Phase 2B Geoapify Enrichment (DESIGN ONLY, no build)

### What happened
- Phase 2A (OSM enrichment) is complete + validated. OSM-only coverage is weak:
  parent_convenience avg ~0.8, accessibility avg ~4.5, rainy_day avg ~21, 89% low
  confidence, **47% OSM archive-miss**, 0 parent_friendly/accessible/rainy_day/budget tags.
- Designed (NOT built) how Geoapify fills the gaps. Design doc:
  `scripts/enrich/PHASE_2B_GEOAPIFY_DESIGN.md`.

### Key design decisions
- **Critical insight:** Geoapify Places/Place Details is OSM-derived. It is NOT a quality
  multiplier on well-tagged venues. Real value = (1) the 47% archive-miss (Geoapify's live
  DB sees venues our static `osm_archive_20260425` extract doesn't), (2) opening_hours +
  website + phone (OSM archive gives almost none), (3) fresher snapshot.
- **Endpoints:** Geocoding API (matching, gives `rank.confidence`) → Place Details
  (facts). 2 credits/venue. Free tier = 3,000 credits/day shared, 5 rps.
- **Matching:** hard distance gate ≤150m + name_sim ≥0.50 + composite score ≥0.70 = ACCEPT.
  REVIEW band logged not written. Pure, fixture-testable matcher.
- **Merge precedence:** manually_curated > OSM explicit > Geoapify explicit > OSM inference
  > Geoapify inference > null. OSM explicit always wins; Geoapify only fills nulls.
  Accessibility NEVER upgraded over an OSM negative (safety).
- **Safety/limits:** backend-only, key in `scripts/.env` (GEOAPIFY_API_KEY) never client,
  cache raw in `venue_enrichment.raw_geoapify` (already exists) + on-disk fixtures,
  ≤500 credits/day budget, 1.2s spacing, dry-run default, Phase-2A-style --write gates.
- New fields (opening_hours/website/phone) captured in raw_geoapify first; columns added
  only in a LATER migration after the 20-venue dry-run proves value.
- **Recommendation:** qualified YES — build 2B-0→2B-2 (logic + fixtures + 20-venue
  dry-run, ~40 credits) then STOP and review footer stats before scaling.

### Explicitly NOT done (per sprint instruction)
- No implementation, no live Geoapify calls, no scaled OSM write, no app wiring.

## Session: 2026-06-07 (cont.) — Phase 2B-0 BUILT (no-network foundation)

Built the pure, no-network Geoapify foundation. **No live calls, no credits, no
DB writes, no app wiring** — all logic exercised against saved fixtures.

### Files added
- `types/enrichment.ts` — appended Geoapify types (GeoapifyResponse, VenueMatchInput,
  GeoapifyRawBundle [fixture/cache format], MatchResult, AnnotatedFacts + provenance,
  FieldConflict, MergeResult, GeoapifyExtras).
- `scripts/enrich/osmProvenance.ts` — `annotateOsmFacts(tags)`: reuses Phase 2A
  `extractRawFacts`, adds per-field explicit/inferred provenance (no logic duplication).
- `scripts/enrich/geoapifyExtract.ts` — raw GeoJSON feature → annotated facts + extras
  (opening_hours/website/phone/email captured, not yet a column).
- `scripts/enrich/geoapifyMatch.ts` — pure matcher: haversine, name normalise + Dice/
  Levenshtein similarity, composite score, ACCEPT/REVIEW/REJECT gates
  (DISTANCE_GATE_M=150, ACCEPT_SCORE=0.70, REVIEW_SCORE=0.55, NAME_FLOOR=0.50),
  non-family category demotion.
- `scripts/enrich/mergeFacts.ts` — `mergeAnnotatedFacts(osm,geo)`: precedence
  (OSM explicit > Geoapify explicit > OSM inferred > Geoapify inferred > null),
  conflict logging, accessibility guard (Geoapify NEVER overrides a non-null OSM
  wheelchair/baby-change value; fills nulls only), `emptyAnnotatedFacts()`.
- Fixtures: `scripts/enrich/__tests__/fixtures/geoapify/*.json` (+ README documenting the
  raw-response fixture format): willows (accept), wrong-name-same-coords (reject/name),
  far-away-same-name (reject/distance), borderline-review, category-collision (demote),
  no-candidates.
- Tests: geoapifyMatch / geoapifyExtract / mergeFacts test files (56 new tests).

### Checks (all green)
- enrich suite: 189 pass (133 prior + 56 new). Full project: **64 suites, 1251 tests pass.**
- Lint: clean on all new files.
- tsc: **0 new errors** — baseline 31 == after 31 (the 31 are pre-existing app-code
  errors in useVenues/useReviews/authStore/SkeletonLoader/useLocation/profile routes,
  NOT mine). Fixed one self-introduced cast in mergeFacts.ts (RawFacts→Record via unknown).

### NOT done (by instruction) + next
- No geoapifyClient.ts (the HTTP layer) yet — deliberately out of 2B-0 scope.
- NOT committed (user asked not to auto-commit).
- Next = 2B-1: one-time manual Geoapify call for ~5 venues to save REAL fixtures and
  eyeball the matcher, then 2B-2 the 20-venue dry-run. Needs GEOAPIFY_API_KEY in
  scripts/.env (backend only). Suggest delegating the build steps to Main-coder/elite-engineer.

## What Needs to Be Done Next

**Start of next session — pick up here:**
1. Fix location consent logging to DB (GDPR critical — `hooks/location/useLocation.ts`)
2. Fix `children_ages` type in `types/index.ts` (`number[]` → `string[]`)
3. Build `app/profile/children-ages.tsx` (missing screen)
4. Add missing hooks to `hooks/useProfile.ts` (`usePublicProfile`, `useUpdateChildrenAges`, `useWithdrawLocationConsent`)
5. Rate limit on review submissions — migration 010 (MEDIUM)

**Earlier outstanding items:**
1. Implement folder restructure (archivist's proposal in earlier session)

**Still to build:**
- `components/map/VenuePin.tsx`
- `app/business/upgrade.tsx` — Stripe subscription flow
- Venue photo upload (migration 007 applied, VenuePhotoUpload component + moderation tab needed)
- Geocoding (postcode → lat/lng via Google Geocoding API)
- Opening hours input in add venue form
- Facilities selector in add venue form
- Push notifications logic
- Social login (Google OAuth)
- Business claim listing flow
- Admin analytics view
- EAS Build / App Store setup
- GDPR data subject request workflow
- Consent history UI
- Groups/social features
- Facilities selector in add venue form

**Stripe webhooks (needed for subscriptions to work):**
- Supabase Edge Function to handle Stripe webhook events
- Update `venues.is_premium` when subscription goes active/cancelled
- Update `profiles.subscription_tier` when user premium changes

**Not yet started:**
- Push notifications logic
- Social login (Google OAuth)
- Business claim listing flow
- Admin analytics view
- App Store / Play Store setup (EAS Build)
- GDPR data subject request workflow
- Consent history UI
- Groups/social features (schema + UI + moderation)

---

## Session log: 2026-07-08 — Play Planner v2 EXACT Home redesign (`feat/exact-v2-design`)

**THIS IS THE CURRENT FOCUS. Read this before anything above (older sections are stale).**

### Design authority (LOCKED by user decision)
- Target = the **final rendered prototype**: `Play Planner v2.html` + `pp2-home.jsx` (+ sibling `pp2-*.jsx`).
- Authority order: 1) Play Planner v2.html (viewer shell — renders the jsx) 2) pp2-home.jsx 3) screenshots 4) README.
- `screens/01-home-dark.png` + README describe an OLDER iteration (two-line intent cards, age chips, 380px photo featured card) — **do not chase them** where they conflict with the jsx.
- Handoff source: `C:\Users\Liame\Downloads\Handoff\`. Local untracked copy: `D:\PlayPlanner\.design-v2-handoff\` (gitignored — never commit without explicit approval).

### Done this session (P1 Home exactness — ALL UNCOMMITTED)
- Home rewritten to final-jsx order: header (pin icon, 17px area, brand 42) → time-based greeting + weather pill → 38px headline → context-line copy map → **weather CTA card (new)** → search pill with **34×34 filter box INSIDE the pill** → single-line intent rail + **inline Clear** (no section labels) → "Good for today" 22px + **192px EditorialCollectionHero (new — routes to real /discover collections, never a venue)** → consent-gated venue list (22px header + "Near you · updated just now" + 38×38 boxed refresh).
- **Age chips REMOVED from Home** (final jsx has none). AgeChips.tsx + age logic kept in tree for later.
- VenueCard2 rebuilt: 82px thumb, r5 context chip, category dot, single star, "Open till X" (real hours via closesAtText exported from SmartFeaturedCard), closed treatment, 34×34 heart wired to real favourites. NO duration (no honest source), NO price badge (not in final jsx).
- New pure fns in lib/homeIntents: `pickHeroCollection`, `getWeatherCta`, `getHomeContextLine`. Hero mapping: rain family→rainy-day, night hours→hidden-gems "Plan for Tomorrow", snow→hidden-gems "Winter Days Out", intent energy/free/animals→burn-energy/free-days-out/hidden-gems, season fallback.
- Earlier same-day: GlassSurface de-blurred (expo-blur native module NOT in installed dev build — any BlurView mount = instant Android crash; do not reintroduce), dark CategoryPlaceholder variant, tab bar cushion Android 10/iOS 22, dev watermark removed from Home.
- Fonts: app ALREADY loads Bricolage Grotesque + Hanken Grotesk (FontFamily.display/body) — typography matches prototype natively.

### Gates at session end (all green)
- Tests: 98 suites, **1815/1815 pass** (home.test.tsx rewritten, 31 tests).
- TypeScript: **31 errors = pre-existing baseline, zero new** (none in touched files).
- ESLint: clean on touched files.
- Gotcha: `.expo/types/router.d.ts` (generated, gitignored) got corrupted by the running Expo dev server's typegen writing concurrently → if tsc shows ~TS1005/TS1128 parse errors there, trim to the first valid closing braces (head -14 worked) or restart expo; not a real error.

### Rules in force (user-imposed)
- **DO NOT commit or push** — user commits only after visually approving Home on device.
- Do not start Venue Detail / Saved / Map / Profile / Auth until Home is visually accepted.
- No Supabase/enrichment/migration/RPC/backend changes.
- P2 (deferred, do NOT start unprompted): animated weather background, Continue-exploring rail (needs recently-viewed tracking), 8-condition weather-pill colour map, 3-equal-lines filter glyph in Icon.tsx.

### Next session
1. User reviews Home on device (expo start was running; reload). If accepted → user commits → move to Venue Detail using `.design-v2-handoff/pp2-venue.jsx` (same authority order).
2. If not accepted → fix against the actual screenshot; the handoff files are local so compare precisely.

---

## Session log: 2026-07-09 — Home visual-review fix round 1 (`feat/exact-v2-design`, still ALL UNCOMMITTED)

User reviewed Home on device: v2 direction confirmed but NOT accepted. 3 blockers reported + fixes applied:

1. **Search pill — filter box appeared below the prompt.** Structure was already a
   `flexDirection:'row'` + `flexWrap:'nowrap'` (should be unable to wrap), so the fix makes
   stacking *physically impossible*: pill is now `minHeight:62`, prompt row (icon + 1-line text,
   `home-search-pill-row`) reserves `paddingRight: 14+34+11`, and the 34×34 filter box is
   **absolutely pinned** inside the pill (`home-filter-anchor`: top:0/bottom:0/right:14,
   justifyContent:center). Font-scale cap 1.3 on the prompt.
2. **EditorialCollectionHero overlap/crush.** Root cause found: on a 360dp phone the title column
   is ~178px (prototype web frame = 390px), so "Plan for Tomorrow" truncated to "Plan for Tomo…";
   the absolutely-positioned badge could collide at large Android font scales. Fix: badge moved
   into NORMAL FLOW (content wrapper `flex:1, justifyContent:'space-between'`, padding
   16/20/18 — padding on wrapper not Pressable because **Yoga insets absolute children by parent
   padding**, would have shrunk the gradient); title `numberOfLines={2}` (prototype wraps
   naturally); desc 2 lines; `maxFontSizeMultiplier={1.2}` on all card text (fixed 192px card).
3. **Tab bar covering "Family favourites" / "Near you · updated just now".** Bottom clearance now
   defensive: `Math.max(useBottomTabBarHeight(), 72 + insets.bottom) + 48` (was tabBarHeight+28).
4. Intent rail verified against pp2-home.jsx — labels/emoji/order/spacing already exact; untouched.

Files: `app/(tabs)/index.tsx`, `components/home/EditorialCollectionHero.tsx`,
`app/(tabs)/__tests__/home.test.tsx` (padding + pill-structure tests updated to lock new invariants).

Gates: 98 suites / **1815 pass** (34 focused Home+tabs pass), tsc **31 = baseline, 0 new**, ESLint clean.
No commit/push, no Supabase/enrichment/migrations, consent gating untouched (only HomeResults calls useLocation()).

**Next:** user re-reviews Home on device → if accepted, user commits → Venue Detail (pp2-venue.jsx).

---

## Session log: 2026-07-09 — Home visual-review fix round 2 (`feat/exact-v2-design`, still ALL UNCOMMITTED)

### 🔑 ROOT CAUSE FOUND (explains BOTH review rounds)
User's screenshot (d:\Downloads\1783541891286.jpeg) showed: no search bubble, intent chips as bare
emoji-over-text stacks, weather CTA card unstyled/stacked, hero square-cornered and too tall — while
plain-View rows rendered fine. Pattern: **every broken element was a `Pressable` with a
style-as-FUNCTION; the app's NativeWind 4.0.1 interop (babel `jsxImportSource: 'nativewind'`)
silently DROPS function styles on the device build.** Jest resolves them fine → tests never caught it.
**RULE: static style objects only + `android_ripple` for feedback.** See auto-memory
`nativewind-function-style-bug.md`. ~14 non-Home files still use the pattern (legacy screens) — convert
whenever a screen is reskinned.

### Fixes (round 2)
1. **All function styles removed from the Home surface**: index.tsx (header/CTA/search pill/refresh/
   nudge/clear ×6), EditorialCollectionHero, VenueCard2 (card + heart), PPBrandMark, IntentChips.
   Press feedback = android_ripple(foreground) + overflow hidden.
2. **Search bubble** now actually visible on device (static style: surface #17171F fill + separator
   ring + r-chip + minHeight 62; filter box still absolutely pinned inside right).
3. **IntentChips rebuilt as designed card buttons** (USER OVERRIDE of final-jsx plain emoji pills,
   recorded decision): 38×38 tinted rounded-square emoji tile + label/sub column on a surface card,
   selected = intent-colour ring + tinted fill + selected a11y state; inline Clear card. testIDs
   intent-chip-*/intent-chip-tile-*/intent-clear.
4. **Animated weather background**: new `components/ui/V2WeatherMotion.tsx` mounted inside
   V2Background — sunny pulse+6 bokeh, 14 rain streaks (11° field), 3 mist bands, 12 stars, 12
   snowflakes; transform/opacity only, built on WeatherLayer's useLoop/seededNodes/
   useReducedMotionPref/useAppActive; renders null under reduce-motion/background (static gradients
   = fallback). Full WEATHER_BACKGROUNDS.md particle system still P2.
   `useAppActive` fixed: undefined/'unknown' AppState (cold start, jest) no longer counts as inactive.
5. **Tab bar**: flat rgba(14,14,20,0.82) GlassSurface fill → vertical LinearGradient fade
   (0.40→0.88→0.96) so scrolled content passing beneath stays faintly visible instead of being
   chopped dead; hairline kept; Home bottom clearance unchanged (max(barHeight, 72+inset)+48).

### Tests
New: components/home/__tests__/IntentChips.test.tsx (card container/tile/selected/toggle/clear),
components/ui/__tests__/V2WeatherMotion.test.tsx (per-atmosphere no-crash, decorative, reduce-motion
→ null). Updated: home.test.tsx search-pill test asserts VISIBLE bubble (bg #17171F, border, radius).

### Gates (all green)
**100 suites / 1826 tests pass** (baseline was 98/1815 + 2 new suites), tsc **31 = baseline, 0 new**,
ESLint clean on all touched files. No commit/push, no Supabase/enrichment/migrations; consent gating
untouched.

**Next:** user re-reviews Home on device (round 3). If accepted → user commits → Venue Detail.

---

## Session log: 2026-07-09 — Home fix round 3: vertical rhythm + tab bar weight (still ALL UNCOMMITTED)

User verdict on round 2: search bubble / intent cards / weather CTA / dark v2 / hero concept ACCEPTED
in principle; blockers = lower half (hero + Family favourites under the tab bar; bar too heavy).

### Compression pass (~84px reclaimed vs the bar on a real Android viewport)
- index.tsx paddings: header top 10→6, greeting top 20→14, context margin 8→6, CTA section 16→12,
  CTA card padV 14→11 + tile 44→40, search section 18→12 + pill minHeight 62→56 (11+34+11),
  intent rail top 18→12, Good-for-today top 26→18 + heading marginBottom 13→10, list header
  top 28→22 / bottom 14→12.
- IntentChips card: tile 38→34 (r11), padV 8→7, padL 7/padR 13, radius 15, gap 9 (test updated).
- EditorialCollectionHero: height 192→176 (web frame had ~100px more room than a real phone),
  content padding 16/18→14/16.
- Tab bar (_layout.tsx): content height 50→46, Android cushion 10→6, paddingTop 8→6, gradient
  lightened 0.40/0.88/0.96 → 0.28/0.80/0.92 (icons sit in the ≥0.80 zone). Home clearance formula
  unchanged (max(barHeight, 72+inset)+48 — 72 still a safe over-estimate of 46+22).

### Gates (all green)
100 suites / 1826 tests pass, tsc 31 = baseline (0 new), ESLint clean. No commit/push/backend.

**Next:** user re-reviews Home (round 4). If accepted → user commits → Venue Detail (pp2-venue.jsx).

---

## Session log: 2026-07-09 — Home fix round 4: tab-safe scroll viewport (still ALL UNCOMMITTED)

Round-3 verdict: entire top half ACCEPTED (search bubble, intent cards, weather CTA, hero, dark v2).
Last blocker: content passing beneath / half-hidden behind the tab bar.

### Structural fix (index.tsx)
Padding-only clearance can never stop mid-scroll content passing under an overlay bar, so the
**scroll VIEWPORT now ends above the bar**: `<ScrollView style={{ marginBottom: tabSafeZone }}>`
where `tabSafeZone = Math.max(useBottomTabBarHeight(), 52 + insets.bottom)` (52 = 46 content + 6
Android cushion floor), with `contentContainerStyle={{ paddingBottom: 32 }}` breathing room inside.
Content is clipped above the bar — it is impossible for any text/card to sit or pass beneath it, at
rest or mid-scroll; the bar overlays ONLY the V2Background atmosphere (mounted at screen root,
continues behind the bar), so the glass still reads as glass. "Family favourites" is now either
fully visible above the bar or cleanly below the fold — never half-hidden. Bar opacity/height
unchanged from round 3 (0.28/0.80/0.92 gradient, 46+6+inset).

home.test.tsx: clearance test replaced with tab-safe-zone test (viewport marginBottom =
max(88, 52+34) under the mocks + paddingBottom ≥ 32 spacer).

### Gates (all green)
100 suites / 1826 tests, tsc 31 = baseline (0 new), ESLint clean. No commit/push/backend.

**Next:** user re-reviews Home (round 5 — expected final). If accepted → user commits → Venue Detail.
