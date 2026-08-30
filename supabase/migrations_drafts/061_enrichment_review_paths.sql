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
--   B. auto_accept_candidate — DROPPED, both signatures, and replaced by
--      queue_candidate_for_review, which cannot publish anything. This is the
--      release-one product decision made structural: there is no longer any
--      service_role-executable function that creates a venue.
--   C. resolve_discovery_candidate — the ONLY candidate -> live venue path in
--      the system. Requires a named human admin, and maps source provenance
--      onto the venue or fails closed by quarantining.
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
-- @test-section: candidate_evidence
ALTER TABLE venue_discovery_candidates
  ADD COLUMN IF NOT EXISTS independent_identity_evidence_count smallint NOT NULL DEFAULT 0
    CHECK (independent_identity_evidence_count >= 0),
  ADD COLUMN IF NOT EXISTS identity_evidence_sources text[] NOT NULL DEFAULT '{}';

-- Existing rows (if any) predate this concept. DEFAULT 0 is deliberately the
-- SAFE value: it means "no independent evidence recorded", which the replaced
-- queue_candidate_for_review below refuses to advance. A backfill would have
-- to invent evidence that was never gathered.
-- @end-section: candidate_evidence

-- ─────────────────────────────────────────────────────────────────────────────
-- B. auto_accept_candidate is REMOVED. queue_candidate_for_review replaces it.
-- ─────────────────────────────────────────────────────────────────────────────
-- RELEASE-ONE PRODUCT DECISION: newly discovered venues must not auto-publish.
--
-- The earlier hardening in this section tightened auto_accept_candidate's gates
-- (adding the independent-identity-evidence requirement) but left its shape
-- intact: a service_role SECURITY DEFINER function containing INSERT INTO
-- venues (..., is_published, moderation_status, discovery_approved) VALUES
-- (..., true, 'approved', true). A tightened gate is still a gate on a door
-- that exists. Release one removes the door.
--
-- WHY A GATE WAS NOT ENOUGH. Every gate in that function reads columns the
-- discovery pipeline itself writes. confidence_score, is_trusted_source,
-- required_fields_complete, independent_identity_evidence_count -- all of them
-- arrive from the same service_role process that then asks for publication. A
-- bug in the scoring code, a provider changing its response shape, or a
-- compromised service key does not trip a self-attested gate. Nothing the
-- caller asserts about itself can substitute for a person looking.
--
-- WHY NOT A TYPESCRIPT FLAG. Because the trust boundary is the database. A
-- flag in scripts/enrich/** is bypassed by anyone holding the service key and
-- a Supabase client -- which is the whole population of callers this control
-- exists to constrain.
--
-- WHAT REPLACES IT. queue_candidate_for_review re-checks exactly the same gates
-- (they remain a genuine pre-screen, and re-checking them server-side still
-- defends against a buggy caller) and then moves the candidate to
-- 'quarantined'. It contains no INSERT INTO venues and never sets
-- is_published, moderation_status or discovery_approved. Publication is
-- resolve_discovery_candidate's job alone, and that function is unreachable
-- without a real auth.uid() belonging to an admin.
--
-- BOTH historical signatures are dropped. 059's (uuid, smallint) and this
-- migration's earlier (uuid, smallint, smallint) are DIFFERENT functions to
-- Postgres; dropping only one would leave the other callable with its own
-- INSERT INTO venues. A database that never saw either drop harmlessly.
DROP FUNCTION IF EXISTS auto_accept_candidate(uuid, smallint);
DROP FUNCTION IF EXISTS auto_accept_candidate(uuid, smallint, smallint);

-- @test-section: candidate_publication
CREATE OR REPLACE FUNCTION queue_candidate_for_review(
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
BEGIN
  SELECT * INTO c FROM venue_discovery_candidates WHERE id = p_candidate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF c.status <> 'candidate' THEN
    RAISE EXCEPTION 'not_pending_candidate:%', c.status;
  END IF;

  -- The pre-screen, unchanged and still re-checked here rather than trusted
  -- from the caller. Failing any of these is a louder signal than passing them,
  -- so they still raise -- the operator needs to see a candidate the pipeline
  -- thought was publishable being refused by the database.
  IF c.dedupe_decision <> 'distinct' THEN
    RAISE EXCEPTION 'not_distinct:%', c.dedupe_decision;
  END IF;
  IF c.confidence_score < p_min_score THEN
    RAISE EXCEPTION 'below_min_score:%<%', c.confidence_score, p_min_score;
  END IF;
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

  -- The strongest outcome an unattended caller can produce. 'quarantined' is
  -- NOT a terminal state, so this row still has to be resolved by a person.
  UPDATE venue_discovery_candidates
     SET status = 'quarantined',
         resolution_reasons = resolution_reasons || jsonb_build_array(jsonb_build_object(
           'code', 'release_one_human_review_required',
           'detail', 'passed every unattended accept gate; publication still requires a named admin',
           'min_score', p_min_score,
           'min_independent_identity_evidence', p_min_independent_identity_evidence,
           'at', now()))
   WHERE id = p_candidate_id;

  RETURN jsonb_build_object(
    'ok', true,
    'published', false,
    'status', 'quarantined',
    'awaiting', 'resolve_discovery_candidate');
END;
$$;

REVOKE ALL ON FUNCTION queue_candidate_for_review(uuid, smallint, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION queue_candidate_for_review(uuid, smallint, smallint) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- B2. upsert_discovery_candidate — REDISCOVERY SAFETY
-- ─────────────────────────────────────────────────────────────────────────────
-- THE BUG THIS FIXES. The discovery runner used a PostgREST upsert with
-- onConflict=(source, source_id) and a full column payload. Providers re-scan
-- the same areas, so the SECOND time a provider sees a venue an admin already
-- REJECTED, that upsert wrote status='candidate' straight back over the human
-- decision -- and the queue grew a row a person had already dealt with. Worse
-- for an APPROVED candidate: the row pointing at a live venue would be reset to
-- 'candidate' while keeping its venue_id.
--
-- The table CHECK constraints happen to catch that second case, but a
-- constraint violation is NOT a control-flow mechanism. It surfaces as an
-- error the runner counts as a failure, it tells the operator nothing useful,
-- and it only covers the cases that happen to be constrained -- a rediscovered
-- REJECTED row violates nothing and would silently reopen. So the semantics are
-- made explicit here instead, in one place, server-side.
--
-- THE RULE: a terminal human decision outranks any later automated sighting.
-- Rediscovery of a terminal row records THAT IT WAS SEEN AGAIN -- last_seen_at
-- and seen_count -- and changes nothing else. Not the status, not the venue_id,
-- not reviewed_by/reviewed_at/review_notes, not resolution_reasons. There is
-- deliberately NO automated path that reopens a resolved candidate; if a
-- reviewer decides a rejection was wrong, that is a human reopening workflow,
-- and it does not exist yet (recorded as follow-up work rather than invented
-- here as a side effect of a rediscovery fix).
--
-- Non-terminal rows ('candidate', 'quarantined') are genuinely refreshable:
-- newer evidence is better evidence, and nobody has decided anything yet.
--
-- Why an RPC rather than tightening the client's upsert: the runner holds the
-- service key, so any rule expressed in TypeScript is a rule the holder of that
-- key can skip. This is the same trust-boundary argument that removed
-- auto_accept_candidate.
-- @test-section: candidate_upsert
CREATE OR REPLACE FUNCTION upsert_discovery_candidate(p_candidate jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source    text := p_candidate ->> 'source';
  v_source_id text := p_candidate ->> 'source_id';
  v_status    text := coalesce(p_candidate ->> 'status', 'candidate');
  c           venue_discovery_candidates%rowtype;
  v_id        uuid;
BEGIN
  IF v_source IS NULL OR btrim(v_source) = '' OR v_source_id IS NULL OR btrim(v_source_id) = '' THEN
    RAISE EXCEPTION 'missing_source_identity';
  END IF;

  -- The pipeline may only ever produce these three. 'approved' and 'dismissed'
  -- are human verdicts and 'duplicate' is set through the dedupe path below --
  -- none of them may arrive from a payload the runner composed.
  IF v_status NOT IN ('candidate', 'quarantined', 'rejected') THEN
    RAISE EXCEPTION 'status_not_settable_by_pipeline:%', v_status;
  END IF;

  SELECT * INTO c FROM venue_discovery_candidates
   WHERE source = v_source AND source_id = v_source_id
   FOR UPDATE;

  -- ── First sighting ────────────────────────────────────────────────────────
  IF NOT FOUND THEN
    INSERT INTO venue_discovery_candidates (
      name, latitude, longitude, postcode, address_line1, city, phone, website,
      category_id, source, source_id, source_datasource,
      dedupe_decision, matched_venue_id, confidence_score,
      has_family_relevant_category, has_valid_uk_coordinates, has_valid_address,
      is_trusted_source, official_verification, has_closure_signal,
      required_fields_complete,
      independent_identity_evidence_count, identity_evidence_sources,
      evidence, status, resolved_mode, reviewed_at, resolution_reasons)
    VALUES (
      p_candidate ->> 'name',
      (p_candidate ->> 'latitude')::decimal, (p_candidate ->> 'longitude')::decimal,
      p_candidate ->> 'postcode', p_candidate ->> 'address_line1', p_candidate ->> 'city',
      p_candidate ->> 'phone', p_candidate ->> 'website',
      nullif(p_candidate ->> 'category_id', '')::uuid,
      v_source, v_source_id, p_candidate -> 'source_datasource',
      coalesce(p_candidate ->> 'dedupe_decision', 'distinct'),
      nullif(p_candidate ->> 'matched_venue_id', '')::uuid,
      coalesce((p_candidate ->> 'confidence_score')::smallint, 0),
      coalesce((p_candidate ->> 'has_family_relevant_category')::boolean, false),
      coalesce((p_candidate ->> 'has_valid_uk_coordinates')::boolean, false),
      coalesce((p_candidate ->> 'has_valid_address')::boolean, false),
      coalesce((p_candidate ->> 'is_trusted_source')::boolean, false),
      coalesce((p_candidate ->> 'official_verification')::boolean, false),
      coalesce((p_candidate ->> 'has_closure_signal')::boolean, false),
      coalesce((p_candidate ->> 'required_fields_complete')::boolean, false),
      coalesce((p_candidate ->> 'independent_identity_evidence_count')::smallint, 0),
      -- text[] on the table (061 A), so the jsonb array from the payload has
      -- to be unpacked rather than cast.
      coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(
                  coalesce(p_candidate -> 'identity_evidence_sources', '[]'::jsonb)) x),
               '{}'::text[]),
      coalesce(p_candidate -> 'evidence', '{}'::jsonb),
      v_status,
      -- A pipeline rejection is a terminal state, so it must carry the audit
      -- the table demands: mode 'system' (the pipeline has no profile id) and
      -- a timestamp. Non-terminal statuses carry neither.
      CASE WHEN v_status = 'rejected' THEN 'system' END,
      CASE WHEN v_status = 'rejected' THEN now() END,
      CASE WHEN v_status = 'rejected'
           THEN jsonb_build_array(jsonb_build_object(
                  'code', 'pipeline_rejected',
                  'detail', p_candidate ->> 'decision_reason', 'at', now()))
           ELSE '[]'::jsonb END)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('ok', true, 'outcome', 'inserted',
                              'id', v_id, 'status', v_status);
  END IF;

  -- ── Rediscovery of a row a human (or the dedupe pass) already settled ─────
  IF c.status IN ('approved', 'rejected', 'dismissed', 'duplicate') THEN
    UPDATE venue_discovery_candidates
       SET last_seen_at = now(),
           seen_count   = seen_count + 1
     WHERE id = c.id;

    RETURN jsonb_build_object(
      'ok', true, 'outcome', 'terminal_unchanged',
      'id', c.id, 'status', c.status,
      'note', 'a settled decision is never reopened by rediscovery');
  END IF;

  -- ── Rediscovery of a still-open row: refresh the evidence ────────────────
  -- Only observational fields. reviewed_by / reviewed_at / review_notes /
  -- resolved_mode / resolution_reasons / venue_id / discovered_at are never
  -- touched here, so no audit history is destroyed by a refresh.
  UPDATE venue_discovery_candidates
     SET name          = coalesce(p_candidate ->> 'name', name),
         latitude      = coalesce((p_candidate ->> 'latitude')::decimal, latitude),
         longitude     = coalesce((p_candidate ->> 'longitude')::decimal, longitude),
         postcode      = coalesce(p_candidate ->> 'postcode', postcode),
         address_line1 = coalesce(p_candidate ->> 'address_line1', address_line1),
         city          = coalesce(p_candidate ->> 'city', city),
         phone         = coalesce(p_candidate ->> 'phone', phone),
         website       = coalesce(p_candidate ->> 'website', website),
         category_id   = coalesce(nullif(p_candidate ->> 'category_id', '')::uuid, category_id),
         -- Provenance may be refreshed but never blanked: a later run that
         -- omits the provider's datasource statement must not erase the one we
         -- already hold, or a publishable candidate would silently become
         -- unpublishable.
         source_datasource = coalesce(p_candidate -> 'source_datasource', source_datasource),
         dedupe_decision   = coalesce(p_candidate ->> 'dedupe_decision', dedupe_decision),
         matched_venue_id  = coalesce(nullif(p_candidate ->> 'matched_venue_id', '')::uuid, matched_venue_id),
         confidence_score  = coalesce((p_candidate ->> 'confidence_score')::smallint, confidence_score),
         has_family_relevant_category = coalesce((p_candidate ->> 'has_family_relevant_category')::boolean, has_family_relevant_category),
         has_valid_uk_coordinates     = coalesce((p_candidate ->> 'has_valid_uk_coordinates')::boolean, has_valid_uk_coordinates),
         has_valid_address            = coalesce((p_candidate ->> 'has_valid_address')::boolean, has_valid_address),
         is_trusted_source            = coalesce((p_candidate ->> 'is_trusted_source')::boolean, is_trusted_source),
         official_verification        = coalesce((p_candidate ->> 'official_verification')::boolean, official_verification),
         has_closure_signal           = coalesce((p_candidate ->> 'has_closure_signal')::boolean, has_closure_signal),
         required_fields_complete     = coalesce((p_candidate ->> 'required_fields_complete')::boolean, required_fields_complete),
         independent_identity_evidence_count = coalesce((p_candidate ->> 'independent_identity_evidence_count')::smallint, independent_identity_evidence_count),
         identity_evidence_sources    = coalesce(
           (SELECT array_agg(x) FROM jsonb_array_elements_text(
              p_candidate -> 'identity_evidence_sources') x),
           identity_evidence_sources),
         evidence      = coalesce(p_candidate -> 'evidence', evidence),
         status        = v_status,
         resolved_mode = CASE WHEN v_status = 'rejected' THEN 'system' ELSE resolved_mode END,
         reviewed_at   = CASE WHEN v_status = 'rejected' THEN now() ELSE reviewed_at END,
         resolution_reasons = CASE
           WHEN v_status = 'rejected'
             THEN resolution_reasons || jsonb_build_array(jsonb_build_object(
                    'code', 'pipeline_rejected',
                    'detail', p_candidate ->> 'decision_reason', 'at', now()))
           ELSE resolution_reasons END,
         last_seen_at  = now(),
         seen_count    = seen_count + 1
   WHERE id = c.id;

  RETURN jsonb_build_object('ok', true, 'outcome', 'refreshed',
                            'id', c.id, 'status', v_status,
                            'previous_status', c.status);
END;
$$;

REVOKE ALL ON FUNCTION upsert_discovery_candidate(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION upsert_discovery_candidate(jsonb) TO service_role;
-- @end-section: candidate_upsert

-- ─────────────────────────────────────────────────────────────────────────────
-- C. resolve_discovery_candidate — the ONLY candidate -> live venue path
-- ─────────────────────────────────────────────────────────────────────────────
-- Every requirement below is a separate, individually testable refusal:
--
--   a real auth.uid()   service_role has none, so the service key cannot reach
--                       this function's body even if EXECUTE were granted --
--                       and it is not (see the grants at the end of C).
--   is_admin()          an ordinary authenticated user is refused.
--   resolvable status   only 'candidate' or 'quarantined'; anything already
--                       terminal is refused rather than silently re-decided,
--                       so there is no double-publication path.
--   required fields     the same minimum a published venue always needs.
--   not a duplicate     a known duplicate is never publishable as new,
--                       regardless of who asks.
--   provenance          mapped through discovery_candidate_provenance, and
--                       QUARANTINED rather than published when that mapping is
--                       not certain (see the fail-closed block below).
--   audit               reviewed_by = the acting admin, reviewed_at,
--                       resolved_mode = 'manual', resolution_reasons.
--                       Enforced by the table's CHECK constraints too, so an
--                       incomplete audit trail cannot be written by ANY path.
--
-- A human reviewer IS independent identity evidence -- a person has looked at
-- this and decided -- so this path does not require the evidence COUNT that
-- queue_candidate_for_review enforces. That is the only requirement a human
-- may substitute for. They may not substitute for provenance: no amount of
-- human confidence tells us which licence the data arrived under.
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
  v_uid      uuid;
  v_prov     jsonb;
  v_prov_err text;
  v_venue_id uuid;
  v_attribution text[];
BEGIN
  -- A NAMED human. is_admin() alone is not enough to say that: it returns
  -- false for a NULL uid, but asserting the uid separately means the audit
  -- columns below can never be written with a NULL actor, and the failure
  -- says which requirement was missed.
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no_authenticated_actor';
  END IF;
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  IF p_decision NOT IN ('approve', 'reject', 'dismiss') THEN
    RAISE EXCEPTION 'invalid_decision:%', p_decision;
  END IF;

  -- FOR UPDATE: two admins resolving the same candidate concurrently must
  -- serialise, or both could pass the status check and publish twice.
  SELECT * INTO c FROM venue_discovery_candidates WHERE id = p_candidate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF c.status NOT IN ('candidate', 'quarantined') THEN
    RAISE EXCEPTION 'not_resolvable:%', c.status;
  END IF;

  -- ── reject / dismiss: no venue is created ─────────────────────────────────
  IF p_decision <> 'approve' THEN
    UPDATE venue_discovery_candidates
       SET status = CASE WHEN p_decision = 'reject' THEN 'rejected' ELSE 'dismissed' END,
           reviewed_by    = v_uid,
           reviewed_at    = now(),
           review_notes   = p_notes,
           resolved_mode  = 'manual',
           resolution_reasons = resolution_reasons || jsonb_build_array(jsonb_build_object(
             'code', 'human_' || p_decision, 'by', v_uid, 'at', now()))
     WHERE id = p_candidate_id;
    RETURN jsonb_build_object('ok', true, 'decision', p_decision, 'published', false);
  END IF;

  -- ── approve ───────────────────────────────────────────────────────────────
  IF c.postcode IS NULL OR c.city IS NULL THEN
    RAISE EXCEPTION 'missing_required_venue_fields';
  END IF;
  IF NOT (c.has_family_relevant_category AND c.has_valid_uk_coordinates) THEN
    RAISE EXCEPTION 'accept_gate_not_satisfied';
  END IF;
  IF c.dedupe_decision = 'duplicate' THEN
    RAISE EXCEPTION 'is_duplicate';
  END IF;

  -- FAIL CLOSED ON PROVENANCE.
  -- If we cannot say with certainty where this record came from and who must
  -- be credited for it, we do not publish it. The candidate goes BACK to
  -- quarantine with the reason recorded, and the admin gets a specific
  -- outcome rather than a stack trace -- the row is fixable (correct the
  -- source_id, or re-import) and must not be lost.
  --
  -- The nested block is a subtransaction: only the failed call is rolled back,
  -- so the quarantine UPDATE that follows it commits normally.
  BEGIN
    v_prov := discovery_candidate_provenance(c.source, c.source_id, c.source_datasource);
  EXCEPTION WHEN OTHERS THEN
    v_prov     := NULL;
    v_prov_err := SQLERRM;
  END;

  IF v_prov IS NULL THEN
    UPDATE venue_discovery_candidates
       SET status = 'quarantined',
           reviewed_by  = v_uid,
           reviewed_at  = now(),
           review_notes = p_notes,
           resolution_reasons = resolution_reasons || jsonb_build_array(jsonb_build_object(
             'code', 'unmappable_provenance', 'detail', v_prov_err, 'by', v_uid, 'at', now()))
     WHERE id = p_candidate_id;
    RETURN jsonb_build_object(
      'ok', false, 'published', false, 'decision', 'approve',
      'outcome', 'quarantined_unmappable_provenance', 'reason', v_prov_err);
  END IF;

  -- venues.osm_id is UNIQUE (migration 016). Publishing a second venue with an
  -- OSM identity we already hold is not a constraint violation to be surfaced
  -- as a 500 -- it is evidence the dedupe pass missed something, which is a
  -- human question. Same fail-closed treatment.
  IF (v_prov->>'osm_id') IS NOT NULL
     AND EXISTS (SELECT 1 FROM venues v WHERE v.osm_id = v_prov->>'osm_id') THEN
    UPDATE venue_discovery_candidates
       SET status = 'quarantined',
           reviewed_by  = v_uid,
           reviewed_at  = now(),
           review_notes = p_notes,
           resolution_reasons = resolution_reasons || jsonb_build_array(jsonb_build_object(
             'code', 'duplicate_source_identity', 'detail', v_prov->>'osm_id',
             'by', v_uid, 'at', now()))
     WHERE id = p_candidate_id;
    RETURN jsonb_build_object(
      'ok', false, 'published', false, 'decision', 'approve',
      'outcome', 'quarantined_duplicate_source_identity', 'reason', v_prov->>'osm_id');
  END IF;

  SELECT array_agg(t) INTO v_attribution
    FROM jsonb_array_elements_text(v_prov->'attribution_required') AS t;

  INSERT INTO venues (
    name, category_id, address_line1, city, postcode, country,
    latitude, longitude, phone, website,
    is_published, is_verified, moderation_status,
    discovery_approved,
    -- provenance, from the single mapping -- never from c.source directly
    data_source, license, osm_id, data_source_ref, attribution_required, data_source_meta
  ) VALUES (
    c.name, c.category_id, c.address_line1, c.city, c.postcode, 'GB',
    c.latitude, c.longitude, c.phone, c.website,
    true, false, 'approved',
    true,
    v_prov->>'data_source', v_prov->>'license', v_prov->>'osm_id',
    v_prov->>'data_source_ref', coalesce(v_attribution, '{}'::text[]),
    v_prov->'data_source_meta'
  )
  RETURNING id INTO v_venue_id;

  UPDATE venue_discovery_candidates
     SET status        = 'approved',
         venue_id      = v_venue_id,
         reviewed_by   = v_uid,
         reviewed_at   = now(),
         review_notes  = p_notes,
         resolved_mode = 'manual',
         resolution_reasons = resolution_reasons || jsonb_build_array(jsonb_build_object(
           'code', 'human_approved_publication', 'by', v_uid, 'at', now(),
           'provenance', v_prov))
   WHERE id = p_candidate_id;

  RETURN jsonb_build_object(
    'ok', true, 'published', true, 'decision', 'approve',
    'venue_id', v_venue_id, 'provenance', v_prov);
END;
$$;

-- service_role is REVOKED, not merely unused. It could never satisfy the
-- auth.uid()/is_admin() checks inside, so the grant advertised a capability
-- that does not exist -- and an ACL that overstates what a role may do is the
-- thing an auditor has to disprove by reading the body. Now it does not.
REVOKE ALL ON FUNCTION resolve_discovery_candidate(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION resolve_discovery_candidate(uuid, text, text) TO authenticated;
-- @end-section: candidate_publication

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
-- REBASED ONTO 057. The earlier draft wrote venues.booking_url directly and
-- stamped a competing applied_by='admin' text value. Both are gone: the write
-- now goes through _enrichment_apply_write, producing an immutable ledger row
-- that rollback_enrichment_run can reverse, and provenance is the canonical
-- pair applied_mode='manual' + venue_enrichment_writes.applied_by = auth.uid().
--
-- HUMAN POLICY DIFFERS DELIBERATELY FROM AUTONOMOUS POLICY.
-- 060's auto_apply_booking_url additionally requires the booking host to belong
-- to the venue's own website. This function does NOT, and must not: a great many
-- legitimate venues take bookings through a third-party provider (Bookwhen,
-- Eventbrite, a leisure-trust portal), and refusing those would make the admin
-- path useless. The safeguard here is a NAMED HUMAN taking responsibility --
-- recorded as the actor uuid in the ledger -- plus the universal scheme, host
-- and stale checks that live in the shared primitive and cannot be bypassed.
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
  v_live     text;
  v_result   jsonb;
  v_reasons  jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  SELECT * INTO p FROM venue_field_proposals WHERE id = p_proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF p.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'not_pending:%', p.status;
  END IF;
  IF p.field <> 'booking_url' THEN
    RAISE EXCEPTION 'wrong_field:%', p.field;
  END IF;

  -- Optimistic concurrency, retained: if the admin UI showed a value that is no
  -- longer live, refuse rather than silently overwrite. This is separate from
  -- the primitive's hash-based stale guard and is about what the HUMAN saw.
  IF p_expected_current_value IS NOT NULL THEN
    v_live := (SELECT booking_url FROM venues WHERE id = p.venue_id);
    IF coalesce(v_live, '') IS DISTINCT FROM coalesce(p_expected_current_value, '') THEN
      RAISE EXCEPTION 'expected_current_value_mismatch';
    END IF;
  END IF;

  v_reasons := coalesce(p.decision_reasons, '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object(
         'code', 'admin_approved_booking_url',
         'third_party_host_permitted', true));

  -- Scheme (HTTPS), host parseability, userinfo rejection, the stale guard and
  -- the ledger row all live in the shared primitive.
  v_result := _enrichment_apply_write(p_proposal_id, NULL, 'manual', auth.uid(), v_reasons);

  IF p_notes IS NOT NULL THEN
    UPDATE venue_field_proposals
       SET review_notes = p_notes
     WHERE id = p_proposal_id;
  END IF;

  RETURN v_result;
END;
$$;

-- service_role REVOKED (verified, not assumed). This function raises
-- 'not_admin' unless is_admin(), which reads profiles WHERE id = auth.uid();
-- service_role has no auth.uid(), so it could never satisfy that check. A grep
-- of every .ts/.tsx file outside __tests__ finds no call site at all -- the only
-- mentions are the operator-facing strings in exceptionQueue.ts, which describe
-- the RPC to a HUMAN admin rather than invoking it. An ACL that advertises a
-- capability the role does not have is something an auditor has to disprove by
-- reading the body.
REVOKE ALL ON FUNCTION apply_booking_url_proposal(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION apply_booking_url_proposal(uuid, text, text) TO authenticated;

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

-- service_role REVOKED, same verification as apply_booking_url_proposal above:
-- is_admin()-gated, and no runtime call site exists anywhere in scripts/ or app/.
REVOKE ALL ON FUNCTION resolve_facility_conflict(uuid, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION resolve_facility_conflict(uuid, text, text, text) TO authenticated;

COMMIT;

-- =============================================================================
-- ROLLBACK (no separate _down file yet, matching the 049/056/059/060 convention):
--   BEGIN;
--   DROP FUNCTION IF EXISTS resolve_facility_conflict(uuid, text, text, text);
--   DROP FUNCTION IF EXISTS apply_booking_url_proposal(uuid, text, text);
--   DROP FUNCTION IF EXISTS resolve_discovery_candidate(uuid, text, text);
--   DROP FUNCTION IF EXISTS queue_candidate_for_review(uuid, smallint, smallint);
--   DROP FUNCTION IF EXISTS upsert_discovery_candidate(jsonb);
--   ALTER TABLE venue_discovery_candidates DROP COLUMN IF EXISTS identity_evidence_sources;
--   ALTER TABLE venue_discovery_candidates DROP COLUMN IF EXISTS independent_identity_evidence_count;
--   COMMIT;
--
-- ⚠ Rolling back Section B does NOT restore auto_accept_candidate in EITHER
-- signature. Neither exists in 059 any more, and this migration drops both
-- deliberately. There is no supported way to reinstate unattended publication:
-- doing it would mean writing a NEW migration that creates a service_role
-- function containing INSERT INTO venues, which is precisely the thing the
-- release-one decision forbids and which the redline suite fails on.
--
-- Rolling this migration back therefore leaves the database with candidates
-- and no publication path at all — safe, but the exception queue stops
-- draining. Roll back 059 too, or forward-fix.
-- =============================================================================
