# Website Enrichment — Exception-Only Decision Contract (Phase 1, LOCKED)

**This is the single source of truth for the agented build.** The TypeScript mirror
is `types/enrichmentDecision.ts` (engine + UI import it). SQL cannot import TS, so the
migration mirrors these strings by hand. Any change here must be made in all three
places (this file, the TS contract, the migration CHECK constraints) and is verified
at the **Phase 3 reconciliation gate**.

---

## 0. Locked product/architecture decisions (do not relitigate)

- **Apply mechanism = in-app authenticated admin confirm ONLY.** No CLI admin-login in v1.
- Enrichment script (service_role) **extracts + persists proposals/decisions only**. It
  **must never apply or roll back** live venue fields.
- Apply + rollback require the **authenticated admin session** (`auth.uid()` + `is_admin()`).
  Service_role fails `is_admin()` by design (no profiles row) — this is the enforcement.
- **No valid non-empty field is ever auto-overwritten.** Engine routes such cases to
  `manual_review`; the RPC re-enforces (moves to manual_review at write time).
- Every write re-checks the stale hash; every successful write appends an immutable
  ledger row. Rollback **appends a compensating row**, never edits history.
- Closing the app must not duplicate completed writes → batch is **resumable** by
  re-querying which `auto_apply` proposals are still `pending`.
- `auto_reject` and `report_only` are **persisted for audit but never actionable cards**.
- **No paid AI API.** Descriptions are composed deterministically from verified facts.
- **No** production enrichment / migration apply / commit / push / deploy in this task.

---

## 1. Decision union  (mirror of `EnrichmentDecision`)
`auto_apply` | `manual_review` | `auto_reject` | `report_only`

## 2. Status union  (mirror of `ProposalStatus`; venue_field_proposals.status CHECK)
`pending` | `approved` | `applied` | `rejected` | `superseded` | `report_only`

**Decision → initial stored status** (also in `DECISION_TO_INITIAL_STATUS`):
| decision | stored status at propose time | becomes |
|---|---|---|
| auto_apply | `pending` (decision='auto_apply') | `applied` (applied_mode='auto') after in-app batch |
| manual_review | `pending` (decision='manual_review') | admin resolves → applied/rejected |
| auto_reject | `rejected` (decision='auto_reject') | terminal, audit only |
| report_only | `report_only` (decision='report_only') | terminal, audit/retry only |

Only `manual_review` (status `pending`/`approved`) is an **actionable card**.

## 3. applied_mode  (mirror of `AppliedMode`)
`auto` | `manual`

## 4. Reason codes
The closed set is the `ReasonCode` union in `types/enrichmentDecision.ts` §4 with the
`REASON_LABELS` map. **The engine emits only those codes; the UI renders via that map.**
Do not invent ad-hoc strings. `decision_reasons` is a **jsonb array of these strings**.

## 5. Engine version
`DECISION_ENGINE_VERSION = 'decision-engine@1.0.0'`. Stamped on every row's
`decision_engine_version`. `'legacy-pilot'` = pre-engine rows (057 backfill).

---

## 6. Database changes (owned by the Database/Security agent)

Finish migration **`057_enrichment_auto_decision.sql`** (uncommitted, NOT applied).
It already provides decision columns, the `venue_enrichment_writes` ledger,
`_enrichment_apply_write`, refactored `apply_venue_proposal`, `auto_apply_venue_proposal`,
`rollback_enrichment_run`, and grants. Two required changes:

### 6a. Fix the pglite test (`supabase/tests/057_enrichment_auto_decision.mjs`)
Currently fails `42P01`: it grants on `venue_enrichment_writes` (created by 057) at
lines ~200-204, **before** `MIGRATION_057` is applied (line ~239). Split the grant:
grant on the 056 tables before seeding; grant on `venue_enrichment_writes` **after**
`db.exec(MIGRATION_057)`. The test must pass and remain a faithful privilege harness.

### 6b. Extend `propose_field` to persist the engine verdict  ⚠ REQUIRED, not yet in 057
The engine computes the decision in TS; it must be stored so `auto_apply_venue_proposal`
can gate on `decision='auto_apply'`. Append three **defaulted** params:

```
propose_field(
  p_run_id uuid, p_venue_id uuid, p_field text, p_proposed jsonb,
  p_source_url text, p_evidence text, p_evidence_raw text,
  p_method text, p_confidence text, p_conflicts boolean,
  p_retrieved_at timestamptz default now(),
  p_decision text default 'manual_review',
  p_decision_reasons jsonb default '[]'::jsonb,
  p_decision_engine_version text default null
) returns uuid
```
- Store `decision`, `decision_reasons`, `decision_engine_version`, `decision_at = now()`
  on insert. Validate `p_decision` against the decision CHECK.
