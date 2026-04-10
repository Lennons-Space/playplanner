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

## What Needs to Be Done Next

**Start of next session — pick up here:**
1. Fix NativeWind styling (app renders but unstyled — colours/layout not applying)
2. Implement folder restructure (archivist's proposal above)
3. Fix critical: log location consent to `location_consent_log` after permission granted
4. Fix critical: restrict `children_ages` column — audit all profile queries
5. Fix low: `children_ages` type in `types/index.ts` (`number[]` → `string[]`)

**Still to build (components not yet created):**
- `components/reviews/ReviewForm.tsx` and `ReviewCard.tsx`
- `components/search/FilterSheet.tsx`
- `components/map/VenuePin.tsx`
- `components/venue/VenueCard.tsx`
- `app/business/upgrade.tsx` — Stripe subscription flow
- Venue photo upload
- Geocoding (postcode → lat/lng via Google Geocoding API)
- Opening hours input in add venue form
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
