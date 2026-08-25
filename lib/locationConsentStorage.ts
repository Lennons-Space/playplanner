// ─────────────────────────────────────────────────────────────────────────
// Account-scoped storage for PlayPlanner's APP-LEVEL location consent (PP-018).
//
// WHY THIS MODULE EXISTS
// Consent used to live under ONE device-global SecureStore key
// (`location_consent_granted`) holding a bare sentinel value (`'1'`). A bare
// sentinel carries no evidence of WHO granted it, and the key carried no
// identity either — so every account on the device read the same flag and
// Account A's consent silently became Account B's.
//
// GDPR Art.7 requires consent to be attributable to a specific data subject,
// and the ICO Children's Code (Standard 10) requires geolocation to be off by
// default. Inheriting another account's consent breaks both: PlayPlanner would
// use precise location for someone who never agreed to it.
//
// The fix mirrors the PP-017 precedent in app/profile/data-download.tsx: the
// key is per-account AND the stored record names its own owner. Two independent
// defences, because a device account-confusion episode can land a value under
// the wrong key — the record itself must still be able to disown it.
//
// DELIBERATELY DEPENDENCY-LIGHT: no Supabase, no React, no expo-secure-store.
// hooks/useResolvedWeather.ts is mounted by every <V2Background/> instance on
// nearly every screen and must be able to read consent without transitively
// pulling in the Supabase-backed audit-log write path. Pure functions only —
// callers own the I/O.
// ─────────────────────────────────────────────────────────────────────────

/**
 * The pre-2026-08-25 device-global key. It holds ONE account's decision and was
 * served to every account, so it is deleted on sight rather than migrated:
 * there is no way to know which account wrote it.
 *
 * PRODUCT DECISION (2026-08-25): we do not manufacture consent and we do not
 * infer it from previous location use. The privacy-safe failure mode is that a
 * user is asked once more the next time location is genuinely required — never
 * that PlayPlanner acts on a consent nobody can be shown to have given.
 */
export const LEGACY_GLOBAL_LOCATION_CONSENT_KEY = 'location_consent_granted';

/**
 * SecureStore keys allow alphanumerics, '.', '-' and '_', so a UUID appends
 * safely. Distinct prefix from the legacy key so the two can never collide.
 */
const KEY_PREFIX = 'playplanner.location_consent';

/** Per-account SecureStore key for this account's location-consent record. */
export function locationConsentKey(userId: string): string {
  return `${KEY_PREFIX}.${userId}`;
}

/** The two decisions an account can actually have made. */
export type LocationConsentDecision = 'granted' | 'declined';

/**
 * The stored record — the DECISION, plus the account it belongs to, plus the
 * consent wording version that account actually saw (GDPR Art.7: consent is
 * specific and informed, so it does not survive a material wording change).
 *
 * TRI-STATE (product ruling, 2026-08-25). Declines are now persisted, so the
 * model is unknown / granted / declined rather than "granted, or ask again".
 * B declining then returning must still be declined — re-prompting on every
 * new session is nagging, and ICO Standard 7 treats that as a dark pattern.
 * Absence of a record means UNKNOWN, which is the only state that prompts.
 *
 * A declined account is not a dead end: the decision is changeable from
 * Privacy & data (app/profile/privacy-settings.tsx), which is the GDPR Art.7(3)
 * "as easy to withdraw as to give" surface in both directions.
 */
export interface LocationConsentRecord {
  userId: string;
  decision: LocationConsentDecision;
  decidedAt: string;
  consentVersion: string;
}

/**
 * Parse a stored value, returning the record ONLY if it positively identifies
 * itself as belonging to `userId`. Null means "unusable" — the caller deletes
 * it and treats the account as undecided.
 *
 * Rejects, in order: absent values; non-JSON (a bare legacy sentinel, which is
 * unattributable by definition); records naming a different account; and
 * structurally malformed records. Failing closed is mandatory here — the unsafe
 * direction is honouring a consent that cannot be proven.
 */
export function parseLocationConsentRecord(
  raw: string | null,
  userId: string,
): LocationConsentRecord | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as LocationConsentRecord).userId === userId &&
      ((parsed as LocationConsentRecord).decision === 'granted' ||
        (parsed as LocationConsentRecord).decision === 'declined') &&
      typeof (parsed as LocationConsentRecord).decidedAt === 'string' &&
      typeof (parsed as LocationConsentRecord).consentVersion === 'string'
    ) {
      return parsed as LocationConsentRecord;
    }
  } catch {
    // Not JSON at all — a bare legacy sentinel. Unattributable by definition.
  }
  // Also lands here for a record with no/invalid `decision` — including the
  // short-lived pre-tri-state dev shape ({userId, grantedAt, consentVersion}).
  // Discarding it costs one re-prompt; honouring an unparseable decision could
  // silently grant. Fail closed.
  return null;
}

/** Serialise a self-identifying decision record for `userId`. */
export function buildLocationConsentRecord(
  userId: string,
  consentVersion: string,
  decision: LocationConsentDecision = 'granted',
  decidedAt: string = new Date().toISOString(),
): string {
  return JSON.stringify({
    userId,
    decision,
    decidedAt,
    consentVersion,
  } satisfies LocationConsentRecord);
}