- **Avoid an ambiguous overload.** 056's `propose_field` has the 11-arg signature. Adding
  params makes a *new* overload, not a replace. The migration must
  `DROP FUNCTION IF EXISTS propose_field(uuid,uuid,text,jsonb,text,text,text,text,text,boolean,timestamptz);`
  before creating the new signature, so exactly ONE `propose_field` exists. Re-affirm grants
  (service_role only) after recreate.
- Keep the existing scalar-dedup (return null → no insert) behaviour.

### 6c. Final RPC contract (names + params + returns — mirror of TS §6)
- `propose_field(...)` → `uuid` (or null when deduped). service_role only.
- `apply_venue_proposal(p_proposal_id uuid, p_applied_text text default null)` → jsonb `{ok, field}`. authenticated + service_role.
- `auto_apply_venue_proposal(p_proposal_id uuid, p_applied_text text default null)` → jsonb `{outcome, field, reason?}`, outcome ∈ `applied|not_authorized|not_pending|moved_to_manual_review|stale|validation_failed`. **authenticated ONLY**.
- `reject_venue_proposal(p_proposal_id uuid, p_notes text)` → jsonb `{ok}`. authenticated + service_role.
- `rollback_enrichment_run(p_run_id uuid)` → jsonb array of `{write_id, proposal_id, venue_id, field, outcome}`, outcome ∈ `restored|already_rolled_back|skipped_newer_change|failed:<msg>`. **authenticated ONLY**.
- `snapshot_current_value(p_venue_id uuid, p_field text)` → jsonb `{value, hash}`. service_role only (internal).

DB safety invariants: SECURITY DEFINER + `set search_path = public`; clients have NO
insert/update/delete on `venue_enrichment_writes`; auto_apply re-checks (a) is_admin,
(b) decision='auto_apply', (c) live value empty (else moved_to_manual_review), (d) stale
hash, (e) field validation — BEFORE any write or ledger row.

---

## 7. Decision engine rules (owned by the Pure-engine agent)

New `scripts/enrich/web/decision.ts` (+ helpers). Pure, no I/O. Operates per venue over
**all candidates per field** (not best-only) + the snapshot. Emits `FieldDecision[]`.

**Global auto_apply preconditions (ALL required):** official-domain source; passed URL/SSRF
guards; value validates; no contradictory value on the same official site; no stale/temporary
warning; no conflict with a trustworthy existing value; current DB value empty/invalid/safely-
equivalent; (stale-hash + non-empty re-checked at write time by the RPC).

**Default policy: never auto_apply over a valid non-empty field** → `would_replace_existing` → manual_review.

| field | auto_apply | manual_review | auto_reject / report_only |
|---|---|---|---|
| phone | empty/invalid current; exactly one validated number consistent across page/structured/`tel:`; none different elsewhere on domain. Store via existing GB-aware `phoneDedupKey`/`normalisePhone`. | multiple distinct; central-vs-branch; would replace valid | equals current/duplicate/malformed → reject |
| email | empty/invalid current; one consistent email; no competing email; not placeholder/unrelated-personal | competing emails (esp. different official-domain vs gmail) | placeholder/duplicate/malformed → reject |
| website | missing/invalid current; official domain confident | meaningful path/subdomain/query difference (`meaningful_url_difference`) | www/trailing-slash/scheme-host-casing/safe-canonical-redirect equivalence → reject (`canonical_equivalent_website`) |
| opening_hours | full 7-day; structured==visible; NO temporary/seasonal/holiday/"call to confirm" markers; intervals valid (24:00/overnight ok); current empty | any warning / partial week / current present | unparseable → reject/suppress |
| description | **never** (max = `manual_review`; the RPC rejects auto-apply for descriptions) | see §7a | failed checks → reject; insufficient facts → **report_only** (`insufficient_description_evidence`) |
| price_range | clear current pricing on official site → unambiguous enum | ambiguous | never infer from venue type → reject |
| booking_url | — | — | always **report_only** (`booking_url_no_target_column`); no card |

