# DPIA Addendum — Venue Enrichment, Discovery & Closure Automation

**Companion to:** `docs/DPIA.md` · **Lawful basis:** `docs/LIA_venue_enrichment.md`
**Version:** 2.1 (supersedes v2.0 — technical remediation R1/R2/R3/R4-mechanism/R6 applied, 2026-09-01;
see §16. v1.0, "Venue Website Enrichment", was superseded by v2.0)
**Date:** 2026-09-01
**Status:** DRAFT — **still not signed off.** R1, R2, R3, R4 (mechanism) and R6 are implemented and
tested against the unapplied drafts. **This is an engineering-blockers update, not a compliance
sign-off.** R5 (privacy notice), retention *periods*, the Article 14 approach, Art. 22A edge cases, and
licence/attribution positions are all still open and are not things engineering work can close. Must be
reviewed and signed **before the first `--apply` run in any environment, including staging.**
**Prepared by:** development team. v2.0 was a line-by-line audit of the certified architecture at commit
`8a097b7`; this v2.1 update was prepared during the pre-staging remediation pass on the same commit,
verified against the actual current file contents and the full test suite, not assumed from the v2.0
text. **Not a substitute for solicitor/DPO review.**

---

## 0. Why v1.0 was withdrawn

Version 1.0 of this addendum stated, as its central safeguard:

> "**No auto-apply.** Default run mode is dry-run; `--propose` only inserts `pending` rows […]
> Nothing reaches `venues`/`opening_hours` without a named admin action."
> "Confidence is advisory triage only — **it never triggers a write**."

**Both statements are false of the architecture this DPIA now covers.** Migrations 057 (live) and
059/060/061 (drafted) introduce automated application of specific venue fields, automated discovery of
venues that were never in our database, and automated closure flagging. v1.0 also covered only two
tables; the current design has eight, plus a third-party provider (Geoapify) and a local cache of
third-party website HTML.

Continuing to rely on v1.0 would mean asserting a safeguard we do not have. It is withdrawn in full.

**This document does not describe "no automated processing". It describes automated processing with
bounded scope and human control at the consequential points, and it states plainly where that control is
a database guarantee and where it is only operational discipline.**

---

## 1. The distinction this document is built on: LIVE vs DRAFT

**Nothing in §§4–6 below is currently operating on production data.** The autonomous runtime targets
functions and columns that exist only in unapplied drafts, so it cannot run against production today.

This DPIA therefore describes **two different systems**, and every safeguard is labelled:

| | What is true today (production) | What becomes true when 059/060/061 are applied |
|---|---|---|
| Automated field writes | **None occur.** `auto_apply_venue_proposal` exists (057) but **has no caller** — the admin UI calls the manual `apply_venue_proposal` only. | `auto_apply_field_proposal` is called by the runtime for `website`, `phone`, `email`, `opening_hours`. |
| Discovery of new venues | **Does not exist.** | Runtime discovers, scores and quarantines candidates. |
| Closure automation | **Does not exist.** | Runtime may flag `suspected_closed`. |
| Provenance / attribution columns | **Do not exist.** | `data_source_ref`, `attribution_required[]`, `data_source_meta`. |

> **Sign-off must therefore be read as authorising the DRAFT system**, because that is what applying the
> migrations would put live. Do not sign this on the basis that "nothing is happening yet".

⚠️ **Unresolved status question — resolve before sign-off.** `supabase/migrations/README.md:13` lists
migrations 062–067 as applied to production, but the project's own operational memory records **063 as
written and reviewed but NOT applied**, and this repository has twice had DDL that turned out to be
absent from production. **Do not state 063's venue-submission invariants as live safeguards until they
are confirmed by a live `pg_trigger` / `information_schema.column_privileges` probe.**

---

## 2. Nature of the data

- [ ] **Venue data is primarily business data, not personal data.** `venues` is a table of places. It has
      no `user_id`. Most rows concern limited companies, trusts and local-authority facilities.
- [ ] **But some venues are sole traders, and for those the data is personal data.** A business phone,
      a `firstname.lastname@` address, or a proprietor's name identifies a natural person. **This
      addendum treats all extracted contact data as personal data**, because we cannot reliably tell
      which venues are sole traders.
      - ⚠️ The `looksPersonalEmail` heuristic (`scripts/enrich/web/fields.ts:28-35`) matches only
        `firstname.lastname@` / `j_smith@` patterns and exempts ~20 role mailboxes. **It does not catch
        `jane@janesplaycafe.co.uk`**, which is the commonest real sole-trader shape. Do not rely on it
        as a personal-data filter; it is a confidence-scoring hint only.
- [ ] **Admin staff identities are personal data too.** `reviewed_by`, `actor_id` and `applied_by` hold
      the uuid of the employee or volunteer who made each decision. See §8 on the erasure conflict.
- [ ] **Raw website HTML may contain incidental personal data** — staff names, personal emails, and on a
      children's-venue site, **photographs of children**. This is cached to local disk (§7, stage 2).
- [ ] **Not special-category data.** No children's data, no health data, no location of individuals is
      *sought*. Venues are places, not people. **This remains the scope boundary and must not drift.**

---

## 3. Nature, scope, context and purposes of the processing

**Purpose:** to keep a public directory of family-friendly venues accurate — correct opening hours,
contact details, accessibility facilities, and whether a venue is still trading.

**Scope:** three distinct processing activities, previously conflated:

1. **Enrichment of existing venues** — reading a venue's own public website for specific facts.
2. **Discovery of new venues** — querying a third-party provider (Geoapify, over OpenStreetMap) for
   places not yet in our database.
3. **Closure detection** — looking for evidence that a listed venue has ceased trading.

**Context:** the data subjects (venue operators, including sole traders) **have no relationship with
PlayPlanner, no account, and no notice**. They did not give us this data; we collected it from public
sources. That is the single most important contextual fact in this assessment and it is what makes
Article 14 (§9) the sharpest obligation here.

