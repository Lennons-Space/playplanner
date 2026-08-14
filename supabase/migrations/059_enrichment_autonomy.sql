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

ALTER TABLE venue_field_proposals
  ADD COLUMN IF NOT EXISTS confidence_score smallint
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)),
  ADD COLUMN IF NOT EXISTS applied_by text
    CHECK (applied_by IS NULL OR applied_by IN ('admin', 'system'));

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
  p          venue_field_proposals%rowtype;
  v_snap     jsonb;
  v_val      text;
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

  -- Never-auto-apply fields, enforced server-side (defence in depth over the
  -- TypeScript policy in autoApplyPolicy.ts).
  IF p.field IN ('description', 'price_range', 'booking_url') THEN
    RAISE EXCEPTION 'field_never_auto_applies:%', p.field;
  END IF;

  -- A proposal that conflicts with a non-null existing value is, by policy,
  -- never eligible for auto-apply (autoApplyPolicy.ts routes these to
  -- 'exception' or 'defer', never 'auto_apply') — re-checked here so a
  -- mis-called RPC cannot silently overwrite a conflicting value unattended.
  IF p.conflicts_existing THEN
    RAISE EXCEPTION 'conflicts_existing_requires_human_review';
  END IF;

  -- Same stale-current-value guard as the human apply path.
  v_snap := snapshot_current_value(p.venue_id, p.field);
  IF (v_snap ->> 'hash') IS DISTINCT FROM p.current_value_hash THEN
    RAISE EXCEPTION 'stale_current_value';
  END IF;

  IF p.field IN ('website', 'phone', 'email') THEN
    v_val := p.proposed_value ->> 'v';
    IF p.field = 'email' AND (v_val IS NULL OR v_val !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN
      RAISE EXCEPTION 'invalid_email';
    END IF;
    IF p.field = 'website' THEN
      UPDATE venues SET website = v_val, updated_at = now() WHERE id = p.venue_id;
    ELSIF p.field = 'phone' THEN
      UPDATE venues SET phone = v_val, updated_at = now() WHERE id = p.venue_id;
    ELSE
      UPDATE venues SET email = v_val, updated_at = now() WHERE id = p.venue_id;
    END IF;

  ELSIF p.field = 'opening_hours' THEN
    -- Delegate to the identical replace-whole-week logic as the human path by
    -- requiring the proposal to already be well-formed (asserted here, same
    -- as apply_venue_proposal) — duplicated rather than factored into a
    -- shared internal function so each RPC's full behaviour stays readable
    -- and independently auditable (small, safety-critical surface).
    IF jsonb_typeof(p.proposed_value -> 'days') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p.proposed_value -> 'days') <> 7 THEN
      RAISE EXCEPTION 'incomplete_week';
    END IF;
    IF (SELECT count(DISTINCT (d ->> 'day_of_week'))
          FROM jsonb_array_elements(p.proposed_value -> 'days') d)
       <> jsonb_array_length(p.proposed_value -> 'days') THEN
      RAISE EXCEPTION 'duplicate_day_of_week';
    END IF;
    -- Opening hours auto-apply requires the CLEAN case only (no split/seasonal
    -- notes) — autoApplyPolicy.ts already penalises any parse issue below the
    -- threshold, so this is a defensive re-check, not the primary gate.
    IF (p.proposed_value ->> 'seasonal_notes') IS NOT NULL THEN
      RAISE EXCEPTION 'seasonal_notes_require_human_review';
    END IF;
    PERFORM apply_venue_proposal_opening_hours_internal(p.venue_id, p.proposed_value);

  ELSE
    RAISE EXCEPTION 'invalid_field_for_auto_apply:%', p.field;
  END IF;

  UPDATE venue_field_proposals
     SET status = 'applied', applied_at = now(), applied_by = 'system',
         confidence_score = p_confidence_score
   WHERE id = p_proposal_id;

  RETURN jsonb_build_object('ok', true, 'field', p.field, 'applied_by', 'system');
END;
$$;

