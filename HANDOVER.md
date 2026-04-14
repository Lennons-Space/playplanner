# PlayPlanner — Claude Handover Document
**Date:** 2026-04-14  
**Status:** Phase 3 complete. OSM import pipeline built. Critical bugs found by review team — must fix before running the import or shipping the report feature.

---

## What this app is

PlayPlanner is a UK React Native + Expo family venue discovery app. Parents open the app, see a map of nearby children's venues (soft play, farms, restaurants, parks, attractions), save favourites, write reviews, and upload photos. Businesses pay for premium/featured placement. It is subject to UK GDPR, ICO Children's Code, and PECR — privacy and safety are non-negotiable.

**Stack:** React Native + Expo SDK 54, Supabase (Postgres + PostGIS + Storage), Zustand, TanStack React Query v5, NativeWind v4 (Tailwind), Expo Router v3, Jest.

---

## Current state

- App runs on device via Expo Go. Full discovery flow works end to end.
- **342 / 342 tests passing. Type-check clean. Lint clean.**
- Migrations 001–012 applied to live Supabase. Migrations 013, 014, 015 are written but NOT yet applied — 014 has a critical bug that must be fixed before running.

---

## What was built (this session)

### App features built
| Feature | Files | Status |
|---|---|---|
| Admin Reviews moderation tab | `app/admin/moderation.tsx`, `hooks/useReviews.ts` | ✅ Live |
| Admin bulk approve by data_source | `app/admin/moderation.tsx` | ✅ Live |
| FilterSheet — Facilities + Featured Only filters | `components/filters/FilterSheet.tsx`, `hooks/useVenues.ts` | ✅ Live |
| Default radius 10km → 32km (20 miles) | `types/index.ts`, `constants/location.ts`, `FilterSheet.tsx`, `app/(tabs)/index.tsx` | ✅ Live |
| Filter chips now show miles | `FilterSheet.tsx` DISTANCE_OPTIONS | ✅ Live |
| Map zoom expanded to 20-mile view | `app/(tabs)/index.tsx` latitudeDelta 0.05→0.35 | ✅ Live |
| "Report an issue" button on venue detail | `app/venue/[id].tsx`, `hooks/useVenueReport.ts` | ✅ Built (has bugs — see below) |
| GDPR Art.13 rejection notes in My Reviews | `app/profile/my-reviews.tsx` | ✅ Live |

### Import pipeline built (`scripts/import/`)
| Script | What it does |
|---|---|
| `01_fetch_osm.js` | Queries Overpass API across 110 UK grid cells (1°×1°), checkpointed, London subdivision |
| `02_transform_osm.js` | Maps OSM tags → PlayPlanner venue schema, ODbL attribution |
| `03_deduplicate.js` | Fuse.js fuzzy dedup within postcode groups |
| `04_geocode.js` | postcodes.io bulk endpoint — fills missing lat/lng |
| `05_insert.js` | Supabase upsert on osm_id, batch 500, service role key |

### Migrations written (not all run)
| Migration | Status |
|---|---|
| `013_radius_and_osm_id.sql` — osm_id column, RPC cap 50→80km | ⚠️ NOT RUN — has C2 bug |
| `014_venue_reports.sql` — venue_reports table + RLS | ⚠️ NOT RUN — has C1 bug |
| `015_venue_reports_index.sql` — index on venue_reports(reported_by, venue_id) | ⚠️ NOT RUN |

---

## STOP — Fix these before doing anything else

Three code review agents (multi-agent-review + performance-engineer) identified critical bugs. Fix in this order:

---

### C1 — CRITICAL: RLS rate-limit on `venue_reports` is completely broken

**File:** `supabase/migrations/014_venue_reports.sql`, lines 35–44

**What's wrong:** The INSERT WITH CHECK policy uses a self-referential subquery. In an INSERT context, `venue_reports.venue_id` refers to the table alias, not the NEW row. The 3-per-venue cap is **never enforced**. Anyone can spam unlimited reports against any venue.

**Fix:** Before running migration 014, drop and recreate the policy:

```sql
-- In 014 or a new migration, replace the policy:
DROP POLICY IF EXISTS "Users can report venues" ON venue_reports;
CREATE POLICY "Users can report venues" ON venue_reports
  FOR INSERT WITH CHECK (
    auth.uid() = reported_by
    AND (
      SELECT COUNT(*) FROM venue_reports vr
      WHERE vr.venue_id    = venue_reports.venue_id
        AND vr.reported_by = auth.uid()
    ) < 3
  );
```

---

### C2 — CRITICAL: `osm_id` UNIQUE constraint is wrong for NULLs

**File:** `supabase/migrations/013_radius_and_osm_id.sql`

**What's wrong:** Plain `UNIQUE` on `osm_id` means two NULL values behave unpredictably (Postgres treats each NULL as distinct, so multiple NULLs insert fine — but PostgREST upsert behaviour with NULL conflict keys is undefined). Re-running the import may create duplicate venues.