---

## 4. EXISTING VENUES — automated field enrichment

### 4.1 What may be applied automatically

| Field | Auto-apply (DRAFT 059/060) | Overwrite protection |
|---|---|---|
| `website` | Yes | Fill-if-empty, enforced in SQL (`059:428-431`) |
| `phone` | Yes | Fill-if-empty, enforced in SQL (`059:428-431`) |
| `email` | Yes | Fill-if-empty, enforced in SQL (`059:428-431`) |
| `opening_hours` | Yes | ✅ Fill-if-empty, enforced in SQL (`enrichment_opening_hours_is_meaningful`) — see 4.3 |
| `description` | Only via `auto_apply_generated_description`, fill-if-empty (`060:236`) | Verbatim copying blocked (§12) |
| `booking_url` | Only via `auto_apply_booking_url`, fill-if-empty + HTTPS + same-host identity (`060:712`) | §13 |
| `price_range` | **Never** — hard refusal (`059:400-402`) | n/a |

**Confidence gates:** `phone` 88, `email` 90, `website` 90, `opening_hours` 92, `+5` for a newly created
venue (`scripts/enrich/web/autoApplyPolicy.ts:66-74`).

> 🔴 **These thresholds are NOT enforced by the database.** `auto_apply_field_proposal` compares
> `p_confidence_score >= p_min_score`, and **both values are supplied by the caller** (`059:388-390`). A
> caller passing `p_min_score = 0` passes the gate. The same is true of `conflicts_existing`, which is
> computed in TypeScript (`scripts/enrich/web/proposals.ts:56`) and not re-derived in SQL.
> **The numeric thresholds are an application-layer policy, not a database guarantee, and this DPIA must
> not describe them as a technical safeguard.** The genuine server-side rules are the field allowlist,
> the fill-if-empty rule for four fields (`website`/`phone`/`email`/`opening_hours` — `opening_hours`
> added by the 2026-09-01 R1 fix, §4.3), the field/venue/source suppression check (§10.1, R3), the
> seasonal-notes guard, and the stale-hash check.

### 4.2 Genuine safeguards (server-side, verified)

- [ ] **Field allowlist by exclusion** — `description`, `price_range`, `booking_url` raise on the generic
      path (`059:400-402`).
- [ ] **Stale-hash guard** — a proposal computed against a value that has since changed is refused
      (`057:437-439`, re-checked inside the write primitive).
- [ ] **Seasonal-notes guard** — `opening_hours` will not auto-apply over a non-empty `seasonal_notes`
      (`059:421-424`).
- [ ] **Immutable write ledger** — every apply and rollback writes one row to `venue_enrichment_writes`
      with `old_value`, `new_value`, `applied_mode`, `source_url`, `evidence_snapshot` (`057:83-116`).
      INSERT/UPDATE/DELETE are revoked from every role including `service_role` (`057:126-128`).
- [ ] **Rollback exists** — `rollback_enrichment_run` (`057:534`), admin-only, refuses to clobber a
      later human edit (`057:568-570`). ⚠️ **It has no caller and no UI**; it is a manual SQL action.

### 4.3 ✅ FIXED (2026-09-01, pre-staging remediation R1) — `opening_hours` overwrite guard restored

**Status update, technical only — does not change this document's overall sign-off status (§17).**

A new `enrichment_opening_hours_is_meaningful(jsonb)` function (mirroring the live 057 array-length check
byte-for-byte, not a reinvention) is now called from `auto_apply_field_proposal` alongside the existing
scalar guard, so a venue with a genuine, non-empty published week is refused with
`live_value_not_empty:opening_hours` before `_enrichment_apply_write` ever runs. The human path
(`apply_venue_proposal`) is unaffected — the guard lives entirely in the autonomy policy wrapper, matching
the same pattern already used for the `seasonal_notes_require_human_review` guard.

**Verified, not merely claimed:** `supabase/tests/enrichment_057_rebase_redline.mjs` Part I (I1–I4) — a
venue with a meaningful existing week refuses auto-apply and the week survives untouched (I1); an
all-closed recorded week still counts as "recorded" (I2); a human admin can still deliberately replace an
existing week (I3, proving the human capability was not lost); a stale opening_hours proposal is still
refused (I4). All green, 0 RED.

---

## 5. NEW VENUES — discovery and candidate handling

### 5.1 Release one is human-approval-only

- [ ] **No unattended process can publish a venue through the pipeline's RPC surface.** Exactly one
      function body in the entire schema contains `INSERT INTO venues` — `resolve_discovery_candidate`
      (`061:509`) — and `service_role` is explicitly revoked from it (`061:544-545`). This is proven
      structurally, not by example: the redline suite queries `pg_proc` for any function that
      `service_role` may execute whose source matches `insert into venues`, and asserts zero rows.
- [ ] `resolve_discovery_candidate` requires **both** a non-NULL `auth.uid()` **and** `is_admin()`
      (`061:409-415`) — deliberately separate, so the audit columns can never record a NULL actor.
- [ ] Unattended discovery can reach **`quarantined` at best** (`061:104-168`).
- [ ] **Table CHECK constraints, not RPC convention, refuse a forged approval** (`059:1021-1043`): an
      `approved` row must carry `resolved_mode='manual'` + `reviewed_by` + `reviewed_at` + `venue_id`,
      and `venue_id` may be non-NULL only when `status='approved'`. These bind a `service_role` UPDATE
      that bypasses RLS.
- [ ] **Provenance fails closed** — `discovery_candidate_provenance` (`059:1250-1349`) rejects a
      non-canonical OSM id, a missing/unrecognised licence, or an unknown source, and the caller
      quarantines rather than guessing.

