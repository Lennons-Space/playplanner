-- =============================================================================
-- 060_enrichment_2_1.sql
-- Enrichment 2.1 — growth unlock + richer venue facts. Purely additive: no
-- existing table/column/RPC is altered in a breaking way, no existing row's
-- meaning changes. Built on top of 056 (website enrichment) and 059
-- (enrichment autonomy) — neither of those files is touched by this one.
--
-- STATUS: NOT APPLIED. Written for review only. Every write-capable function
-- below is service_role-only unless explicitly noted, mirroring the pattern
-- established in 056/059.
--
-- Sections (added incrementally across Enrichment 2.1's milestones):
--   A. enrichment_nearby_venues_for_dedupe — dedicated spatial prefilter RPC
--      for discovery dedupe (Phase D). Replaces the in-memory full-pool scan
--      as the production hot path; the in-memory scan remains available as a
--      fixture/test fallback in TypeScript, unchanged.
--   B. venues.booking_url + venue_enrichment.admission_status (Phase J/D7)
--   C. auto_apply_generated_description — deterministic template synthesis
--      only, never scraped text (Phase L)
--   D. venue_enrichment age/height EVIDENCE columns — never mirrored into
--      admin-owned venues.min_age/max_age (Phase I)
--   E. snapshot_current_value — booking_url branch now reads the real column
--      added in Section B (056's hardcoded NULL would otherwise break that
--      field's stale-value guard entirely)
--   F. auto_apply_booking_url + enrichment_url_host — booking_url auto-apply
--      behind a venue-IDENTITY check, not just a confidence score (Phase D7)
--   G. enrichment_coverage_grid — per-cell/per-category venue counts that make
--      the Phase F coverage planner run on real data instead of fixtures
--
-- Sections A-C were written first; D-G close the integration gaps found in the
-- pre-commit review (facts extracted with nowhere to go, and a planner with no
-- data source). Only Section E replaces an existing function, and only its
-- booking_url branch differs — see that section's own note.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- A. enrichment_nearby_venues_for_dedupe (Phase D)
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY NOT get_nearby_venues (045): that RPC is deliberately consumer-search-
-- shaped — it filters `is_published=true AND moderation_status='approved' AND
-- discovery_approved=true`, which is exactly wrong for dedupe (a discovery
-- candidate that actually duplicates a PENDING/unpublished venue would look
-- "distinct" and get inserted again). It is also granted to anon/authenticated
-- with a default 32km / max 80km radius tuned for consumer proximity search,
-- not identity matching. This RPC is a deliberately separate, narrower,
-- service_role-only function — reusing get_nearby_venues by widening its
-- grants would have been the wrong fix (a correctness bug, not just an access
-- one), so a dedicated function was built instead, per instruction.
--
-- Scope discipline: returns ONLY the columns discovery/dedupe.ts's
-- DedupeExistingVenue shape needs (id/name/lat/lon/postcode/phone/website/
-- category slug) — never the full venues row — to keep payloads small at
-- result-cap size and avoid leaking unrelated columns to the caller.
--
-- Radius is identity-appropriate (a physical venue's footprint), not
-- consumer-search-appropriate: default 1,500m, hard-capped at 5,000m
-- regardless of what's requested — venues further apart than that are never
-- the same physical place, and widening the prefilter further would only
-- feed more irrelevant rows into the (more expensive) detailed dedupe scorer.
-- Result count is separately hard-capped (default 50, max 100) as a second,
-- independent guard against a pathologically dense city-centre cell returning
-- an unbounded payload.
--
-- NULL/malformed coordinates: p_lat/p_lng are validated exactly like
-- get_nearby_venues (raise on out-of-range, not a silent empty result — a
-- caller passing garbage coordinates should see an error, not a false
-- "no duplicates found"). Venues with a NULL `location` (never geocoded) are
-- naturally excluded by ST_DWithin (NULL geography → NULL predicate → not
-- matched) — no special-case needed.
--
-- PARITY NOTE (same convention as migration 050's confidence-threshold
-- parity with lib/facilities/confidence.ts): the 1500/5000 radius and 50/100
-- limit bounds below MUST stay in lockstep with
-- scripts/enrich/discovery/spatialPrefilterPolicy.ts. If you change a bound
-- here, change it there too.
--
-- TESTING NOTE: this repo's pinned @electric-sql/pglite@0.5.3 has no PostGIS
-- contrib module, so this function cannot be loaded or behaviourally tested
-- in-sandbox (CREATE FUNCTION referencing geography/ST_Point/ST_DWithin fails
-- without the extension). spatialPrefilterPolicy.test.ts covers the bounds
-- logic in isolation; supabase/tests/060_enrichment_2_1_staging_checklist.sql
-- has the full behavioural test cases (nearby/pending/unpublished/distant/
-- chain-branch/cap/role-security) — written to be run against a real
-- Postgres+PostGIS dev/staging database, not executed by this build.
CREATE OR REPLACE FUNCTION enrichment_nearby_venues_for_dedupe(
  p_lat        float,
  p_lng        float,
  p_radius_m   float DEFAULT 1500,
  p_limit      int   DEFAULT 50
)
RETURNS TABLE (
  id             uuid,
  name           text,
  latitude       float8,
  longitude      float8,
  postcode       text,
  phone          text,
  website        text,
  category_slug  text,
  distance_m     float8
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_lat IS NULL OR p_lat < -90 OR p_lat > 90 THEN
    RAISE EXCEPTION 'p_lat must be between -90 and 90' USING errcode = 'check_violation';
  END IF;
  IF p_lng IS NULL OR p_lng < -180 OR p_lng > 180 THEN
    RAISE EXCEPTION 'p_lng must be between -180 and 180' USING errcode = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT
    v.id,
    v.name,
    v.latitude::float8,
    v.longitude::float8,
    v.postcode,
    v.phone,
    v.website,
    c.slug AS category_slug,
    ROUND(ST_Distance(v.location, ST_Point(p_lng, p_lat)::geography)::numeric, 1)::float8 AS distance_m
  FROM venues v
  LEFT JOIN categories c ON c.id = v.category_id
  WHERE
    v.location IS NOT NULL
    AND ST_DWithin(
      v.location,
      ST_Point(p_lng, p_lat)::geography,
      LEAST(GREATEST(p_radius_m, 0), 5000)
    )
    -- Deliberately NO is_published / moderation_status / discovery_approved
    -- filter — dedupe must see pending/unpublished venues too (see header).
  ORDER BY distance_m ASC, v.id ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
END;
$$;

-- service_role only — never anon/authenticated (a candidate's raw coordinates
-- and the resulting nearby-venue set are internal enrichment-pipeline state,
-- not a consumer-facing search feature).
REVOKE ALL ON FUNCTION enrichment_nearby_venues_for_dedupe(float, float, float, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION enrichment_nearby_venues_for_dedupe(float, float, float, int) TO service_role;

-- ENRICHMENT_2_1_SECTIONS_BC_START (marker for
-- supabase/tests/060_enrichment_2_1_sections_bc.mjs — extracts Sections B+C
-- as a standalone pglite-runnable block, since Section A needs PostGIS
-- (unavailable in this repo's pinned pglite) and the whole file is one
-- transaction. Sections B/C have zero dependency on Section A's function —
-- this extraction runs the exact same SQL text, not a hand-maintained copy.)
-- ─────────────────────────────────────────────────────────────────────────────
-- B. booking_url + admission (Phase J/D7)
-- ─────────────────────────────────────────────────────────────────────────────
-- booking_url: already anticipated in the type system (types/webEnrichment.ts's
-- WebField union has had 'booking_url' since Phase 1 of the original website-
-- enrichment build) but the column itself was never created — autoApplyPolicy.ts
-- has hardcoded it into NEVER_AUTO_APPLY only because there was nowhere to
-- write it. This migration adds the column; auto-apply eligibility for it is
-- a separate, deliberate policy decision (kept never-auto-apply in this build
-- — see the final Enrichment 2.1 report's "genuine risks/decisions" section —
-- because "an official booking page clearly tied to the venue" needs the same
-- identity-corroboration confidence as a new-venue accept, which the existing
-- website/phone/email thresholds don't capture for a NEW field).
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS booking_url text;

-- admission: the smallest structured model that answers the one question that
-- actually matters initially (per instruction: "the most important product
-- fact initially is often FREE / PAID / UNKNOWN — do not overbuild"). Lives in
-- venue_enrichment (the evidence/intelligence layer), NOT venues — numeric
-- pricing is explicitly deferred (too volatile to present as canonical truth
-- without a freshness-bound re-check cadence this build doesn't implement yet).
ALTER TABLE venue_enrichment
  ADD COLUMN IF NOT EXISTS admission_status text
    CHECK (admission_status IS NULL OR admission_status IN ('free', 'paid', 'unknown'));

-- ─────────────────────────────────────────────────────────────────────────────
-- C. auto_apply_generated_description (Phase L)
-- ─────────────────────────────────────────────────────────────────────────────
-- Enrichment 2.0 blanket-prohibited ANY automated description apply (056's
-- apply_venue_proposal requires an admin-authored rewrite; 059's
-- auto_apply_field_proposal hard-blocks 'description' in NEVER_AUTO_APPLY).
-- That prohibition existed for ONE reason: copyright — a script must never
-- auto-publish verbatim/near-verbatim scraped marketing text. A DETERMINISTIC
-- TEMPLATE SYNTHESIS from verified structured facts (scripts/enrich/web/
-- descriptionGenerator.ts) is not scraped text at all — it is originated by
-- our own code from facts already trusted enough to auto-apply individually.
-- This is a NEW, NARROW, SEPARATE RPC — 059's auto_apply_field_proposal is
-- NOT modified (per instruction) and still blocks 'description' exactly as
-- before for ordinary extracted-description proposals.
--
-- Guards (every one independently enforced here, not trusted from the caller):
--   1. Same stale-current-value guard as every other apply path.
--   2. The EXISTING description must be empty/null/trivially short (<10 chars
--      after trim) — a real human/admin/curated description of any
--      substance is NEVER overwritten. This is a coarser, SQL-side mirror of
--      descriptionGenerator.ts's own isMeaningfulDescription() eligibility
--      check — defence in depth, not the only check.
--   3. The generated text must NOT equal the proposal's own evidence_snippet/
--      evidence_raw — i.e. it cannot literally BE scraped text passed through
--      unchanged (same anti-copyright check 056's human path already uses).
--   4. Only ever targets field='description' on an otherwise-ordinary pending
--      venue_field_proposals row — reuses 056's proposal/audit-trail
--      machinery rather than inventing a parallel one.
CREATE OR REPLACE FUNCTION auto_apply_generated_description(p_proposal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p          venue_field_proposals%rowtype;
  v_snap     jsonb;
  v_current  text;
  v_generated text;
BEGIN
  SELECT * INTO p FROM venue_field_proposals WHERE id = p_proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF p.status <> 'pending' THEN
    RAISE EXCEPTION 'not_pending:%', p.status;
  END IF;
  IF p.field <> 'description' THEN
    RAISE EXCEPTION 'wrong_field:%', p.field;
  END IF;

  v_snap := snapshot_current_value(p.venue_id, 'description');
  IF (v_snap ->> 'hash') IS DISTINCT FROM p.current_value_hash THEN
    RAISE EXCEPTION 'stale_current_value';
  END IF;

  v_current := p.current_value ->> 'v';
  IF v_current IS NOT NULL AND length(btrim(v_current)) >= 10 THEN
    RAISE EXCEPTION 'existing_description_not_trivial';
  END IF;

  v_generated := p.proposed_value ->> 'v';
  IF v_generated IS NULL OR btrim(v_generated) = '' THEN
    RAISE EXCEPTION 'empty_generated_text';
  END IF;
  IF btrim(v_generated) = btrim(coalesce(p.evidence_snippet, ''))
     OR btrim(v_generated) = btrim(coalesce(p.evidence_raw, '')) THEN
    RAISE EXCEPTION 'not_a_synthesis';
  END IF;

  UPDATE venues SET description = v_generated, updated_at = now() WHERE id = p.venue_id;

  UPDATE venue_field_proposals
     SET status = 'applied', applied_at = now(), applied_by = 'system'
   WHERE id = p_proposal_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION auto_apply_generated_description(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION auto_apply_generated_description(uuid) TO service_role;
-- ENRICHMENT_2_1_SECTIONS_BC_END

-- ENRICHMENT_2_1_SECTIONS_DEFG_START (marker for
-- supabase/tests/060_enrichment_2_1_sections_defg.mjs. Like the B/C block
-- above, these sections need no PostGIS and are extracted verbatim — not
-- hand-copied — so the tests always run the real migration text. Section E
-- replaces a function created in 056 and Section F depends on Section B's
-- venues.booking_url column, so that test loads 056 + the B/C block first,
-- exactly matching real migration order.)
-- ─────────────────────────────────────────────────────────────────────────────
-- D. Age / height evidence (Phase I destination)
-- ─────────────────────────────────────────────────────────────────────────────
-- venueFacts.ts extracts age ranges and height restrictions, but Enrichment
-- 2.1's first pass had nowhere provenance-safe to put them. They deliberately
-- do NOT go to venues.min_age/venues.max_age: those are admin/curator-owned
-- and carry no provenance flag, so an automated write there would be
-- indistinguishable from a human decision and could silently overwrite one.
--
-- These columns live in venue_enrichment (the evidence/intelligence layer,
-- same reasoning as admission_status in Section B) and are EVIDENCE ONLY:
-- nothing in this migration, and nothing in scripts/enrich/**, ever copies
-- them into venues.*. Promoting evidence to a published venue field stays a
-- deliberate human/admin decision — the whole point of keeping the layers
-- separate.
ALTER TABLE venue_enrichment
  ADD COLUMN IF NOT EXISTS min_age_evidence smallint
    CHECK (min_age_evidence IS NULL OR (min_age_evidence >= 0 AND min_age_evidence <= 18)),
  ADD COLUMN IF NOT EXISTS max_age_evidence smallint
    CHECK (max_age_evidence IS NULL OR (max_age_evidence >= 0 AND max_age_evidence <= 18)),
  ADD COLUMN IF NOT EXISTS min_height_cm_evidence smallint
    CHECK (min_height_cm_evidence IS NULL OR (min_height_cm_evidence >= 50 AND min_height_cm_evidence <= 250));

-- Ordering sanity: a max below its min is meaningless — reject at the DB, not
-- just in the extractor (venueFacts.ts already checks, this is defence in depth).
ALTER TABLE venue_enrichment
  DROP CONSTRAINT IF EXISTS venue_enrichment_age_evidence_order_chk;
ALTER TABLE venue_enrichment
  ADD CONSTRAINT venue_enrichment_age_evidence_order_chk
    CHECK (min_age_evidence IS NULL OR max_age_evidence IS NULL OR min_age_evidence <= max_age_evidence);

-- ─────────────────────────────────────────────────────────────────────────────
-- E. snapshot_current_value — booking_url now has a real column (Phase D7)
-- ─────────────────────────────────────────────────────────────────────────────
-- 056 hardcoded booking_url's snapshot to NULL with the comment "no
-- venues.booking_url column yet (deferred)". Section B created that column, so
-- leaving the hardcoded NULL would be an ACTIVE BUG, not just an omission:
-- every booking_url snapshot would hash identically regardless of the live
-- value, so the stale-current-value guard could never detect a concurrent
-- change and an apply could silently overwrite an existing booking_url.
--
-- This is a CREATE OR REPLACE of 056's function. ONLY the booking_url branch
-- differs; every other branch, the {"v": ...} wrapping, the field-prefixed
-- hash text and the return shape are byte-identical to 056. Verified by the
-- Section D/E/F/G tests, which assert the other fields' hashes are unchanged.
CREATE OR REPLACE FUNCTION snapshot_current_value(p_venue_id uuid, p_field text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_value jsonb;
  v_text  text;
begin
  if p_field = 'opening_hours' then
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'day_of_week', day_of_week,
                 'is_closed',   is_closed,
                 'opens_at',    opens_at,
                 'closes_at',   closes_at,
                 'notes',       notes
               ) order by day_of_week
             ),
             '[]'::jsonb)
      into v_value
      from opening_hours
     where venue_id = p_venue_id;
  elsif p_field = 'description' then
    select to_jsonb(description) into v_value from venues where id = p_venue_id;
  elsif p_field = 'price_range' then
    select to_jsonb(price_range) into v_value from venues where id = p_venue_id;
  elsif p_field = 'website' then
    select to_jsonb(website) into v_value from venues where id = p_venue_id;
  elsif p_field = 'phone' then
    select to_jsonb(phone) into v_value from venues where id = p_venue_id;
  elsif p_field = 'email' then
    select to_jsonb(email) into v_value from venues where id = p_venue_id;
  elsif p_field = 'booking_url' then
    -- CHANGED IN 060: reads the real column added in Section B (was a
    -- hardcoded null in 056 because the column did not exist yet).
    select to_jsonb(booking_url) into v_value from venues where id = p_venue_id;
  else
    raise exception 'invalid_field:%', p_field;
  end if;

  -- Wrap scalar values as { "v": ... } so they compare with proposed_value.
  if p_field <> 'opening_hours' and v_value is not null then
    v_value := jsonb_build_object('v', v_value);
  end if;

  -- Field-prefixed so a NULL value hashes differently per field (defence in depth;
  -- the stale guard always compares same-field snapshots, so this never falses).
  v_text := p_field || ':' || coalesce(v_value::text, 'null');
  return jsonb_build_object(
    'value', v_value,
    'hash',  encode(sha256(convert_to(v_text, 'UTF8')), 'hex')
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- F. auto_apply_booking_url (Phase D7) + URL host helper
-- ─────────────────────────────────────────────────────────────────────────────
-- Extracts the registrable-ish host from a URL for identity comparison.
-- Deliberately strict: anything that isn't a plain scheme://host/... shape
-- returns NULL, and a host containing '@' returns NULL so a userinfo trick
-- (https://real-venue.co.uk@evil.example/) can never be read as the venue's
-- own host. Not a security boundary on its own — it is one layer of the
-- identity check in auto_apply_booking_url below.
CREATE OR REPLACE FUNCTION enrichment_url_host(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
           WHEN h IS NULL OR h = '' OR position('@' in h) > 0 THEN NULL
           ELSE regexp_replace(h, '^www\.', '')
         END
  FROM (
    SELECT lower(substring(btrim(coalesce(p_url, '')) from '^(?:https?://)?([^/?#]+)')) AS h
  ) s;
$$;

-- Enrichment 2.1's booking_url auto-apply path. Separate from 059's
-- auto_apply_field_proposal (which still hard-blocks booking_url, and is NOT
-- modified here, per instruction) because booking_url needs a guard the
-- generic contact-field path has no concept of: VENUE IDENTITY.
--
-- The risk this exists to prevent: a booking link is an outbound link a parent
-- will click and potentially pay through. Auto-publishing one extracted from a
-- crawled page is only safe if we can show the link belongs to THAT venue —
-- a generic "confidence score" cannot express that. So:
--   1. Same stale-current-value guard as every other apply path.
--   2. Fill-if-empty ONLY — an existing booking_url is never overwritten.
--   3. https only (never http, never any other scheme).
--   4. IDENTITY: the booking URL's host must match the venue's own website
--      host (equal, or one a subdomain of the other). A third-party booking
--      host (bookwhen, eventbrite, ...) therefore never auto-applies — it is
--      routed to the exception queue by the caller for a human to approve.
--      A venue with no website on file can never satisfy this, by design.
-- Mirrored in scripts/enrich/web/bookingUrlPolicy.ts; as everywhere else in
-- this pipeline, the TypeScript is a pre-flight filter and THIS is the trust
-- boundary — every rule is re-checked here regardless of what the caller did.
CREATE OR REPLACE FUNCTION auto_apply_booking_url(p_proposal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p            venue_field_proposals%rowtype;
  v_snap       jsonb;
  v_current    text;
  v_proposed   text;
  v_site       text;
  v_host_url   text;
  v_host_site  text;
BEGIN
  SELECT * INTO p FROM venue_field_proposals WHERE id = p_proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF p.status <> 'pending' THEN
    RAISE EXCEPTION 'not_pending:%', p.status;
  END IF;
  IF p.field <> 'booking_url' THEN
    RAISE EXCEPTION 'wrong_field:%', p.field;
  END IF;

  v_snap := snapshot_current_value(p.venue_id, 'booking_url');
  IF (v_snap ->> 'hash') IS DISTINCT FROM p.current_value_hash THEN
    RAISE EXCEPTION 'stale_current_value';
  END IF;

  -- Fill-if-empty only.
  v_current := p.current_value ->> 'v';
  IF v_current IS NOT NULL AND btrim(v_current) <> '' THEN
    RAISE EXCEPTION 'booking_url_already_set';
  END IF;

  v_proposed := btrim(coalesce(p.proposed_value ->> 'v', ''));
  IF v_proposed = '' THEN
    RAISE EXCEPTION 'empty_booking_url';
  END IF;
  IF v_proposed !~* '^https://' THEN
    RAISE EXCEPTION 'insecure_or_invalid_scheme';
  END IF;

  SELECT website INTO v_site FROM venues WHERE id = p.venue_id;
  v_host_url  := enrichment_url_host(v_proposed);
  v_host_site := enrichment_url_host(v_site);
  IF v_host_url IS NULL OR v_host_site IS NULL THEN
    RAISE EXCEPTION 'identity_unverifiable';
  END IF;
  IF v_host_url <> v_host_site
     AND v_host_url NOT LIKE ('%.' || v_host_site)
     AND v_host_site NOT LIKE ('%.' || v_host_url) THEN
    RAISE EXCEPTION 'host_identity_mismatch:%', v_host_url;
  END IF;

  UPDATE venues SET booking_url = v_proposed, updated_at = now() WHERE id = p.venue_id;

  UPDATE venue_field_proposals
     SET status = 'applied', applied_at = now(), applied_by = 'system'
   WHERE id = p_proposal_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION auto_apply_booking_url(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION auto_apply_booking_url(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- G. enrichment_coverage_grid (Phase F — makes the coverage planner real)
-- ─────────────────────────────────────────────────────────────────────────────
-- coveragePlanner.ts needs "how many venues, of which categories, are already
-- in each grid cell, and when was that cell last discovery-checked". Doing
-- that client-side would mean loading the whole venues table into memory —
-- exactly the anti-pattern Phase D removed from the dedupe path. This
-- aggregates in Postgres and returns one small row per (cell, category).
--
-- CELL IDENTITY: returns INTEGER cell indices, not formatted ids. TypeScript
-- computes the same integers from the same origin/step (ukGridCells in
-- coveragePlanner.ts), so cell matching is exact integer comparison — no
-- float-formatting agreement needed between JS's toFixed and SQL's to_char,
-- which is precisely the kind of mismatch that silently mis-buckets data.
--
-- Cells with zero venues never appear here; the caller treats absent as zero
-- (coveragePlanner already reads venuesByCategory[slug] ?? 0), so an
-- unpopulated cell is correctly seen as fully uncovered.
--
-- No PostGIS: this deliberately uses the plain latitude/longitude columns, so
-- unlike Section A it IS testable in pglite.
CREATE OR REPLACE FUNCTION enrichment_coverage_grid(
  p_step_deg  float DEFAULT 1.0,
  p_lat_start float DEFAULT 49.0,
  p_lng_start float DEFAULT -8.7
)
RETURNS TABLE (
  cell_lat_idx       int,
  cell_lng_idx       int,
  category_slug      text,
  venue_count        bigint,
  last_discovered_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_step_deg IS NULL OR p_step_deg <= 0 THEN
    RAISE EXCEPTION 'p_step_deg must be > 0' USING errcode = 'check_violation';
  END IF;

  RETURN QUERY
  WITH venue_cells AS (
    SELECT
      floor((v.latitude::float8  - p_lat_start) / p_step_deg)::int AS lat_idx,
      floor((v.longitude::float8 - p_lng_start) / p_step_deg)::int AS lng_idx,
      c.slug AS slug
    FROM venues v
    LEFT JOIN categories c ON c.id = v.category_id
    WHERE v.latitude IS NOT NULL AND v.longitude IS NOT NULL
  ),
  counts AS (
    SELECT lat_idx, lng_idx, slug, count(*)::bigint AS n
    FROM venue_cells
    GROUP BY lat_idx, lng_idx, slug
  ),
  discovery AS (
    SELECT
      floor((d.latitude::float8  - p_lat_start) / p_step_deg)::int AS lat_idx,
      floor((d.longitude::float8 - p_lng_start) / p_step_deg)::int AS lng_idx,
      max(d.created_at) AS last_at
    FROM venue_discovery_candidates d
    WHERE d.latitude IS NOT NULL AND d.longitude IS NOT NULL
    GROUP BY 1, 2
  )
  SELECT co.lat_idx, co.lng_idx, co.slug, co.n, di.last_at
  FROM counts co
  LEFT JOIN discovery di
    ON di.lat_idx = co.lat_idx AND di.lng_idx = co.lng_idx
  ORDER BY co.lat_idx, co.lng_idx, co.slug;
END;
$$;

-- service_role only — this is internal enrichment-planning state (it exposes
-- where the catalogue is thin), not a consumer-facing feature.
REVOKE ALL ON FUNCTION enrichment_coverage_grid(float, float, float) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION enrichment_coverage_grid(float, float, float) TO service_role;
-- ENRICHMENT_2_1_SECTIONS_DEFG_END

COMMIT;

-- =============================================================================
-- ROLLBACK (no separate _down file yet, matching the 049/056/059 convention):
--   BEGIN;
--   DROP FUNCTION IF EXISTS enrichment_coverage_grid(float, float, float);
--   DROP FUNCTION IF EXISTS auto_apply_booking_url(uuid);
--   DROP FUNCTION IF EXISTS enrichment_url_host(text);
--   ALTER TABLE venue_enrichment DROP CONSTRAINT IF EXISTS venue_enrichment_age_evidence_order_chk;
--   ALTER TABLE venue_enrichment DROP COLUMN IF EXISTS min_height_cm_evidence;
--   ALTER TABLE venue_enrichment DROP COLUMN IF EXISTS max_age_evidence;
--   ALTER TABLE venue_enrichment DROP COLUMN IF EXISTS min_age_evidence;
--   DROP FUNCTION IF EXISTS auto_apply_generated_description(uuid);
--   ALTER TABLE venue_enrichment DROP COLUMN IF EXISTS admission_status;
--   ALTER TABLE venues DROP COLUMN IF EXISTS booking_url;
--   DROP FUNCTION IF EXISTS enrichment_nearby_venues_for_dedupe(float, float, float, int);
--   COMMIT;
--
-- ⚠ ONE EXCEPTION to "this rollback loses nothing but this migration's own
-- additions": Section E replaced snapshot_current_value. Dropping Section B's
-- venues.booking_url column WITHOUT first restoring 056's version of that
-- function would leave a function referencing a missing column. To roll back
-- fully, re-run 056's snapshot_current_value definition (its booking_url
-- branch sets v_value := null) BEFORE the ALTER TABLE ... DROP COLUMN
-- booking_url line above. Every other object here is a pure addition.
-- =============================================================================