### 7a. Description composition (deterministic, from verified facts ONLY)
Compose original UK-English 1–2 sentence copy from verified structured facts (name, category/
type, town/locality, confirmed activities, verified facilities, supported age/accessibility/
booking facts). **Never copy or lightly rewrite the site's marketing description.** Use several
deterministic sentence patterns (vary by available facts, stay deterministic/testable). Omit
location if missing/uncertain. **Ban filler**: "a great day out", "fun for all the family",
"something for everyone", "the perfect place", "unforgettable experience".
- `auto_apply`: **NEVER** for descriptions. The engine always caps at `manual_review`; it
  never emits `auto_apply` for this field. The RPC independently rejects any description
  auto-apply (returns `validation_failed`), so a rogue row would be orphaned. Admin approval
  is mandatory for every description write.
- `manual_review`: useful draft + mostly reliable facts + ONE clearly identified uncertainty.
  **Never make the admin write from scratch.**
- `report_only`: insufficient facts → no card, leave description unchanged, reason
  `insufficient_description_evidence`, retain evidence + engine version for retry.
- `auto_reject`: draft fails similarity/validation/factuality → `description_failed_similarity`
  | `description_failed_validation` | `description_unsupported_fact` | `description_conflicting_evidence`.

The objective: the admin is **never** handed hundreds of descriptions to write.

### 7b. Orchestration + report integration
Thread `FieldDecision[]` through `orchestrate.ts` (feed it all candidates, not best-only) and
into the run report + `EnrichmentBatchSummary`. The report must show, per venue/field, the
decision + reason codes. The script persists via the extended `propose_field` (passing decision/
reasons/version). `auto_reject`/`report_only` are persisted too (audit), never as cards.

---

## 8. Automation controls (script flags, owned by Pure-engine agent / enrichWebsites.ts)
Policies, conservative defaults: `dry_run` (default), `proposal_only`, `auto_apply_safe`
(**note: in v1 the script NEVER auto-applies — `auto_apply_safe` only marks rows; apply is
in-app only**), `--max-venues`, `--max-writes`, allowed-auto-apply-fields, never-overwrite-non-
empty (default true), stop-on-error threshold. Existing `PROPOSE_LIMIT_CAP=100` retained.

---

## 9. Admin UI (owned by the UI agent, Phase 4)
Exception-only dashboard (`app/admin/enrichment.tsx` + `hooks/useEnrichmentProposals.ts`):
default view = counts (venues processed / auto-applied / auto-rejected / report-only /
exceptions / failures); **only `manual_review` rows render as cards**; filters (conflict, field,
confidence, replaces-existing, extraction-warning); a one-tap **"Apply N safe changes"** confirm
stating venues, field-writes, fields affected, whether any non-empty replaced (must be none),
rollback id; bounded sequential (or very low concurrency) calls to `auto_apply_venue_proposal`
with the admin JWT; live progress; resumable (re-query remaining `auto_apply` pending); stop on
auth/permission failure; per-item stale/validation failure → recorded + moved to manual_review;
read-only audit/history view for rejected + report_only. Use only the §6c RPC shapes; do not
redesign schema.

---

## 10. File ownership (NO overlapping edits across parallel agents)
- **Pure-engine agent:** `scripts/enrich/web/decision.ts` (+ description/similarity/sanitise
  helpers), `scripts/enrich/web/orchestrate.ts`, `report.ts`, `enrichWebsites.ts`, their
  `__tests__`. Imports `types/enrichmentDecision.ts` (read-only). MUST NOT touch migrations,
  RPC SQL, admin hooks, or UI.
- **Database/Security agent:** `supabase/migrations/057_enrichment_auto_decision.sql`,
  `supabase/tests/057_enrichment_auto_decision.mjs`. MUST NOT touch the TS engine or UI.
- **UI agent (Phase 4):** `app/admin/enrichment.tsx`, `hooks/useEnrichmentProposals.ts`,
  their `__tests__`. Imports `types/enrichmentDecision.ts` (read-only). MUST NOT touch schema.
- **Lead (me):** `types/enrichmentDecision.ts`, this file, reconciliation, all fixes after review.

## 11. Validation gates (Phase 5 + each phase)
Focused enrichment tests, DB tests (057 pglite), admin UI tests, `tsc --noEmit` (baseline = 31,
zero NEW), `eslint`, full `test:ci`. Pilot-derived tests are mandatory (Hillview equiv-website
auto_reject; Hollywood phone auto_apply-when-empty; Hollywood opening-hours NOT auto-applied due
to update warning; Rascals phone auto_apply; Rascals competing emails manual_review; both booking
URLs report_only; 5 descriptions composed + pass original-wording checks OR report_only; leading-
text/blank-line sanitisation; existing valid fields not overwritten; stale → safe skip/manual;
rollback respects newer human edit; mixed batch success/failure reporting accurate).