### 5.2 🔴 The limit of that guarantee — state it this way, not more strongly

> **`service_role` holds direct `INSERT`/`UPDATE`/`DELETE` on `public.venues` and bypasses RLS.**

No migration revokes DML on `venues` from `service_role`; the only revokes target `PUBLIC`, `anon` and
`authenticated` (`063:514-516`, `20260829205506:420-421`). The applied privilege-hardening migration
states this in terms: *"service_role keeps all four privileges"*, *"SELECT/INSERT/UPDATE/DELETE grants
are NOT touched anywhere"* (`20260830102402:78-81`).

**The correct formulation for any external statement:** *no unattended process can publish a venue
through the discovery pipeline's RPC surface; a holder of the service-role key can still write to the
`venues` table directly, and the control against that is key custody and code discipline, not a database
boundary.* The same applies to `venues.operating_status` — a direct UPDATE writes no status event.

### 5.3 ✅ FIXED (2026-09-01, pre-staging remediation R2) — the runtime now goes through the guard

**Status update, technical only — does not change this document's overall sign-off status (§17).**

Two independent changes, both required (either alone would have left a gap):

1. **`059`'s grant on `venue_discovery_candidates` is now `REVOKE ALL` for every role, `service_role`
   included — no direct table privilege of any kind.** The only way in is
   `upsert_discovery_candidate` (a `SECURITY DEFINER` function, which needs no table grant on its
   caller). This closes the gap even against a future migration that accidentally re-widens the grant,
   because `upsert_discovery_candidate`'s own terminal-state logic (unchanged, already tested) is what
   actually refuses the reopen — the tightened grant just removes the alternate route around it.
2. **`scripts/enrich/autonomous.ts` no longer calls `.from('venue_discovery_candidates').upsert(...)`.**
   It calls `supabase.rpc('upsert_discovery_candidate', { p_candidate: {...} })`, passing a
   `decision_reason` field for the RPC to fold into `resolution_reasons` on a pipeline rejection, rather
   than computing `resolved_mode`/`reviewed_at` client-side (the RPC now owns that computation
   entirely).

**The previously-identified test weakness is fixed too:** `H28` now checks `['anon', 'authenticated',
'service_role']` — all three hold zero privileges on the table (verified: `G22`'s privilege matrix was
updated to expect this).

**Verified, not merely claimed:** the full `H20`–`H28` series in the redline suite (rediscovering an
approved/rejected/dismissed/duplicate candidate leaves it untouched — `H20-*`; a still-open candidate is
correctly refreshed — `H24`; provenance is updated but never blanked — `H25`; the pipeline cannot forge a
human-only status — `H26`; a pipeline rejection carries the required audit — `H27`; no direct table DML
for any role, service_role included — `H28`), plus a new TS-level regression test
(`scripts/enrich/discovery/__tests__/discoverCandidates.test.ts`) proving the runtime no longer re-queues
a `terminal_unchanged` outcome for human review. All green, 0 RED.

---

## 6. CLOSURE — automation may only suspect, never confirm

- [ ] **`system_flag_suspected_closure` has no target-status parameter.** `'suspected_closed'` is a
      literal in the function body (`059:804`). It is a no-op unless the venue is currently `active`.
      Granted to `service_role` only (`059:809-811`).
- [ ] **The transition matrix independently forbids anything else for automation** — for `mode='auto'`,
      only `active → suspected_closed` is permitted; everything else raises (`059:697-701`).
- [ ] **`active → confirmed_closed` is forbidden even for an admin** (`059:702-711`). A human must flag,
      then confirm — two deliberate steps.
- [ ] **`confirm_venue_closure` and `reactivate_venue`** each require non-NULL `auth.uid()` **and**
      `is_admin()`; `service_role` is revoked (`059:860-861`, `059:894-895`).
- [ ] **Every status transition is audited atomically.** The `UPDATE venues` and the
      `INSERT INTO venue_operating_status_events` are consecutive statements in one function body; any
      failure rolls back both. `mode='auto'` ⇒ `actor_id IS NULL`; `mode='manual'` ⇒ `actor_id IS NOT
      NULL`, enforced by table CHECK (`059:572-575`).
- [ ] **`suspected_closed` has no user-facing effect today.** It does not change visibility
      (`059:735-736`), and no file in `app/`, `components/` or `hooks/` reads `operating_status`. Its one
      current consequence is internal: the venue drops out of future enrichment crawls.

> ⚠️ **Trigger condition to re-assess:** if a "may have closed" badge is ever surfaced in the app, this
> flag becomes an automated, consumer-visible statement about a business — and for a sole trader, about
> a person's livelihood. **That change requires this DPIA to be revisited before it ships.**

⚠️ **Do not describe `venue_closure_signals` as an operating safeguard.** The table exists in draft, but
**nothing writes to it** — `autonomous.ts:671` calls `system_flag_suspected_closure` with only
`p_venue_id` and `p_reason`, never `p_signal_id` or `p_evidence`. The evidence table would be
permanently empty. This remains true after the R6 fix below; wiring the write path is separate,
still-unstarted work.

✅ **FIXED (2026-09-01, pre-staging remediation R6):** `scripts/enrich/web/closureSignals.ts`'s
`detectClosureText` now routes the evidence snippet through `cleanEvidence` (the same canonical
`scrubPii`-based scrubber used elsewhere in the schema) before it is ever assigned to `evidenceSnippet`,
instead of a raw `text.slice(…).trim().slice(0, 512)`. **Stated honestly, not overclaimed:** `scrubPii` is
a regex-based redactor for email/phone/UK-postcode shapes only — it does **not** do named-entity/
person-name detection (e.g. "ask for Dave" is not caught), which is a pre-existing limitation shared by
every other `evidence_snippet` in this schema, not something this fix introduces or resolves. Verified by
new tests in `scripts/enrich/web/__tests__/closureSignals.test.ts` (redacts an adjacent email; redacts an
adjacent phone number; documents the named-entity limitation explicitly rather than silently relying on
it; ordinary non-PII evidence is unaffected). This closes the gap for *if* the evidence table is ever
wired — it remains genuinely unwired today, per the paragraph above.