**Fix:** Replace plain UNIQUE with a partial unique index (add to migration 013 or create 016):

```sql
ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_osm_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS venues_osm_id_unique
  ON venues (osm_id) WHERE osm_id IS NOT NULL;
```

---

### C3 — CRITICAL: UK grid excludes Northern Ireland

**File:** `scripts/import/01_fetch_osm.js` — find `LNG_START` and `LAT_START` constants near the top.

**What's wrong:** Grid starts at `lng = -8.0` but NI's western coast reaches `-8.2`. NI gets zero venues.

**Fix:** Change to:
```js
const LAT_START = 49.0;  // covers Channel Islands + Isles of Scilly
const LNG_START = -8.7;  // covers NI western edge + St Kilda
```

---

### CM1 — LEGAL: ODbL attribution missing from app

**What's wrong:** OpenStreetMap data requires visible in-app attribution under ODbL 1.0 §4.3. OSMF actively enforces this. Shipping without it is a licence breach.

**Fix — three places:**

1. `app/venue/[id].tsx` — below the address section, add:
```tsx
{(venue as any).data_source === 'osm' && (
  <Text className="text-grey text-xs mt-1">
    © OpenStreetMap contributors (ODbL)
  </Text>
)}
```

2. `app/(tabs)/index.tsx` — small persistent credit in a corner of the map view.

3. App About / Privacy screen — full attribution line.

---

## High priority bugs (fix before shipping the report button)

| Bug | File | Fix |
|---|---|---|
| **H1** — No user DELETE on venue_reports (GDPR Art.17 gap) | `014_venue_reports.sql` | Add `FOR DELETE USING (auth.uid() = reported_by AND resolved = false)` |
| **H2** — notes field not redacted on account deletion (GDPR Art.17) | DB trigger needed | Trigger to NULL notes when reported_by is deleted |
| **H3** — No length cap on notes (DoS + admin XSS risk) | `014_venue_reports.sql` + `hooks/useVenueReport.ts` | `CHECK (length(notes) <= 2000)` + client trim |
| **H4** — OSM names/descriptions unsanitised (control chars, long strings) | `scripts/import/02_transform_osm.js` | Add `sanitise(s, maxLen)` function, apply to name (200) and description (2000) |
| **H5** — Report button no pending state (double-tap = duplicate reports) | `app/venue/[id].tsx` | Add `disabled={reportVenue.isPending}` to the report TouchableOpacity |
| **H6** — Falsy check `if (lat && lng)` rejects lat=0 or lng=0 (Greenwich meridian) | `scripts/import/04_geocode.js` | Use `lat != null && lng != null` |

---

## What to do after the fixes

Once critical bugs are fixed and migrations 013/014/015 are run:

### 1. Run the import pipeline (first run: one city to validate)
```bash
# Install dependencies first (from project root):
npm install fuse.js dotenv --legacy-peer-deps

# Create scripts/.env from scripts/.env.example and fill in SERVICE key (not anon key)

# Run in order:
node scripts/import/01_fetch_osm.js    # ~6 min for full UK
node scripts/import/02_transform_osm.js
node scripts/import/03_deduplicate.js
node scripts/import/04_geocode.js
node scripts/import/05_insert.js
```
Start with a small bounding box test (one city) by temporarily setting tight `LAT_START/END` and `LNG_START/END` values. Check the moderation queue in the admin panel after the insert script runs — venues arrive as `pending`, never published automatically.

### 2. Write missing tests
The test engineer hit a rate limit. These tests are not written:
- `scripts/import/__tests__/02_transform_osm.test.js` — unit tests for OSM element transformation
- `scripts/import/__tests__/03_deduplicate.test.js` — deduplication logic
- `hooks/__tests__/useVenueReport.test.ts` — mutation + error handling

### 3. Build the business claiming flow
This is the most important remaining monetisation feature. When a business finds their imported listing, they click "Is this your venue?" → verify by domain-matched email → gain edit access to their listing → upsell to premium placement. The `claimed_by` FK already exists on venues. The `is_business_owner` flag and `business/upgrade.tsx` screen already exist.

### 4. Update the DPIA
Importing childcare/kindergarten venues (`amenity=childcare`) into a children's app requires a DPIA update. These venues should be flagged for manual-only review and should not surface to child account types.

### 5. Verify `is_admin()` function
The `venue_reports` admin policy relies on `is_admin()`. Verify in the Supabase SQL editor that:
- Function is `SECURITY DEFINER`
- It reads from `profiles.is_admin` which no user-facing UPDATE policy allows users to set
- There is no privilege escalation path

---

## Key file map

