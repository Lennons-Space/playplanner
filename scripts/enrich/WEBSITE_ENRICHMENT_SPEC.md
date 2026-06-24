# Venue Website Enrichment — Implementation-Ready Build Specification

> **Status: SPECIFICATION ONLY.** No code, no migration, no website fetch, no DB write.
> This is the document we review (and optionally hand to a specialist) before building.
> Date: 2026-06-22 · **Revision: v2 (post-review)** · Builds on migration 049 + `scripts/enrich/` conventions.
>
> **v2 incorporates a `secom-reviewer` (security/privacy) + `agent-arch` (architecture) pass.**
> Legal basis is now documented in **§16**; every finding's disposition (accepted / rejected /
> deferred) is logged in **§17**; unresolved risks carried into the build are in **§18**. Sections
> changed by the review are marked **⟲v2**.

---

## 0. Scope, in one paragraph

Fetch each pilot venue's **own official website** (the URL already stored in `venues.website`)
and extract candidate values for **opening hours, price band, description, booking link,
contact details (phone/email) and facilities** — as **reviewable proposals**, never direct
writes. Every proposed value carries its **source URL, exact evidence snippet, retrieval
timestamp, extraction method, confidence, and a snapshot of the current value**. A human
reviews a report; an explicit **admin-only RPC** applies approved proposals. The first pilot
is **£0** (no LLM, no paid API), **dry-run by default**, and depends on **nothing from the
paused Geoapify pipeline**.

### Confirmed constraints (from the approval)
1. Pilot only venues where `venues.website IS NOT NULL` **AND** published/approved. No Geoapify.
2. **LLM tier OFF** for the first pilot. Free tiers only (JSON-LD ▸ microdata ▸ meta ▸ heuristics).
3. `booking_url` is captured in proposals but **no `venues.booking_url` column is added yet**.
4. Nothing writes to `venues`/`opening_hours` except the explicit admin apply RPC.
5. Every proposal = source URL + exact snippet + retrieval time + method + confidence + current-value snapshot.
6. All fields human-review-only throughout the MVP. No auto-apply, ever, in this phase.
7. Descriptions: store the site's exact text **as evidence**; the applied description must be an
   **original factual summary**, not copied marketing — so descriptions are review-and-rewrite only.
8. Conflicts with an existing non-null value are flagged and **confidence-capped at `medium`**.
9. Opening hours stored as **structured JSON** in the proposal, **plus** the original raw text and
   any seasonal/exception notes.
10. robots denial, failed fetch, off-domain redirect, oversized body, non-HTML, bot-protection =
    **clean skip outcomes**, never errors to bypass.
11. Raw fetched HTML lives in the **local cache only** — never copied to the database.
12. **No admin UI** initially — a reviewable JSON/CSV/HTML report instead.
13. Dry-run by default; proposal insertion needs an explicit flag; apply is a separate admin RPC.

---

## 1. Data model — parent run + child field proposals (recommended grain)

**Decision: a parent `venue_enrichment_runs` row per fetch attempt, with child
`venue_field_proposals` rows (one per field).** Rationale:

- **Review grain is per-field** (approve the phone, reject the price) → one row per field is correct.
- **Fetch audit is per-run** (robots status, which pages were fetched, HTTP statuses, content
  hashes, skip reason) → storing that once on a parent avoids duplicating it across every field row.
- A run with **zero** extracted fields (e.g. robots-disallowed) still needs a record — the parent
  captures the **clean-skip outcome** with no children.

### 1a. Migration `056_venue_website_enrichment.sql` — proposed shape

```sql
-- =============================================================================
-- 056_venue_website_enrichment.sql
-- Website enrichment: reviewable field proposals + fetch-run audit.
-- NOTHING here writes to venues/opening_hours. Apply is a separate RPC (below).
-- =============================================================================

-- ── Parent: one row per website fetch attempt per venue ──────────────────────
create table venue_enrichment_runs (
  id              uuid primary key default uuid_generate_v4(),
  venue_id        uuid not null references venues(id) on delete cascade,
  run_label       text not null,                 -- batch id, e.g. '2026-06-22T20:00Z-pilot'
  source_website  text,                          -- the venues.website we started from
  outcome         text not null check (outcome in (
                    'extracted',                  -- at least one page parsed
                    'skipped_no_website',
                    'skipped_invalid_url',        -- ⟲v2 SSRF guard: private IP/localhost/non-http(s)
                    'skipped_robots',             -- robots.txt disallowed
                    'skipped_redirect_offdomain', -- final host != registrable domain
                    'skipped_non_html',
                    'skipped_too_large',
                    'skipped_bot_protected',      -- challenge / 403 challenge markers
                    'fetch_failed'                -- timeout / network / 5xx after retries
                  )),
  robots_checked_url text,
  robots_allowed     boolean,
  pages           jsonb not null default '[]',   -- [{url,http_status,content_sha256,bytes,fetched_at}]
  error_note      text,                           -- sanitised; NEVER secrets/PII
  -- ⟲v2 (arch #2): proposals_count column DROPPED. It was a denormalised count with no
  -- trigger keeping it consistent (a crash mid-insert would freeze it, making an incomplete
  -- run indistinguishable from a genuine zero-extraction one). Count on demand instead:
  --   select count(*) from venue_field_proposals where run_id = ?
  created_at      timestamptz not null default now()
);

create index venue_enrichment_runs_venue_idx   on venue_enrichment_runs(venue_id);
create index venue_enrichment_runs_label_idx   on venue_enrichment_runs(run_label);
create index venue_enrichment_runs_outcome_idx on venue_enrichment_runs(outcome);

-- ── Child: one row per (run, field) candidate ────────────────────────────────
create table venue_field_proposals (
  id                 uuid primary key default uuid_generate_v4(),
  run_id             uuid not null references venue_enrichment_runs(id) on delete cascade,
  venue_id           uuid not null references venues(id) on delete cascade, -- denormalised for query/RLS
  field              text not null check (field in (
                       'description','price_range','website','booking_url',
                       'phone','email','opening_hours'
                     )),

  -- Value (uniform jsonb container: scalars wrapped {"v": ...}; opening_hours structured)
  proposed_value     jsonb not null,
  current_value      jsonb,                       -- snapshot of existing venue value at extraction
  current_value_hash text,                        -- sha256 of current_value — stale-apply guard

  -- Evidence (REQUIRED — the whole point)
  source_url         text not null,
  -- ⟲v2 (sec #10): hard length cap; ⟲v2 (sec #1): PII-scrubbed before storage (see §4).
  evidence_snippet   text not null check (length(evidence_snippet) <= 512),
  evidence_raw       text check (evidence_raw is null or length(evidence_raw) <= 2048),
  retrieved_at       timestamptz not null,
  extraction_method  text not null check (extraction_method in (
                       'jsonld','microdata','meta','heuristic'   -- 'llm' deliberately absent in MVP
                     )),
  confidence         text not null check (confidence in ('low','medium','high')),
  conflicts_existing boolean not null default false,

  -- Review lifecycle
  status        text not null default 'pending'
                  check (status in ('pending','approved','rejected','applied','superseded')),
  reviewed_by   uuid references profiles(id),
  reviewed_at   timestamptz,
  review_notes  text,
  applied_at    timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger venue_field_proposals_updated_at
  before update on venue_field_proposals
  for each row execute function touch_updated_at();   -- reuse existing fn (001:323)

create index venue_field_proposals_venue_idx  on venue_field_proposals(venue_id);
create index venue_field_proposals_field_idx  on venue_field_proposals(field);
create index venue_field_proposals_pending_idx
  on venue_field_proposals(status) where status = 'pending';

-- Integrity: at most ONE live pending proposal per (venue, field).
-- A new run supersedes the previous pending one (see §6) rather than duplicating.
create unique index venue_field_proposals_one_pending_idx
  on venue_field_proposals(venue_id, field) where status = 'pending';

-- ── RLS: admin-only (may contain business-contact PII; not public) ───────────
alter table venue_enrichment_runs   enable row level security;
alter table venue_field_proposals   enable row level security;

create policy "runs_admin_all"      on venue_enrichment_runs
  for all using (is_admin()) with check (is_admin());      -- is_admin() = 001:396
create policy "proposals_admin_all" on venue_field_proposals
  for all using (is_admin()) with check (is_admin());
-- The enrichment script uses service_role, which bypasses RLS entirely.
```

