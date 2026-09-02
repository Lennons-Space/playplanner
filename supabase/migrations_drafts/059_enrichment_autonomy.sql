-- =============================================================================
-- 059_enrichment_autonomy.sql
-- Enrichment 2.0 — schema for auto-apply, closure tracking, and new-venue
-- discovery/dedup. Purely additive: no existing table/column/RPC is altered
-- in a breaking way, no existing row's meaning changes, nothing here changes
-- app-facing query results until the new columns/tables are actually
-- populated by the (separately gated) autonomous scripts.
--
-- STATUS: NOT APPLIED. Written for review only, per the Enrichment 2.0 task
-- instruction ("Do NOT apply any database migration... require Liam's
-- explicit approval"). Every RPC below that writes data is service_role- or
-- admin-gated, mirroring the pattern established in 056_venue_website_
-- enrichment.sql (snapshot/propose/apply/reject). Rollback: see the comment
-- block at the end of this file (no down-migration file exists yet, matching
-- the convention already used for 049 and 056).
--
-- Three areas:
--   A. Numeric confidence + provenance on venue_field_proposals (Part 3/15)
--   B. Closure status on venues + append-only evidence log (Part 9)
--   C. venue_discovery_candidates — the quarantine model for new venues
--      found by discovery, plus the (conservative, re-validating) auto-accept
--      RPC (Part 6/7/8)
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- A. venue_field_proposals: numeric confidence + who applied it
-- ─────────────────────────────────────────────────────────────────────────────
-- confidence_score: the deterministic 0-100 score from confidenceScore.ts,
-- stored alongside the existing qualitative 'confidence' column (low/medium/
-- high) — that column is UNCHANGED and still drives the human-review report.
-- applied_by distinguishes a human admin's apply_venue_proposal call from the
-- new auto_apply_field_proposal path below, so every applied row is
-- attributable (Part 15 audit trail — extends the existing pattern, does not
-- replace it: reviewed_by/reviewed_at/applied_at all still populate as before).

-- confidence_score: the deterministic 0-100 score from confidenceScore.ts,
-- stored alongside the existing qualitative 'confidence' column (low/medium/
-- high) — that column is UNCHANGED and still drives the human-review report.
--
-- REBASED ONTO 057: the earlier draft also added a competing
--   applied_by text CHECK (applied_by IN ('admin','system'))
-- column here. That is REMOVED. Migration 057 already owns proposal-level
-- provenance through applied_mode ('auto' | 'manual'), and actor identity
-- through venue_enrichment_writes.applied_by (uuid). A second, text-valued
-- provenance column on the same row can disagree with applied_mode and cannot
-- say WHICH admin acted, so it is not added.
--
-- CANONICAL PROVENANCE CONTRACT
--   venue_field_proposals.applied_mode   'auto' | 'manual'
--   venue_field_proposals.decision*      why the engine routed it that way
--   venue_enrichment_writes.applied_by   uuid actor, NULL for automation
--   For automation: applied_mode='auto', ledger applied_by=NULL, and the
--   decision_* columns carry the machine justification.

ALTER TABLE venue_field_proposals
  ADD COLUMN IF NOT EXISTS confidence_score smallint
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100));

CREATE INDEX IF NOT EXISTS venue_field_proposals_confidence_score_idx
  ON venue_field_proposals (confidence_score);