```
app/
  (auth)/welcome.tsx          — ICO-compliant welcome
  (auth)/login.tsx            — email auth
  (auth)/register.tsx         — rate-limited registration + audit log
  (tabs)/index.tsx            — Map screen, 20mi radius, consent gate
  (tabs)/search.tsx           — Text search + FilterSheet
  (tabs)/favourites.tsx       — Saved venues
  (tabs)/profile.tsx          — Settings, GDPR controls, business menu
  venue/[id].tsx              — Venue detail (photos, reviews, report button)
  venue/[id]/review.tsx       — Write review screen
  venue/add.tsx               — Submit new venue (Google Places autocomplete)
  admin/moderation.tsx        — Venues/Photos/Reviews tabs + bulk approve
  profile/
    edit.tsx                  — Edit profile + avatar
    privacy-settings.tsx      — Location, visibility, consent, data rights
    my-reviews.tsx            — GDPR Art.17 delete + rejection notes shown
    my-venues.tsx             — Submitted venues + moderation badges
    data-download.tsx         — GDPR Art.15 full data export

components/
  filters/FilterSheet.tsx     — Categories, price, age, distance(miles), facilities, premium
  venue/VenuePhotoUpload.tsx  — EXIF-stripped photo upload
  consent/LocationConsentPrompt.tsx — ICO Standard 10 compliant

hooks/
  useAuth.ts                  — auth state
  useVenues.ts                — useNearbyVenues (RPC), useVenue, useVenueSearch
  useReviews.ts               — useVenueReviews, useSubmitReview, useModerateReview
  useVenuePhotos.ts           — upload + moderation
  useDataRights.ts            — GDPR Art.15/17 hooks
  useVenueReport.ts           — report submission (has H5 bug)

store/
  authStore.ts                — session + profile
  filterStore.ts              — filters (miles displayed, km stored)

services/
  consent/locationConsent.ts
  audit/gdprAuditLog.ts

scripts/import/               — OSM pipeline (standalone Node.js, NOT part of app)
  01_fetch_osm.js             — has C3 bug (NI coverage)
  02_transform_osm.js
  03_deduplicate.js
  04_geocode.js               — has H6 bug (falsy lat/lng check)
  05_insert.js
  README.md

supabase/migrations/
  013_radius_and_osm_id.sql   — has C2 bug; NOT run
  014_venue_reports.sql       — has C1 bug; NOT run
  015_venue_reports_index.sql — NOT run
```

---

## GDPR / compliance status

| Requirement | Status |
|---|---|
| ICO Children's Code Std 9: private by default | ✅ show_in_search defaults FALSE |
| ICO Children's Code Std 10: location off by default | ✅ LocationConsentPrompt gated |
| GDPR Art.5(1)(c): data minimisation | ✅ coord rounding, explicit selects, no user ID in storage paths |
| GDPR Art.5(2): accountability audit trail | ✅ gdpr_audit_log, moderated_by fields |
| GDPR Art.7(3): consent withdrawal | ✅ instant, no friction |
| GDPR Art.13: transparency on rejection | ✅ rejection notes shown in My Reviews |
| GDPR Art.15: right of access | ✅ data-download.tsx full JSON export |
| GDPR Art.17: right to erasure | ✅ review + account deletion; ⚠️ venue_reports notes NOT redacted (H2) |
| UK PECR: marketing consent | ✅ defaults FALSE |
| EXIF/GPS strip on photo upload | ✅ before bytes leave device |
| ODbL attribution for OSM data | ❌ NOT YET IN APP — legal requirement (CM1) |
| DPIA for venue photo upload | ⚠️ documented needed but not written |
| DPIA for childcare venue import | ⚠️ needed before running import |

---

## Running the project

```bash
# Install (from root, always use --legacy-peer-deps due to Expo/React 19 conflict)
npm install --legacy-peer-deps

# Start dev server
npx expo start --clear

# Type check
npx tsc --noEmit

# Tests
npx jest --passWithNoTests --ci

# Lint
npx expo lint
```

The app connects to a live Supabase project. Credentials are in `.env` (not committed). Ask the developer for the `.env` values.

---

## Gotchas worth knowing

- **UK longitude is negative** — e.g. Manchester is `-2.24`. If you seed a venue and it appears in the North Sea, the longitude sign is wrong.
- **PostgREST FK ambiguity** — After migration 011 added `moderated_by` FK to profiles, all queries joining `reviews → public_profiles` must use `profile:public_profiles!reviews_user_id_fkey(...)`. Already fixed in `hooks/useReviews.ts`.
- **Venue visibility** — a venue must have BOTH `is_published = true` AND `moderation_status = 'approved'` to appear on the map. The admin bulk approve sets both.
- **act() warnings in tests** — pre-existing noise from React Query async timers. Not a real problem, ignore them.
- **Stripe Deno lint errors** — the Stripe webhook is an Edge Function (Deno). Its ESM imports fail ESLint but are correct. Ignore.
- **Filter store: distances stored in km, displayed in miles** — `DEFAULT_FILTERS.maxDistanceKm = 32` (20 miles). The FilterSheet converts for display only. Do not change to store miles.