### 1b. Why NOT reuse `venue_enrichment.raw_*`

`venue_enrichment` holds **facility/intelligence facts + scores** that target *its own* table and
are read by filters. Website enrichment targets the **`venues`/`opening_hours` content columns**
and needs a **per-field review→apply lifecycle with evidence**. Different target, different grain,
different workflow → its own tables. (Facility booleans the website confirms could *later* feed
`venue_enrichment`, but that is out of MVP scope.)

---

## 2. RPCs (responsibilities only — SECURITY DEFINER, `search_path` locked) ⟲v2

**Four RPCs.** Two are new in v2 (`snapshot_current_value`, `propose_field`) to fix correctness
findings — they make snapshot hashing single-sided and the supersede+insert atomic.

### `snapshot_current_value(p_venue_id uuid, p_field text) returns jsonb` ⟲v2 (arch #4)
Returns `{ "value": <jsonb>, "hash": <sha256 hex> }` for the field's **current** live value,
computed **entirely in Postgres** (`encode(digest(value::text,'sha256'),'hex')`). For
`opening_hours` it assembles the 7 day-rows **ordered by `day_of_week` asc** into a stable array
before hashing. Both propose-time snapshot and apply-time re-check call this **same** function, so
the hashes are guaranteed comparable — eliminating the TypeScript-`JSON.stringify` vs
Postgres-`jsonb::text` mismatch (key order / number formatting). The script never hashes values itself.

### `propose_field(p_run_id uuid, p_venue_id uuid, p_field text, p_proposed jsonb, p_source_url text, p_evidence text, p_evidence_raw text, p_method text, p_confidence text, p_conflicts boolean) returns uuid` ⟲v2 (arch #3)
Atomic supersede+insert in **one** PL/pgSQL transaction: `update venue_field_proposals set
status='superseded' where venue_id=p_venue_id and field=p_field and status='pending'`, **then**
insert the new `pending` row (capturing `current_value`/`current_value_hash` from
`snapshot_current_value`). Removes the client-side race window where a parallelised run could lose a
supersede or hit the partial-unique violation (§6c). Callable by service_role (background proposing).
Returns the new proposal id. Dedup guard: if `p_proposed` normalises equal to the current value,
**no row is inserted** and it returns null (arch #5).

### `apply_venue_proposal(p_proposal_id uuid) returns jsonb`
1. **Authz:** `if not is_admin() then raise exception` — admin JWT only (see §2c).
2. Load proposal; require `status = 'approved'` (else raise `not_approved`).
3. **Stale-current-value guard:** call `snapshot_current_value` for the live value; if its `hash`
   ≠ the proposal's `current_value_hash` → raise `stale_current_value` (venue was edited after we
   snapshotted; force re-review). **Value-equality only — no wall-clock/temporal check** (sec #6
   *rejected*: a value edited away and back is, by definition, not an unseen change being clobbered,
   so a time-based rejection would only produce false "stale" failures — see §16).
