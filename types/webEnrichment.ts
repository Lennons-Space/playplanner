// =============================================================================
// types/webEnrichment.ts
//
// Shared types for the Website Enrichment system (WEBSITE_ENRICHMENT_SPEC.md v2).
// Phase 1 = the PURE, offline foundation. These types are consumed by the pure
// modules in scripts/enrich/web/* and (later) the DB/fetch layers.
//
// IMPORTANT: relative imports only — NO '@/' path alias. These run outside the
// Expo app bundle (tsx / jest in node), where the alias is not configured.
// =============================================================================

// ── Field & provenance vocabulary ────────────────────────────────────────────

/** The venue fields this system can propose values for. */
export type WebField =
  | 'description'
  | 'price_range'
  | 'website'
  | 'booking_url'
  | 'phone'
  | 'email'
  | 'opening_hours';

/** How a candidate value was extracted (highest → lowest base confidence). */
export type ExtractionMethod = 'jsonld' | 'microdata' | 'meta' | 'heuristic';

/** Confidence band. Advisory only — never triggers auto-apply (MVP rule). */
export type Confidence = 'low' | 'medium' | 'high';

/** The four price buckets on venues.price_range. */
export type PriceBand = 'free' | 'budget' | 'moderate' | 'premium';

// ── Extraction output ─────────────────────────────────────────────────────────

/**
 * A single extracted candidate, value still in its native shape (string for
 * scalars, OpeningWeek for opening_hours). Evidence is already trimmed, capped
 * and PII-scrubbed by the extractor before it reaches here.
 */
export interface FieldCandidate<T = unknown> {
  field: WebField;
  value: T;
  sourceUrl: string;
  evidenceSnippet: string; // exact supporting text (≤512, PII-scrubbed)
  evidenceRaw?: string; // pre-normalisation text (e.g. raw OSM-style hours string)
  method: ExtractionMethod;
  /** opening_hours only: parser issues (split_hours, seasonal, …) → drives the confidence cap. */
  openingIssues?: string[];
}

/** htmlExtract output for one page: 0..n candidates, never throws on missing data. */
export interface ExtractedCandidates {
  candidates: FieldCandidate[];
}

// ── Opening hours (structured) ────────────────────────────────────────────────

export interface HourInterval {
  opens: string; // 'HH:MM'
  closes: string; // 'HH:MM' ('24:00' allowed for end-of-day)
}

export interface DayHours {
  day_of_week: number; // 0=Sun … 6=Sat (matches the opening_hours table)
  is_closed: boolean;
  intervals: HourInterval[]; // [] when closed/unknown
}

export interface OpeningWeek {
  days: DayHours[]; // ALWAYS exactly 7 entries when a parse succeeds
  seasonal_notes: string | null; // 'term-time only', 'closed January', exceptions
  source_text: string; // original raw string as found
}

export interface OpeningParseResult {
  ok: boolean;
  week?: OpeningWeek;
  issues: string[]; // 'split_hours','seasonal','assumed_closed_days','unparseable',…
}

// ── Current-value snapshot (fetched by the orchestrator, passed to pure code) ──

/**
 * The venue's CURRENT live values, fetched once by the (impure) orchestrator and
 * passed into the pure proposals module so it never does I/O (arch #7). Hashing
 * for the stale-guard is the DB's job (snapshot_current_value RPC) — this snapshot
 * is for conflict detection and reviewer display only.
 */
export interface CurrentVenueSnapshot {
  description: string | null;
  price_range: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  opening_hours: DayHours[]; // all rows currently stored for this venue
}

// ── Proposal draft (pure output of proposals.ts) ──────────────────────────────

/**
 * What proposals.ts emits per accepted candidate. This is the pre-DB shape: the
 * run_id / id / status / review columns are added by the (later) propose_field
 * RPC, not by the pure layer.
 */
export interface ProposalDraft {
  field: WebField;
  proposed_value: unknown; // { v: scalar } or an OpeningWeek
  current_value: unknown; // snapshot of the existing value (for the reviewer diff)
  source_url: string;
  evidence_snippet: string;
  evidence_raw: string | null;
  retrieved_at: string; // ISO8601 — injected for determinism
  extraction_method: ExtractionMethod;
  confidence: Confidence;
  conflicts_existing: boolean;
}

// ── Fetch layer types (Phase 2 — defined here so the boundary is explicit) ────

export interface PageFetch {
  url: string;
  httpStatus: number;
  contentSha256: string;
  bytes: number;
  fetchedAt: string;
}

export type FetchSkipKind =
  | 'skipped_no_website'
  | 'skipped_invalid_url'
  | 'skipped_robots'
  | 'skipped_redirect_offdomain'
  | 'skipped_non_html'
  | 'skipped_too_large'
  | 'skipped_bot_protected'
  | 'fetch_failed';

export type FetchOutcome =
  | { kind: 'extracted'; pages: PageFetch[]; htmlByUrl: Record<string, string> }
  | { kind: FetchSkipKind; pages: PageFetch[]; note?: string };

/** A single fetched page (webClient.fetch result). */
export interface FetchedPage {
  finalUrl: string; // after redirects
  html: string;
  page: PageFetch;
  fromCache: boolean;
}

/** Result of fetching ONE URL — either the page, or a typed skip/fail with a note. */
export type WebFetchResult =
  | { kind: 'ok'; page: FetchedPage }
  | { kind: FetchSkipKind; note?: string };
