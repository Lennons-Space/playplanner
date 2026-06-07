# PlayPlanner — Launch-Readiness Checklist

_Audit date: 2026-06-07. Audited against the live codebase (not the older memory
to-do list, which was stale). Status key: ✅ done · ⚠️ gap, fix before submission ·
🔴 blocker (legal/store-rejection risk)._

The app is much further along than the memory notes implied. Data export, privacy
settings, consent withdrawal, GDPR audit logging, Stripe webhook (with signature
verification), and EAS build config all already exist. 1321 tests pass.

---

## ✅ Already in place

**GDPR data-subject rights**
- Right to erasure (Art.17) — `delete_own_account()` RPC + client photo cleanup
  (commit `fd253e2`). ⚠️ migration `051` not yet applied to prod (see blockers).
- Right of access / portability (Art.15/20) — `app/profile/data-download.tsx`,
  `hooks/useDataRights.ts`, tested.
- Right to withdraw consent (Art.7(3)) — `app/profile/privacy-settings.tsx`.
- Location consent capture + logging — `services/consent/locationConsent.ts`,
  `location_consent_log` table (3-yr retention).
- GDPR audit log (Art.5(2)) — `services/audit/gdprAuditLog.ts`, no-PII test enforced.
- `marketing_consent` defaults `false` (opt-in only). ✅

**Legal docs**
- Privacy policy + Terms: in-app screens (`app/(auth)/privacy.tsx`, `terms.tsx`)
  and hosted (`docs/privacy.html`, `docs/terms.html`); `privacyPolicyUrl` wired in
  `app.json`.

**Payments**
- Stripe webhook with signature verification (`supabase/functions/stripe-webhook`).
- Checkout + plans edge functions present.

**Store config**
- `app.json`: bundle ids (`com.playplanner.app`), version 1.0.0, iOS privacy
  usage strings, `ITSAppUsesNonExemptEncryption: false`, EAS projectId, support URL.
- `eas.json`: development / preview / production build profiles.

**Privacy-positive**
- No analytics / tracking SDKs (no Sentry/Amplitude/Mixpanel/etc.) detected.
- RLS-everywhere schema; secrets in env, not committed.

---

## 🔴 Blockers (resolve before public launch)

1. **Migration 051 not applied to production DB.** Right-to-erasure is still broken
   in prod (FK violations block deletion for any user who submitted a venue /
   reported a review / uploaded a photo) until it runs. _Owner: apply via Supabase
   MCP when ready (user is gating this)._

2. **No DPIA document exists.** CLAUDE.md and ICO require a Data Protection Impact
   Assessment for high-risk processing — this app has BOTH triggers (children's
   data + geolocation). Must be written and dated before processing at scale.

3. ✅ **FIXED (2026-06-07).** Android `RECORD_AUDIO`. Root cause: the `expo-image-picker`
   config plugin auto-injects `RECORD_AUDIO` at prebuild unless `microphonePermission: false`
   (see `node_modules/expo-image-picker/plugin/build/withImagePicker.js` lines 10-11/34-35) —
   so removing it from the `permissions` array alone is ineffective. Fixed properly by setting
   `microphonePermission: false` on the plugin (also adds it to blockedPermissions). Verified
   the picker is `mediaTypes: ['images']`, library-only — no audio/video capture anywhere.

4. ✅ **FIXED (2026-06-07).** iOS "Always" location removed — `NSLocationAlwaysUsageDescription`
   dropped and the expo-location plugin switched to `locationWhenInUsePermission` with
   `isAndroidBackgroundLocationEnabled`/`isIosBackgroundLocationEnabled: false`. App is
   when-in-use only. _Takes effect on next native build._

## ⚠️ Gaps (fix before store submission)

5. ✅ **FIXED (2026-06-07).** Android `READ/WRITE_EXTERNAL_STORAGE` removed from `app.json`
   (deprecated on Android 13+, unneeded with the photo picker).

5b. ✅ **FIXED (2026-06-07).** `CAMERA` permission was requested but never used (no
   `launchCameraAsync` anywhere — uploads use `launchImageLibraryAsync` only). Removed:
   Android `CAMERA` from the array, iOS `NSCameraUsageDescription` from infoPlist, and set
   `cameraPermission: false` on the `expo-image-picker` plugin so it stays blocked at prebuild.
   _If a "take a photo of the venue" feature is added later, re-enable by setting
   `cameraPermission` back to a usage string._

6. **`eas.json` submit credentials are placeholders** — `appleId`,
   `ascAppId`, `appleTeamId` are `YOUR_...`. Fill before `eas submit`.

7. **No age affirmation at registration.** App is for parents (adults), but there's
   no "18+ / for parents" affirmation or documented age-assurance rationale. ICO
   Children's Code expects an age-assurance decision to be recorded.

8. **Store privacy disclosures not authored** — Play Data Safety form + App Store
   privacy nutrition labels. Data to declare: email, coarse/fine location, photos,
   children's age ranges, payment (via Stripe).

9. **Apple account-deletion URL** — in-app deletion exists ✅; Apple also wants a
   publicly reachable deletion instruction page. Verify the support site documents it.

---

## Suggested order of attack
Quick, high-value, low-risk first: **3 → 4 → 5** (permission minimisation — also the
strongest compliance wins), then **2** (DPIA doc), then **6–9** (submission paperwork),
with **1** gated on the user. Each permission change needs a rebuild to take effect.