4. **Apply by field:**
   - scalar (`price_range`,`website`,`phone`,`email`) → `update venues set <field> = …, updated_at = now()`.
     **⟲v2 (sec #12):** `price_range` is re-validated against `('free','budget','moderate','premium')`
     in the RPC; an invalid value raises `invalid_enum_value` (defence-in-depth over the column CHECK).
   - `description` → **⟲v2 (sec #5):** the RPC takes a required `p_applied_text` argument (the admin's
     **original factual summary**) and **refuses** to write text equal to `evidence_snippet`/`evidence_raw`
     (raises `description_not_rewritten`). The site's exact words live in evidence only and can never be
     applied verbatim — closes the accidental-copyright path without a new column.
   - `opening_hours` → **⟲v2 (arch #6): replace-whole-week.** Assert the proposal's structured value
     has **exactly 7 day entries** (else `incomplete_week`); `delete from opening_hours where venue_id=…`
     then insert 7 fresh rows. Eliminates the partial-week hybrid (e.g. new Mon–Fri leaving a stale
     imported Sat/Sun). Idempotent (see §7f).
   - `booking_url` → **raise `no_target_column`** (measured in pilot, no column yet — never silently dropped).
5. Set proposal `status='applied'`, `applied_at = now()`, `reviewed_by = auth.uid()`.
6. Return `{ ok, field, applied_value }`. The applied proposal row **is** the provenance record
   (keeps `current_value` = the pre-apply value, enabling revert — §13).
7. `.select()`-guarded internally so a zero-row update raises, never silently no-ops
   (the moderation silent-failure lesson).

### `reject_venue_proposal(p_proposal_id uuid, p_notes text) returns jsonb`
Admin-only; sets `status='rejected'`, `review_notes`, `reviewed_by=auth.uid()`, `reviewed_at=now()`.
(Approval for the pilot can be a plain admin `update … set status='approved'`; the RPCs exist so a
future admin UI calls them directly.)

> **Audit trail (sec #7 — accepted-light):** the proposal row itself is the audit record — it
> retains `reviewed_by`, `reviewed_at`, `applied_at`, and the pre-apply `current_value`, so every
> applied change is attributable and revertible. A separate **immutable `enrichment_audit_log`**
> table (multi-admin accountability, IP capture) is **deferred to scale-up** when an admin UI and
> multiple reviewers exist — overkill for a single-operator £0 pilot (see §16, §17).

### 2c. Auth boundary (important) ⟲v2 (arch #13)
- **Proposing** (insert runs/proposals via `propose_field`) = background **service_role** script
  (bypasses RLS).
- **Applying** = an **authenticated admin** session whose `auth.uid()` passes `is_admin()`.
  The apply script signs in (`signInWithPassword`) to obtain a JWT, then calls the RPC. This keeps
  "apply is admin-only" true and mirrors the future UI path. Service_role is never used to apply.
- **⟲v2 credential hygiene:** use a **dedicated `enrichment-admin` Supabase auth user**
  (`is_admin = true`), **not** the developer's personal admin login — separation of concerns and a
  clean audit identity. Its password is a long random secret in `scripts/.env` **only** (already
  gitignored; an admin password leak is worse than a service-role-key leak). Call
  `signInWithPassword` immediately before the apply loop, **refresh** the access token if the batch
  could exceed its ~1 h lifetime, and `signOut` immediately after.
- **Pilot reality:** measuring extraction precision does **not** require applying. Apply is
  exercised on a tiny subset (≤5 approved proposals — see §9) only to prove the RPC + stale guard work.

---

## 3. Module / file layout (mirrors `scripts/enrich/` conventions)

Network I/O is isolated to ONE module; everything else is **pure and fixture-tested** — exactly
like `osmExtract.ts` / `geoapifyClient.ts` today.

| File | Responsibility | Pure? |
|---|---|---|
| `scripts/enrich/web/urlSafety.ts` ⟲v2 | Validate a URL is public & http(s): reject private IPs (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, `::1`/ULA), `localhost`, `.local/.internal`, non-http(s) schemes. **Re-checked on every redirect hop.** (sec #2 SSRF) | **Yes** |
| `scripts/enrich/web/robotsParse.ts` | Parse robots.txt → allow/deny + crawl-delay for a path | **Yes** |
| `scripts/enrich/web/webClient.ts` | fetch (throttle, retry, redirect policy + per-hop `urlSafety`, size/type/timeout limits), robots fetch+cache, page disk-cache. **Only network module.** robots enforcement is structural — a single non-bypassable code path, no `--ignore-robots` parameter (sec #3). | No |
| `scripts/enrich/web/htmlExtract.ts` | HTML string → per-field candidates with evidence (JSON-LD ▸ microdata ▸ meta ▸ heuristics). **Trims+caps snippets to 512 chars and PII-scrubs them** (sec #1, #10). | **Yes** |
| `scripts/enrich/web/openingHours.ts` | Parse/normalise opening hours → structured **7-day** week + issues | **Yes** |
| `scripts/enrich/web/confidence.ts` | Per-field confidence + caps (conflict, seasonal, lossy mapping) | **Yes** |
| `scripts/enrich/web/proposals.ts` | Candidates + a passed-in `CurrentVenueSnapshot` → proposal payloads; conflict detection; **proposed==current dedup skip** (arch #5). Reads no DB — the snapshot is fetched by the orchestrator and passed in (arch #7). Authoritative hash comes from the `snapshot_current_value` RPC, not this module. | **Yes** |
| `scripts/enrich/web/report.ts` | Render JSON + CSV + **HTML-escaped** pilot report (sec #4 — escape `& < > " '` in every website-derived field) | **Yes** (string out) |
| `scripts/enrich/enrichWebsites.ts` | CLI orchestrator (dry-run default; `--propose` calls `propose_field`). Fetches `venues.*` + `opening_hours` rows per venue → builds `CurrentVenueSnapshot`. | No |
| `scripts/enrich/applyProposals.ts` | Admin apply runner (dedicated admin JWT → `apply_venue_proposal`) | No |
| `types/webEnrichment.ts` | Shared types incl. `CurrentVenueSnapshot` (relative imports, **no `@/`**) | — |
| `scripts/enrich/web/__tests__/*` + `fixtures/` | Unit tests + saved HTML fixtures | — |

---

## 4. Typed interfaces & validation boundaries (`types/webEnrichment.ts`)

```ts
export type WebField =
  | 'description' | 'price_range' | 'website' | 'booking_url'
  | 'phone' | 'email' | 'opening_hours';
export type ExtractionMethod = 'jsonld' | 'microdata' | 'meta' | 'heuristic';
export type Confidence = 'low' | 'medium' | 'high';

// A single extracted candidate, value still in its native shape.
export interface FieldCandidate<T = unknown> {
  field: WebField;
  value: T;                 // string | OpeningWeek | …
  sourceUrl: string;        // the exact page it came from
  evidenceSnippet: string;  // exact supporting text (trimmed, length-capped)
  evidenceRaw?: string;     // pre-normalisation (e.g. raw hours string)
  method: ExtractionMethod;
}

export interface ExtractedCandidates {           // htmlExtract output for one page
  candidates: FieldCandidate[];                  // 0..n, never throws on missing data
}

// Opening hours (structured proposal payload)
export interface DayHours {
  day_of_week: number;                  // 0=Sun … 6=Sat (matches opening_hours table)
  is_closed: boolean;
  intervals: { opens: string; closes: string }[]; // 'HH:MM'; [] when closed/unknown
}
export interface OpeningWeek {
  days: DayHours[];                     // exactly 7 entries when parsed
  seasonal_notes: string | null;        // 'term-time only', 'closed Jan', exceptions
  source_text: string;                  // original raw string as found
}
export interface OpeningParseResult {
  ok: boolean;
  week?: OpeningWeek;                    // when ok: ALWAYS 7 day entries (closed days = is_closed)
  issues: string[];                     // 'split_hours','seasonal','unparseable_day:Mon',…
}

// ⟲v2 (arch #7): the orchestrator fetches this from the DB and passes it to the PURE
// proposals.ts module, so that module never does I/O. Hashing for the stale-guard is the
// DB's job (snapshot_current_value RPC) — this is for conflict detection + reviewer display.
export interface CurrentVenueSnapshot {
  description: string | null;
  price_range: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  opening_hours: DayHours[];            // all rows currently in opening_hours for this venue
}

// Fetch layer
export interface PageFetch { url: string; httpStatus: number; contentSha256: string; bytes: number; fetchedAt: string; }
export type FetchOutcome =
  | { kind: 'extracted'; pages: PageFetch[]; htmlByUrl: Record<string,string> }
  | { kind: 'skipped_no_website' | 'skipped_robots' | 'skipped_redirect_offdomain'
        | 'skipped_non_html' | 'skipped_too_large' | 'skipped_bot_protected' | 'fetch_failed';
      pages: PageFetch[]; note?: string };

// Proposal row (mirrors the table; jsonb fields typed)
export interface ProposalRow {
  run_id: string; venue_id: string; field: WebField;
  proposed_value: unknown; current_value: unknown; current_value_hash: string | null;
  source_url: string; evidence_snippet: string; evidence_raw: string | null;
  retrieved_at: string; extraction_method: ExtractionMethod;
  confidence: Confidence; conflicts_existing: boolean;
}
```

**Validation boundaries (pure guards, no new deps — project has no zod):**
- **⟲v2 URL safety (`urlSafety.ts`, sec #2 SSRF):** before any fetch — and **again on every redirect
  hop** — the target must be absolute `http(s)` with a **public** host. Reject private IP ranges
  (`10/8`,`172.16/12`,`192.168/16`,`127/8`,`169.254/16`,`::1`,ULA `fc00::/7`), `localhost`,
  `*.local/.internal/.private`, and non-http(s) schemes → run outcome `skipped_invalid_url`.
  (A venue's `website` is ultimately user-submitted data — never trust it as a fetch target.)
- **⟲v2 evidence snippet (sec #1, #10):** trim and **truncate to ≤512 chars** at extraction; then
  **PII-scrub** — redact emails (`[email]`) and phone-like runs (`[phone]`) that are **not** the
  field's own proposed value, plus UK postcodes, preserving context. The intended contact value of a
  `phone`/`email` proposal is retained in `proposed_value` (that is the feature, under the §11 lawful
  basis); incidental third-party PII in surrounding text is scrubbed.
- `phone`: strip to digits/`+`, accept only plausible GB forms → store normalised; reject otherwise.
- `email`: regex-valid AND flag `firstname.lastname@`-style as **personal → review-required, capped `low`**.
- `price_range`: heuristic map from `priceRange`/`£` text to the 4-bucket enum
  (`free|budget|moderate|premium`) — **lossy → cap at `medium`, always review** (re-validated in apply RPC).
- `website`/`booking_url`: must pass `urlSafety` + be absolute `http(s)`. `website` must be same
  registrable domain; `booking_url` may be a known third-party ticketing host (e.g. digitickets,
  eventbrite) — allowed but flagged.
- **⟲v2 dedup (arch #5):** for every field, if the normalised `proposed_value` equals the
  `CurrentVenueSnapshot` value, **emit nothing** (no "change X to X" proposals).
- `description`: store the site's exact text in **evidence only**; `proposed_value` is **not** a
  ready-to-write string — the apply RPC requires an admin-supplied rewritten summary distinct from the
  evidence (sec #5). Never propose `high`.
- `opening_hours`: only emitted when `OpeningParseResult.ok` with a full **7-day** week; otherwise
  clean skip (§7e).

---

## 5. Fetch policy (webClient.ts)

| Concern | Rule |
|---|---|
| Source | Only `venues.website` (already held). Never a guessed/search URL in MVP. |
| **⟲v2 URL safety** | `urlSafety.ts` must pass **before fetch and on every redirect hop** (SSRF, sec #2). Fail → `skipped_invalid_url`, no fetch. |
| **robots.txt** | Fetch + cache per registrable domain; honour `Disallow` for our UA and `Crawl-delay`. Disallowed path → `skipped_robots`, **no fetch**. ⟲v2 enforcement is **structural & non-bypassable** — one code path, no skip flag (sec #3); a CI grep for `ignoreRobots\|skipRobots\|bypass` in `web/` must return 0 (also guards "no auto-apply", sec #9). |
| User-Agent | Descriptive, identifies the bot + an info/contact URL. Never spoof a browser. ⟲v2 a `403`/block → escalate to manual review in the report; do **not** retry with a browser UA (sec #15). |
| Redirects | Follow ≤ **3** (`MAX_REDIRECTS` — guards loops; most venues redirect ≤1×). Each hop re-checked by `urlSafety`. If final host's **registrable domain (eTLD+1)** ≠ original → `skipped_redirect_offdomain`. |
| Same-origin links | From the landing page, follow ≤ **2** extra links whose host == venue's registrable domain AND whose path matches hints: `/opening`,`/opening-times`,`/hours`,`/prices`,`/admission`,`/tickets`,`/contact`,`/visit`,`/plan-your-visit`. Depth 1 only. |
| Page cap | ≤ **3 pages/venue** total. |
| Content type | `text/html`/`application/xhtml+xml` only, else `skipped_non_html`. |
| Body size | ≤ **2 MB**, else `skipped_too_large` (stream-abort). |
| Timeout | 15 s/request (AbortController, like geoapifyClient). |
| **⟲v2 Throttle** | **Per-domain concurrency = 1** (strict queue, honours Crawl-delay); **across domains ≤ 2** concurrent. Per-domain min interval **3 s** (or Crawl-delay if larger). **`--cache-only` disables all delays** (fast offline test iteration, sec #14/arch #9). |
| Retry | `429`/`5xx`/network → exp. backoff + jitter, ≤ 3 attempts, then `fetch_failed` (clean skip, not a crash). A `429` accrues a **per-domain** back-off carried to that domain's next request (not just per-URL). |
| Bot protection | Cloudflare/JS-challenge markers or `403` w/ challenge → `skipped_bot_protected`. |
| Budget | Per-run page budget; abort run cleanly when hit. |
| Logging | URLs only; **never** log PII or full page bodies. |

All skip kinds are **first-class outcomes** recorded on the run row — never exceptions to swallow.

---

## 6. Extraction order, confidence & superseding

### 6a. Order (first hit wins per field; later tiers only fill gaps)
1. **JSON-LD** `<script type="application/ld+json">` — schema.org `LocalBusiness`/`Place`/`Event`:
   `openingHoursSpecification`, `priceRange`, `telephone`, `email`, `description`, `url`,
   `potentialAction`/reservation links → booking. **Highest quality (machine-readable).**
2. **Microdata / RDFa** (`itemprop=...`) — same fields, slightly weaker.
3. **Meta / OpenGraph** — `<meta name="description">`, `og:description`, `og:title`; `tel:`/`mailto:` links.
4. **Heuristics** on visible text — day+time regex (hours), `book|tickets|buy|reserve` anchors
   (booking links), labelled phone/email. Each keeps the surrounding sentence as `evidenceSnippet`.

### 6b. Confidence (confidence.ts)
| Base by method | |
|---|---|
| jsonld / microdata explicit | `high` |
| meta / `tel:`/`mailto:` | `medium` |
| heuristic body-text | `low` |

**Caps / demotions (always applied after base):**
- `conflicts_existing == true` (current value non-null & differs) → **cap `medium`**, set flag.
- `opening_hours` with split intervals, seasonal/exception notes, or any parse issue → **cap `medium`**.
- `price_range` (lossy enum mapping) → **cap `medium`**.
- `description` → never above `medium`; apply requires rewrite.
- personal-looking `email` → **cap `low`** + review-required.
- **MVP rule: no confidence value auto-applies.** Confidence only triages reviewer attention.

### 6c. Superseding & stale protection ⟲v2
- **Supersede (atomic, arch #3):** the supersede-then-insert pair runs **inside the
  `propose_field` PL/pgSQL RPC** (§2), not as two client calls — closing the race window where a
  parallelised run could lose a supersede or hit the partial-unique violation. The partial-unique
  index `…_one_pending_idx` is the backstop. Approved/applied/rejected rows are immutable history
  and are never superseded.
- **Stale-current-value (arch #4):** `current_value` + `current_value_hash` are produced by the
  **`snapshot_current_value` RPC** (hash computed in Postgres) at propose time; at apply time the
  RPC re-runs the **same** function and aborts (`stale_current_value`) if the hash differs —
  guaranteed comparable (no TS/Postgres serialisation drift). **Value-equality only**; the proposed
  temporal "older than 12 h" guard was **rejected** (sec #6 — an edited-away-and-back value is not an
  unseen change; a time check would only produce false stalenesses; see §16).

---

## 7. Opening-hours normalisation (openingHours.ts)

**Target schema reminder:** `opening_hours(venue_id, day_of_week 0-6, opens_at time, closes_at time,
is_closed bool, notes text, unique(venue_id, day_of_week))` — **one opens/closes per day** (no native split).

### 7a. Inputs handled
- OSM-syntax strings (`Mo-Su 10:00-17:30`, `Mo-Fr 09:00-12:00,13:00-17:00`), schema.org
  `openingHoursSpecification` arrays, and labelled HTML tables/lists.

### 7b. Split hours (e.g. 9–12, 14–17)
Parse into `intervals: [{09:00,12:00},{14:00,17:00}]`. On **apply**, store the **outer envelope**
(`opens_at = 09:00`, `closes_at = 17:00`) and put the precise split in `notes`. Proposal carries the
full structured intervals; **confidence capped at `medium`**. (A future `opening_hours_intervals`
child table could store splits natively — **out of MVP scope**, noted only.)

**⟲v2 (arch #10) exact `notes` format** — one canonical string so the TS builder and the apply RPC
produce identical output: `"Open HH:MM-HH:MM and HH:MM-HH:MM"` for splits, then any seasonal note
appended with ` | `, e.g. `"Open 09:00-12:00 and 14:00-17:00 | term-time only"`. Soft cap **500 chars**.

### 7c. Closed days
`is_closed = true`, `intervals = []`, `opens_at/closes_at = null` on apply.

### 7d. Seasonal / exception notes
`OpeningWeek.seasonal_notes` (e.g. `"term-time only"`, `"closed January"`, bank-holiday exceptions)
is preserved in the proposal and **appended to `notes`** on apply. Presence → **cap `medium`**
(weekly grid is not the whole truth).

### 7e. Malformed / ambiguous
`parseOpeningHours` returns `{ ok:false, issues }` → **no opening_hours proposal is emitted**
(clean skip), OR (operator option) a single `low`-confidence proposal flagged
`"unparseable — raw text only"` with the raw string in `evidence_raw`. Never write a guessed grid.

### 7f. Apply mechanics ⟲v2 (arch #6) — replace-whole-week
The RPC **asserts the proposal's structured value has exactly 7 day entries** (`openingHours.ts`
always emits 7 — closed days as `is_closed`; else `incomplete_week` is raised), then **deletes all
existing `opening_hours` rows for the venue and inserts 7 fresh rows**, inside one transaction. This
"replace whole week" semantic is idempotent **and** eliminates the partial-week hybrid that a plain
per-day upsert would leave (e.g. a new Mon–Fri week silently keeping a stale imported Sat/Sun row).

---

## 8. Local cache & content hashing

```
scripts/data/raw/website_cache/
  robots/<registrable_domain>.json      { url, fetched_at, body, crawl_delay, ttl_seconds }
  pages/<sha1(final_url)>.json          { url, final_url, fetched_at, http_status,
                                          content_type, bytes, content_sha256, html }
  runs/<venue_id>.<run_label>.json      full run record (for fixtures / reproducibility)
```
- **HTML lives ONLY on disk** (constraint 11) — the DB stores hashes/metadata, never raw HTML.
- `content_sha256` over normalised HTML body → (a) skip re-fetch if cached & fresh (`< 30 days`)
  and unchanged, (b) detect drift on refresh, (c) reproducible offline dev via `--cache-only`.
- **⟲v2 (sec #8): robots.txt has its OWN short TTL of 1 day (86,400 s)**, independent of the 30-day
  page cache. After expiry it is **re-fetched** before honouring it — so a site that tightens its
  robots policy is respected within 24 h, not up to 30 days later (a legal/ToS risk if conflated).
- Cache dir is **gitignored** (already covered) and deletable with zero production impact (§13).

---

## 9. CLI commands & safety flags

### `scripts/enrich/enrichWebsites.ts` (fetch + extract + report)
```
npx tsx scripts/enrich/enrichWebsites.ts [flags]

  (default)            DRY RUN: fetch → extract → write REPORT. No DB writes.
  --propose            ALSO insert pending proposals + run rows (via propose_field RPC). Gated.
  --limit=N            How many pilot venues (required for --propose; hard cap PROPOSE_LIMIT_CAP=100).
  --venue-id=<uuid>    Single venue. Implies --limit=1, so --propose --venue-id needs no --limit.
  --report=<path>      Report output base (.json/.csv/.html). Default scripts/enrich/out/.
  --max-pages=3        Page cap per venue.
  --per-domain-delay-ms=3000
  --refresh            Ignore cache freshness (re-fetch).
  --cache-only         Never hit network — use cached pages/fixtures (offline dev/tests).
                       ⟲v2 also disables ALL throttle delays for fast iteration.
```
Safety: service_role required; `--propose` refuses without an explicit `--limit` **unless
`--venue-id` is given** (then it is implicitly 1, mirroring `enrichVenues.ts`'s `venueId ||
limitProvided` gate, arch #8) and refuses `> PROPOSE_LIMIT_CAP` (⟲v2 a **named constant** like
`WRITE_LIMIT_CAP`, arch #11); **robots is always honoured — there is no bypass flag**; secrets/PII
never logged.

### `scripts/enrich/applyProposals.ts` (admin apply)
```
npx tsx scripts/enrich/applyProposals.ts [flags]

  (default)            DRY RUN: list what WOULD apply. No RPC calls.
  --apply              Actually call apply_venue_proposal for each target.
  --ids=<uuid,...>     Specific approved proposals, OR
  --approved           All proposals where status='approved'.
  --limit=N            Cap. ⟲v2 default = 5 for the pilot (arch #12 — a first RPC exercise must be
                       tiny; the operator raises it consciously), not 25.
  --applied-text=<...> Required when applying a 'description' proposal — the admin's rewritten summary.
```
Requires **dedicated admin auth** env (not service_role; §2c). `booking_url` proposals are reported
as `no_target_column` and skipped. Dry-run default here too.

---

## 10. Fixture & unit-test matrix

Saved HTML fixtures in `scripts/enrich/web/__tests__/fixtures/` (hand-made + a few real saved pages,
PII scrubbed). Every pure module gets deterministic tests — **no network in tests**.

| # | Fixture | Exercises | Expected |
|---|---|---|---|
| 1 | clean JSON-LD LocalBusiness | tier-1 extract all fields | high-confidence candidates, correct values |
| 2 | microdata-only | tier-2 | medium candidates |
| 3 | meta/OG description + `tel:`/`mailto:` only | tier-3 | description+phone+email medium; no hours |
| 4 | heuristic hours in a `<table>` | body-text parse | low/medium hours, evidence = the table text |
| 5 | split hours `Mo-Fr 9-12,14-17` | §7b | intervals parsed, envelope+notes on apply, cap medium |
| 6 | seasonal `term-time only` | §7d | seasonal_notes set, cap medium |
| 7 | closed Sundays | §7c | is_closed=true for day 0 |
| 8 | malformed/ambiguous hours | §7e | `ok:false`, no proposal (or flagged low) |
| 9 | price text `£8.50 adults` / `Free entry` | price map | mapped bucket, cap medium |
| 10 | personal email `jane.smith@…` | PII guard | flagged personal, cap low, review-required |
| 11 | booking anchor `Book tickets` → digitickets | booking heuristic | booking_url candidate, third-party flagged |
| 12 | value conflicts existing venue value | §6b | conflicts_existing=true, cap medium |
| 13 | robots Disallow | fetch outcome | `skipped_robots`, zero proposals |
| 14 | redirect to off-domain | fetch outcome | `skipped_redirect_offdomain` |
| 15 | non-HTML (PDF) | fetch outcome | `skipped_non_html` |
| 16 | 3 MB body | fetch outcome | `skipped_too_large` |
| 17 | Cloudflare challenge | fetch outcome | `skipped_bot_protected` |
| 18 | multi-page (landing + /opening-times) | same-origin link rule | follows ≤2 hint links, merges candidates |
| 19 | supersede: 2nd run same field | §6c / propose_field | old pending → superseded, 1 pending remains, atomic |
| 20 | stale apply (current value changed) | RPC guard | apply aborts `stale_current_value` |
| 21 | ⟲v2 SSRF: `http://localhost:5432`, `http://192.168.0.1`, `ftp://…` | urlSafety | rejected → `skipped_invalid_url` |
| 22 | ⟲v2 redirect to internal host mid-chain | urlSafety per-hop | rejected → `skipped_invalid_url` |
| 23 | ⟲v2 evidence snippet with `<script>`/`onerror` | report.ts | HTML-escaped in HTML report; raw in JSON/CSV |
| 24 | ⟲v2 incidental 3rd-party email/phone in snippet | PII scrub | redacted `[email]`/`[phone]`, context kept |
| 25 | ⟲v2 robots cached 2 days old | robots TTL | re-fetched before honouring (not reused) |
| 26 | ⟲v2 proposed value == current value | dedup | no proposal emitted |
| 27 | ⟲v2 opening_hours apply over partial existing week | apply RPC | replace-whole-week: exactly 7 rows after |
| 28 | ⟲v2 description apply == evidence text | apply RPC | raises `description_not_rewritten` |
| 29 | ⟲v2 price_range apply = `'cheap'` | apply RPC | raises `invalid_enum_value` |

Tests also assert: `htmlExtract` never throws on missing data (returns `[]`); confidence caps fire;
snippet ≤512 chars; report renders valid JSON/CSV **and escaped HTML**; the snapshot hash from
`snapshot_current_value` is stable across re-reads; a CI grep finds no `ignoreRobots|skipRobots|auto.*apply`.

---

## 11. Pilot-selection SQL (50–100 representative venues)

Goal: published/approved venues that already have a website, spread across category families, with a
deliberate mix of "likely clean" and "likely messy" sites. Run read-only first to inspect.

```sql
-- Candidate pool (inspect counts by category before sampling)
select c.slug, count(*) filter (where v.website is not null) as with_site
from venues v join categories c on c.id = v.category_id
where v.is_published = true and v.moderation_status = 'approved'
group by c.slug order by with_site desc;

-- Representative sample: up to ~12 per family, http(s) sites only, capped 100
with eligible as (
  select v.id, v.name, v.website, c.slug as category,
         row_number() over (partition by c.id order by random()) as rn
  from venues v join categories c on c.id = v.category_id
  where v.is_published = true
    and v.moderation_status = 'approved'
    and v.website is not null
    and v.website ~* '^https?://'
)
select id, name, category, website
from eligible
where rn <= 12
   and category in (
     'soft-play','farm','museum','swimming-pool','park',
     'playground','indoor-play','zoo','aquarium','theme-park'
   )
order by category, name
limit 100;
```
*(Category slugs to be confirmed against the live `categories` table during build — read-only check,
no assumptions baked into code.)* Save the chosen IDs to `scripts/enrich/web/pilot_venue_ids.json`.

---

## 12. Pilot success / failure thresholds

After the dry-run over the 50–100, a human grades each proposal (correct / wrong / partial) in the
CSV report. **Decision gate:**

| Metric | Proceed (scale) | Stop / rethink |
|---|---|---|
| **Coverage** — venues yielding ≥1 usable proposal | ≥ 50% | < 30% |
| **High-confidence precision** (jsonld/microdata correct) | ≥ 90% | < 80% |
| **Medium-confidence precision** | ≥ 75% | < 60% |
| **Opening-hours structural correctness** | ≥ 80% of emitted weeks | < 60% |
| **Wrong-venue / wrong-domain writes** | **0** (must) | any |
| **Clean-skip correctness** (robots/redirect/etc. handled, no crashes) | 100% | any crash/bypass |
| **Booking-link precision** | measured (informs whether to add the column) | — |
| **Cost** | £0 | any spend |

≥ thresholds → expand venue count, then separately decide on (a) the LLM tier and (b) adding
`venues.booking_url`. < thresholds → stop; the lesson cost £0.

---

## 13. Rollback & cleanup

- **Schema:** purely additive + isolated. Down migration `056_…_down.sql` = `drop table
  venue_field_proposals; drop table venue_enrichment_runs; drop function apply_venue_proposal,
  reject_venue_proposal, propose_field, snapshot_current_value;` ⟲v2 (drop the two new RPCs too).
  No existing object altered → reversible with no data loss to current app.
- **Applied venue changes:** only the tiny RPC-applied subset touches `venues`/`opening_hours`. Each
  applied proposal stored the pre-apply `current_value`, so manual restore (or a future
  `revert_venue_proposal(id)`) can undo it. ⟲v2 the pilot apply cap is **5** by default (§9), and
  `revert_venue_proposal` is a documented **build-before-scaling** dependency (arch #12) so it is not
  deferred indefinitely.
- **Cache:** `rm -rf scripts/data/raw/website_cache/` — local only, zero production impact.
- **Code:** all new files under `scripts/enrich/web/` + `applyProposals.ts` + `enrichWebsites.ts` +
  `types/webEnrichment.ts` — deletable as a unit.

---

## 14. Files created / modified

**Created**
- `supabase/migrations/056_venue_website_enrichment.sql` (+ optional `_down`) — 2 tables, **4 RPCs**
  (`snapshot_current_value`, `propose_field`, `apply_venue_proposal`, `reject_venue_proposal`).
- `types/webEnrichment.ts` (incl. `CurrentVenueSnapshot`)
- `scripts/enrich/enrichWebsites.ts`
- `scripts/enrich/applyProposals.ts`
- `scripts/enrich/web/{urlSafety,robotsParse,webClient,htmlExtract,openingHours,confidence,proposals,report}.ts`
  ⟲v2 (`urlSafety.ts` added)
- `scripts/enrich/web/__tests__/*` + `fixtures/*`
- `scripts/enrich/web/pilot_venue_ids.json` (pilot selection output)

**Modified**
- `.gitignore` — add `scripts/data/raw/website_cache/` and `scripts/enrich/out/` (report output).
- *(No app code, no `venues`/`opening_hours` shape change, no `tailwind`/UI, no existing migration.)*

**Explicitly NOT in MVP** (noted for later, separate decisions): LLM extraction tier,
`venues.booking_url` column, `opening_hours_intervals` split table, admin review UI, immutable
`enrichment_audit_log` table (sec #7, deferred to scale-up), `revert_venue_proposal` (build before
scaling apply), any Geoapify dependency, URL-sourcing for venues lacking a website.

---

## 15. Build order (when approved — still gated, still dry-run)

1. Migration `056` (review SQL only; do not apply until approved).
2. `types/webEnrichment.ts` + the **pure** modules + full fixture tests (**0 network, £0**).
3. `webClient.ts` + robots, tested against saved fixtures via `--cache-only`.
4. `enrichWebsites.ts` dry-run over the pilot IDs → **report**. Human grades it.
5. Only if thresholds pass: `--propose` inserts pending proposals; exercise `applyProposals.ts`
   on ~5 approved to validate the RPC + stale guard.
6. Gate decision (§12) → scale / LLM / booking_url column, each as its own reviewed step.

> Per CLAUDE.md, after any build step: `lint:fix → type-check → test:ci → security/privacy review →
> secret scan`. A `secom-reviewer` pass is mandatory before `--propose` ever runs.

---

## 16. Legal basis & lawful processing (GDPR) ⟲v2 (sec #11)

PlayPlanner operates under UK/EU GDPR + the ICO Children's Code. This feature processes **business**
information from venues' public websites. No children's data is involved.

- **Lawful basis — Legitimate Interest (Art. 6(1)(f)).** Interest: improving venue discovery for
  families by populating accurate hours/price/contact. Necessity: proportionate — only the venue's
  **own** public website is read, only public business facts are extracted, and a human reviews
  everything before it is published.
- **Personal-data edge (sole traders).** A venue's contact phone/email **can** be personal data.
  Mitigations already in the spec: personal-looking emails are flagged and capped `low`
  (review-required); incidental third-party PII in evidence snippets is scrubbed (§4); contact
  fields are never auto-applied; data is minimised to business contact only.
- **Right to object / removal.** A venue can request removal of harvested contact details via
  support; applied values are revertible from the stored `current_value` (§13).
- **Copyright.** Facts (hours, price, phone) are not copyrightable. Descriptions are stored as
  **evidence only** and can never be applied verbatim (§2, §4) — the published description is an
  original admin-written summary.
- **DPIA.** Add a short addendum to `docs/DPIA.md` covering this processing **before `--propose`
  runs** (low residual risk: public business data, human-in-the-loop, no children's data). Disclosing
  "we may supplement venue listings from public sources" in the privacy policy is a separate,
  recommended follow-up (out of this spec's code scope).

---

## 17. Review log — every finding's disposition ⟲v2

Two specialist passes ran against v1 (`secom-reviewer` = S#, `agent-arch` = A#). **A = accepted,
R = rejected, D = deferred.** Accepted items are reflected in the v2 body above (marked ⟲v2).

### secom-reviewer (security / privacy)
| # | Finding | Sev | Disposition | Reasoning |
|---|---|---|---|---|
| S1 | PII in evidence snippets | Crit | **A (scoped)** | Scrub *incidental* PII in snippets (§4); the proposed phone/email value is retained — that IS the feature, under §16 lawful basis. |
| S2 | SSRF / no URL validation | Crit | **A** | `urlSafety.ts` rejects private/localhost/non-http(s), re-checked per redirect hop → `skipped_invalid_url`. venue.website is user-submitted. |
| S3 | robots bypass not enforced | Crit | **A (scoped)** | Stated structural/no-bypass code path + CI grep (§5). Type-level fortress was over-engineering; the grep + single path is enough. |
| S4 | XSS in HTML report | Crit | **A** | `report.ts` HTML-escapes all website-derived fields (§3, test 23). |
| S5 | Copyright on descriptions | High | **A (better form)** | Instead of a `copyright_flag` column: apply RPC refuses description text equal to evidence (`description_not_rewritten`) — enforces rewrite directly (§2, §4). |
| S6 | Temporal stale guard (12 h) | High | **R** | Value-hash guard already prevents clobbering unseen changes. Edited-away-and-back ⇒ live state == snapshot ⇒ nothing unseen; a time check only yields false stalenesses. |
| S7 | Immutable audit-log table | High | **D** | Proposal row already records who/when/old-value (attributable + revertible). A separate audit table + IP capture belongs with the multi-admin UI at scale-up. |
| S8 | robots cache TTL too long | High | **A** | robots.txt given its own 1-day TTL, separate from 30-day page cache (§8). |
| S9 | Confidence/no-auto-apply not enforced | Med | **A (scoped)** | Apply only acts on human-set `status='approved'`; CI grep guards against `auto.*apply` (§5/§6b). DB CHECK can't express "human-set". |
| S10 | Evidence snippet unbounded | Med | **A** | 512-char cap at extraction + column CHECK (§1a, §4). |
| S11 | Lawful basis / DPIA undocumented | Med | **A** | New §16; DPIA addendum required before `--propose`. |
| S12 | price_range enum not re-validated on apply | Med | **A** | RPC re-validates against the 4 buckets → `invalid_enum_value` (§2, test 29). |
| S13 | Redirect limit (3) unjustified | Low | **A** | Documented `MAX_REDIRECTS=3` rationale (§5). |
| S14 | Concurrency underspecified | Low | **A** | Per-domain=1, cross-domain ≤2; cache-only disables throttle (§5). |
| S15 | UA-block escalation | Low | **A** | 403/block → manual review; never retry as a browser (§5). |
| S16 | booking_url attribution | Low | **D** | booking_url column itself is deferred; revisit `booking_url_source` when the column is added. |
| S17 | Geolocation privacy | Info | **R (N/A)** | Backend-only; touches no app geolocation. No spec change. |

### agent-arch (architecture / correctness)
| # | Finding | Sev | Disposition | Reasoning |
|---|---|---|---|---|
| A1 | Migration-number collision risk | Low | **A (note)** | Confirm `ls supabase/migrations/056*` at build time; no spec change. |
| A2 | `proposals_count` unenforced | Med | **A** | Column dropped; count children on demand (§1a). |
| A3 | Supersede+insert not atomic | High | **A** | New `propose_field` RPC does supersede+insert in one PL/pgSQL txn (§2, §6c). |
| A4 | Hash computed cross-language | Med | **A** | New `snapshot_current_value` RPC hashes in Postgres both sides (§2, §6c). |
| A5 | website proposed==current dedup | Low | **A** | General "proposed==current ⇒ emit nothing" rule (§4, test 26). |
| A6 | Opening-hours partial-week hybrid | Med | **A** | Apply = assert-7 + replace-whole-week (§2, §7f, test 27). |
| A7 | `proposals.ts` purity broken | Med | **A** | Orchestrator fetches `CurrentVenueSnapshot` and passes it in; module stays pure (§3, §4). |
| A8 | `--venue-id` vs `--limit` gate | Low | **A** | `--venue-id` ⇒ implicit limit 1, mirrors enrichVenues.ts (§9). |
| A9 | cache-only doesn't disable throttle | Low | **A** | `--cache-only` disables all delays (§5, §9). |
| A10 | `notes` format/length undefined | Low | **A** | Canonical `notes` string + 500-char soft cap (§7b). |
| A11 | Magic-number limit cap | Info | **A** | `PROPOSE_LIMIT_CAP` named constant (§9). |
| A12 | Apply default limit 25 too high | Low | **A** | Pilot apply default = 5 (§9). |
| A13 | Admin credential hygiene | Med | **A** | Dedicated `enrichment-admin` account, signOut after, token-refresh note (§2c). |

**Net:** 26 accepted (several scoped lighter than proposed), 2 rejected (S6 temporal guard, S17 N/A),
2 deferred to scale-up (S7 audit table, S16 booking attribution). No finding was a build-blocker that
survives v2 — the four security "Criticals" (S1–S4) are all addressed.

---

## 18. Unresolved risks carried into the build ⟲v2

1. **Robots/no-bypass is convention + CI grep, not a cryptographic guarantee.** A determined dev
   could still edit the cache by hand. Accepted: code review + grep is proportionate for a solo repo.
2. **Single-operator accountability.** With one admin and no audit-log table (S7 deferred), the
   proposal row is the only trail. Acceptable now; revisit when a second reviewer or UI appears.
3. **`registrable-domain` (eTLD+1) detection** needs a Public Suffix List. Prefer a tiny vetted
   list/helper over a heavy dep; if none is added, document the simplified same-host fallback and its
   limits (subdomains like `tickets.venue.co.uk` treated as off-domain).
4. **DPIA addendum is a human task** — must be written before `--propose`, not enforceable in code.
5. **Pilot precision is unknown until run.** The £0 dry-run exists precisely to measure it; thresholds
   in §12 decide go/stop. No code risk, but the feature's value is unproven until then.
6. **Category slugs + migration number** are assumptions to confirm against live at build time (§11, A1).