-- ─────────────────────────────────────────────────────────────────────────────
-- A2. RPC: auto_apply_field_proposal — the system's equivalent of
-- apply_venue_proposal, restricted to service_role (never authenticated/anon).
-- Mirrors apply_venue_proposal's field-by-field logic (same validation, same
-- stale-guard, same replace-whole-week semantics) with three extra guards
-- apply_venue_proposal does not need, because a human already made the
-- decision there:
--   1. p_confidence_score must be >= p_min_score (defence in depth — the
--      calling script decided this off-RPC in autoApplyPolicy.ts; the RPC
--      re-checks so a bug in the script cannot force a low-confidence write).
--   2. The field must NOT be one of the never-auto-apply fields (description,
--      price_range, booking_url) — enforced here too, not just in TypeScript.
--   3. Precedence: if venues.<field>_verified_by_admin-equivalent state can't
--      be represented cheaply here, the caller MUST pass p_current_value_
--      human_verified=false only when it has independently confirmed (via
--      the orchestrator's own tracking) that the existing value was not a
--      prior human edit. This is the one guard that is NOT fully self-
--      contained in SQL — documented as a residual risk in the accompanying
--      design note (ENRICHMENT_2_0_SPEC.md, precedence section).
-- Proposal status flow: pending -> applied directly (skips 'approved' — a
-- human never touched this row). status stays fully auditable via applied_by
-- = 'system' and the preserved current_value (revert path unchanged from the
-- human-apply flow).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- A2. Shared value validators + the audited write primitive, extended.
-- ─────────────────────────────────────────────────────────────────────────────
-- REBASED ONTO 057. The earlier draft wrote venues directly from
-- auto_apply_field_proposal, producing no venue_enrichment_writes row and
-- therefore no audit trail and nothing for rollback_enrichment_run to undo.
-- Every proposal-driven mutation now goes through _enrichment_apply_write.
--
-- Migration 057 is historical and is NOT edited. The primitive is extended here
-- with CREATE OR REPLACE, exactly as 057 itself extended 056's functions.
--
-- WHAT IS UNIVERSAL vs WHAT IS POLICY
--   Universal (here, in the primitive): value validity. A malformed or unsafe
--   value must never reach the venues table by ANY path, human or automated.
--   Policy (in the calling wrapper): whether automation is allowed to act at
--   all -- confidence thresholds, conflicts, and fill-if-empty. A human admin
--   may legitimately replace an existing value; automation may not.
-- =============================================================================

-- Returns the lowercase host of an http(s) URL, or NULL if the URL is unusable.
-- NULL for: a non-http(s) scheme (javascript:, data:, file:, ...), a userinfo
-- segment (https://evil.test@real.test -- the classic identity trick), or an
-- empty host. Not a security boundary on its own; one layer of several.
CREATE OR REPLACE FUNCTION enrichment_url_host(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_url IS NULL THEN NULL
    WHEN p_url !~* '^https?://' THEN NULL
    WHEN pg_catalog.split_part(
           pg_catalog.split_part(
             pg_catalog.regexp_replace(p_url, '^https?://', '', 'i'), '/', 1), '?', 1) LIKE '%@%'
      THEN NULL
    WHEN pg_catalog.btrim(pg_catalog.split_part(
           pg_catalog.split_part(
             pg_catalog.regexp_replace(p_url, '^https?://', '', 'i'), '/', 1), ':', 1)) = ''
      THEN NULL
    ELSE pg_catalog.lower(pg_catalog.split_part(
           pg_catalog.split_part(
             pg_catalog.regexp_replace(p_url, '^https?://', '', 'i'), '/', 1), ':', 1))
  END
$$;

REVOKE ALL ON FUNCTION enrichment_url_host(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION enrichment_url_host(text) TO service_role;

-- A website must parse to a real host. HTTPS is preferred but NOT required:
-- many small venues still publish http-only sites, and refusing them would
-- silently drop legitimate data. The scheme allowlist in enrichment_url_host
-- is what blocks javascript:/data:/file:.
CREATE OR REPLACE FUNCTION enrichment_is_valid_website(p_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_url IS NOT NULL
     AND pg_catalog.btrim(p_url) <> ''
     AND public.enrichment_url_host(pg_catalog.btrim(p_url)) IS NOT NULL
$$;

REVOKE ALL ON FUNCTION enrichment_is_valid_website(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION enrichment_is_valid_website(text) TO service_role;

-- Conservative plausibility only. We deliberately do NOT normalise or invent a
-- country code: storing a number we synthesised would be worse than storing
-- nothing. Accepts ordinary UK punctuation -- spaces, brackets, hyphens, dots,
-- a leading + -- and requires 7..15 digits (E.164 caps at 15; UK numbers are
-- 10-11). Anything containing letters is rejected outright.
CREATE OR REPLACE FUNCTION enrichment_is_valid_phone(p_phone text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_phone IS NOT NULL
     AND pg_catalog.btrim(p_phone) <> ''
     AND pg_catalog.btrim(p_phone) ~ '^[0-9()+.\- ]+$'
     AND pg_catalog.length(pg_catalog.regexp_replace(p_phone, '[^0-9]', '', 'g')) BETWEEN 7 AND 15
$$;

REVOKE ALL ON FUNCTION enrichment_is_valid_phone(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION enrichment_is_valid_phone(text) TO service_role;

-- Is an existing value meaningful, i.e. would writing over it destroy data?
-- SCALAR fields only (website/phone/email) -- snapshot_current_value wraps
-- those as {"v": ...}. opening_hours is NOT a scalar: snapshot_current_value
-- returns it as a raw jsonb ARRAY of day rows (056:124-138), so
-- `p_value ->> 'v'` is always NULL for it and this function would always
-- (wrongly) say "not meaningful" -- see enrichment_opening_hours_is_meaningful
-- below for the array-shaped equivalent. Do not extend this one to cover it.
CREATE OR REPLACE FUNCTION enrichment_value_is_meaningful(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_value IS NOT NULL
     AND pg_catalog.jsonb_typeof(p_value) <> 'null'
     AND pg_catalog.btrim(coalesce(p_value ->> 'v', '')) <> ''
$$;

REVOKE ALL ON FUNCTION enrichment_value_is_meaningful(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION enrichment_value_is_meaningful(jsonb) TO service_role;

-- R1 (pre-staging remediation, 2026-09-01): the opening_hours equivalent of
-- enrichment_value_is_meaningful. "Meaningful" for a multi-row field means
-- "at least one opening_hours row exists for this venue" -- an empty week is
-- exactly what fill-if-empty is for; a non-empty week is exactly what it must
-- not overwrite. Mirrors the live, already-audited logic in
-- 057_enrichment_auto_decision.sql's auto_apply_venue_proposal
-- (`jsonb_typeof(v_live) = 'array' and jsonb_array_length(v_live) > 0`) --
-- deliberately the SAME test, not a reinvention, so the draft cannot drift
-- from the behaviour production already has.
CREATE OR REPLACE FUNCTION enrichment_opening_hours_is_meaningful(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_value IS NOT NULL
     AND pg_catalog.jsonb_typeof(p_value) = 'array'
     AND pg_catalog.jsonb_array_length(p_value) > 0
$$;

REVOKE ALL ON FUNCTION enrichment_opening_hours_is_meaningful(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION enrichment_opening_hours_is_meaningful(jsonb) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- _enrichment_apply_write, extended with universal website/phone validation.
-- Body is 057's, unchanged apart from the two validation guards. booking_url
-- still raises no_target_column here: the column does not exist until 060.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _enrichment_apply_write(
  p_proposal_id      uuid,
  p_applied_text     text,
  p_mode             text,
  p_applied_by       uuid,
  p_decision_reasons jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p          venue_field_proposals%rowtype;
  v_snap     jsonb;
  v_val      text;
  v_seasonal text;
  v_day      jsonb;
  v_dow      int;
  v_open     time;
  v_close    time;
  v_notes    text;
  v_split    text;
  v_new_hash text;
  v_new_val  jsonb;
BEGIN
  SELECT * INTO p FROM venue_field_proposals WHERE id = p_proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF p.field = 'booking_url' THEN
    RAISE EXCEPTION 'no_target_column';
  END IF;

  v_snap := snapshot_current_value(p.venue_id, p.field);
  IF (v_snap ->> 'hash') IS DISTINCT FROM p.current_value_hash THEN
    RAISE EXCEPTION 'stale_current_value';
  END IF;

  IF p.field = 'price_range' THEN
    v_val := p.proposed_value ->> 'v';
    IF v_val IS NULL OR v_val NOT IN ('free','budget','moderate','premium') THEN
      RAISE EXCEPTION 'invalid_enum_value:%', coalesce(v_val, 'null');
    END IF;
    UPDATE venues SET price_range = v_val, updated_at = now() WHERE id = p.venue_id;
    v_new_val := jsonb_build_object('v', v_val);

  ELSIF p.field IN ('website','phone','email') THEN
    v_val := btrim(coalesce(p.proposed_value ->> 'v', ''));
    IF v_val = '' THEN
      RAISE EXCEPTION 'empty_value:%', p.field;
    END IF;
    -- ADDED IN THE 057 REBASE: universal value validation. Applies to the human
    -- apply path too -- a malformed website must never reach venues by ANY route.
    IF p.field = 'website' AND NOT enrichment_is_valid_website(v_val) THEN
      RAISE EXCEPTION 'invalid_website_url';
    END IF;
    IF p.field = 'phone' AND NOT enrichment_is_valid_phone(v_val) THEN
      RAISE EXCEPTION 'invalid_phone';
    END IF;
    IF p.field = 'email'
       AND v_val !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'invalid_email';
    END IF;
    IF    p.field = 'website' THEN
      UPDATE venues SET website = v_val, updated_at = now() WHERE id = p.venue_id;
    ELSIF p.field = 'phone'   THEN
      UPDATE venues SET phone   = v_val, updated_at = now() WHERE id = p.venue_id;
    ELSE
      UPDATE venues SET email   = v_val, updated_at = now() WHERE id = p.venue_id;
    END IF;
    v_new_val := jsonb_build_object('v', v_val);

  ELSIF p.field = 'description' THEN
    IF p_applied_text IS NULL OR btrim(p_applied_text) = '' THEN
      RAISE EXCEPTION 'description_text_required';
    END IF;
    IF btrim(p_applied_text) = btrim(coalesce(p.evidence_snippet, ''))
       OR btrim(p_applied_text) = btrim(coalesce(p.evidence_raw, '')) THEN
      RAISE EXCEPTION 'description_not_rewritten';
    END IF;
    UPDATE venues SET description = p_applied_text, updated_at = now()
     WHERE id = p.venue_id;
    v_new_val := jsonb_build_object('v', p_applied_text);

  ELSIF p.field = 'opening_hours' THEN
    IF jsonb_typeof(p.proposed_value -> 'days') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p.proposed_value -> 'days') <> 7 THEN
      RAISE EXCEPTION 'incomplete_week';
    END IF;
    IF (SELECT count(DISTINCT (d ->> 'day_of_week'))
          FROM jsonb_array_elements(p.proposed_value -> 'days') d)
       <> jsonb_array_length(p.proposed_value -> 'days') THEN
      RAISE EXCEPTION 'duplicate_day_of_week';
    END IF;
    v_seasonal := nullif(btrim(coalesce(p.proposed_value ->> 'seasonal_notes', '')), '');
    DELETE FROM opening_hours WHERE venue_id = p.venue_id;
    FOR v_day IN SELECT * FROM jsonb_array_elements(p.proposed_value -> 'days') LOOP
      v_dow := (v_day ->> 'day_of_week')::int;
      IF coalesce((v_day ->> 'is_closed')::boolean, false)
         OR coalesce(jsonb_array_length(v_day -> 'intervals'), 0) = 0 THEN
        INSERT INTO opening_hours (venue_id, day_of_week, is_closed)
          VALUES (p.venue_id, v_dow, true);
      ELSE
        SELECT min((iv ->> 'opens')::time), max((iv ->> 'closes')::time)
          INTO v_open, v_close
          FROM jsonb_array_elements(v_day -> 'intervals') iv;
        v_notes := NULL;
        IF jsonb_array_length(v_day -> 'intervals') > 1 THEN
          SELECT string_agg((iv ->> 'opens') || '-' || (iv ->> 'closes'), ' and ' ORDER BY ord)
            INTO v_split
            FROM jsonb_array_elements(v_day -> 'intervals') WITH ORDINALITY AS t(iv, ord);
          v_notes := 'Open ' || v_split;
        END IF;
        IF v_seasonal IS NOT NULL THEN
          v_notes := CASE WHEN v_notes IS NULL THEN v_seasonal
                          ELSE v_notes || ' | ' || v_seasonal END;
        END IF;
        INSERT INTO opening_hours (venue_id, day_of_week, opens_at, closes_at, is_closed, notes)
          VALUES (p.venue_id, v_dow, v_open, v_close, false, v_notes);
      END IF;
    END LOOP;
    v_new_val := p.proposed_value;

  ELSE
    RAISE EXCEPTION 'invalid_field:%', p.field;
  END IF;

  v_new_hash := snapshot_current_value(p.venue_id, p.field) ->> 'hash';

  UPDATE venue_field_proposals
     SET status       = 'applied',
         applied_at   = now(),
         reviewed_by  = p_applied_by,
         reviewed_at  = now(),
         applied_mode = p_mode
   WHERE id = p_proposal_id;

  INSERT INTO venue_enrichment_writes (
    run_id,       proposal_id,     venue_id,  field,
    operation,    old_value,       old_value_hash,
    new_value,    new_value_hash,
    applied_mode, applied_by,      decision_reasons,
    source_url,   evidence_snapshot
  ) VALUES (
    p.run_id,     p.id,            p.venue_id, p.field,
    'apply',      p.current_value, p.current_value_hash,
    v_new_val,    v_new_hash,
    p_mode,       p_applied_by,    coalesce(p_decision_reasons, '[]'::jsonb),
    p.source_url, p.evidence_snippet
  );

  RETURN jsonb_build_object('ok', true, 'field', p.field);
END;
$$;

REVOKE ALL ON FUNCTION _enrichment_apply_write(uuid, text, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- auto_apply_field_proposal — POLICY wrapper, no direct writes.
-- ─────────────────────────────────────────────────────────────────────────────
-- Order is deliberate: cheap policy checks first, then the audited mutation.
--   1. confidence threshold (defence in depth over the TS policy)
--   2. proposal exists and is still pending
--   3. never-auto-apply fields
--   4. conflicts_existing requires a human
--   4b. opening_hours carrying seasonal_notes requires a human -- the extracted
--       week is conditional, and automation must not publish it as year-round
--   5. fill-if-empty -- automation may complete missing data, never replace
--      data that is already there. A human admin still may, through
--      apply_venue_proposal.
--   6. delegate. The primitive re-runs the stale guard and does the validation,
--      the venues write, the proposal flip and the immutable ledger row.
-- Provenance: applied_mode='auto', ledger applied_by=NULL (there is no auth
-- user), decision_reasons carry the machine justification.
CREATE OR REPLACE FUNCTION auto_apply_field_proposal(
  p_proposal_id uuid,
  p_confidence_score smallint,
  p_min_score smallint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p        venue_field_proposals%rowtype;
  v_live   jsonb;
  v_reasons jsonb;
BEGIN
  IF p_confidence_score IS NULL OR p_confidence_score < p_min_score THEN
    RAISE EXCEPTION 'below_min_score:%<%', p_confidence_score, p_min_score;
  END IF;

  SELECT * INTO p FROM venue_field_proposals WHERE id = p_proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF p.status <> 'pending' THEN
    RAISE EXCEPTION 'not_pending:%', p.status;
  END IF;

  -- R3 (pre-staging remediation, 2026-09-01): re-checked HERE, not only at
  -- propose_field time. A suppression may be created by an admin AFTER a
  -- proposal was already queued -- e.g. a venue operator objects to their
  -- personal phone number the day after the crawl proposed it, before the
  -- nightly auto-apply batch runs. Re-checking at the point of auto-apply is
  -- what makes the objection effective against an already-pending write, not
  -- just against future proposals. See enrichment_venue_field_suppressed
  -- (Section E below) -- this call happens for EVERY caller of this function,
  -- with no service_role-specific bypass, so the check cannot be routed
  -- around by whoever holds the service key.
  IF enrichment_venue_field_suppressed(p.venue_id, p.field) THEN
    RAISE EXCEPTION 'field_suppressed:%', p.field;
  END IF;

  IF p.field IN ('description', 'price_range', 'booking_url') THEN
    RAISE EXCEPTION 'field_never_auto_applies:%', p.field;
  END IF;

  IF p.conflicts_existing THEN
    RAISE EXCEPTION 'conflicts_existing_requires_human_review';
  END IF;

  -- Opening hours: automation may only apply the CLEAN case. Seasonal notes
  -- ("term-time only", "summer hours") mean the week we extracted is CONDITIONAL,
  -- and replace-whole-week would publish it as if it were the year-round truth --
  -- a parent turning up to a closed venue is the failure mode.
  --
  -- RESTORED. This guard existed in the pre-rebase 059 and was lost when the
  -- rebase deleted apply_venue_proposal_opening_hours_internal and delegated to
  -- the shared primitive: the well-formedness checks travelled across with the
  -- write (they are universal -- both paths need them) but this one did not,
  -- because it is not about validity at all. It is a POLICY about what
  -- AUTOMATION may decide, so the wrapper is exactly where it belongs. A human
  -- admin may still apply seasonal hours through apply_venue_proposal, having
  -- read the note and judged it -- which is the whole point.
  IF p.field = 'opening_hours'
     AND nullif(btrim(coalesce(p.proposed_value ->> 'seasonal_notes', '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'seasonal_notes_require_human_review';
  END IF;

  -- Fill-if-empty. Autonomy completes gaps; it does not overwrite.
  v_live := snapshot_current_value(p.venue_id, p.field) -> 'value';
  IF p.field IN ('website','phone','email')
     AND enrichment_value_is_meaningful(v_live) THEN
    RAISE EXCEPTION 'live_value_not_empty:%', p.field;
  END IF;

  -- R1 (pre-staging remediation, 2026-09-01): RESTORED for opening_hours.
  -- This guard was scoped to ('website','phone','email') only, so a venue with
  -- a genuine, meaningful published week fell through to
  -- _enrichment_apply_write, which unconditionally DELETEs every existing
  -- opening_hours row and reinserts the proposed week -- automation replacing
  -- data that was already there, exactly what fill-if-empty exists to forbid,
  -- for the one field whose wrongness sends a family to a locked door. The
  -- live 057 auto-apply path already guards this correctly (see the function
  -- comment on enrichment_opening_hours_is_meaningful above); this brings the
  -- draft back into line with it rather than leaving it weaker.
  IF p.field = 'opening_hours'
     AND enrichment_opening_hours_is_meaningful(v_live) THEN
    RAISE EXCEPTION 'live_value_not_empty:%', p.field;
  END IF;

  UPDATE venue_field_proposals
     SET confidence_score = p_confidence_score
   WHERE id = p_proposal_id;

  v_reasons := coalesce(p.decision_reasons, '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object(
         'code', 'auto_apply_confidence',
         'confidence_score', p_confidence_score,
         'min_score', p_min_score));

  RETURN _enrichment_apply_write(p_proposal_id, NULL, 'auto', NULL, v_reasons);
END;
$$;

REVOKE ALL ON FUNCTION auto_apply_field_proposal(uuid, smallint, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION auto_apply_field_proposal(uuid, smallint, smallint) TO service_role;

-- apply_venue_proposal_opening_hours_internal is REMOVED by the 057 rebase.
-- It was a parallel, unlogged implementation of the opening-hours write that
-- _enrichment_apply_write already performs -- including the duplicate-day guard
-- and the seasonal-notes handling -- and it produced no ledger row. Keeping two
-- write paths for one field is exactly the architecture 057 exists to prevent.
DROP FUNCTION IF EXISTS apply_venue_proposal_opening_hours_internal(uuid, jsonb);


-- ─────────────────────────────────────────────────────────────────────────────
-- B. Closure status (Part 9)
-- ─────────────────────────────────────────────────────────────────────────────
-- Ladder: active -> suspected_closed -> confirmed_closed. Additive
-- (suspected_closed) transitions may be system-driven; the destructive
-- transition (confirmed_closed, which also hides the venue from discovery)
-- is admin-only, matching Part 4's "destructive changes require stronger
-- proof than additive changes".

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS operating_status text NOT NULL DEFAULT 'active'
    CHECK (operating_status IN ('active', 'suspected_closed', 'confirmed_closed')),
  ADD COLUMN IF NOT EXISTS operating_status_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS venues_operating_status_idx ON venues (operating_status);

-- Append-only evidence log — one row per detected signal (never updated).
-- @test-section: closure_schema
CREATE TABLE IF NOT EXISTS venue_closure_signals (
  id               uuid primary key default gen_random_uuid(),
  venue_id         uuid not null references venues(id) on delete cascade,
  kind             text not null check (kind in (
                      'explicit_official_text', 'explicit_thirdparty_text',
                      'redirect_to_closure_notice', 'operator_announcement'
                    )),
  source_url       text not null,
  evidence_snippet text not null check (length(evidence_snippet) <= 512),
  source_tier      smallint not null check (source_tier in (1, 2, 3)),
  detected_at      timestamptz not null,
  created_at       timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS venue_closure_signals_venue_idx ON venue_closure_signals (venue_id);

ALTER TABLE venue_closure_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "closure_signals_admin_all" ON venue_closure_signals
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ── TABLE PRIVILEGES (D12) ───────────────────────────────────────────────────
-- A new table must NOT rely on Supabase's inherited DML defaults + RLS alone.
-- ALTER DEFAULT PRIVILEGES in this project grants SELECT/INSERT/UPDATE/DELETE
-- on every new public table to anon+authenticated, and ALL to service_role, so
-- a bare CREATE TABLE here would silently hand anon four DML privileges whose
-- only barrier is a policy. Two independent layers are the contract: the GRANT
-- decides whether the role may attempt the statement at all, RLS decides which
-- rows. Both are stated explicitly below.
--
-- anon / authenticated: NOTHING. There is no user- or admin-facing surface that
-- reads closure evidence directly today (verified: no app/ or components/ code
-- references this table). If an admin UI later needs it, add a narrow
-- GRANT SELECT TO authenticated in a new migration -- do not widen this one.
--
-- service_role: SELECT + INSERT only. The closure log is append-only evidence;
-- background detection writes rows and never edits or deletes them, so UPDATE
-- and DELETE are withheld rather than inherited from the ALL default.
REVOKE ALL ON TABLE venue_closure_signals FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE venue_closure_signals TO service_role;
-- service_role (the background scripts) bypasses RLS to insert signals.
-- @end-section: closure_schema

-- @test-section: closure_functions
-- ─────────────────────────────────────────────────────────────────────────────
-- B2. The closure EVENT log, and the single transition primitive
-- ─────────────────────────────────────────────────────────────────────────────
-- THE GAP THIS CLOSES. venue_enrichment_writes is the immutable ledger for
-- FIELD PROPOSALS. Closure is not a field proposal -- it is a state machine on
-- venues.operating_status, with its own actors, its own allowed edges and its
-- own destructive step. Forcing it into the proposal ledger would have meant
-- inventing a fake proposal for every transition and giving that ledger a
-- second, incompatible meaning. So closure gets its own append-only log, and
-- the two audit surfaces stay honest about what they each record.
--
-- venue_closure_signals (above) is EVIDENCE: "we saw a closure notice here".
-- venue_operating_status_events (here) is DECISION: "the status moved from X to
-- Y, by whom, in which mode, and why". Many signals may precede one decision,
-- and a decision may be taken with no signal at all (an admin who phoned the
-- venue), so they are deliberately separate tables joined by an optional FK.

CREATE TABLE IF NOT EXISTS venue_operating_status_events (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references venues(id) on delete cascade,

  from_status   text not null check (from_status in ('active', 'suspected_closed', 'confirmed_closed')),
  to_status     text not null check (to_status   in ('active', 'suspected_closed', 'confirmed_closed')),

  reason        text,
  -- Machine-readable justification, same convention as 057's decision_reasons
  -- and the candidate table's resolution_reasons.
  evidence      jsonb not null default '{}'::jsonb,
  -- Optional pointer at the specific signal row that triggered an automated
  -- transition. Nullable because a human decision usually has no signal row.
  closure_signal_id uuid references venue_closure_signals(id),

  mode          text not null check (mode in ('auto', 'manual')),
  -- The human who decided. NULL for automation is the SAME contract 057
  -- established for venue_enrichment_writes.applied_by: automation has no auth
  -- user, and a NULL actor is legitimate there and only there.
  actor_id      uuid references profiles(id),
  -- Where the decision came from: a provider id, a script name, or NULL.
  source        text,

  -- What the transition did to public visibility, captured BOTH sides. This is
  -- what makes reactivation deliberate rather than accidental: reactivating a
  -- confirmed-closed venue restores the value closure actually took away,
  -- instead of blindly setting discovery_approved = true and possibly
  -- re-exposing a venue that was hidden for some entirely different reason.
  discovery_approved_before boolean,
  discovery_approved_after  boolean,

  created_at    timestamptz not null default now(),

  -- Automation is never a person; a human decision always names one.
  constraint venue_operating_status_events_mode_actor_ck check (
    (mode = 'auto'   and actor_id is null)
    or (mode = 'manual' and actor_id is not null)
  ),
  -- A "transition" that goes nowhere is not an event. This is what stops a
  -- no-op call from polluting the log.
  constraint venue_operating_status_events_real_transition_ck check (from_status <> to_status)
);

CREATE INDEX IF NOT EXISTS venue_operating_status_events_venue_idx
  ON venue_operating_status_events (venue_id, created_at DESC);

ALTER TABLE venue_operating_status_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operating_status_events_admin_select" ON venue_operating_status_events
  FOR SELECT USING (is_admin());

-- APPEND-ONLY, enforced twice.
--
-- (1) Privileges. Nobody gets UPDATE or DELETE -- service_role included, exactly
--     as 057 did for venue_enrichment_writes. service_role gets NOTHING here,
--     not even INSERT: every write goes through the SECURITY DEFINER transition
--     primitive below, which inserts as the function OWNER, so granting the
--     service key direct INSERT would only create a second, unvalidated way to
--     write history. An ACL that hands out a capability nothing needs is a
--     capability an attacker inherits.
-- (2) A trigger, because a privilege can be re-granted by a later migration and
--     an append-only guarantee should survive that. The trigger refuses UPDATE
--     and DELETE from ANY role, including the table owner.
REVOKE ALL ON TABLE venue_operating_status_events
  FROM PUBLIC, anon, authenticated, service_role;
-- An admin review UI, when it exists, should get a narrow
-- GRANT SELECT TO authenticated in its own migration (the admin-only RLS policy
-- above is already in place for it). Not granted speculatively here.

CREATE OR REPLACE FUNCTION venue_operating_status_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'venue_operating_status_events is append-only (attempted %)', TG_OP
    USING errcode = '42501';
END;
$$;
REVOKE EXECUTE ON FUNCTION venue_operating_status_events_append_only()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS venue_operating_status_events_no_update ON venue_operating_status_events;
CREATE TRIGGER venue_operating_status_events_no_update
  BEFORE UPDATE OR DELETE ON venue_operating_status_events
  FOR EACH ROW EXECUTE FUNCTION venue_operating_status_events_append_only();

-- ── THE SINGLE TRANSITION PRIMITIVE ─────────────────────────────────────────
-- Every status change in the system goes through this one function, for the
-- same reason every proposal write goes through _enrichment_apply_write: one
-- place to validate the state machine, one place that guarantees the venue
-- update and the audit event happen together or not at all.
--
-- ATOMICITY is structural, not conventional. This is a single plpgsql function
-- body: the UPDATE and the INSERT are in the same statement sequence inside the
-- caller's transaction, and any RAISE anywhere in it rolls back both. There is
-- no code path that updates venues and returns without appending an event, and
-- no path that appends an event without having updated venues.
--
-- THE MATRIX (deliberately narrow -- see the note on active -> confirmed_closed):
--   auto:    active -> suspected_closed                      ... and nothing else
--   manual:  active -> suspected_closed
--            suspected_closed -> confirmed_closed
--            suspected_closed -> active
--            confirmed_closed -> active
--
-- ⚠ active -> confirmed_closed is NOT permitted, even for an admin. Confirming
-- a closure is the destructive step, and requiring the venue to have been
-- flagged first means there is always a suspected_closed event -- and usually a
-- venue_closure_signals row -- sitting in the log underneath it. An admin who
-- knows a venue has closed calls confirm_venue_closure twice in effect: flag,
-- then confirm. If that proves too much friction in practice, widening it is
-- one line in the matrix below plus a test -- but it should be a decision
-- someone makes on purpose, not a gap nobody noticed.
CREATE OR REPLACE FUNCTION _venue_record_status_transition(
  p_venue_id  uuid,
  p_to_status text,
  p_mode      text,
  p_actor     uuid,
  p_reason    text,
  p_evidence  jsonb   DEFAULT '{}'::jsonb,
  p_source    text    DEFAULT NULL,
  p_signal_id uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from        text;
  v_disc_before boolean;
  v_disc_after  boolean;
  v_restore     boolean;
  v_event_id    uuid;
BEGIN
  IF p_mode NOT IN ('auto', 'manual') THEN
    RAISE EXCEPTION 'invalid_mode:%', p_mode;
  END IF;
  -- The mode/actor pairing is a table constraint too, but checking it here
  -- gives the caller a named error instead of a constraint violation.
  IF p_mode = 'auto' AND p_actor IS NOT NULL THEN
    RAISE EXCEPTION 'auto_transition_must_have_no_actor';
  END IF;
  IF p_mode = 'manual' AND p_actor IS NULL THEN
    RAISE EXCEPTION 'manual_transition_requires_actor';
  END IF;

  -- FOR UPDATE: two concurrent transitions on one venue must serialise, or both
  -- could read the same from_status and write two contradictory events.
  SELECT operating_status, discovery_approved
    INTO v_from, v_disc_before
    FROM venues WHERE id = p_venue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found';
  END IF;

  IF v_from = p_to_status THEN
    RAISE EXCEPTION 'no_transition:%', v_from;
  END IF;

  -- The matrix.
  IF p_mode = 'auto' THEN
    IF NOT (v_from = 'active' AND p_to_status = 'suspected_closed') THEN
      RAISE EXCEPTION 'transition_not_permitted_for_automation:%->%', v_from, p_to_status;
    END IF;
  ELSE
    IF NOT (
         (v_from = 'active'           AND p_to_status = 'suspected_closed')
      OR (v_from = 'suspected_closed' AND p_to_status = 'confirmed_closed')
      OR (v_from = 'suspected_closed' AND p_to_status = 'active')
      OR (v_from = 'confirmed_closed' AND p_to_status = 'active')
    ) THEN
      RAISE EXCEPTION 'transition_not_permitted:%->%', v_from, p_to_status;
    END IF;
  END IF;

  -- Visibility. Only two edges touch it, and each does so for a stated reason.
  v_disc_after := v_disc_before;

  IF p_to_status = 'confirmed_closed' THEN
    -- The destructive step: stop showing a venue that no longer exists.
    v_disc_after := false;

  ELSIF p_to_status = 'active' AND v_from = 'confirmed_closed' THEN
    -- DELIBERATE RESTORE, not a blanket "set it true". Take back exactly what
    -- the confirmation took away, by reading the value recorded on the most
    -- recent transition INTO confirmed_closed. If a venue was already hidden
    -- for an unrelated reason (moderation, a manual takedown) before it was
    -- confirmed closed, reactivating it must NOT publish it.
    SELECT e.discovery_approved_before INTO v_restore
      FROM venue_operating_status_events e
     WHERE e.venue_id = p_venue_id AND e.to_status = 'confirmed_closed'
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT 1;
    -- No recorded confirmation (a row that predates this log): leave visibility
    -- exactly as it is rather than guessing. The event records that we did.
    v_disc_after := coalesce(v_restore, v_disc_before);

  END IF;
  -- suspected_closed never touches visibility at all. A suspicion is not a
  -- finding, and hiding on suspicion would make automation destructive.

  UPDATE venues
     SET operating_status = p_to_status,
         operating_status_updated_at = now(),
         discovery_approved = v_disc_after
   WHERE id = p_venue_id;

  INSERT INTO venue_operating_status_events (
    venue_id, from_status, to_status, reason, evidence, closure_signal_id,
    mode, actor_id, source, discovery_approved_before, discovery_approved_after)
  VALUES (
    p_venue_id, v_from, p_to_status, p_reason, coalesce(p_evidence, '{}'::jsonb), p_signal_id,
    p_mode, p_actor, p_source, v_disc_before, v_disc_after)
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'ok', true, 'changed', true,
    'venue_id', p_venue_id, 'event_id', v_event_id,
    'from_status', v_from, 'to_status', p_to_status,
    'mode', p_mode, 'actor_id', p_actor,
    'discovery_approved_before', v_disc_before,
    'discovery_approved_after', v_disc_after);
END;
$$;

-- Internal. No API role calls this directly -- the three policy wrappers below
-- are the whole public surface, and they are what carry the authorisation.
REVOKE ALL ON FUNCTION _venue_record_status_transition(uuid, text, text, uuid, text, jsonb, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ── system_flag_suspected_closure — the ONLY automated transition ────────────
-- service_role only, active -> suspected_closed only, mode='auto', actor NULL.
-- Automation cannot reach confirmed_closed from here even by passing arguments:
-- the target status is not a parameter.
--
-- IDEMPOTENT BY DESIGN, and the no-op is explicit rather than accidental. A
-- venue already suspected or already confirmed is left completely alone and
-- NO event is appended -- a re-detection is not a state change, and logging one
-- would make the event log say the status moved when it did not. The caller
-- gets changed=false and the reason, so a re-run is quiet but not silent.
CREATE OR REPLACE FUNCTION system_flag_suspected_closure(
  p_venue_id uuid,
  p_reason   text,
  p_evidence jsonb DEFAULT '{}'::jsonb,
  p_signal_id uuid DEFAULT NULL,
  p_source   text  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT operating_status INTO v_status FROM venues WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found';
  END IF;
  IF v_status <> 'active' THEN
    RETURN jsonb_build_object(
      'ok', true, 'changed', false, 'status', v_status,
      'reason', 'already_' || v_status);
  END IF;

  RETURN _venue_record_status_transition(
    p_venue_id, 'suspected_closed', 'auto', NULL,
    p_reason, coalesce(p_evidence, '{}'::jsonb), p_source, p_signal_id);
END;
$$;

REVOKE ALL ON FUNCTION system_flag_suspected_closure(uuid, text, jsonb, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION system_flag_suspected_closure(uuid, text, jsonb, uuid, text) TO service_role;
-- The 2-argument form from the earlier draft is a DIFFERENT function to
-- Postgres and would survive with its unaudited body -- which updated venues
-- and wrote no event at all. Dropped, not left callable.
DROP FUNCTION IF EXISTS system_flag_suspected_closure(uuid, text);

-- ── confirm_venue_closure — the destructive step, humans only ───────────────
-- A real auth.uid() AND is_admin(). service_role EXECUTE is revoked, so the
-- service key cannot reach the body even before is_admin() would refuse it.
-- This is the ONLY function that sets operating_status='confirmed_closed' and
-- the only one that hides a venue for closure reasons.
CREATE OR REPLACE FUNCTION confirm_venue_closure(p_venue_id uuid, p_notes text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_out jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no_authenticated_actor';
  END IF;
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  v_out := _venue_record_status_transition(
    p_venue_id, 'confirmed_closed', 'manual', v_uid,
    coalesce(p_notes, 'confirmed closed'),
    jsonb_build_object('code', 'human_confirmed_closure', 'by', v_uid),
    'admin', NULL);

  -- Kept from the original: the note is also appended to moderation_notes,
  -- which is what the existing admin surfaces read. The event log is the
  -- authoritative record; this is a convenience mirror.
  UPDATE venues
     SET moderation_notes = coalesce(moderation_notes || E'\n', '')
                            || coalesce(p_notes, 'confirmed closed')
   WHERE id = p_venue_id;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION confirm_venue_closure(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION confirm_venue_closure(uuid, text) TO authenticated;

-- ── reactivate_venue — humans only ──────────────────────────────────────────
-- Covers both reopening edges: suspected_closed -> active (the suspicion was
-- wrong) and confirmed_closed -> active (it reopened). Visibility is restored
-- from what the confirmation actually took away -- see the primitive.
CREATE OR REPLACE FUNCTION reactivate_venue(p_venue_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no_authenticated_actor';
  END IF;
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  RETURN _venue_record_status_transition(
    p_venue_id, 'active', 'manual', v_uid,
    coalesce(p_notes, 'reactivated'),
    jsonb_build_object('code', 'human_reactivated_venue', 'by', v_uid),
    'admin', NULL);
END;
$$;

REVOKE ALL ON FUNCTION reactivate_venue(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION reactivate_venue(uuid, text) TO authenticated;
-- Same reasoning as system_flag_suspected_closure: the earlier 1-argument form
-- is a different function and would survive, still able to set
-- discovery_approved = true with no event and no restore logic.
DROP FUNCTION IF EXISTS reactivate_venue(uuid);
-- @end-section: closure_functions

-- ─────────────────────────────────────────────────────────────────────────────
-- C. venue_discovery_candidates — quarantine model for new venues (Part 6/7/8)
-- ─────────────────────────────────────────────────────────────────────────────
-- Denormalised accept-gate flags (has_family_relevant_category etc.) are
-- stored directly on the row, set by the (TypeScript) discovery script from a
-- vetted category allowlist — the RPC re-checks stored booleans rather than
-- re-deriving them from a category join, keeping the safety-critical RPC
-- simple and auditable.
--
-- === RELEASE-ONE PRODUCT DECISION: NO CANDIDATE EVER AUTO-PUBLISHES =========
-- This table is a QUARANTINE, not a staging area that drains itself. The only
-- path from a candidate row to a publicly discoverable venue is a named human
-- admin calling resolve_discovery_candidate (061 section C). 059 therefore
-- ships NO publishing RPC at all -- see the note where auto_accept_candidate
-- used to be.
--
-- === THE RESOLUTION AUDIT MODEL -- a deliberate decision ====================
-- The brief asked for resolved_by / resolved_at / resolution_reasons /
-- resolved_mode / venue_id. Four of those already existed here in another
-- vocabulary, so adding all five would have created two competing truths about
-- who decided what -- the exact mistake the 057 rebase removed from
-- venue_field_proposals (a text applied_by competing with applied_mode).
--
--   ASKED FOR             CANONICAL COLUMN HERE   WHY
--   resolved_by        -> reviewed_by             already a uuid FK to profiles
--   resolved_at        -> reviewed_at             already timestamptz
--   (notes)            -> review_notes            already free text
--   venue_id           -> venue_id                already present
--   resolved_mode      -> resolved_mode           NEW. Nothing recorded whether
--                                                 a HUMAN or the PIPELINE
--                                                 produced a terminal state,
--                                                 and reviewed_by cannot say
--                                                 it: the pipeline has no
--                                                 profile id, so its rows are
--                                                 NULL -- indistinguishable
--                                                 from "human, not recorded".
--   resolution_reasons -> resolution_reasons      NEW. review_notes is prose for
--                                                 a person; this is the machine-
--                                                 readable justification array,
--                                                 matching 057's
--                                                 decision_reasons convention.
--
-- reviewed_* IS the resolution record. The two new columns add only what could
-- not otherwise be expressed. The invariants are enforced by CHECK constraints
-- on this table, not by convention -- see the constraint block below.

-- @test-section: discovery_schema
CREATE TABLE IF NOT EXISTS venue_discovery_candidates (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null,
  latitude                    decimal(9,6) not null,
  longitude                   decimal(9,6) not null,
  postcode                    text,
  address_line1               text,
  city                        text,
  phone                       text,
  website                     text,
  category_id                 uuid references categories(id),

  source                      text not null check (source in ('osm', 'geoapify')),
  source_id                   text not null,

  dedupe_decision             text not null check (dedupe_decision in ('duplicate', 'possible_duplicate', 'distinct')),
  matched_venue_id            uuid references venues(id),
  confidence_score            smallint not null check (confidence_score between 0 and 100),

  has_family_relevant_category boolean not null default false,
  has_valid_uk_coordinates     boolean not null default false,
  has_valid_address            boolean not null default false,
  is_trusted_source            boolean not null default false,
  official_verification        boolean not null default false,
  has_closure_signal           boolean not null default false,
  required_fields_complete     boolean not null default false,

  -- Status vocabulary. 'auto_accepted' is GONE: nothing in release one is auto
  -- accepted, and keeping a state named for a capability that no longer exists
  -- would let a future reader (or a future migration) reintroduce it by
  -- accident. 'approved' means a named human published it; 'dismissed' is the
  -- reviewer saying "not for us" and is distinct from 'duplicate', which is a
  -- factual claim about another row. The earlier 061 draft overloaded
  -- 'auto_accepted' for human approvals and 'duplicate' for dismissals; both
  -- were lies told to the audit trail.
  status        text not null default 'candidate'
                  check (status in ('candidate', 'quarantined', 'approved', 'rejected', 'dismissed', 'duplicate')),
  venue_id      uuid references venues(id), -- set ONLY by a human approval
  evidence      jsonb not null default '{}',

  -- Provider-declared datasource metadata, stored VERBATIM as the provider
  -- returned it. The Geoapify Places API returns a `datasource` object --
  -- {sourcename, attribution, license, url} -- and the honest thing to do with
  -- a licence statement made by the party we got the data from is to keep it,
  -- not to overwrite it with our own standing assumption about that provider.
  -- Nullable: the OSM archive provider has no such object (its licence is a
  -- property of the whole extract, not of each element).
  source_datasource jsonb,

  -- Rediscovery bookkeeping. first_seen_at is discovered_at; this records that
  -- a later run saw the same record again, which is real information even when
  -- nothing about the record changed -- and it lets a terminal row record the
  -- re-sighting without its decision being disturbed.
  last_seen_at  timestamptz not null default now(),
  seen_count    integer not null default 1 check (seen_count > 0),

  -- resolution audit (see the header block above)
  reviewed_by   uuid references profiles(id),  -- the resolving human; NULL for pipeline decisions
  reviewed_at   timestamptz,                   -- when the row reached its terminal state
  review_notes  text,                          -- prose, for a person
  resolved_mode text check (resolved_mode in ('manual', 'system')),
  resolution_reasons jsonb not null default '[]'::jsonb
                  check (jsonb_typeof(resolution_reasons) = 'array'),

  discovered_at timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (source, source_id),

  -- THE RELEASE-ONE PUBLICATION INVARIANT.
  -- A candidate that reached 'approved' MUST carry a complete human audit
  -- trail. This is a table constraint, not an RPC convention, so it holds even
  -- against a direct service_role UPDATE that bypasses RLS: the pipeline
  -- cannot mark anything 'approved' because it has no reviewed_by to supply
  -- and no venue it is permitted to create.
  constraint venue_discovery_candidates_approved_audit_ck check (
    status <> 'approved'
    or (resolved_mode = 'manual'
        and reviewed_by is not null
        and reviewed_at is not null
        and venue_id   is not null)
  ),

  -- Every other terminal state must still say WHO decided and WHEN. A 'manual'
  -- decision additionally needs the reviewer's identity; a 'system' one is the
  -- pipeline and legitimately has none.
  constraint venue_discovery_candidates_terminal_audit_ck check (
    status not in ('rejected', 'dismissed', 'duplicate')
    or (resolved_mode is not null
        and reviewed_at is not null
        and (resolved_mode = 'system' or reviewed_by is not null))
  ),

  -- A venue id may only ever appear on the row that actually published it.
  constraint venue_discovery_candidates_venue_only_when_approved_ck check (
    venue_id is null or status = 'approved'
  )
);

CREATE TRIGGER venue_discovery_candidates_updated_at
  BEFORE UPDATE ON venue_discovery_candidates
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX IF NOT EXISTS venue_discovery_candidates_status_idx ON venue_discovery_candidates (status);
CREATE INDEX IF NOT EXISTS venue_discovery_candidates_dedupe_idx ON venue_discovery_candidates (dedupe_decision);

ALTER TABLE venue_discovery_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "discovery_candidates_admin_all" ON venue_discovery_candidates
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());
-- ── TABLE PRIVILEGES (D12) ───────────────────────────────────────────────────
-- Same reasoning as venue_closure_signals above: this project's
-- ALTER DEFAULT PRIVILEGES hands anon+authenticated four DML privileges on
-- every new public table and ALL to service_role, so a bare CREATE TABLE would
-- make the admin RLS policy the ONLY thing standing between an anon token and
-- this table. Grants and RLS are two independent layers and both are stated.
--
-- anon / authenticated: NOTHING. Verified, not assumed -- no file under app/,
-- components/ or hooks/ references venue_discovery_candidates; the only
-- consumers are service_role scripts and the admin RPCs below, and a
-- SECURITY DEFINER function does not need the CALLER to hold table privileges.
-- When the admin review UI is built it should get a narrow
-- GRANT SELECT TO authenticated (the admin-only RLS policy already exists), in
-- its own migration, reviewed on its own merits.
--
-- R2 (pre-staging remediation, 2026-09-01): service_role gets NOTHING either,
-- not even SELECT. It PREVIOUSLY held SELECT, INSERT, UPDATE directly on this
-- table, which meant the compliance/DB boundary this migration otherwise
-- describes ("a terminal human decision outranks any later automated
-- sighting", 061 B2) was only a convention -- the runner's own service-role
-- key could always bypass upsert_discovery_candidate and write the table
-- directly, which is exactly what scripts/enrich/autonomous.ts was doing.
-- upsert_discovery_candidate (061 B2) is SECURITY DEFINER and runs as the
-- function owner, so it needs no table grant on the caller's role to do its
-- job; the only way in now is genuinely the RPC, matching this table's own
-- header claim. Verified no other file reads this table directly either (a
-- repo-wide grep of scripts/, supabase/functions/, app/, components/ finds
-- only autonomous.ts, now rewired onto the RPC). TRUNCATE, REFERENCES and
-- TRIGGER (and MAINTAIN on PG17+) are withheld from every role by the REVOKE.
REVOKE ALL ON TABLE venue_discovery_candidates FROM PUBLIC, anon, authenticated, service_role;
-- @end-section: discovery_schema

-- ── RPC: auto_accept_candidate — DELIBERATELY NOT CREATED ────────────────────
-- An earlier draft of this migration created auto_accept_candidate here: a
-- service_role SECURITY DEFINER function that INSERTed straight into venues
-- with is_published = true, moderation_status = 'approved' and
-- discovery_approved = true. That is an unattended path from a third-party API
-- response to a publicly discoverable family venue, and release one does not
-- have one.
--
-- It is not commented out, not renamed, and not left behind with its EXECUTE
-- revoked -- it is simply never created, so there is no object to re-grant by
-- accident. 061 additionally DROPs both historical signatures, so a database
-- that ever saw the earlier draft ends up in the same state as one that did
-- not.
--
-- What replaces it:
--   queue_candidate_for_review  (061 B) service_role; re-checks every accept
--                                       gate and then QUARANTINES. Creates no
--                                       venue. Contains no INSERT INTO venues.
--   resolve_discovery_candidate (061 C) authenticated + is_admin() + a real
--                                       auth.uid(); the ONLY candidate ->
--                                       venue path in the system.

-- ─────────────────────────────────────────────────────────────────────────────
-- D. Venue provenance: the source/licence contract discovery must satisfy
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 012 gave venues data_source + license and 013/016 gave it osm_id.
-- Discovery breaks two things about that model, and both are fixed here rather
-- than papered over at publication time:
--
-- 1. 012's CHECK has no 'geoapify'. The earlier drafts passed the candidate's
--    own source straight into venues.data_source, so EVERY Geoapify approval
--    would have failed the constraint at the moment of publication. The
--    tempting workarounds were all worse than the bug: recording 'manual' (a
--    lie about a machine import), 'osm' (a lie about which provider we
--    actually hold a licence relationship with), or 'ogl' (a lie about the
--    licence itself). The CHECK is widened instead.
--
-- 2. One column cannot carry provenance for a DERIVED source. Geoapify results
--    are substantially OpenStreetMap-derived -- scripts/enrich/sourceTrust.ts
--    already treats Geoapify as an OSM descendant for independence purposes,
--    and geoapifyPlacesProvider.ts already stamps every candidate
--    "OpenStreetMap contributors (via Geoapify)". So a Geoapify venue can owe
--    attribution to TWO parties, and which ones can change with our
--    subscription tier. Baking today's answer into one opaque string would
--    make the database unable to answer the question later.
--
-- The model: data_source says WHO WE GOT IT FROM, license says WHAT LICENCE
-- THE UNDERLYING DATA IS UNDER, data_source_ref says WHICH RECORD, and
-- attribution_required says WHO MUST BE CREDITED. The UI/legal layer reads the
-- last one; it is never inferred from data_source at render time.
--
-- SCOPE NOTE, and it matters: storing these columns does not by itself
-- discharge any ODbL or Geoapify obligation. It records what the product needs
-- in order to render correct attribution, and nothing here is a legal opinion
-- or a compliance sign-off. See the assumptions list at the end of this file.

-- @test-section: venues_provenance
ALTER TABLE venues
  -- The provider's own identifier for the record we imported. For OSM this
  -- equals osm_id; for Geoapify it is the Geoapify place_id, which is NOT an
  -- OSM identity and must never be written to osm_id (that column is UNIQUE
  -- and is the OSM importer's upsert key -- a place_id in there could block a
  -- genuine OSM import and would assert an OSM identity we do not have).
  ADD COLUMN IF NOT EXISTS data_source_ref text,
  -- Who must be credited wherever this venue's data is shown. An ARRAY because
  -- a derived source can owe more than one party, and a separate column
  -- because the answer is a property of how we acquired the row, not something
  -- to re-derive from data_source in a template.
  ADD COLUMN IF NOT EXISTS attribution_required text[] NOT NULL DEFAULT '{}'::text[],
  -- The provider's OWN statement about where this record came from and under
  -- what licence, carried onto the published venue verbatim. attribution_required
  -- is our normalised rendering contract; this is the evidence behind it, so the
  -- legal layer can see what the provider actually said rather than only what we
  -- concluded -- and can still see it if the candidate row is ever pruned.
  ADD COLUMN IF NOT EXISTS data_source_meta jsonb;

-- Widen 012's data_source CHECK to admit 'geoapify'. Widening is always safe
-- for existing rows -- every value that satisfied the old constraint satisfies
-- this one -- but the DROP has to be exact or we would silently keep the old
-- narrow constraint alongside the new wide one and Geoapify would still fail.
-- 012 created the constraint inline, so its name is server-generated; this
-- finds it by definition rather than trusting a name, then verifies the
-- rewrite actually happened.
DO $do$
DECLARE
  r record;
  v_remaining int;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
     WHERE con.conrelid = 'public.venues'::regclass
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%data_source%'
  LOOP
    EXECUTE format('ALTER TABLE public.venues DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE public.venues
    ADD CONSTRAINT venues_data_source_check
    CHECK (data_source IN ('manual', 'user_submitted', 'osm', 'ogl',
                           'foursquare', 'business_claimed', 'geoapify'));

  SELECT count(*) INTO v_remaining
    FROM pg_constraint con
   WHERE con.conrelid = 'public.venues'::regclass
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%data_source%';
  IF v_remaining <> 1 THEN
    RAISE EXCEPTION 'venues.data_source must end with exactly one CHECK, found %', v_remaining;
  END IF;
END
$do$;

-- Constrain the attribution vocabulary. Deny-by-default: an unrecognised token
-- fails the write rather than reaching the UI as an unrenderable string.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'venues_attribution_required_check'
       AND conrelid = 'public.venues'::regclass
  ) THEN
    ALTER TABLE public.venues
      ADD CONSTRAINT venues_attribution_required_check
      CHECK (attribution_required <@ ARRAY['openstreetmap', 'geoapify']::text[]);
  END IF;
END
$do$;

COMMENT ON COLUMN venues.data_source_ref IS
  'The source provider''s own identifier for this record (OSM: "node/123" -- same as osm_id; Geoapify: the place_id). Provenance only; never a join key.';
COMMENT ON COLUMN venues.data_source_meta IS
  'The source provider''s own datasource statement, stored verbatim (Geoapify Places returns {sourcename, attribution, license, url}). Evidence for attribution_required; never parsed at render time.';
COMMENT ON COLUMN venues.attribution_required IS
  'Parties that must be credited wherever this venue is displayed. Read by the UI/legal layer; never inferred from data_source at render time. Recording it does not by itself discharge any licence obligation.';
-- ── The single provenance mapping, and it FAILS CLOSED ──────────────────────
-- Publication has exactly one place where a candidate's source becomes a
-- venue's provenance, so there is exactly one place to audit. Anything this
-- function cannot map with certainty raises -- and the caller's contract
-- (061 C) is to QUARANTINE on that raise, never to publish with a guess.
--
--   osm       data_source 'osm'       license 'ODbL-1.0'
--                                     osm_id = the canonical "type/id"
--                                     attribution {openstreetmap}
--   geoapify  data_source 'geoapify'  license 'ODbL-1.0'
--                                     osm_id NULL -- we do not have one
--                                     attribution {openstreetmap, geoapify}
--
-- Why Geoapify carries ODbL-1.0 and BOTH attributions: the provider is
-- substantially OSM-derived (see sourceTrust.ts), so the underlying data
-- obligation travels with it, and the provider's own credit requirement
-- applies on top. Storing both means a later change of subscription tier is a
-- rendering decision the product can make from data it already holds, instead
-- of a backfill it can no longer perform.
-- The provider's datasource statement is the INPUT to this mapping, not a
-- decoration on it. Geoapify Places returns, per feature:
--     "datasource": { "sourcename":   "openstreetmap",
--                     "attribution":  "© OpenStreetMap contributors",
--                     "license":      "Open Database License",
--                     "url":          "https://www.openstreetmap.org/copyright" }
-- (verified against the real captured fixture in
--  scripts/enrich/fixtures/geoapify-real/, not assumed from documentation).
--
-- WHY THIS MATTERS ENOUGH TO CHANGE THE SIGNATURE. Geoapify is an aggregator.
-- Today its Places results are overwhelmingly OpenStreetMap, but "Geoapify" is
-- a company, not a licence, and a future product, tier or dataset of theirs may
-- carry different terms. Hardcoding "geoapify implies ODbL" would mean the
-- database quietly asserting a licence nobody checked, on rows imported years
-- after anyone looked. So the provider tells us, and we refuse what we cannot
-- recognise.
CREATE OR REPLACE FUNCTION discovery_candidate_provenance(
  p_source text,
  p_source_id text,
  p_datasource jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_sourcename  text;
  v_license_raw text;
  v_license     text;
  v_attribution text[];
BEGIN
  IF p_source_id IS NULL OR btrim(p_source_id) = '' THEN
    RAISE EXCEPTION 'unmappable_provenance:missing_source_id';
  END IF;

  IF p_source = 'osm' THEN
    -- The OSM importer's contract, followed exactly rather than reinvented:
    -- osmArchiveProvider.ts builds sourceId as format('%s/%s', element.type,
    -- element.id) and venues.osm_id already holds values of that shape
    -- ("node/123"). A candidate whose source_id is not in that form is an OSM
    -- record whose identity we cannot state, so it is not publishable.
    IF p_source_id !~ '^(node|way|relation)/[0-9]+$' THEN
      RAISE EXCEPTION 'unmappable_provenance:osm_id_not_canonical:%', p_source_id;
    END IF;
    RETURN jsonb_build_object(
      'data_source', 'osm',
      'license', 'ODbL-1.0',
      'osm_id', p_source_id,
      'data_source_ref', p_source_id,
      'attribution_required', jsonb_build_array('openstreetmap'),
      'data_source_meta', coalesce(p_datasource, jsonb_build_object(
        'sourcename', 'openstreetmap',
        'license', 'Open Database License',
        'attribution', '(c) OpenStreetMap contributors',
        'url', 'https://www.openstreetmap.org/copyright',
        'note', 'declared by the OSM archive importer, not returned per-record')));
  END IF;

  IF p_source = 'geoapify' THEN
    -- FAIL CLOSED when the provider told us nothing. Publishing would mean
    -- asserting a licence on this specific record that nobody verified.
    IF p_datasource IS NULL OR jsonb_typeof(p_datasource) <> 'object' THEN
      RAISE EXCEPTION 'unmappable_provenance:missing_datasource_metadata';
    END IF;

    v_sourcename  := lower(btrim(coalesce(p_datasource ->> 'sourcename', '')));
    v_license_raw := lower(btrim(coalesce(p_datasource ->> 'license', '')));

    IF v_sourcename = '' THEN
      RAISE EXCEPTION 'unmappable_provenance:missing_datasource_sourcename';
    END IF;

    -- Recognised upstream datasets only. A new one must be added here, with
    -- its licence and attribution decided by a person.
    IF v_sourcename <> 'openstreetmap' THEN
      RAISE EXCEPTION 'unmappable_provenance:unknown_datasource:%', v_sourcename;
    END IF;

    -- Recognise the licence the provider NAMED, rather than assuming it. These
    -- are the spellings Geoapify actually returns for OSM-sourced records.
    v_license := CASE
      WHEN v_license_raw IN ('open database license', 'odbl', 'odbl-1.0',
                             'open database license (odbl)', 'odc odbl')
        THEN 'ODbL-1.0'
      ELSE NULL
    END;
    IF v_license IS NULL THEN
      RAISE EXCEPTION 'unmappable_provenance:unknown_license:%',
        coalesce(nullif(v_license_raw, ''), '(empty)');
    END IF;

    -- Attribution is DERIVED: the upstream dataset's requirement, plus the
    -- provider's own. Both are recorded because which of them actually applies
    -- can change with our subscription tier -- and that is a rendering decision
    -- the product must be able to make later from data it already holds.
    v_attribution := ARRAY['openstreetmap', 'geoapify']::text[];

    RETURN jsonb_build_object(
      'data_source', 'geoapify',
      'license', v_license,
      -- A Geoapify place_id is NOT an OSM identity, even though the underlying
      -- record is OSM-derived. venues.osm_id is UNIQUE and is the OSM importer's
      -- upsert key; putting a place_id in it would assert an identity we do not
      -- have and could block a genuine OSM import.
      'osm_id', NULL,
      'data_source_ref', p_source_id,
      'attribution_required', to_jsonb(v_attribution),
      'data_source_meta', p_datasource);
  END IF;

  -- A new provider must be added HERE, consciously, with its licence and
  -- attribution decided. Falling through to a default would publish a venue
  -- with provenance nobody chose.
  RAISE EXCEPTION 'unmappable_provenance:unknown_source:%', p_source;
END;
$$;

REVOKE ALL ON FUNCTION discovery_candidate_provenance(text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION discovery_candidate_provenance(text, text, jsonb) TO service_role;
-- The 2-argument form would otherwise survive as a separate function with the
-- old "geoapify always means ODbL" assumption baked in.
DROP FUNCTION IF EXISTS discovery_candidate_provenance(text, text);
-- @end-section: venues_provenance

-- =============================================================================
-- E. venue_enrichment_suppressions — durable objection/suppression (R3)
-- =============================================================================
-- PRE-STAGING REMEDIATION, 2026-09-01. THE GAP THIS CLOSES: nothing in this
-- schema could previously stop a corrected or objected-to fact from being
-- re-proposed by the next crawl. propose_field's dedupe compares only against
-- the CURRENT live value (056:209-212) -- so blanking a field to honour an
-- objection made the field MORE likely to be re-proposed at high confidence,
-- with no record anywhere that a human had already said no to it. That defeat
-- of the right to object/erasure was the DPIA's stated reason this could not
-- be signed off (docs/DPIA_website_enrichment_addendum.md §10.1).
--
-- MODEL. One table, two independent targets:
--   scope='venue'     -- an EXISTING published venue objects to (or has had
--                         corrected) a specific field, or the whole venue.
--                         field IS NULL means "do not touch this venue at
--                         all"; field NOT NULL means "leave this one field
--                         alone, everything else may still be enriched" --
--                         Liam's requirement that a field-level suppression
--                         must not unnecessarily suppress unrelated fields.
--   scope='candidate' -- a (source, source_id) that must never be admitted as
--                         a NEW candidate/venue again, keyed by provider
--                         identity because a not-yet-created venue has no
--                         venue_id to suppress by.
--
-- ENFORCEMENT IS SERVER-SIDE, INSIDE THE WRITE PATH, NOT IN TYPESCRIPT.
-- Exactly the lesson R2 already proved: a rule a service-role holder can skip
-- is not a rule. So the check lives inside propose_field (below, extended by
-- CREATE OR REPLACE), inside auto_apply_field_proposal (re-checked above, at
-- the point of auto-apply -- a suppression created AFTER a proposal was
-- already queued must still stop that proposal), and inside
-- upsert_discovery_candidate (061 B2, extended by CREATE OR REPLACE in that
-- file). None of these checks branch on the caller's role: there is no
-- "unless service_role" clause anywhere, so service_role cannot silently
-- override a suppression by construction, not by convention.
--
-- WHY A ROW, NOT A BOOLEAN COLUMN ON venues. A boolean loses WHY, WHEN and WHO
-- -- exactly the information an objection needs to be defensible later, and
-- exactly the pattern this schema already uses everywhere else (decision_
-- reasons, resolution_reasons, the closure event log). Removal is a soft
-- delete (removed_by/removed_at/removal_notes), not a hard DELETE, for the
-- same reason: "an admin restored eligibility for this venue on this date, for
-- this stated reason" is itself worth keeping.
--
-- @test-section: suppression_schema
CREATE TABLE IF NOT EXISTS venue_enrichment_suppressions (
  id            uuid primary key default gen_random_uuid(),
  scope         text not null check (scope in ('venue', 'candidate')),

  -- scope='venue' target
  venue_id      uuid references venues(id) on delete cascade,
  field         text check (field in (
                  'description','price_range','website','booking_url',
                  'phone','email','opening_hours'
                )),

  -- scope='candidate' target -- same provider-identity contract as
  -- venue_discovery_candidates(source, source_id); deliberately not a FK to
  -- that table, because the whole point is to suppress a source_id BEFORE (or
  -- even without) a candidate row ever existing for it.
  source        text check (source in ('osm', 'geoapify')),
  source_id     text,

  reason        text not null check (btrim(reason) <> ''),
  notes         text,

  created_by    uuid not null references profiles(id),
  created_at    timestamptz not null default now(),

  is_permanent  boolean not null default true,
  expires_at    timestamptz,

  -- Soft delete. A suppression that has been removed no longer blocks
  -- anything (the enforcement functions below filter on removed_at IS NULL),
  -- but the record of it having existed, and of who lifted it and why, is
  -- retained -- an admin "restoring eligibility" is itself an accountable act.
  removed_by    uuid references profiles(id),
  removed_at    timestamptz,
  removal_notes text,

  -- Exactly one target shape per row -- never both, never neither.
  constraint venue_enrichment_suppressions_target_ck check (
    (scope = 'venue'
       and venue_id is not null and source is null and source_id is null)
    or
    (scope = 'candidate'
       and venue_id is null and source is not null and source_id is not null
       and field is null)
  ),
  -- is_permanent and expires_at must never disagree about whether this
  -- suppression ends. No "permanent, but also has an expiry" and no
  -- "not permanent, but nobody said when it lapses".
  constraint venue_enrichment_suppressions_expiry_ck check (
    is_permanent = (expires_at is null)
  ),
  -- A half-recorded removal (only one of removed_by/removed_at set) is not a
  -- state this schema can make sense of later.
  constraint venue_enrichment_suppressions_removal_ck check (
    (removed_by is null and removed_at is null)
    or (removed_by is not null and removed_at is not null)
  )
);

CREATE INDEX IF NOT EXISTS venue_enrichment_suppressions_venue_idx
  ON venue_enrichment_suppressions (venue_id, field) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS venue_enrichment_suppressions_candidate_idx
  ON venue_enrichment_suppressions (source, source_id) WHERE removed_at IS NULL;

ALTER TABLE venue_enrichment_suppressions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "enrichment_suppressions_admin_all" ON venue_enrichment_suppressions
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ── TABLE PRIVILEGES ─────────────────────────────────────────────────────────
-- NOTHING, for every role, including service_role and authenticated. The only
-- surface is the three SECURITY DEFINER RPCs below (create/remove/list) plus
-- the two read-only check functions the write-path functions call internally.
-- This is the same shape as venue_operating_status_events and (after R2)
-- venue_discovery_candidates: a table whose only door is a function, so there
-- is no ACL surface for an auditor to have to disprove.
REVOKE ALL ON TABLE venue_enrichment_suppressions FROM PUBLIC, anon, authenticated, service_role;
-- @end-section: suppression_schema

-- @test-section: suppression_checks
-- Whole-venue OR single-field suppression. field IS NULL on the suppression
-- row means "the whole venue"; p_field is the field a caller is asking about.
CREATE OR REPLACE FUNCTION enrichment_venue_field_suppressed(p_venue_id uuid, p_field text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM venue_enrichment_suppressions
     WHERE scope = 'venue'
       AND venue_id = p_venue_id
       AND (field IS NULL OR field = p_field)
       AND removed_at IS NULL
       AND (is_permanent OR expires_at > now())
  )
$$;

REVOKE ALL ON FUNCTION enrichment_venue_field_suppressed(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION enrichment_venue_field_suppressed(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION enrichment_candidate_source_suppressed(p_source text, p_source_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM venue_enrichment_suppressions
     WHERE scope = 'candidate'
       AND source = p_source
       AND source_id = p_source_id
       AND removed_at IS NULL
       AND (is_permanent OR expires_at > now())
  )
$$;

REVOKE ALL ON FUNCTION enrichment_candidate_source_suppressed(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION enrichment_candidate_source_suppressed(text, text) TO service_role;
-- @end-section: suppression_checks

-- @test-section: suppression_admin
-- create_enrichment_suppression -- the ONLY way to create a suppression row.
-- Human admin only: an objection/erasure record must name a real accountable
-- actor, exactly like confirm_venue_closure and resolve_discovery_candidate.
CREATE OR REPLACE FUNCTION create_enrichment_suppression(
  p_reason       text,
  p_venue_id     uuid DEFAULT NULL,
  p_field        text DEFAULT NULL,
  p_source       text DEFAULT NULL,
  p_source_id    text DEFAULT NULL,
  p_notes        text DEFAULT NULL,
  p_is_permanent boolean DEFAULT true,
  p_expires_at   timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_scope text;
  v_id  uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no_authenticated_actor';
  END IF;
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  IF p_venue_id IS NOT NULL AND (p_source IS NOT NULL OR p_source_id IS NOT NULL) THEN
    RAISE EXCEPTION 'ambiguous_target:both_venue_and_candidate_supplied';
  END IF;

  IF p_venue_id IS NOT NULL THEN
    v_scope := 'venue';
  ELSIF p_source IS NOT NULL AND p_source_id IS NOT NULL THEN
    v_scope := 'candidate';
    IF p_field IS NOT NULL THEN
      RAISE EXCEPTION 'candidate_suppression_has_no_field';
    END IF;
  ELSE
    RAISE EXCEPTION 'target_required:supply_either_venue_id_or_source_and_source_id';
  END IF;

  IF NOT p_is_permanent AND p_expires_at IS NULL THEN
    RAISE EXCEPTION 'expires_at_required_when_not_permanent';
  END IF;
  IF p_is_permanent AND p_expires_at IS NOT NULL THEN
    RAISE EXCEPTION 'permanent_suppression_must_not_carry_an_expiry';
  END IF;

  INSERT INTO venue_enrichment_suppressions (
    scope, venue_id, field, source, source_id,
    reason, notes, created_by, is_permanent, expires_at
  ) VALUES (
    v_scope, p_venue_id, p_field, p_source, p_source_id,
    p_reason, p_notes, v_uid, p_is_permanent, p_expires_at
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION create_enrichment_suppression(text, uuid, text, text, text, text, boolean, timestamptz)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION create_enrichment_suppression(text, uuid, text, text, text, text, boolean, timestamptz)
  TO authenticated;

-- remove_enrichment_suppression -- deliberate restoration of eligibility.
-- Soft delete only (see the table comment); the row survives as history.
CREATE OR REPLACE FUNCTION remove_enrichment_suppression(
  p_suppression_id uuid,
  p_notes          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_row venue_enrichment_suppressions%rowtype;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no_authenticated_actor';
  END IF;
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  SELECT * INTO v_row FROM venue_enrichment_suppressions WHERE id = p_suppression_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF v_row.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_removed';
  END IF;

  UPDATE venue_enrichment_suppressions
     SET removed_by = v_uid, removed_at = now(), removal_notes = p_notes
   WHERE id = p_suppression_id;

  RETURN jsonb_build_object('ok', true, 'id', p_suppression_id, 'removed_by', v_uid);
END;
$$;

REVOKE ALL ON FUNCTION remove_enrichment_suppression(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION remove_enrichment_suppression(uuid, text) TO authenticated;

-- list_enrichment_suppressions -- the read surface. Admin-only, via a
-- function rather than a table grant, for the same "no ACL for an auditor to
-- disprove" reason as everything else in this section. p_include_removed
-- defaults false so the ordinary view is "what is currently blocking
-- enrichment", with history available on request.
CREATE OR REPLACE FUNCTION list_enrichment_suppressions(p_include_removed boolean DEFAULT false)
RETURNS SETOF venue_enrichment_suppressions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  RETURN QUERY
    SELECT * FROM venue_enrichment_suppressions
     WHERE p_include_removed OR removed_at IS NULL
     ORDER BY created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION list_enrichment_suppressions(boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION list_enrichment_suppressions(boolean) TO authenticated;
-- @end-section: suppression_admin

-- @test-section: suppression_propose_field
-- propose_field, extended with the suppression check (R3). REBASED ONTO 057's
-- 14-argument version (057:696-781) -- the signature, dedup and decision-
-- mapping logic below are 057's, byte-for-byte, with exactly one addition:
-- the suppression guard, first, before anything else runs. FAILS CLOSED: a
-- suppressed field never gets as far as a proposal row, not even a
-- 'report_only' or 'auto_reject' one -- there is nothing for a suppression to
-- protect against if a proposal already exists carrying the objected-to value.
CREATE OR REPLACE FUNCTION propose_field(
  p_run_id                  uuid,
  p_venue_id                uuid,
  p_field                   text,
  p_proposed                jsonb,
  p_source_url              text,
  p_evidence                text,
  p_evidence_raw            text,
  p_method                  text,
  p_confidence              text,
  p_conflicts               boolean,
  p_retrieved_at            timestamptz DEFAULT now(),
  p_decision                text        DEFAULT 'manual_review',
  p_decision_reasons        jsonb       DEFAULT '[]'::jsonb,
  p_decision_engine_version text        DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot jsonb;
  v_current  jsonb;
  v_hash     text;
  v_new_id   uuid;
  v_status   text;
BEGIN
  -- R3: checked before anything else. No branch below this line runs for a
  -- suppressed (venue_id, field) pair.
  IF enrichment_venue_field_suppressed(p_venue_id, p_field) THEN
    RAISE EXCEPTION 'field_suppressed:%', p_field;
  END IF;

  IF p_decision IS NULL
     OR p_decision NOT IN ('auto_apply','manual_review','auto_reject','report_only') THEN
    RAISE EXCEPTION 'invalid_decision:%', coalesce(p_decision, 'null');
  END IF;

  v_snapshot := snapshot_current_value(p_venue_id, p_field);
  v_current  := v_snapshot -> 'value';
  v_hash     := v_snapshot ->> 'hash';

  IF p_field <> 'opening_hours'
     AND v_current IS NOT NULL
     AND v_current = p_proposed THEN
    RETURN NULL;
  END IF;

  v_status := CASE p_decision
    WHEN 'auto_reject'  THEN 'rejected'
    WHEN 'report_only'  THEN 'report_only'
    ELSE                     'pending'
  END;

  UPDATE venue_field_proposals
     SET status = 'superseded'
   WHERE venue_id = p_venue_id
     AND field    = p_field
     AND status   = 'pending';

  INSERT INTO venue_field_proposals (
    run_id, venue_id, field, proposed_value, current_value, current_value_hash,
    source_url, evidence_snippet, evidence_raw, retrieved_at,
    extraction_method, confidence, conflicts_existing, status,
    decision, decision_reasons, decision_engine_version, decision_at
  ) VALUES (
    p_run_id, p_venue_id, p_field, p_proposed, v_current, v_hash,
    p_source_url, p_evidence, p_evidence_raw, p_retrieved_at,
    p_method, p_confidence, coalesce(p_conflicts, false), v_status,
    p_decision, coalesce(p_decision_reasons, '[]'::jsonb),
    p_decision_engine_version, now()
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION propose_field(
  uuid, uuid, text, jsonb, text, text, text, text, text, boolean,
  timestamptz, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION propose_field(
  uuid, uuid, text, jsonb, text, text, text, text, text, boolean,
  timestamptz, text, jsonb, text)
  TO service_role;
-- @end-section: suppression_propose_field

-- =============================================================================
-- F. Retention — the TECHNICAL CAPABILITY, not the legal decision (R4)
-- =============================================================================
-- PRE-STAGING REMEDIATION, 2026-09-01. THIS SECTION DOES NOT DECIDE RETENTION
-- PERIODS. Every period below is an explicit REQUIRED PARAMETER with a safety
-- floor, never a silently-applied default long enough to matter, and every
-- purge function has EXECUTE revoked from every role including service_role
-- -- there is deliberately no API path that can invoke any of them yet. They
-- exist so that once Liam/legal approve specific periods (DPIA §8.2), turning
-- them on is "GRANT EXECUTE + schedule a call", not "design and build a
-- retention mechanism against a live table for the first time".
--
-- THE STRUCTURAL PROBLEM THIS SECTION FIXES FIRST: venue_operating_status_
-- events' append-only trigger (Section B2 above) raises unconditionally for
-- UPDATE OR DELETE, for every role, including the table owner -- a superuser
-- calling DELETE hits it too, because the trigger doesn't consult roles at
-- all. That means NO retention period could ever be expressed on that table,
-- not even by a future signed-off admin action. The fix is a session-local
-- guard the trigger checks: only a DELETE issued while
-- app.enrichment_retention_purge is set to 'on' in THIS transaction is let
-- through, and the only code path that ever sets it is
-- purge_expired_operating_status_events below, which resets it before
-- returning. UPDATE is not exempted by this guard under any setting -- the
-- append-only guarantee for a live row is untouched; only aged-out DELETE is
-- possible, and only through this one function.
-- @test-section: retention_functions
CREATE OR REPLACE FUNCTION venue_operating_status_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.enrichment_retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'venue_operating_status_events is append-only (attempted %)', TG_OP
    USING errcode = '42501';
END;
$$;
-- (REPLACES the Section B2 definition above -- same REVOKE, same trigger
-- attachment already in place; CREATE OR REPLACE is enough, no re-attach.)

-- Deliberately not callable by anything yet (see the section header). p_older_
-- than_days has a hard floor so a fat-fingered call cannot mass-delete recent
-- audit history even after this is one day granted to an ops role.
CREATE OR REPLACE FUNCTION purge_expired_operating_status_events(p_older_than_days integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_older_than_days IS NULL OR p_older_than_days < 365 THEN
    RAISE EXCEPTION 'retention_period_too_short_or_unset:%', p_older_than_days;
  END IF;

  PERFORM set_config('app.enrichment_retention_purge', 'on', true); -- LOCAL: this transaction only
  DELETE FROM venue_operating_status_events
   WHERE created_at < now() - (p_older_than_days || ' days')::interval;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('app.enrichment_retention_purge', 'off', true);

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION purge_expired_operating_status_events(integer)
  FROM PUBLIC, anon, authenticated, service_role;
-- No EXECUTE grant to ANY role. DRAFT VALUE, OWNER/LEGAL SIGN-OFF REQUIRED for
-- the actual period (DPIA §8.2 proposes "architecture decision required" for
-- this exact table) before this is ever granted or scheduled.

-- venue_field_proposals (056, LIVE) -- rejected/superseded/report_only rows
-- only. 'applied' and 'pending' rows are NEVER touched here: 'applied' is the
-- actual record of what changed venues data (the DPIA's proposed rule is
-- "retained, reviewed at 24m", i.e. a review trigger, not a deletion, and
-- reviews are a human process this function does not perform), and 'pending'
-- is live work. DRAFT VALUES for p_rejected_after_days/p_superseded_after_days
-- -- see DPIA §8.2.
CREATE OR REPLACE FUNCTION purge_old_field_proposals(
  p_rejected_after_days   integer,
  p_superseded_after_days integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_rejected_after_days IS NULL OR p_rejected_after_days < 30 THEN
    RAISE EXCEPTION 'retention_period_too_short_or_unset:rejected:%', p_rejected_after_days;
  END IF;
  IF p_superseded_after_days IS NULL OR p_superseded_after_days < 7 THEN
    RAISE EXCEPTION 'retention_period_too_short_or_unset:superseded:%', p_superseded_after_days;
  END IF;

  DELETE FROM venue_field_proposals
   WHERE (status = 'rejected'   AND decision_at < now() - (p_rejected_after_days   || ' days')::interval)
      OR (status = 'superseded' AND updated_at  < now() - (p_superseded_after_days || ' days')::interval)
      OR (status = 'report_only' AND decision_at < now() - (p_rejected_after_days  || ' days')::interval);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION purge_old_field_proposals(integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
-- No EXECUTE grant to ANY role. DRAFT VALUES, OWNER/LEGAL SIGN-OFF REQUIRED.

-- venue_enrichment_writes (057, LIVE) -- never a DELETE (it is the ledger
-- rollback_enrichment_run depends on); the DPIA's proposed rule is to NULL the
-- evidence-bearing columns after the retention window while keeping the
-- skeleton row (what changed, when, by what mode) for audit continuity. No
-- append-only TRIGGER exists on this table (only a plain REVOKE of insert/
-- update/delete from client roles, 057:119-130), so a SECURITY DEFINER
-- function reaches it as the owning role without needing the GUC trick used
-- for the closure event log above.
CREATE OR REPLACE FUNCTION purge_old_enrichment_write_evidence(p_older_than_days integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_older_than_days IS NULL OR p_older_than_days < 365 THEN
    RAISE EXCEPTION 'retention_period_too_short_or_unset:%', p_older_than_days;
  END IF;

  -- venue_enrichment_writes (057) has no created_at column, only applied_at --
  -- verified against the real table definition, not assumed.
  UPDATE venue_enrichment_writes
     SET evidence_snapshot = NULL,
         old_value = NULL,
         new_value = NULL
   WHERE applied_at < now() - (p_older_than_days || ' days')::interval
     AND evidence_snapshot IS NOT NULL; -- idempotent: don't keep "touching" already-nulled rows
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION purge_old_enrichment_write_evidence(integer)
  FROM PUBLIC, anon, authenticated, service_role;
-- No EXECUTE grant to ANY role. DRAFT VALUE, OWNER/LEGAL SIGN-OFF REQUIRED.

-- venue_discovery_candidates (059/061) -- terminal, non-approved rows only.
-- 'approved' rows are the audit trail for a LIVE venue (venue_id points at a
-- real published row) and are never touched. This nulls the contact/address
-- fields the DPIA identifies as the personal-data-bearing ones, keeping the
-- decision skeleton (status, resolved_mode, reviewed_by/at, resolution_
-- reasons, source/source_id, seen_count) intact.
CREATE OR REPLACE FUNCTION purge_old_discovery_candidate_contact_data(p_older_than_days integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_older_than_days IS NULL OR p_older_than_days < 30 THEN
    RAISE EXCEPTION 'retention_period_too_short_or_unset:%', p_older_than_days;
  END IF;

  UPDATE venue_discovery_candidates
     SET phone = NULL, website = NULL, address_line1 = NULL
   WHERE status IN ('rejected', 'dismissed', 'duplicate')
     AND reviewed_at < now() - (p_older_than_days || ' days')::interval
     AND (phone IS NOT NULL OR website IS NOT NULL OR address_line1 IS NOT NULL);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION purge_old_discovery_candidate_contact_data(integer)
  FROM PUBLIC, anon, authenticated, service_role;
-- No EXECUTE grant to ANY role. DRAFT VALUE, OWNER/LEGAL SIGN-OFF REQUIRED.
--
-- NOTE, load-bearing for the retention+suppression interaction requirement:
-- this function touches ONLY venue_discovery_candidates. No retention
-- function in this file references venue_enrichment_suppressions in any FROM,
-- JOIN or WHERE clause that could delete or modify a suppression row, and none
-- ever will by accident -- there IS no purge function for that table at all.
-- A suppression is a durable objection record; it does not "go stale" the way
-- evidence does, and nothing here ages it out. See the redline test proving
-- this (R3xRetention section).

-- venue_closure_signals (059) -- append-only evidence, but not append-forever.
-- No trigger guards this table (only the plain REVOKE at Section B above), so
-- this is a straightforward DELETE by age, matching the DPIA's proposed
-- "180d after status settles" rule (parameterised, not hardcoded, per this
-- section's header).
CREATE OR REPLACE FUNCTION purge_old_closure_signals(p_older_than_days integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_older_than_days IS NULL OR p_older_than_days < 30 THEN
    RAISE EXCEPTION 'retention_period_too_short_or_unset:%', p_older_than_days;
  END IF;

  DELETE FROM venue_closure_signals
   WHERE detected_at < now() - (p_older_than_days || ' days')::interval;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION purge_old_closure_signals(integer)
  FROM PUBLIC, anon, authenticated, service_role;
-- No EXECUTE grant to ANY role. DRAFT VALUE, OWNER/LEGAL SIGN-OFF REQUIRED.

-- ── The pre-existing, ALREADY LIVE, user-facing promise ─────────────────────
-- app/(auth)/privacy.tsx:181-183 already tells every user, today, in
-- production: "Location consent log entries — kept for 3 years for ICO
-- accountability purposes, then deleted automatically" and the same for GDPR
-- audit log entries. That promise is not a draft awaiting sign-off -- it has
-- ALREADY been made. Nothing currently implements it (docs/DPIA.md:387,392
-- correctly marks it "(future)"). This is the one pair of functions in this
-- section with a real, non-placeholder default (1095 days = 3 years, matching
-- the live wording exactly), because the period itself is not in question --
-- only the mechanism was missing. EXECUTE is still revoked from every role:
-- actually SCHEDULING these (pg_cron, or an ops script) is a separate,
-- deliberate deployment decision this remediation pass does not make
-- unprompted, and neither table is touched by any migration that has been
-- applied anywhere.
CREATE OR REPLACE FUNCTION purge_expired_location_consent_log(p_older_than_days integer DEFAULT 1095)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_older_than_days IS NULL OR p_older_than_days < 365 THEN
    RAISE EXCEPTION 'retention_period_too_short_or_unset:%', p_older_than_days;
  END IF;
  DELETE FROM location_consent_log
   WHERE created_at < now() - (p_older_than_days || ' days')::interval;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION purge_expired_location_consent_log(integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION purge_expired_gdpr_audit_log(p_older_than_days integer DEFAULT 1095)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_older_than_days IS NULL OR p_older_than_days < 365 THEN
    RAISE EXCEPTION 'retention_period_too_short_or_unset:%', p_older_than_days;
  END IF;
  DELETE FROM gdpr_audit_log
   WHERE created_at < now() - (p_older_than_days || ' days')::interval;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION purge_expired_gdpr_audit_log(integer)
  FROM PUBLIC, anon, authenticated, service_role;
-- @end-section: retention_functions

COMMIT;

-- =============================================================================
-- ROLLBACK (no separate _down file yet, matching the 049/056 convention):
--   BEGIN;
--   -- R4/R3 remediation (2026-09-01), rolled back first since nothing else
--   -- depends on these:
--   DROP FUNCTION IF EXISTS purge_expired_gdpr_audit_log(integer);
--   DROP FUNCTION IF EXISTS purge_expired_location_consent_log(integer);
--   DROP FUNCTION IF EXISTS purge_old_closure_signals(integer);
--   DROP FUNCTION IF EXISTS purge_old_discovery_candidate_contact_data(integer);
--   DROP FUNCTION IF EXISTS purge_old_enrichment_write_evidence(integer);
--   DROP FUNCTION IF EXISTS purge_old_field_proposals(integer, integer);
--   DROP FUNCTION IF EXISTS purge_expired_operating_status_events(integer);
--   -- NOTE: rolling back to the PRE-R4 venue_operating_status_events_append_only
--   -- (unconditional RAISE, no GUC check) is safe and recommended if this
--   -- section is reverted -- do not leave the GUC-aware version live without
--   -- the purge function, since an unused escape hatch is worse than none.
--   DROP FUNCTION IF EXISTS propose_field(uuid, uuid, text, jsonb, text, text, text, text, text, boolean, timestamptz, text, jsonb, text);
--   -- then re-apply 057's propose_field (057:696-781) to restore pre-R3 behaviour.
--   DROP FUNCTION IF EXISTS list_enrichment_suppressions(boolean);
--   DROP FUNCTION IF EXISTS remove_enrichment_suppression(uuid, text);
--   DROP FUNCTION IF EXISTS create_enrichment_suppression(text, uuid, text, text, text, text, boolean, timestamptz);
--   DROP FUNCTION IF EXISTS enrichment_candidate_source_suppressed(text, text);
--   DROP FUNCTION IF EXISTS enrichment_venue_field_suppressed(uuid, text);
--   DROP TABLE IF EXISTS venue_enrichment_suppressions;  -- destroys objection/erasure history
--   DROP FUNCTION IF EXISTS enrichment_opening_hours_is_meaningful(jsonb);
--   DROP FUNCTION IF EXISTS discovery_candidate_provenance(text, text, jsonb);
--   ALTER TABLE venues DROP COLUMN IF EXISTS data_source_meta;
--   ALTER TABLE venues DROP COLUMN IF EXISTS attribution_required;
--   ALTER TABLE venues DROP COLUMN IF EXISTS data_source_ref;
--   -- and restore 012's narrower data_source CHECK, which is only safe once
--   -- every data_source='geoapify' row is gone:
--   --   ALTER TABLE venues DROP CONSTRAINT venues_attribution_required_check;
--   --   ALTER TABLE venues DROP CONSTRAINT venues_data_source_check;
--   --   ALTER TABLE venues ADD CONSTRAINT venues_data_source_check
--   --     CHECK (data_source IN ('manual','user_submitted','osm','ogl',
--   --                            'foursquare','business_claimed'));
--   DROP TABLE IF EXISTS venue_discovery_candidates;
--   DROP FUNCTION IF EXISTS reactivate_venue(uuid, text);
--   DROP FUNCTION IF EXISTS confirm_venue_closure(uuid, text);
--   DROP FUNCTION IF EXISTS system_flag_suspected_closure(uuid, text, jsonb, uuid, text);
--   DROP FUNCTION IF EXISTS _venue_record_status_transition(uuid, text, text, uuid, text, jsonb, text, uuid);
--   DROP TABLE IF EXISTS venue_operating_status_events;   -- destroys closure audit history
--   DROP FUNCTION IF EXISTS venue_operating_status_events_append_only();
--   DROP TABLE IF EXISTS venue_closure_signals;
--   ALTER TABLE venues DROP COLUMN IF EXISTS operating_status_updated_at;
--   ALTER TABLE venues DROP COLUMN IF EXISTS operating_status;
--   DROP FUNCTION IF EXISTS auto_apply_field_proposal(uuid, smallint, smallint);
--   DROP FUNCTION IF EXISTS apply_venue_proposal_opening_hours_internal(uuid, jsonb);
--   ALTER TABLE venue_field_proposals DROP COLUMN IF EXISTS applied_by;
--   ALTER TABLE venue_field_proposals DROP COLUMN IF EXISTS confidence_score;
--   COMMIT;
-- =============================================================================
-- IMPLEMENTATION ASSUMPTIONS REQUIRING LATER COMPLIANCE SIGN-OFF
-- =============================================================================
-- These are engineering assumptions recorded so the schema can support whatever
-- the legal/compliance answer turns out to be. THIS IS NOT A LEGAL OPINION AND
-- NOT A COMPLIANCE CERTIFICATION. None of it has been signed off. The DPIA
-- rewrite is deliberately NOT part of this pass.
--
-- 1. OSM attribution must be rendered appropriately in the product wherever
--    OSM-derived data is shown. The database records WHO must be credited
--    (venues.attribution_required); it does not render anything, and storing
--    the field discharges no obligation on its own.
-- 2. OpenStreetMap data is under ODbL. We record 'ODbL-1.0' in venues.license
--    for OSM-derived rows. Whether any onward use of ours triggers ODbL's
--    share-alike provisions is a legal question this schema does not answer.
-- 3. Geoapify results may require BOTH OpenStreetMap attribution AND Geoapify
--    attribution, depending on the current subscription tier and Geoapify's
--    then-current terms. Both are recorded, so the product can render whichever
--    combination applies without a backfill it could no longer perform.
-- 4. The FREE Geoapify plan currently requires Geoapify attribution. Paid-plan
--    rules may differ. Because that state can change AFTER a venue row is
--    written, the correct answer is derived at render time from stored
--    provenance -- never baked into one opaque string at import time.
-- 5. Database provenance must retain enough information for the UI/legal layer
--    to satisfy whatever attribution requirement applies. That is the design
--    goal these columns exist to serve, and the reason
--    discovery_candidate_provenance FAILS CLOSED rather than guessing.
-- 6. Geoapify is treated as substantially OSM-derived. This is the existing,
--    already-reviewed position in scripts/enrich/sourceTrust.ts (used there to
--    refuse counting OSM and Geoapify as two independent witnesses) and in
--    geoapifyPlacesProvider.ts's own attribution string. It is reused here for
--    consistency, not newly decided.
--
-- Open for compliance review: whether 'ODbL-1.0' is the correct licence string
-- for a Geoapify record that turns out NOT to be OSM-derived. We cannot tell
-- per-record which it is, so the schema records the more onerous obligation.
-- =============================================================================

-- ⚠ Dropping venue_operating_status_events destroys the closure AUDIT TRAIL --
-- who decided a venue was permanently closed, when, and on what evidence. That
-- is the one thing in this migration that cannot be reconstructed from anywhere
-- else, so export it before rolling back if any transition has been recorded.
--
-- No existing object is altered destructively above, so this rollback loses
-- only Enrichment 2.0's own data (candidates, closure signals, auto-apply
-- provenance) — never pre-existing venues/proposals data.
-- =============================================================================
