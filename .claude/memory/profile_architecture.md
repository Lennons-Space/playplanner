# Profile Screen Architecture — Decisions & Build Plan

Session: 2026-04-12
Tasks completed: agent-arch (architecture), Ui-agent (UI design), secom-reviewer (security audit)

---

## Routes

| Route | Status | Purpose |
|---|---|---|
| `app/(tabs)/profile.tsx` | Exists — needs updates | Self-profile hub, menu |
| `app/profile/edit.tsx` | To build (Phase 2) | Edit name, username, bio, avatar, postcode |
| `app/profile/privacy-settings.tsx` | To build (Phase 3) | Consent withdrawal, visibility controls |
| `app/profile/children-ages.tsx` | To build (Phase 3) | Manage age ranges — private, own user only |
| `app/profile/data-download.tsx` | To build (Phase 4) | GDPR Art.15 data export trigger |
| `app/profile/[id].tsx` | To build (Phase 5) | Public read-only profile (safe columns only) |

---

## Critical Database Change Required Before Building (Phase 1)

### Migration 003 — create before building any profile screens

File: `supabase/migrations/003_public_profiles_view.sql`

Must contain:
1. `public_profiles` VIEW — exposes only: id, username, full_name, avatar_url, bio, is_business_owner
   - Grants SELECT to `authenticated` only
   - Revokes all from `anon`
   - Excludes: is_admin, children_ages, stripe_customer_id, subscription_tier, subscription_expires_at, marketing_consent, terms_accepted_at
2. `postcode text` column added to profiles table

---

## Security Findings (secom-reviewer, 2026-04-12)

| Severity | Issue | Fix |
|---|---|---|
| CRITICAL | No public_profiles view — column-level exposure of children_ages and is_admin possible | Create view (migration 003) |
| HIGH | is_admin fetchable for other users via raw profiles query | Fixed by public_profiles view |
| MEDIUM | Delete account flow — no error fallback after signOut() failure | try/catch/finally in profile.tsx |
| MEDIUM | children_ages in store with no exposure guard | Dedicated private hook (Phase 3) |
| LOW | postcode column does not exist on profiles | Add in migration 003 |
| LOW | useIsAdmin() has no display-only warning | Add comment |
| LOW | fetchProfile error uses console.error | Structured logger in production |

---

## Edit Profile Fields

Editable: full_name, username (unique), avatar_url (Supabase Storage), bio (max 200 chars), postcode
Not editable via this form: email (Auth flow), password (Auth flow), is_admin (server only), subscription_tier (Stripe)

---

## Privacy Settings Screen Sections

1. Location consent — toggle + withdrawal + consent history link
2. Children's ages — privacy notice + link to children-ages screen
3. Profile visibility — "show in search" toggle (default: OFF), "show reviews" toggle (default: ON)
4. Email preferences — marketing_consent toggle
5. GDPR rights — Download my data + Delete my account

---

## Children's Ages Design Rules

- Own user only — auth-gated route
- Stored as text ranges: '0-2', '3-5', '6-8', '9-11', '12-14', '15-17' (never exact ages or DOBs)
- Privacy notice always visible at top of screen
- Can remove all ages (sets to null)
- Never appears in public_profiles view
- Never appears on any other user's visible profile

---

## Public Profile Screen Rules

- Queries public_profiles VIEW — never the profiles table directly
- Hook: usePublicProfile(id) in hooks/useProfile.ts
- Shows: avatar, name, username, bio, is_business_owner badge, approved reviews
- Never shows: children_ages, is_admin, subscription, email, postcode, location, consent data

---

## Hooks to Create

`hooks/useProfile.ts` (new file):
- useUpdateProfile() — mutation for edit profile form
- usePublicProfile(id) — React Query fetch from public_profiles view
- useUpdateChildrenAges() — mutation for children-ages screen (private, own user only)
- useWithdrawLocationConsent() — calls locationConsent service

---

## Build Order Summary

Phase 1: Migration 003 (database safety — do first)
Phase 2: Edit profile screen
Phase 3: Privacy settings + children's ages screens
Phase 4: GDPR data download (Edge Function + trigger screen)
Phase 5: Public profile view screen

---

## Developer's Privacy Requirement (non-negotiable)

"The profile tab should not really contain any sensitive information apart from your approximate location. It makes zero sense to be able to know where someone lives at that exact point — maybe a postcode and that's it."

Implemented as:
- Postcode field only (no GPS, no map, no coordinates) on edit profile
- Postcode is NOT shown on the public profile screen
- Postcode is NOT in the public_profiles view
- children_ages never shown publicly
- All location data stays in the venue discovery layer, never on user profiles
