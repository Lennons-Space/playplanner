// =============================================================================
// scripts/enrich/web/bookingUrlPolicy.ts
//
// Enrichment 2.1 — Phase D7: the venue-IDENTITY-aware decision for booking_url.
//
// WHY THIS IS NOT JUST ANOTHER CONFIDENCE THRESHOLD (the whole reason this
// file exists rather than an entry in FIELD_THRESHOLDS): a booking link is an
// outbound link a parent will click and may pay through. The generic
// confidence model scores "how sure are we we extracted this correctly" — it
// has no way to express "and does this link actually belong to THIS venue".
// A perfectly-extracted link to the wrong operator's booking system would
// score highly and be completely wrong in the way that matters most.
//
// So booking_url stays OUT of autoApplyPolicy.ts's generic auto-apply path
// (it remains in NEVER_AUTO_APPLY there, in lockstep with migration 059's SQL
// which also still blocks it) and is decided here instead, on identity:
//
//   auto_apply  the booking host IS the venue's own website host (equal, or
//               one a subdomain of the other) over an EMPTY current value.
//   exception   plausible but unverifiable by us — most commonly a legitimate
//               third-party booking host (bookwhen/eventbrite/...), or a venue
//               with no website on file to check against. A human decides.
//   ignore      nothing to do, or something we will never publish unattended
//               (already set, not https, unparseable).
//
// Absence of a website on the venue record is NEVER treated as permission —
// it routes to exception, never to auto_apply.
//
// Mirrored by migration 060 Section F's auto_apply_booking_url, which
// re-checks every rule here server-side. As everywhere else in this pipeline,
// this module is a pre-flight filter and the DB is the trust boundary.
//
// No I/O, deterministic, no '@/' path alias.
// =============================================================================

export type BookingUrlAction = 'auto_apply' | 'exception' | 'ignore';

export interface BookingUrlPolicyInput {
  /** The extracted candidate booking URL (htmlExtract.ts's booking_url WebField). */
  proposedUrl: string | null;
  /** The venue's own website, as currently recorded. The identity anchor — null means identity cannot be checked. */
  venueWebsite: string | null;
  /** The venue's current booking_url. Anything non-empty means "already set" — never overwritten by automation. */
  currentBookingUrl: string | null;
}

export interface BookingUrlPolicyResult {
  action: BookingUrlAction;
  reason: string;
  /** The host compared for identity, when one could be parsed — surfaced in the exception queue so a human sees what we saw. */
  proposedHost: string | null;
  venueHost: string | null;
}

/**
 * Host extraction mirroring migration 060's enrichment_url_host EXACTLY,
 * including its two refusals:
 *   - a host containing '@' returns null, so userinfo tricks
 *     (https://real-venue.co.uk@evil.example/) can never be read as the
 *     venue's own host;
 *   - anything that isn't a plain [scheme://]host[/...] shape returns null.
 * A leading "www." is stripped so www.venue.co.uk and venue.co.uk match.
 */
export function urlHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^(?:https?:\/\/)?([^/?#]+)/i.exec(raw.trim());
  const host = m?.[1]?.toLowerCase();
  if (!host || host.includes('@')) return null;
  return host.replace(/^www\./, '');
}

/** Equal, or one a subdomain of the other (book.venue.co.uk vs venue.co.uk). Never a substring match — `notvenue.co.uk` must not match `venue.co.uk`. */
export function hostsShareIdentity(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export function decideBookingUrl(input: BookingUrlPolicyInput): BookingUrlPolicyResult {
  const proposedHost = urlHost(input.proposedUrl);
  const venueHost = urlHost(input.venueWebsite);

  if (!input.proposedUrl || !input.proposedUrl.trim()) {
    return { action: 'ignore', reason: 'no booking URL extracted', proposedHost, venueHost };
  }
  if (input.currentBookingUrl && input.currentBookingUrl.trim()) {
    return { action: 'ignore', reason: 'venue already has a booking_url — automation never overwrites one', proposedHost, venueHost };
  }
  if (!/^https:\/\//i.test(input.proposedUrl.trim())) {
    // http:// included deliberately: we will not publish a non-TLS link that a
    // parent may enter payment details into.
    return { action: 'ignore', reason: 'booking URL is not https — never published', proposedHost, venueHost };
  }
  if (!proposedHost) {
    return { action: 'ignore', reason: 'booking URL host could not be parsed safely', proposedHost, venueHost };
  }
  if (!venueHost) {
    return {
      action: 'exception',
      reason: 'venue has no usable website on file, so this link cannot be tied to the venue — needs human review (absence of a website is never treated as permission)',
      proposedHost,
      venueHost,
    };
  }
  if (!hostsShareIdentity(proposedHost, venueHost)) {
    return {
      action: 'exception',
      reason: `booking host "${proposedHost}" is not the venue's own host "${venueHost}" — likely a third-party booking provider; legitimate, but a human confirms it, automation never does`,
      proposedHost,
      venueHost,
    };
  }
  return {
    action: 'auto_apply',
    reason: `booking host "${proposedHost}" matches the venue's own website host "${venueHost}", and no booking_url is currently set`,
    proposedHost,
    venueHost,
  };
}
