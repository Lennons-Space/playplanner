# Location Data-Minimisation Review — PlayPlanner

**Status:** DRAFT — **OWNER/LEGAL REVIEW REQUIRED** for the overall document; the specific
`ACCESS_FINE_LOCATION` permission change below **HAS been implemented** (2026-09-01, Privacy-Critical
Engineering Remediation Pass) on the strength of code analysis and new simulated-coarse-input unit tests
— **a real-device confirmation is still required before this is treated as fully closed.** See the
updated §"Technical recommendation" and the new §"Real-device test procedure" at the bottom of this
document.
**Date:** 2026-09-01 · Built from direct inspection of `app.json`, `hooks/location/useLocation.ts`,
`constants/location.ts`, and `services/consent/locationConsent.ts` this session (a fresh repo-inventory
fork re-verified these paths independently of any prior session's notes).

---

## Why `ACCESS_FINE_LOCATION` is declared

`app.json:39-42` declares both `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION`. The permission
request itself (`hooks/location/useLocation.ts:46`, `Location.requestForegroundPermissionsAsync()`) is
Expo's standard foreground request, which on Android maps to whatever permissions are declared in the
manifest — so declaring `ACCESS_FINE_LOCATION` makes the **OS-level permission prompt itself** ask for
precise location, regardless of what the app does with the result afterwards.

**No current feature genuinely requires GPS-grade precision.** The one consumer of location —
nearby-venue search via PostGIS distance queries — needs enough accuracy to rank venues within a
reasonable radius (hundreds of metres to a few kilometres), not room-level precision.

## What accuracy actually reaches application code

Confirmed directly (`hooks/location/useLocation.ts:68`): `Location.getCurrentPositionAsync({ accuracy:
Location.Accuracy.Balanced, maximumAge: 30_000 })`. **`Balanced`, not `High`/`Highest`** — the app already
requests a lower accuracy tier than the declared permission would allow. The result is then further
**coarsened to 3 decimal places (~111m)** via `coarsenCoordinates()` before being held in React state
(`useLocation.ts:81`, `services/location/coordinates.ts`).

## What accuracy reaches Supabase/other networks

**None of it, as raw coordinates.** Coordinates are never written to the database (confirmed repeatedly
across sessions and re-confirmed by this session's fresh repo-inventory fork) — they exist only in
in-memory React state for the duration of a map session, used to parameterise a PostGIS nearby-venues
query. `location_consent_log` records the **fact and timing of consent**, never the coordinates
themselves.

## Is anything stored? Is anything logged?

**Not stored.** Not logged either: this session's fresh grep for any `console.log`/similar call
containing `coords`/`latitude`/`longitude` in the shipped app found matches only in
`hooks/useLocationConsent.ts` and `services/consent/locationConsent.ts`, and every one logs a static
error string plus the caught error object — never an interpolated coordinate value. The only files that
log raw lat/long anywhere in the repo are offline import/enrichment CLI scripts operating on **venue**
coordinates (business data), not user location.

## Could PlayPlanner function with approximate location only?

**Yes, functionally.** A coarse/approximate location (the Android Data-Safety-form category, ≥3km²) is
more than sufficient to rank "nearby venues" for a discovery app where users are choosing where to *go*,
not being tracked *while* somewhere. The app already behaviourally coarsens to ~111m after the fact — the
gap is that the **permission declared and requested is stricter than what the app ends up using**.

## "We round it later" — explicitly not accepted as sufficient justification

Per Liam's explicit instruction, this review does **not** treat post-hoc coarsening as justification for
requesting more precision than necessary at collection time. **Data minimisation and privacy-by-design
(UK GDPR Art.5(1)(c), Art.25) apply to the collection decision itself, not only to what is retained
afterward.** Requesting `ACCESS_FINE_LOCATION` and then discarding the precision is better than requesting
it and keeping it, but it is not the same as never requesting it — the OS-level prompt itself still asks
the user to grant more than the app needs, and a coarse-only Android permission (`ACCESS_COARSE_LOCATION`
alone) would trigger a **less alarming, more proportionate OS permission dialog**, which is itself a
UX-and-trust-relevant privacy-by-design outcome, not just a paperwork one.

## What UX impact would removing FINE have?

Requesting `ACCESS_COARSE_LOCATION` only would still let Android's location services return a position —
Android's coarse permission still permits `Balanced`-tier accuracy in practice on modern Android versions
(coarse location on current Android typically resolves to a random point within ~1-2km of the true
location, refreshed periodically) — which is **already coarser than what the app currently requests and
then discards down to anyway** (~111m). The practical UX risk is narrow: on some older Android versions or
some device/OS combinations, coarse-only location can be slower to acquire a first fix or slightly less
reliable in dense urban areas — this needs a real device test, not an assumption, before committing to
the change (see recommendation below).

## Interaction with the Children's Code geolocation standard

As discussed in `CHILDRENS_CODE_SCOPE_ASSESSMENT.md` §6, geolocation is already off-by-default and
consent-gated for everyone, which substantively satisfies the Code's geolocation standard's *outcome*.
**Removing `ACCESS_FINE_LOCATION` would strengthen this further and specifically**, since it is a direct,
named data-minimisation control on the geolocation standard's own subject matter, not a general privacy
default that happens to help — worth stating in the Children's Code document as a concrete, prioritised
follow-up rather than leaving location minimisation as a separate, disconnected item.

---

## Technical recommendation

**`REMOVE FINE — COARSE SUFFICIENT` — IMPLEMENTED 2026-09-01**, with a real-device confirmation still
outstanding (see below).

**Reasoning:** the app already behaviourally treats location as coarse (Balanced accuracy, further rounded
to ~111m); no feature reads or needs GPS-grade precision; the "round it later" pattern is explicitly not
an adequate substitute for minimising at collection; and the change directly strengthens both the general
UK GDPR data-minimisation position and the Children's Code geolocation standard specifically.

**What was actually done this pass:**
- `app.json`'s Android `permissions` array no longer declares `android.permission.ACCESS_FINE_LOCATION` —
  only `ACCESS_COARSE_LOCATION` remains. No other location-related config changed (no background
  permission added, no accuracy request raised elsewhere to compensate — both explicitly forbidden by the
  brief for this change, and neither was touched).
- `hooks/location/useLocation.ts` itself is **unchanged** — it still requests `Location.Accuracy.Balanced`
  and still coarsens to 3dp. The permission change does not require any change to how the app *asks* for
  a position; it only changes what the OS is allowed to grant.
- New tests added (`hooks/__tests__/useLocation.test.ts`, "coarse-permission-only input" suite, 2 new
  tests, both green) using the app's REAL `coarsenCoordinates`/`isValidCoordinate` implementations (not
  mocked passthroughs) fed a deliberately jittered position (~1.5km offset, representative of what
  Android's coarse mode is documented to return) — proving the app's own pipeline has no special-case
  coupling to GPS-grade input and produces a valid, usable, non-fallback location either way.

**What this does NOT prove, and why a real device is still required:** the tests above prove the APP'S
tolerance for degraded input — they do not and cannot prove what a real Android device actually returns
once only `ACCESS_COARSE_LOCATION` is declared (jitter amount, refresh cadence, acquisition latency, any
device/OEM-specific variation). **Do not treat this as a device-UX PASS — it isn't one.** The exact
real-device procedure is below; it must be run before this change is considered fully verified for
release, even though the code and config change is already made.

## Real-device test procedure (for Liam — this cannot be automated from this session)

Build and install the app (with `ACCESS_FINE_LOCATION` now removed) on a real Android device, and:

1. **Explore nearby venues** — open the Home tab / Explore, grant location permission when prompted
   (confirm the OS dialog itself no longer offers a "precise" toggle, only the coarse grant), and check
   that a reasonable set of nearby venues appears, roughly correctly ordered by distance.
2. **Map centring** — open the map screen and confirm it centres on approximately your real location
   (city/neighbourhood-level correctness is the bar — not street-level).
3. **Distance labels** — check a few venue cards' displayed distances against your actual rough distance
   from them (walking/driving them if practical, or comparing against a maps app) — they should be
   plausible, not wildly wrong.
4. **Search relevance** — run a search and confirm results are still sensibly local, not returning venues
   from a different city/region.
5. **Fallback behaviour** — deny location permission entirely (or test on a fresh install) and confirm the
   app falls back gracefully to the existing non-landmark fallback location, with no crash and no infinite
   loading state.
6. **Permission decline** — decline the OS prompt specifically (not just skip it) and repeat step 5's
   check.
7. **Approximate-only permission specifically** — on Android 12+, when the OS permission dialog appears,
   there may still be a device-level "Precise/Approximate" choice shown even though the app only declares
   coarse — confirm what the dialog actually looks like now (it should not offer a precise option at all
   if the manifest permission is genuinely gone; if it still does, that's a build/config issue worth
   reporting back, not something to route around here) and select whatever coarse-only option is offered.
8. **Repeat steps 1-4 after a device restart / cold app start** to rule out any caching artefact from a
   single warm session.

**Report back:** whether nearby-venue discovery still feels "good enough" for the product's actual
purpose (finding somewhere to go — not turn-by-turn navigation), and whether the OS permission dialog's
wording/options changed in the way expected. If venue discovery feels meaningfully worse, that is real
evidence this document doesn't have yet, and the recommendation should be revisited — this is exactly the
kind of finding that should override a code-level analysis.

**Not implemented in this pass, per instructions** — this is a recommendation for a future, explicitly
scoped engineering change (remove `ACCESS_FINE_LOCATION` from `app.json`, verify Android coarse-location
behaviour on-device, confirm no regression in nearby-venue search quality), not something this
documentation-only pass carries out.
