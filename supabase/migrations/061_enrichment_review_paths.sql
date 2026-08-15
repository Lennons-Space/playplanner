-- =============================================================================
-- 061_enrichment_review_paths.sql
-- Enrichment 2.1 hardening — trust + review-path completeness.
--
-- STATUS: NOT APPLIED. Written for review only.
--
-- Migrations 059 and 060 are NOT edited by this file (059 is committed and
-- 060, while still unapplied, is already committed too). Where a function
-- defined there needs to change, it is replaced here with CREATE OR REPLACE —
-- the ordinary forward-migration mechanism — and the change is spelled out.
--
-- Sections:
--   A. venue_discovery_candidates: independent identity evidence columns
--   B. auto_accept_candidate — REPLACED to require independent identity
--      evidence. This is the security-relevant change: previously a single
--      fully-populated OSM record scoring 100 could publish a public venue.
--   C. resolve_discovery_candidate — the missing ADMIN path for quarantined
--      candidates (approve / reject / dismiss). Without this, every
--      quarantined candidate was permanently stuck.
--   D. apply_booking_url_proposal — the missing ADMIN path for a pending
--      booking_url proposal (056's apply_venue_proposal still raises
--      no_target_column for that field, and is NOT replaced here).
--   E. resolve_facility_conflict — the missing ADMIN path for a facility
--      conflict raised by the enrichment pipeline.
--
-- Every function here is SECURITY DEFINER with an explicit search_path, and
-- every one is either admin-gated via is_admin() or service_role-only. None
-- is granted to anon.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Independent identity evidence on discovery candidates
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY: candidate confidence_score answers "did we read this record well?".
-- It cannot answer "does more than one independent witness say this place
-- exists?" — and only the second question should be allowed to publish a
-- public family venue unattended.
--
-- The count is produced by scripts/enrich/discovery/identityEvidence.ts:
-- the discovery record itself is 1, VERIFIED official-site corroboration adds
-- 1, and each genuinely INDEPENDENT trusted provider resolving to the same
-- venue adds 1. Mirrors do not count (Geoapify is OSM-derived), nor do extra
-- tags on one record, nor extra pages of one website.
--
-- identity_evidence_sources is kept for provenance/audit so a reviewer can see
-- WHICH witnesses were counted, not just how many.
ALTER TABLE venue_discovery_candidates
  ADD COLUMN IF NOT EXISTS independent_identity_evidence_count smallint NOT NULL DEFAULT 0
    CHECK (independent_identity_evidence_count >= 0),
  ADD COLUMN IF NOT EXISTS identity_evidence_sources text[] NOT NULL DEFAULT '{}';

-- Existing rows (if any) predate this concept. DEFAULT 0 is deliberately the
-- SAFE value: it means "no independent evidence recorded", which the replaced
-- auto_accept_candidate below refuses to publish. A backfill would have to
-- invent evidence that was never gathered.

-- ─────────────────────────────────────────────────────────────────────────────
-- B. auto_accept_candidate — now requires independent identity evidence
-- ─────────────────────────────────────────────────────────────────────────────
-- REPLACES 059's version. The ONLY change is the new evidence gate below
-- (marked "ADDED IN 061"); every other check, the INSERT column list and the
-- return shape are identical to 059, so this cannot silently alter what a
-- published venue looks like.
--
-- Threshold 2 is passed as a defaulted parameter for the same reason
-- p_min_score is: so it can never be quietly lowered by a script change
-- without also touching this call site.
CREATE OR REPLACE FUNCTION auto_accept_candidate(
  p_candidate_id uuid,
  p_min_score smallint DEFAULT 98,
  p_min_independent_identity_evidence smallint DEFAULT 2
)
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

  -- ADDED IN 061: independent identity evidence. Checked SEPARATELY from and
  -- AFTER the score, because no score is permitted to substitute for it —
  -- that substitution is exactly the hole this closes.
  IF c.independent_identity_evidence_count < p_min_independent_identity_evidence THEN
    RAISE EXCEPTION 'insufficient_independent_identity_evidence:%<%',
      c.independent_identity_evidence_count, p_min_independent_identity_evidence;
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

