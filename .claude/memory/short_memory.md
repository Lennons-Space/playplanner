---
name: Short Memory
description: Quick catch-up file — last session snapshot, completed items, and immediate next action
type: project
---

## Session: 2026-04-10 (continued)

---

## App Status

**NativeWind is now working.** The Welcome screen renders with full styling — coral title, sand background, emoji hero, white card bullets, mint privacy strip. App confirmed running on phone via Expo Go.

**Fix that made NativeWind work:**
`babel.config.js` must use `jsxImportSource` option, NOT a plugin:
```js
presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }]],
```
After any babel.config.js change: `npx expo start --clear` (cache must be cleared).

---

## What Was Completed This Session

### NativeWind fix
- `babel.config.js` — added `jsxImportSource: 'nativewind'` to babel-preset-expo options
- This is the correct approach for NativeWind v4. The `plugins: ['nativewind/babel']` approach is v2 only and will crash.

### Welcome screen redesign (`app/(auth)/welcome.tsx`)
- Full redesign by Ui-agent: sand bg, coral heading, emoji hero with colour blobs, white card bullets, mint privacy strip ("location off by default"), legal footer with Terms/Privacy links
- Google OAuth button removed (commented out — not yet wired)
- Accessibility labels on all interactive elements
- ICO Children's Code Standards 4, 7, 10 compliant

### Folder restructure (archivist plan implemented)
New structure:
- `hooks/location/useLocation.ts` — moved from `hooks/useLocation.ts` (DELETED)
- `hooks/location/index.ts` — re-exports useLocation
- `services/audit/gdprAuditLog.ts` — centralised GDPR audit log writer (`writeAuditLog()`)
- `services/location/coordinates.ts` — `roundCoordinate`, `coarsenCoordinates`, `isValidCoordinate`
- `components/consent/LocationConsentPrompt.tsx` — pre-permission consent UI (NOT YET WIRED)
- `components/consent/index.ts`
- Import paths updated: `app/(tabs)/index.tsx` and `app/(tabs)/search.tsx` now import from `@/hooks/location`
- `register.tsx` now uses `writeAuditLog()` instead of inline insert

### Compliance fix — coordinate rounding
`hooks/location/useLocation.ts` now calls `coarsenCoordinates()` before storing coords in state.
Coordinates are rounded to 3 decimal places (~111m) — GDPR Art.5(1)(c) data minimisation.
Raw GPS precision (7+ decimals) never leaves the device.

### Auth logic hardening (elite-engineer)
**`app/(auth)/login.tsx`** — full rewrite:
- `EMAIL_REGEX` validation before network call
- `getFriendlyAuthError()` — sanitises Supabase errors, prevents email enumeration
- `handleForgotPassword()` — calls `supabase.auth.resetPasswordForEmail()`, anti-enumeration (always same response)
- `KeyboardAvoidingView` added
- Labels above inputs, mint privacy strip, legal footer

**`app/(auth)/register.tsx`** — full rewrite:
- `EMAIL_REGEX` + password space check + length check
- `getPasswordStrength()` — non-blocking strength hint (Weak/Fair/Good/Strong)
- `submitLocked` useRef — rate-limit guard against double-submission
- `writeAuditLog` wrapped in `try/catch` — audit log failure never crashes registration
- `KeyboardAvoidingView`, sandDark consent card, mint privacy strip

**`hooks/useAuth.ts`:**
- `getSession()` now has `.catch(() => setSession(null))` — prevents splash screen hanging forever on network failure

**`store/authStore.ts`:**
- `fetchProfile` now destructures and logs `error` — silent failures now visible to developers

---

## Critical Issue Still Open — LocationConsentPrompt NOT Wired

🔴 **This is a live ICO Children's Code Standard 10 violation.**

**The problem:** `app/(tabs)/index.tsx` calls `useLocation()` unconditionally. The OS permission dialog appears immediately with no prior explanation.

**What exists:** `components/consent/LocationConsentPrompt.tsx` is built and ready.

**What needs to happen:**
1. In `app/(tabs)/index.tsx`, add state to track whether the user has been shown the consent prompt
2. Show `LocationConsentPrompt` first; only call `useLocation()` after user taps "Allow location"
3. Persist the choice using `AsyncStorage` so the prompt only appears once (not on every app open)
4. If user taps "Not now", show the map with fallback (London) location — no permission requested

**Fix in next session — this is priority #1.**

---

## What Needs to Be Done Next

**Priority order for next session:**

1. 🔴 **Wire LocationConsentPrompt into map screen** (`app/(tabs)/index.tsx`)
   - Add `AsyncStorage` persistence so prompt only shows once
   - "Not now" → use fallback location, no OS dialog
   - "Allow" → trigger useLocation() → OS dialog → consent logged

2. **Style and test the Login + Register screens on device**
   - Both screens are fully rewritten — check they look good on phone
   - Test: wrong password → friendly error shown
   - Test: "Forgot password?" → alert appears
   - Test: double-tap Create account → only one network call
   - Test: tick Terms checkbox → Create account button works

3. **Build the Map screen** (`app/(tabs)/index.tsx`)
   - Currently has placeholder UI
   - Needs VenuePin components, filter bar, loading state
   - LocationConsentPrompt must be wired first (item 1 above)

4. **Build VenueCard and VenuePin components**
   - `components/venue/VenueCard.tsx`
   - `components/map/VenuePin.tsx`

5. **Consent withdrawal UI** (Settings screen)
   - `recordLocationConsentWithdrawn()` exists in `services/consent/locationConsent.ts`
   - Needs a Settings screen with "Revoke location access" button
   - GDPR Art.7(3) requirement — must be as easy to withdraw as to give

---

## Still To Build (unchanged from previous session)

- `components/reviews/ReviewForm.tsx` and `ReviewCard.tsx`
- `components/search/FilterSheet.tsx`
- `app/business/upgrade.tsx` — Stripe subscription flow
- Venue photo upload
- Geocoding (postcode → lat/lng via Google Geocoding API)
- Opening hours input in add venue form
- Facilities selector in add venue form
- Stripe webhooks (Edge Function for subscription events)
- Push notifications
- Social login (Google OAuth)
- Business claim listing flow
- Admin analytics view
- GDPR data subject request workflow (`services/privacy/dataSubjectRequest.ts`)
- App Store / Play Store setup (EAS Build)

---

## Key Files Reference

| File | Purpose |
|---|---|
| `app/(auth)/welcome.tsx` | Welcome screen — ✅ done, styled |
| `app/(auth)/login.tsx` | Login — ✅ done, styled + hardened |
| `app/(auth)/register.tsx` | Register — ✅ done, styled + hardened |
| `app/(tabs)/index.tsx` | Map screen — needs LocationConsentPrompt wired |
| `hooks/location/useLocation.ts` | Location hook (coord rounding applied) |
| `services/consent/locationConsent.ts` | recordLocationConsentGranted/Withdrawn |
| `services/audit/gdprAuditLog.ts` | writeAuditLog() — centralised GDPR audit writer |
| `services/location/coordinates.ts` | coarsenCoordinates, isValidCoordinate |
| `components/consent/LocationConsentPrompt.tsx` | Built but NOT yet wired |
| `constants/location.ts` | FALLBACK_LOCATION, MAX_SEARCH_RADIUS_KM, LOCATION_CONSENT_VERSION |

---

## Agents Available (`.claude/agents/`)
- `ui-agent.md` — screen design, ICO-compliant UX
- `main-coder.md` — architecture, implementation
- `secom-reviewer.md` — security + GDPR/ICO review
- `agent-arch.md` — system architecture planning
- `elite-engineer.md` — production-quality code implementation