---

## 7. Data flow and storage map

| # | Stage | Personal data | Location | Access | Retention |
|---|---|---|---|---|---|
| 1 | Provider query (Geoapify/OSM) | Business names, addresses, phones; sole-trader details | In memory; fixtures in `scripts/enrich/fixtures/` | Operator process | **NONE DEFINED** |
| 2 | Website crawl | **Full raw HTML**, incl. incidental staff names and possibly photographs of children | **Local disk**, `scripts/data/raw/website_cache/` (~15 MB, 81 pages) | Operator filesystem — **no encryption, no access control beyond the OS** | **NONE DEFINED.** The 30-day `pageTtlMs` is a *freshness* check, not deletion — nothing ever unlinks a file |
| 3 | Extraction | `evidence_snippet` PII-scrubbed; **`evidence_raw` is NOT scrubbed** | In memory | Operator process | n/a |
| 4 | Proposal | `proposed_value`, `current_value`, evidence, `source_url` | `venue_field_proposals` (**LIVE**) | admin RLS; `service_role` writes via RPC | **NONE DEFINED** |
| 5 | Candidate | `name`, `phone`, `website`, address, coords | `venue_discovery_candidates` (**DRAFT**) | admin RLS; **`service_role` holds no direct table privilege at all** (R2 fix, §5.3) — the only route in is `upsert_discovery_candidate`, which also checks source-level suppression (R3, §10.1) first | ✅ Mechanism exists — `purge_old_discovery_candidate_contact_data` (§8.2) — but no period is approved and it is deliberately unarmed |
| 6 | Write ledger | `old_value`, `new_value`, evidence snapshot | `venue_enrichment_writes` (**LIVE**) | admin SELECT; all DML revoked | **NONE DEFINED** |
| 7 | Status ledger | Admin `actor_id` | `venue_operating_status_events` (**DRAFT**) | admin SELECT; append-only trigger, narrow purge-only bypass (§8.1) | **NONE DEFINED — periods still require sign-off.** Client/service roles cannot mutate or delete this history; a narrowly-scoped purge function can age out old rows once a period is approved, but that function is deliberately unarmed (`EXECUTE` revoked from every role) until then (§8) |
| 8 | Human review | Admin identity | `reviewed_by` / `actor_id` | admin | — |
| 9 | Public venue | Contact details, incl. sole-trader personal data | `venues` | **Public** | **NONE DEFINED** |

**Reports on disk:** `scripts/enrich/out/` contains real extracted contact data (e.g. `run.json` carries a
live phone number) and has not been cleaned since June. Both directories are correctly gitignored.

---

## 8. Retention and deletion

> **UPDATE (2026-09-01, pre-staging remediation R4) — the TECHNICAL CAPABILITY now exists; the LEGAL
> PERIODS remain unapproved.** This section originally read "there is no retention mechanism of any kind
> anywhere in this repository" — that is no longer true of the *mechanism*, but it remains true that
> **no retention period in this document is signed off**, and nothing here has been scheduled to run
> anywhere. Do not read the paragraphs below as retention having "started" — they describe capability,
> not policy. §17's sign-off checklist is unchanged: retention periods approved is still a precondition,
> not a completed item.