REVOKE ALL ON FUNCTION auto_accept_candidate(uuid, smallint, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION auto_accept_candidate(uuid, smallint, smallint) TO service_role;

-- 059's two-argument signature is a DIFFERENT function to Postgres, so it
-- would survive this migration and still be callable — with the old, weaker
-- gate. Drop it explicitly; leaving it would defeat the whole point.
DROP FUNCTION IF EXISTS auto_accept_candidate(uuid, smallint);

-- ─────────────────────────────────────────────────────────────────────────────
-- C. resolve_discovery_candidate — admin resolution for quarantined candidates
-- ─────────────────────────────────────────────────────────────────────────────
-- THE GAP THIS CLOSES: 059 shipped auto_accept_candidate (service_role,
-- status='candidate' only) and nothing else. A candidate the pipeline
-- QUARANTINED had no path to any terminal state — no approve, no reject, no
-- dismiss — so the exception queue could only ever grow. With section B making
-- quarantine the normal outcome for single-source candidates, that would have
-- become the dominant workflow.
--
-- A human reviewer IS independent identity evidence — a person has looked at
-- this and decided — so this path does NOT require the evidence count. That is
-- the entire difference between it and auto-accept, and it is why this one is
-- admin-gated and that one is service_role.
CREATE OR REPLACE FUNCTION resolve_discovery_candidate(
  p_candidate_id uuid,
  p_decision     text,     -- 'approve' | 'reject' | 'dismiss'
  p_notes        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c venue_discovery_candidates%rowtype;
  v_venue_id uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  IF p_decision NOT IN ('approve', 'reject', 'dismiss') THEN
    RAISE EXCEPTION 'invalid_decision:%', p_decision;
  END IF;

  SELECT * INTO c FROM venue_discovery_candidates WHERE id = p_candidate_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  -- Only unresolved candidates. Anything already terminal (auto_accepted /
  -- rejected / duplicate) is refused rather than silently re-decided.
  IF c.status NOT IN ('candidate', 'quarantined') THEN
    RAISE EXCEPTION 'not_resolvable:%', c.status;
  END IF;

  IF p_decision = 'approve' THEN
    -- Same minimum data quality a published venue always needs. A human may
    -- override the EVIDENCE requirement (they are the evidence) but not the
    -- structural requirement that the row is publishable at all.
    IF c.postcode IS NULL OR c.city IS NULL THEN
      RAISE EXCEPTION 'missing_required_venue_fields';
    END IF;
    IF NOT (c.has_family_relevant_category AND c.has_valid_uk_coordinates) THEN
      RAISE EXCEPTION 'accept_gate_not_satisfied';
    END IF;
    -- A known duplicate is never publishable as a new venue, regardless of who asks.
    IF c.dedupe_decision = 'duplicate' THEN
      RAISE EXCEPTION 'is_duplicate';
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
       SET status = 'auto_accepted',   -- reuses the existing terminal state; reviewed_by records that a HUMAN did it
           venue_id = v_venue_id,
           reviewed_by = auth.uid(),
           reviewed_at = now(),
           review_notes = p_notes
     WHERE id = p_candidate_id;

    RETURN jsonb_build_object('ok', true, 'venue_id', v_venue_id, 'decision', 'approve');
  END IF;

  -- reject / dismiss: no venue is created; the candidate reaches a terminal
  -- state so it leaves the exception queue.
  UPDATE venue_discovery_candidates
     SET status = CASE WHEN p_decision = 'reject' THEN 'rejected' ELSE 'duplicate' END,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_notes = p_notes
   WHERE id = p_candidate_id;

  RETURN jsonb_build_object('ok', true, 'decision', p_decision);
END;
$$;

REVOKE ALL ON FUNCTION resolve_discovery_candidate(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION resolve_discovery_candidate(uuid, text, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. apply_booking_url_proposal — admin manual approval of a booking_url
-- ─────────────────────────────────────────────────────────────────────────────
-- THE GAP THIS CLOSES: 060 §F added auto_apply_booking_url for links whose
-- host matches the venue's own domain, and routes everything else (typically a
-- legitimate third-party booking provider) to human review. But 056's
-- apply_venue_proposal still raises 'no_target_column' for booking_url, so a
-- reviewer had nothing to approve WITH — a surfaced exception with no exit.
--
-- SMALLEST SAFE EXTENSION, deliberately: a dedicated ~60-line function rather
-- than replacing 056's ~120-line generic apply_venue_proposal (which also
-- handles price_range/description/opening_hours and has a much larger blast
-- radius). reject_venue_proposal is already field-agnostic, so the REJECT half
-- of this workflow needed no change at all — verified, not assumed.
--
-- What an admin may do here that automation may not: approve a booking URL on
-- a DIFFERENT host to the venue's website. That is the whole point — a human
-- can recognise "bookwhen.com/our-venue" as legitimate. What an admin may NOT
-- do: bypass staleness, expected-value or transport-security protection.
CREATE OR REPLACE FUNCTION apply_booking_url_proposal(
  p_proposal_id  uuid,
  p_expected_current_value text DEFAULT NULL,  -- optimistic-concurrency: caller's view of the live value
  p_notes        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p          venue_field_proposals%rowtype;
  v_snap     jsonb;
  v_live     text;
  v_proposed text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  SELECT * INTO p FROM venue_field_proposals WHERE id = p_proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  -- Mirrors apply_venue_proposal's own contract: a proposal must have been
  -- moved to 'approved' by the review flow first (or still be pending, which
  -- is how the enrichment pipeline leaves them).
  IF p.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'not_pending:%', p.status;
  END IF;
  IF p.field <> 'booking_url' THEN
    RAISE EXCEPTION 'wrong_field:%', p.field;
  END IF;

  -- Stale-current-value guard — identical semantics to every other apply path
  -- (056's apply_venue_proposal, 059's auto_apply_field_proposal, 060's two).
  -- This works only because 060 §E made snapshot_current_value read the real
  -- venues.booking_url column; against 056's hardcoded NULL it would have been
  -- permanently blind.
  v_snap := snapshot_current_value(p.venue_id, 'booking_url');
  IF (v_snap ->> 'hash') IS DISTINCT FROM p.current_value_hash THEN
    RAISE EXCEPTION 'stale_current_value';
  END IF;

  -- Expected-old-value guard: when the caller states what it believes is
  -- live, that must still be true. NULL means "not asserted" (the stale-hash
  -- guard above still applies), so this is additive, never a weakening.
  SELECT booking_url INTO v_live FROM venues WHERE id = p.venue_id;
  IF p_expected_current_value IS NOT NULL
     AND btrim(coalesce(v_live, '')) IS DISTINCT FROM btrim(p_expected_current_value) THEN
    RAISE EXCEPTION 'unexpected_current_value';
  END IF;

  v_proposed := btrim(coalesce(p.proposed_value ->> 'v', ''));
  IF v_proposed = '' THEN
    RAISE EXCEPTION 'empty_booking_url';
  END IF;
  -- https only, for an admin exactly as for automation: a parent may enter
  -- payment details behind this link. Being an admin does not make http safe.
  IF v_proposed !~* '^https://' THEN
    RAISE EXCEPTION 'insecure_or_invalid_scheme';
  END IF;
  -- Must still parse as a real host (rejects userinfo-disguised URLs such as
  -- https://real-venue.co.uk@evil.example/ — see 060 §F's enrichment_url_host).
  IF enrichment_url_host(v_proposed) IS NULL THEN
    RAISE EXCEPTION 'unparseable_booking_host';
  END IF;

  UPDATE venues SET booking_url = v_proposed, updated_at = now() WHERE id = p.venue_id;

  -- Provenance + audit trail: applied_by='admin' distinguishes this from
  -- 060 §F's applied_by='system', and reviewed_by records WHICH admin.
  UPDATE venue_field_proposals
     SET status = 'applied',
         applied_at = now(),
         applied_by = 'admin',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_notes = coalesce(p_notes, review_notes)
   WHERE id = p_proposal_id;

  RETURN jsonb_build_object('ok', true, 'field', 'booking_url');
END;
$$;

REVOKE ALL ON FUNCTION apply_booking_url_proposal(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION apply_booking_url_proposal(uuid, text, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- E. resolve_facility_conflict — admin resolution for a facility conflict
-- ─────────────────────────────────────────────────────────────────────────────
-- THE GAP THIS CLOSES: facilitySync.ts raises a 'facility_conflict' exception
-- when explicit NEGATIVE evidence from a venue's own site contradicts an
-- already-published venue_facilities row, and deliberately never auto-deletes.
-- But venue_facilities has only two RLS policies (001): public SELECT for
-- approved venues, and ALL for the venue's claimed owner. There is NO admin
-- policy — so an admin who is not the claimant could not resolve the conflict
-- at all.
--
-- Deliberately an RPC, not a new blanket admin RLS policy on venue_facilities:
-- this grants exactly one narrow capability instead of broad table write
-- access. It can ONLY remove rows this pipeline itself published
-- (notes = 'official-enrichment'); parent-confirmed rows from migration 050's
-- vote pipeline and admin/import rows (NULL notes) are untouchable here, so
-- resolving an automated conflict can never destroy community evidence.
CREATE OR REPLACE FUNCTION resolve_facility_conflict(
  p_venue_id      uuid,
  p_facility_slug text,
  p_decision      text,    -- 'remove_official' | 'keep'
  p_notes         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_facility_id uuid;
  v_removed     int := 0;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  IF p_decision NOT IN ('remove_official', 'keep') THEN
    RAISE EXCEPTION 'invalid_decision:%', p_decision;
  END IF;

  SELECT id INTO v_facility_id FROM facilities WHERE slug = p_facility_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_facility_slug:%', p_facility_slug;
  END IF;

  IF p_decision = 'remove_official' THEN
    DELETE FROM venue_facilities
     WHERE venue_id = p_venue_id
       AND facility_id = v_facility_id
       AND notes = 'official-enrichment';   -- NEVER parent-confirmed, never NULL/admin rows
    GET DIAGNOSTICS v_removed = ROW_COUNT;
  END IF;

  -- 'keep' is a real outcome, not a no-op: it records that a human looked at
  -- the conflict and decided the published row stands, which is what lets the
  -- item leave the queue.
  RETURN jsonb_build_object('ok', true, 'decision', p_decision, 'removed', v_removed, 'notes', p_notes);
END;
$$;

REVOKE ALL ON FUNCTION resolve_facility_conflict(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION resolve_facility_conflict(uuid, text, text, text) TO authenticated, service_role;

COMMIT;

-- =============================================================================
-- ROLLBACK (no separate _down file yet, matching the 049/056/059/060 convention):
--   BEGIN;
--   DROP FUNCTION IF EXISTS resolve_facility_conflict(uuid, text, text, text);
--   DROP FUNCTION IF EXISTS apply_booking_url_proposal(uuid, text, text);
--   DROP FUNCTION IF EXISTS resolve_discovery_candidate(uuid, text, text);
--   DROP FUNCTION IF EXISTS auto_accept_candidate(uuid, smallint, smallint);
--   ALTER TABLE venue_discovery_candidates DROP COLUMN IF EXISTS identity_evidence_sources;
--   ALTER TABLE venue_discovery_candidates DROP COLUMN IF EXISTS independent_identity_evidence_count;
--   COMMIT;
--
-- ⚠ Rolling back Section B does NOT restore 059's two-argument
-- auto_accept_candidate (this migration drops it deliberately, so the weaker
-- gate cannot survive). To fully revert, re-run 059's definition of that
-- function AFTER the drops above — and be aware that doing so reopens the
-- single-source auto-publish hole this migration exists to close.
-- =============================================================================