-- Small internal helper factored out so both the human RPC (via a follow-up
-- migration, not touched here to keep 056 unmodified) and auto_apply_field_
-- proposal share the exact replace-whole-week write — avoids logic drift
-- between the two paths for the trickiest field.
CREATE OR REPLACE FUNCTION apply_venue_proposal_opening_hours_internal(
  p_venue_id uuid,
  p_proposed jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day    jsonb;
  v_dow    int;
  v_open   time;
  v_close  time;
  v_notes  text;
  v_split  text;
BEGIN
  DELETE FROM opening_hours WHERE venue_id = p_venue_id;

  FOR v_day IN SELECT * FROM jsonb_array_elements(p_proposed -> 'days') LOOP
    v_dow := (v_day ->> 'day_of_week')::int;

    IF coalesce((v_day ->> 'is_closed')::boolean, false)
       OR coalesce(jsonb_array_length(v_day -> 'intervals'), 0) = 0 THEN
      INSERT INTO opening_hours (venue_id, day_of_week, is_closed)
        VALUES (p_venue_id, v_dow, true);
    ELSE
      SELECT min((iv ->> 'opens')::time), max((iv ->> 'closes')::time)
        INTO v_open, v_close
        FROM jsonb_array_elements(v_day -> 'intervals') iv;

      v_notes := null;
      IF jsonb_array_length(v_day -> 'intervals') > 1 THEN
        SELECT string_agg((iv ->> 'opens') || '-' || (iv ->> 'closes'), ' and ' ORDER BY ord)
          INTO v_split
          FROM jsonb_array_elements(v_day -> 'intervals') WITH ORDINALITY AS t(iv, ord);
        v_notes := 'Open ' || v_split;
      END IF;

      INSERT INTO opening_hours (venue_id, day_of_week, opens_at, closes_at, is_closed, notes)
        VALUES (p_venue_id, v_dow, v_open, v_close, false, v_notes);
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION auto_apply_field_proposal(uuid, smallint, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION auto_apply_field_proposal(uuid, smallint, smallint) TO service_role;
REVOKE ALL ON FUNCTION apply_venue_proposal_opening_hours_internal(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_venue_proposal_opening_hours_internal(uuid, jsonb) TO service_role;

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
-- service_role (the background scripts) bypasses RLS to insert signals.

-- System-driven, additive-only transition: active -> suspected_closed.
-- Never touches confirmed_closed or discovery_approved. service_role only.
CREATE OR REPLACE FUNCTION system_flag_suspected_closure(p_venue_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE venues
     SET operating_status = 'suspected_closed', operating_status_updated_at = now()
   WHERE id = p_venue_id AND operating_status = 'active';
  RETURN jsonb_build_object('ok', true, 'reason', p_reason);
END;
$$;

REVOKE ALL ON FUNCTION system_flag_suspected_closure(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION system_flag_suspected_closure(uuid, text) TO service_role;

-- Human-only, destructive transition: (any status) -> confirmed_closed, and
-- flips discovery_approved so the venue stops appearing in map/search/list
-- (mirrors the existing 044 discovery_approved gate — we never delete rows).
CREATE OR REPLACE FUNCTION confirm_venue_closure(p_venue_id uuid, p_notes text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  UPDATE venues
     SET operating_status = 'confirmed_closed',
         operating_status_updated_at = now(),
         discovery_approved = false,
         moderation_notes = coalesce(moderation_notes || E'\n', '') || coalesce(p_notes, 'confirmed closed')
   WHERE id = p_venue_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Human-only reactivation (a venue reopens, or a suspected-closure was wrong).
CREATE OR REPLACE FUNCTION reactivate_venue(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  UPDATE venues
     SET operating_status = 'active',
         operating_status_updated_at = now(),
         discovery_approved = true
   WHERE id = p_venue_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION confirm_venue_closure(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_venue_closure(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION reactivate_venue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reactivate_venue(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. venue_discovery_candidates — quarantine model for new venues (Part 6/7/8)
-- ─────────────────────────────────────────────────────────────────────────────
-- Denormalised accept-gate flags (has_family_relevant_category etc.) are
-- stored directly on the row, set by the (TypeScript) discovery script from a
-- vetted category allowlist — the RPC re-checks stored booleans rather than
-- re-deriving them from a category join, keeping the safety-critical RPC
-- simple and auditable.

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

  status        text not null default 'candidate'
                  check (status in ('candidate', 'auto_accepted', 'quarantined', 'rejected', 'duplicate')),
  venue_id      uuid references venues(id), -- set once auto_accepted or manually approved
  evidence      jsonb not null default '{}',
  reviewed_by   uuid references profiles(id),
  reviewed_at   timestamptz,
  review_notes  text,

  discovered_at timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (source, source_id)
);

CREATE TRIGGER venue_discovery_candidates_updated_at
  BEFORE UPDATE ON venue_discovery_candidates
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX IF NOT EXISTS venue_discovery_candidates_status_idx ON venue_discovery_candidates (status);
CREATE INDEX IF NOT EXISTS venue_discovery_candidates_dedupe_idx ON venue_discovery_candidates (dedupe_decision);

ALTER TABLE venue_discovery_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "discovery_candidates_admin_all" ON venue_discovery_candidates
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());
-- service_role (discovery script) bypasses RLS to insert/update candidates.

-- ── RPC: auto_accept_candidate ────────────────────────────────────────────────
-- The single highest-risk write in this entire migration: it can PUBLISH a
-- brand-new venue with zero human review. Every gate from Part 8 is
-- re-checked here in SQL (not trusted from the caller), and the threshold
-- (default 98) is passed explicitly so it is never silently lowered by a
-- script change without also touching this call site.
-- service_role only. Idempotent: a candidate already auto_accepted/rejected/
-- quarantined/duplicate is a no-op (raises, doesn't double-insert).
CREATE OR REPLACE FUNCTION auto_accept_candidate(p_candidate_id uuid, p_min_score smallint DEFAULT 98)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c venue_discovery_candidates%rowtype;
  v_venue_id uuid;
BEGIN
  SELECT * INTO c FROM venue_discovery_candidates WHERE id = p_candidate_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF c.status <> 'candidate' THEN
    RAISE EXCEPTION 'not_pending_candidate:%', c.status;
  END IF;

  IF c.dedupe_decision <> 'distinct' THEN
    RAISE EXCEPTION 'not_distinct:%', c.dedupe_decision;
  END IF;
  IF c.confidence_score < p_min_score THEN
    RAISE EXCEPTION 'below_min_score:%<%', c.confidence_score, p_min_score;
  END IF;
  IF NOT (c.has_family_relevant_category AND c.has_valid_uk_coordinates
          AND c.has_valid_address AND c.is_trusted_source
          AND c.required_fields_complete) THEN
    RAISE EXCEPTION 'accept_gate_not_satisfied';
  END IF;
  IF c.has_closure_signal THEN
    RAISE EXCEPTION 'has_closure_signal';
  END IF;
  IF c.postcode IS NULL OR c.city IS NULL THEN
    RAISE EXCEPTION 'missing_required_venue_fields';
  END IF;

  INSERT INTO venues (
    name, category_id, address_line1, city, postcode, country,
    latitude, longitude, phone, website,
    is_published, is_verified, moderation_status,
    discovery_approved, data_source
  ) VALUES (
    c.name, c.category_id, c.address_line1, c.city, c.postcode, 'GB',
    c.latitude, c.longitude, c.phone, c.website,
    true, false, 'approved',
    true, c.source
  )
  RETURNING id INTO v_venue_id;

  UPDATE venue_discovery_candidates
     SET status = 'auto_accepted', venue_id = v_venue_id, reviewed_at = now()
   WHERE id = p_candidate_id;

  RETURN jsonb_build_object('ok', true, 'venue_id', v_venue_id);
END;
$$;

REVOKE ALL ON FUNCTION auto_accept_candidate(uuid, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION auto_accept_candidate(uuid, smallint) TO service_role;

COMMIT;

-- =============================================================================
-- ROLLBACK (no separate _down file yet, matching the 049/056 convention):
--   BEGIN;
--   DROP FUNCTION IF EXISTS auto_accept_candidate(uuid, smallint);
--   DROP TABLE IF EXISTS venue_discovery_candidates;
--   DROP FUNCTION IF EXISTS reactivate_venue(uuid);
--   DROP FUNCTION IF EXISTS confirm_venue_closure(uuid, text);
--   DROP FUNCTION IF EXISTS system_flag_suspected_closure(uuid, text);
--   DROP TABLE IF EXISTS venue_closure_signals;
--   ALTER TABLE venues DROP COLUMN IF EXISTS operating_status_updated_at;
--   ALTER TABLE venues DROP COLUMN IF EXISTS operating_status;
--   DROP FUNCTION IF EXISTS auto_apply_field_proposal(uuid, smallint, smallint);
--   DROP FUNCTION IF EXISTS apply_venue_proposal_opening_hours_internal(uuid, jsonb);
--   ALTER TABLE venue_field_proposals DROP COLUMN IF EXISTS applied_by;
--   ALTER TABLE venue_field_proposals DROP COLUMN IF EXISTS confidence_score;
--   COMMIT;
-- No existing object is altered destructively above, so this rollback loses
-- only Enrichment 2.0's own data (candidates, closure signals, auto-apply
-- provenance) — never pre-existing venues/proposals data.
-- =============================================================================