**What now exists:** one purge function per store below, each a narrowly-scoped `SECURITY DEFINER`
function with an **explicit, required, floor-guarded age parameter** (no silent default long enough to
matter) and **`EXECUTE` revoked from every role, including `service_role`** — there is deliberately no API
path that can invoke any of them today. Turning one on, once a period is approved, is "grant `EXECUTE`
to whichever role will run it, and schedule the call" — not "design a retention mechanism against a live
table for the first time." Which specific numbers to use are still marked `OWNER / LEGAL SIGN-OFF
REQUIRED` throughout this section — none of the values below are asserted as approved.

**The structural blocker this section previously described is fixed:** `venue_operating_status_events`'s
append-only trigger raised unconditionally for `UPDATE OR DELETE`, for every role including the table
owner — meaning **no retention period could ever be expressed on that table by any means**, including a
future signed-off admin action. The trigger now additionally checks a session-local flag
(`current_setting('app.enrichment_retention_purge', true) = 'on'`) that only
`purge_expired_operating_status_events` ever sets, only inside its own transaction, reset before
returning. **`UPDATE` is not exempted under any setting** — only aged-out `DELETE`, and only through this
one function. Verified: an ordinary `DELETE` (even as the table owner, outside the purge function) is
still refused (`K2`); after a purge runs, the append-only guarantee is restored and does not leak into
later statements (`K4`).

**Original wording retained below for context — read the update above first, then this:**
>
> There was no retention mechanism of any kind anywhere in this repository. No `pg_cron` job, no
> scheduled function, no cleanup script, no TTL column, no eviction pass. Verified by exhaustive search.

The 90-day / 30-day rule from v1.0 §4 was written down three times — in the migration comment
(`056:45-49`), in v1.0 itself, and in the spec — and **implemented zero times**.

**An immutable audit log does not self-justify indefinite retention.** Storage limitation
(Art. 5(1)(e)) applies to audit trails too; "we need it for accountability" is a purpose with a period,
not a purpose without one.

### 8.1 ✅ FIXED (2026-09-01, pre-staging remediation R4) — `venue_operating_status_events` can now be aged out, deliberately and narrowly

**Original problem (kept for record):** append-only was enforced twice — all DML revoked from every role,
**and** a `BEFORE UPDATE OR DELETE` row trigger that raised unconditionally. A row-level trigger in
PostgreSQL fires regardless of the executing role, **including the table owner**, so no retention period
was expressible on this table at all without disabling the integrity control that guarantees the audit
trail — the control and the Art. 5(1)(e) breach were the same mechanism.

**Fix:** the trigger now lets a `DELETE` through **only** when a session-local flag
(`current_setting('app.enrichment_retention_purge', true) = 'on'`) is set, and the **only** code path
that ever sets it is `purge_expired_operating_status_events`, inside its own transaction, unset again
before returning. `UPDATE` is never exempted, under any setting — the append-only guarantee for a live
row is untouched by this fix; only an aged-out row can ever be removed, and only through this one
function. `EXECUTE` on that function is revoked from every role including `service_role` — it is not
callable via the API until someone with direct database access grants it, which should happen only after
sign-off (see §17).

**The FK/cascade consequence is unchanged and remains open:** the FK is `on delete cascade`; a cascade
issues a row-level DELETE, which the trigger still refuses outside a purge call. **`DELETE FROM venues`
still fails for every ordinary role once a venue has one status event.** This is not something R4 was
scoped to fix (it is about a *venue's* deletion, not the *event log's* retention) and remains a genuine
gap: **hiding is still the only available erasure primitive for a venue today.**

**Verified, not merely claimed:** `K2` (ordinary DELETE still refused, including as the owning role,
outside the purge function); `K3` (the purge function deletes only rows older than its cutoff, nothing
newer); `K4` (after a purge call returns, the append-only guarantee is restored — the bypass does not
leak into a later, unrelated statement). All green, 0 RED.

### 8.2 Proposed periods — all STILL require owner sign-off; the MECHANISM now exists for each row below

| Store | Proposed rule | Mechanism |
|---|---|---|
| `venue_enrichment_runs` | Delete >12 months where all child proposals are terminal | Not yet built — narrower than the others, deferred |
| `venue_field_proposals` | rejected → 90d; superseded/report_only → 30d; applied → retained, reviewed at 24m | ✅ `purge_old_field_proposals(p_rejected_after_days, p_superseded_after_days)` — deletes rejected/superseded/report_only only; `applied` and `pending` are never touched |
| `evidence_raw` | Null at 30d past terminal state; keep the 512-char snippet with applied rows | Not yet built as a separate function — folded into the field-proposals purge scope for a future pass |
| `venue_enrichment_writes` | 24 months, then null `evidence_snapshot`/`old_value`/`new_value`, keep skeleton | ✅ `purge_old_enrichment_write_evidence(p_older_than_days)` — nulls the three evidence-bearing columns, keeps the skeleton row (what/when/mode) |
| `venue_discovery_candidates` | rejected/dismissed/duplicate → null `phone`/`website`/`address_line1` at 90d, keep decision skeleton | ✅ `purge_old_discovery_candidate_contact_data(p_older_than_days)` — never touches `approved` rows (the audit trail for a live venue) |
| `venue_closure_signals` | 180d after status settles | ✅ `purge_old_closure_signals(p_older_than_days)` |
| `venue_operating_status_events` | **Architecture decision required** — period still needs approval | ✅ Architecture built (§8.1); `purge_expired_operating_status_events(p_older_than_days)`, floor-guarded at 365 days |
| Local cache + reports | Evict pages/robots past TTL at run start; delete reports >30d | Not yet built — filesystem-side, not a database function |

**Every function above shares three properties, deliberately:** the age parameter is **required**, not
defaulted, with a **floor** that rejects an implausibly short period outright (proving nothing was
fat-fingered even in principle — `K1`); **`EXECUTE` is revoked from every role**, so none is reachable
via the API today; and **none references `venue_enrichment_suppressions`** in any `DELETE`/`UPDATE` —
proved by reading the actual function bodies (`pg_get_functiondef`), not by convention (`L1`), and
confirmed behaviourally: a year-old suppression survives every purge function running back-to-back and
still blocks re-enrichment afterward (`L2`).

### 8.3 🟠 Still a live, user-facing inaccuracy — the MECHANISM to fix it now exists, but it is not scheduled

`app/(auth)/privacy.tsx:181-183` still tells every user that location-consent and GDPR audit log entries
are kept for 3 years **"then deleted automatically."** This remains **not true** — nothing deletes them
yet, and this remediation pass does not change that user-facing reality.

**What changed:** `purge_expired_location_consent_log(p_older_than_days DEFAULT 1095)` and
`purge_expired_gdpr_audit_log(p_older_than_days DEFAULT 1095)` now exist as `SECURITY DEFINER` functions
against the live (`001_initial_schema.sql`) tables, with a default matching the promise exactly (1095
days = 3 years) because **the period itself is not in question here** — it is the one retention period
in this whole document that is already a live commitment, not a draft awaiting sign-off. **`EXECUTE` is
still revoked from every role.** Actually scheduling these (`pg_cron`, or an ops script) is a separate,
deliberate deployment decision this remediation pass does **not** make unprompted, and neither function
has been applied anywhere (they live in the same unapplied `059` draft as everything else in this
document).

**This is therefore still an open, user-facing transparency failure, unchanged in severity by this pass.**
The cheapest immediate fix remains either: correct the wording in `privacy.tsx` to stop overstating a
safeguard that does not yet run, or take the deliberate next step of scheduling the now-built functions.
Both are Liam's call, not this pass's to make.

---

## 9. Article 14 — the sharpest obligation here

Enrichment data is **not obtained from the data subject**, so Article 14 applies. See
`docs/LIA_venue_enrichment.md` §5 for the full analysis. In summary:

- **Nothing in the pipeline notifies a venue operator** that their details were crawled, scored and
  republished. No notice exists in any form.
- **Timing:** within a reasonable period and at most **one month**; or, if the data is used to
  communicate with the person, at the latest at first communication.
- **Required content:** controller identity, purposes, lawful basis (legitimate interests, plus the
  interests pursued), **the categories of data**, **the source and whether it was publicly accessible**,
  recipients, retention, and the rights to object, rectify, erase and complain to the ICO.
- **The "disproportionate effort" exception (Art. 14(5)(b)) is `LEGAL/OWNER DECISION REQUIRED`.** It is
  not self-applying. If relied on, we must **still** publish the privacy information, **carry out this
  DPIA**, and **document a proportionality balance**. Evidence needed: the number of affected venues, how
  many have a reachable published contact address, the cost of contacting them, and the effect of the
  processing on them. **With a directory in the low thousands and a published email address for most
  venues, "disproportionate" is a hard argument to sustain** — unlike the web-scale scraping cases the
  ICO usually discusses it in.
- **A realistic middle path:** publish a public enrichment notice (see §16 R5), and send an actual
  notification at the point we first contact a venue or when a claim is made.

---

## 10. Rights: correction, objection, erasure

| Right | Route today | Verdict |
|---|---|---|
| Operator corrects own listing | DB boundary exists (`20260829205506:277-280`) but **there is no in-app claim or edit screen**; `hooks/useVenueClaims.ts` has no user-facing consumer and production holds **0 claimed venues** | 🟠 **Blocked in practice** |
| Correction of personal contact data | ✅ **Now durable** — see §10.1 (was 🟠 not durable) | 🟢 **Durable, admin-operated** |
| Objection | ✅ **Mechanism now exists** — `venue_enrichment_suppressions` (§10.1) | 🟢 **Present, admin-operated** (was 🔴 Absent) |
| Erasure | No role holds DELETE on the candidate, signal, or write-ledger tables; the status ledger refuses ordinary deletion from every role. **Retention capability now exists** (§8) as a separate, narrower mechanism (ages out old rows once periods are approved) — this is not the same as an individual erasure request, and remains 🔴 for that purpose | 🔴 **Effectively absent for individual erasure; retention is a different, now-built capability** |
| Venue removal | Admin-only; no operator route; a venue cannot be *deleted* at all (§8.1) | 🟠 **Partial** |
| Suppression from future enrichment | ✅ **Built (2026-09-01, R3)** — see §10.1 | 🟢 **Present** (was 🔴 Absent — root cause of the rows above) |

### 10.1 ✅ FIXED (2026-09-01, pre-staging remediation R3) — a durable suppression/objection mechanism

**Status update, technical only — does not change this document's overall sign-off status (§17). A
technical capability existing is not the same as this DPIA being signed off; §17's sign-off checklist is
unchanged by this section.**

`venue_enrichment_suppressions` — a new admin-only table, enforced **server-side inside the write path
itself**, not in TypeScript (the exact lesson §5.3/R2 already proved: a rule the service-role holder can
skip is not a rule):

- **`propose_field`** (extended by `CREATE OR REPLACE`, same technique 057 already used on 056) now
  checks `enrichment_venue_field_suppressed(venue_id, field)` **before anything else runs**, and fails
  closed with `field_suppressed:<field>` — a suppressed field never reaches a proposal row of any kind,
  not even a `report_only` one.
- **`auto_apply_field_proposal`** re-checks the same function **at the point of auto-apply**, not only at
  propose time — closing the exact gap the trace in the old §10.1 (below) described: a suppression
  created *after* a proposal was already queued still stops that proposal from being applied.
- **`upsert_discovery_candidate`** checks `enrichment_candidate_source_suppressed(source, source_id)`
  as its first line, before the first-sighting INSERT branch — a venue operator who does not want to be
  discovered at all can be suppressed by provider identity even before any candidate row exists for
  them.
- **Field-level suppression does not over-suppress:** `field IS NULL` means "the whole venue";
  `field = 'phone'` blocks only that field, leaving `website`/other fields free to enrich normally.
- **None of the three checks branch on caller role.** `service_role` gets no exemption — proven by
  calling the checks explicitly as `service_role` in the test suite, not merely inferred.
- **Removal is a deliberate, admin-only, soft delete** (`remove_enrichment_suppression`) —
  `removed_by`/`removed_at`/`removal_notes` are recorded, not a hard `DELETE`, so "an admin restored
  eligibility on this date, for this reason" is itself an accountable, auditable act.
- **Retention never touches this table.** No purge function in §8 references
  `venue_enrichment_suppressions` in any `DELETE`/`UPDATE` — proved structurally by reading every purge
  function's body (`pg_get_functiondef`), not just by convention — so an objection cannot be silently
  lifted by an unrelated maintenance job before its purpose has expired.

**The trace that used to defeat objection (kept here as the regression this fix targets, now closed):**
a sole trader objects to their personal mobile appearing; an admin blanks `venues.phone` **and creates a
suppression** for that venue+field; the next crawl re-extracts the same number and calls `propose_field`,
which now fails closed with `field_suppressed:phone` before a proposal row is ever created — there is
nothing left for a well-intentioned colleague to approve.

**What this does NOT change:** creating a suppression is still an **admin-operated** action — there is no
operator-facing self-service objection form (see the "Operator corrects own listing" row above, still
blocked in practice by the missing claim/edit screen). The suppression mechanism makes an admin's
enforcement of an objection durable; it does not yet give the data subject a direct channel to request one.
That gap is a product/UX item, not a database one, and is not closed by this remediation pass.

**Verified, not merely claimed:** `supabase/tests/enrichment_057_rebase_redline.mjs` Part J (`J1`–`J9`) —
a suppressed field cannot be re-proposed (`J1`); a suppression created after a proposal is queued still
blocks auto-apply (`J2`); suppressing one field leaves an unrelated field free (`J3`); a whole-venue
suppression blocks every field (`J4`); a whole-source suppression blocks a new candidate's first sighting
(`J5`); `service_role` cannot bypass the check (`J6`); admin removal deliberately restores eligibility,
recorded not deleted (`J7`); a non-admin cannot create or remove a suppression (`J8`); the full ACL matrix
for every new function and the table itself (`J9`). Part L (`L1`–`L2`) separately proves no retention
function references the suppression table, and a year-old suppression survives every retention pass and
still blocks re-enrichment afterward. All green, 0 RED.

---

## 11. Automated decision-making (UK GDPR Arts. 22A–22D as amended by the DUAA)

⚠️ **Legal position is in flux.** The Data (Use and Access) Act 2025 replaced Article 22 with
**Articles 22A–22D**; all DUAA data-protection provisions came into force **19 June 2026**. The ICO's
final ADM guidance is **still pending (due Winter 2026)**; consultation closed 29 May 2026. **Do not
treat this section as settled law — revisit on publication.**

Under Art. 22A a decision is "based solely on automated processing" where there is **no meaningful human
involvement**, and "significant" where it has a **legal or similarly significant effect** on the person.

| Path | About an individual? | Significant effect? |
|---|---|---|
| Validation of venue facts (URL/phone/email/enum shape) | No — about a string | No |
| Auto-apply of `website`/`phone`/`email`/`opening_hours` | **Sometimes** — sole traders | Not legal. Arguably *approaching* "similarly significant" for a sole trader, since republishing a personal number to a consumer app increases contact volume and is hard to reverse. **Mitigating:** fill-if-empty means automation only adds what the venue itself published on its own site. **Assessment: below the Art. 22A bar — but a live Art. 14 and rights issue.** |
| Candidate scoring / quarantine | No — about a place | No. **And the decision it gates is "does a human look at this" — it triggers human review rather than replacing it**, which is the opposite of the Art. 22A concern |
| Venue publication | — | **Not automated.** Requires `auth.uid()` + `is_admin()` |
| Suspected-closure flagging | **Sometimes** — sole traders | **No effect today** — not visible in the app, does not change visibility. See the §6 trigger condition |
| Confirmed closure / delisting | **Sometimes** | **This is the genuinely consequential decision** — delisting a sole trader from a family discovery app is an economic effect. **It is reserved to a named human, structurally unreachable by automation, reversible, and fully audited.** This is the strongest answer in the architecture |

**Assessment: no path currently constitutes solely automated decision-making with legal or similarly
significant effects on a natural person.** The consequential decisions are all human, with a named actor
recorded.

**`LEGAL SIGN-OFF REQUIRED`** on two edge cases: (a) whether auto-publishing a sole trader's personal
contact details to a consumer app crosses "similarly significant"; and (b) whether a consumer-visible
"suspected closed" flag would, if ever surfaced. **Neither should be closed out internally**, and both
should be revisited when the ICO's final ADM guidance lands.

---

## 12. Copyright, database right and the description rule

- [ ] **Facts may be extracted; expressive prose may not be copied.** Copyright does not protect facts
      (opening times, a phone number, an address) but does protect the venue's descriptive writing.
- [ ] **`description_not_rewritten` guard must be retained.** `apply_venue_proposal` raises if the
      applied text equals the captured evidence. ⚠️ **Its limits must be stated honestly:** it is an
      equality check, so a trivially altered copy passes. **It is a backstop against verbatim paste, not
      a plagiarism detector**, and reviewer guidance must carry the real obligation.
- [ ] `auto_apply_field_proposal` **never** auto-applies `description` (`059:400-402`).
- [ ] **Do NOT rely on a UK text-and-data-mining exemption.** CDPA s.29A is limited to non-commercial
      research; the proposed broader commercial exemption was withdrawn. PlayPlanner is a commercial
      service. `LEGAL/OWNER DECISION REQUIRED` if any broader reliance is contemplated.
- [ ] **Database right** — extracting substantial parts of a third-party database may infringe the sui
      generis right independently of copyright. Relevant to bulk provider data, not to single-venue
      fact reads.

---

## 13. Fetch ethics and security

- [ ] **robots.txt always honoured, no bypass flag exists, fails closed** when robots cannot be retrieved.
- [ ] **SSRF protection** — per-hop URL safety check with manual redirect handling; off-domain redirects
      refused.
- [ ] **Throttling** — 3 s per-domain interval; size, type and timeout caps; never impersonates a browser
      user-agent.
- [ ] **Only the venue's own site is read.** No aggregator or review-site scraping exists in the codebase.
- [ ] **Booking links:** automation is HTTPS-only, structurally validated, no `user:pass@` userinfo,
      fill-if-empty, and anchored to the venue's own trusted host. A third-party booking provider may be
      approved **only by a human admin**, with the actor recorded.
- [ ] **No affiliate tracking, commissions, paid ranking or sponsored placement exists anywhere in the
      codebase.** Recorded here as a positive finding; if that ever changes, disclosure becomes a
      consumer-protection obligation (CPUT/DMCCA) as well as a trust matter.
- [ ] ⚠️ **The UI should make clear when a booking link leads to an external third party.** Not currently
      signalled.

---

## 14. Attribution

- [ ] **OSM/ODbL attribution must be visible to anyone exposed to the produced work, without requiring
      interaction** (OSMF Attribution Guidelines). **Database provenance is not attribution** —
      `data_source`, `data_source_ref` and `attribution_required[]` record where data came from; they do
      not credit anyone in the UI.
- [ ] **There is currently no attribution anywhere in the app UI.** `docs/DPIA.md` already carries this
      as an open risk, rated LOW; **for OSM-derived venue data it is a licence-compliance obligation, not
      a nicety**, and should be re-rated.
- [ ] **Geoapify:** OSM attribution is always required; Geoapify's own attribution is required on the
      free tier and waived on paid "white label" plans. **Keep this data-driven from
      `attribution_required[]` rather than hard-coded**, because it varies by source and subscription.
- [ ] The licence positions recorded in draft 059 are **assumptions requiring sign-off**, not legal advice.

---

## 15. Security and access control

- [ ] **RLS admin-only** on every enrichment table; no `anon`/`authenticated` grant exists on the
      proposal, candidate, signal or ledger tables.
- [ ] **Least privilege:** `propose_field` and the auto-apply functions are `service_role`-only; the
      admin functions are `authenticated` + `is_admin()`-gated with `service_role` revoked.
- [ ] ⚠️ **Residual:** `apply_venue_proposal` / `reject_venue_proposal` retain a `service_role` EXECUTE
      grant (`057:823`), harmless **only** because a service-role JWT carries no `sub` so `is_admin()`
      returns false. **That is a reasoned assumption asserted in a code comment and never verified
      against live production.** 061 revoked `service_role` from its own admin functions for exactly this
      reason; 057 was never brought into line. **Verify or revoke.**
- [ ] ⚠️ **`autonomous.ts:986-989` writes `venue_facilities` rows directly by PostgREST**, with no
      proposal, no ledger row, no threshold and no rollback — while `autonomous.ts:14-16` claims *"this
      script never updates venues/opening_hours directly"*, which is literally true and materially
      misleading. **Facilities are a child-safety-relevant attribute** (accessibility, baby-change).
      **This write path is outside every safeguard described in this DPIA.**
- [ ] **Secrets:** service-role key from `scripts/.env`, never logged; the Geoapify key is redacted in
      error paths.

---

## 16. Remediation required before staging

**Status as of 2026-09-01 (pre-staging remediation pass): R1, R2, R3, R4 (mechanism) and R6 are
IMPLEMENTED AND TESTED. This does NOT change the overall verdict to PASS — R5, R7–R11 remain open, and
critically, retention PERIODS, Article 14 approach, Art. 22A edge cases, and legal/owner sign-off are
NOT engineering work and are NOT satisfied by any of the fixes below. See §17.**

**Technical — status:**

- **R1 — ✅ FIXED.** `opening_hours` is now in the fill-if-empty guard (via
  `enrichment_opening_hours_is_meaningful`, mirroring 057's live check), matching the live 057 behaviour.
  See §4.3. Tested: redline Part I (4 tests).
- **R2 — ✅ FIXED.** `service_role`'s grant on `venue_discovery_candidates` is now `REVOKE ALL` (no
  privilege at all, not just a narrowed one), and the runtime routes through `upsert_discovery_candidate`
  exclusively. `H28` now checks `service_role` alongside `anon`/`authenticated`. See §5.3. Tested: redline
  `H20`–`H28`, plus a new TS regression test.
- **R3 — ✅ FIXED.** `venue_enrichment_suppressions`, enforced server-side inside `propose_field`,
  `auto_apply_field_proposal` and `upsert_discovery_candidate` — none of the three checks branch on
  caller role. See §10.1. Tested: redline Part J (9 tests) and Part L (2 tests, retention interaction).
- **R4 — ✅ MECHANISM BUILT; PERIODS STILL UNAPPROVED.** A purge function per store (§8.2), each
  floor-guarded, each with `EXECUTE` revoked from every role including `service_role` — not callable via
  the API today. The structural blocker (`venue_operating_status_events`' unconditional append-only
  trigger) is resolved via a narrow, purge-function-only bypass. **The `on delete cascade` /
  venue-deletion gap named in §8.1 is NOT resolved** — it was out of R4's scope (event-log retention, not
  venue erasure) and remains open. See §8. Tested: redline Part K (7 tests) and Part L.
- **R5 — Still open.** Publish an enrichment privacy notice (§9) covering source categories, lawful
  basis, purposes, retention, rights, objection and the ICO route. Not engineering work; not started by
  this pass.
- **R6 — ✅ FIXED.** `closureSignals.ts`'s `detectClosureText` now routes through `cleanEvidence`
  (`scrubPii`) before persistence. See §6. Tested: 4 new Jest tests, including one that honestly documents
  the scrubber's named-entity-detection limitation rather than overclaiming it.

**Documentation / decision:**

- **R7** — Correct the "deleted automatically" claim in `app/(auth)/privacy.tsx:181-183` (§8.3).
- **R8** — Add enrichment and Open-Meteo to both privacy notices.
- **R9** — Resolve the 063 applied/not-applied conflict by live probe (§1).
- **R10** — Verify or revoke the residual `service_role` grants (§15).
- **R11** — Surface OSM/ODbL attribution in the app UI (§14).

---

## 17. Sign-off — required BEFORE any `--apply` run in any environment

- [ ] This addendum reviewed against master `docs/DPIA.md`; **LIA recorded** (`docs/LIA_venue_enrichment.md`)
- [x] **R1, R2, R3, R6 implemented and tested** (2026-09-01 pre-staging remediation pass — see §16)
- [x] **R4 mechanism implemented and tested** — periods themselves are a separate, still-open sign-off item (see the retention-periods line below, and §8.2)
- [ ] **R5 (enrichment privacy notice) — still open, not started**
- [ ] **Article 14 approach decided and evidenced** — notice published, or disproportionate-effort
      assessment documented with the evidence in §9
- [ ] **Retention periods approved** and the `venue_operating_status_events` architecture decision made
- [ ] **Art. 22A edge cases signed off** (sole-trader contact publication; any future closure badge)
- [ ] **Licence/attribution positions signed off** (§14) — these are assumptions, not legal advice
- [ ] 063 applied/not-applied status confirmed by live probe
- [ ] **Data-protection owner sign-off:** name __________ date __________
- [ ] **Legal review** of §§9, 11, 12, 14 by a qualified UK practitioner: name __________ date __________

**Only then** may 059/060/061 be applied to a non-production environment, and only then may a gated pilot
run.
