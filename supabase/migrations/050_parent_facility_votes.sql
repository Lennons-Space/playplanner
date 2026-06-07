-- =============================================================================
-- 050_parent_facility_votes.sql
-- Parent Contribution MVP -- Phase 1 (venue-detail only).
--
-- WHAT THIS ADDS
-- --------------
-- A one-tap "is this here?" vote for three facilities (toilets, baby change,
-- parking) on a venue's detail page. Individual votes are aggregated into a
-- public confidence score, and -- once enough parents agree -- the result is
-- mirrored into the EXISTING `venue_facilities` table that the recommender
-- (lib/recommendations/familyScore.ts -- scoreFacilities) already reads.
-- This means the recommender lights up for parent-confirmed facilities with
-- ZERO changes to its scoring code.
--
-- PRIVACY BY DESIGN (why this shape)
-- ----------------------------------
--   * No PII, no child data, no location data is stored here -- only a
--     boolean "present/absent" vote tied to a venue and a user id.
--   * Individual votes (`venue_facility_votes`) have NO client SELECT policy.
--     Nobody -- not even the voter via the anon/authenticated API -- can read
--     raw vote rows back. Only the aggregate (`venue_facility_stats`) is
--     public, and it never reveals who voted or how many people voted "no"
--     in a way that identifies anyone (counts only).
--   * `user_id REFERENCES auth.users(id) ON DELETE CASCADE` -- when a user
--     deletes their account (GDPR Art.17 erasure, see delete_own_account()),
--     every vote they ever cast is removed automatically by the database.
--   * The aggregation and mirror triggers run as SECURITY DEFINER with a
--     locked search_path (public, pg_temp) so they cannot be hijacked by a
--     malicious schema earlier in the search path, and so they can update
--     the aggregate/mirror tables even though normal users cannot write to
--     them directly.
--
-- PARITY NOTE (read this before changing thresholds)
-- ---------------------------------------------------
-- The confidence/mirror thresholds in `recompute_facility_stats()` below
-- MUST stay in lockstep with the pure TypeScript helpers in
-- `lib/facilities/confidence.ts` (computeConfidence / shouldMirror). Those
-- functions exist so the decision logic is unit-testable in CI even though
-- Postgres cannot run inside Jest. If you change a threshold here, change it
-- there too -- and update the parity comment in that file.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: Seed the three facilities (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
-- `facilities` already exists (migration 001) and already has the columns we
-- need (id, name, slug, icon). We only seed rows that are missing -- existing
-- rows (e.g. if an admin already added "Toilets" under a different id) are
-- left untouched thanks to ON CONFLICT (slug) DO NOTHING.
INSERT INTO public.facilities (name, slug, icon) VALUES
  ('Toilets',     'toilets',     'shield'),
  ('Baby Change', 'baby-change', 'stroller'),
  ('Parking',     'parking',     'pin')
ON CONFLICT (slug) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: venue_facility_votes -- one vote per (venue, user, facility)
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY a CHECK on facility_slug rather than a facility_id FK:
--   The MVP only supports three known facilities. A text CHECK keeps the
--   client payload simple (no extra lookup round-trip) and makes the trigger
--   logic below trivial to read and audit. If the facility set grows later,
--   this can be migrated to an FK without changing the public shape much.
CREATE TABLE IF NOT EXISTS public.venue_facility_votes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  -- ON DELETE CASCADE: deleting an account erases every vote that account
  -- ever cast. This is the database-level guarantee behind GDPR Art.17.
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  facility_slug text NOT NULL CHECK (facility_slug IN ('toilets', 'baby-change', 'parking')),
  present       boolean NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- One vote per person per facility per venue. Re-tapping updates the
  -- existing row (the client upserts on this constraint) rather than
  -- creating duplicate "votes" that would inflate the aggregate.
  UNIQUE (venue_id, user_id, facility_slug)
);

CREATE INDEX IF NOT EXISTS venue_facility_votes_venue_facility_idx
  ON public.venue_facility_votes (venue_id, facility_slug);

CREATE INDEX IF NOT EXISTS venue_facility_votes_user_idx
  ON public.venue_facility_votes (user_id);

-- Keep updated_at honest on re-vote (reuses the existing shared trigger
-- function from earlier migrations -- see touch_updated_at()).
CREATE TRIGGER venue_facility_votes_updated_at
  BEFORE UPDATE ON public.venue_facility_votes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: venue_facility_stats -- public, anonymous aggregate
-- ─────────────────────────────────────────────────────────────────────────────
-- This is the ONLY facility-vote data clients can read. It contains nothing
-- but counts and a derived confidence/presence verdict -- no user identifiers,
-- no timestancps tied to individuals, nothing that could be used to single
-- out who voted what.
CREATE TABLE IF NOT EXISTS public.venue_facility_stats (
  venue_id      uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  facility_slug text NOT NULL CHECK (facility_slug IN ('toilets', 'baby-change', 'parking')),
  yes_count     int  NOT NULL DEFAULT 0,
  no_count      int  NOT NULL DEFAULT 0,
  total_votes   int  NOT NULL DEFAULT 0,
  confidence    text NOT NULL DEFAULT 'low' CHECK (confidence IN ('low', 'medium', 'high')),
  present       boolean,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, facility_slug)
);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4: Aggregation function + trigger
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY SECURITY DEFINER:
--   Regular users can only INSERT/UPDATE/DELETE their OWN vote rows (RLS
--   below). But the aggregate table must be written by the system, not by
--   users directly -- otherwise anyone could fabricate "Confirmed by 50
--   parents". Running as the function owner (DEFINER) lets the trigger write
--   the aggregate row regardless of the calling user's own permissions, while
--   the calling user still cannot write to venue_facility_stats directly.
--
-- WHY SET search_path = public, pg_temp:
--   Locks name resolution so a same-named object in another schema earlier in
--   a session's search_path cannot be substituted in (the class of attack
--   migration 046 closed for get_nearby_venues). pg_temp is included per the
--   project's house style for DEFINER trigger functions.
--
-- CONFIDENCE THRESHOLDS (must match lib/facilities/confidence.ts EXACTLY):
--   low    -- total_votes < 3
--   medium -- total_votes >= 3 AND agreement >= 0.66  (agreement = max(yes,no)/total)
--   high   -- total_votes >= 5 AND agreement >= 0.75
--   present -- majority verdict: yes_count > no_count
CREATE OR REPLACE FUNCTION public.recompute_facility_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_venue_id      uuid;
  v_facility_slug text;
  v_yes           int;
  v_no            int;
  v_total         int;
  v_agreement     numeric;
  v_confidence    text;
  v_present       boolean;
BEGIN
  -- On DELETE the OLD row carries the (venue_id, facility_slug) we need to
  -- recompute; on INSERT/UPDATE the NEW row does. Either way we recompute
  -- from scratch by counting the live rows -- simplest to reason about and
  -- impossible to drift out of sync via partial increments.
  IF TG_OP = 'DELETE' THEN
    v_venue_id      := OLD.venue_id;
    v_facility_slug := OLD.facility_slug;
  ELSE
    v_venue_id      := NEW.venue_id;
    v_facility_slug := NEW.facility_slug;
  END IF;

  SELECT
    count(*) FILTER (WHERE present = true),
    count(*) FILTER (WHERE present = false),
    count(*)
  INTO v_yes, v_no, v_total
  FROM public.venue_facility_votes
  WHERE venue_id = v_venue_id AND facility_slug = v_facility_slug;

  IF v_total = 0 THEN
    v_agreement := 0;
  ELSE
    v_agreement := GREATEST(v_yes, v_no)::numeric / v_total::numeric;
  END IF;

  -- Majority verdict. Ties (yes = no, both > 0) resolve to "not present" --
  -- a cautious default so we never claim a facility exists on a 50/50 split.
  v_present := v_total > 0 AND v_yes > v_no;

  IF v_total < 3 THEN
    v_confidence := 'low';
  ELSIF v_total >= 5 AND v_agreement >= 0.75 THEN
    v_confidence := 'high';
  ELSIF v_total >= 3 AND v_agreement >= 0.66 THEN
    v_confidence := 'medium';
  ELSE
    v_confidence := 'low';
  END IF;

  INSERT INTO public.venue_facility_stats
    (venue_id, facility_slug, yes_count, no_count, total_votes, confidence, present, updated_at)
  VALUES
    (v_venue_id, v_facility_slug, v_yes, v_no, v_total, v_confidence, v_present, now())
  ON CONFLICT (venue_id, facility_slug) DO UPDATE SET
    yes_count   = EXCLUDED.yes_count,
    no_count    = EXCLUDED.no_count,
    total_votes = EXCLUDED.total_votes,
    confidence  = EXCLUDED.confidence,
    present     = EXCLUDED.present,
    updated_at  = now();

  RETURN NULL; -- AFTER trigger -- return value is ignored
END;
$$;

-- No client should ever be able to call this directly -- only the trigger
-- (which runs as the function owner) invokes it.
REVOKE EXECUTE ON FUNCTION public.recompute_facility_stats() FROM PUBLIC;

CREATE TRIGGER venue_facility_votes_recompute_stats
  AFTER INSERT OR UPDATE OR DELETE ON public.venue_facility_votes
  FOR EACH ROW EXECUTE FUNCTION public.recompute_facility_stats();


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 5: Mirror function + trigger
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY this exists (the whole point of the feature):
--   `lib/recommendations/familyScore.ts` (scoreFacilities) and
--   `lib/recommendations/venueIntelligence.ts` (parentConvenienceScore) and
--   recommendationReasons.ts ("Parent Friendly") all read venue.facilities,
--   which `useVenue` populates by joining venue_facilities -> facilities.
--   By writing a row into venue_facilities once parents agree a facility is
--   present (medium/high confidence + present = true), the EXISTING
--   recommender picks it up automatically -- no scorer changes required.
--
-- WHY notes = 'parent-confirmed' as a guard:
--   venue_facilities may already contain rows from admins/business owners/
--   enrichment scripts. We must NEVER delete or overwrite those. Tagging
--   rows THIS trigger creates with notes = 'parent-confirmed' lets us safely
--   remove only the rows we ourselves added if confidence later drops (e.g.
--   new votes flip the majority) -- without ever touching a non-parent row.
--   The upsert also only fires with that same notes value, so if a non-parent
--   row already exists for this (venue, facility), we leave it alone.
CREATE OR REPLACE FUNCTION public.mirror_facility_stats_to_venue_facilities()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_facility_id uuid;
  v_should_mirror boolean;
BEGIN
  SELECT id INTO v_facility_id
  FROM public.facilities
  WHERE slug = NEW.facility_slug;

  -- The three slugs are seeded in section 1. If for some reason the lookup
  -- fails (facility row removed by an admin), there is nothing to mirror to --
  -- skip silently rather than raising and breaking the vote flow.
  IF v_facility_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_should_mirror := NEW.confidence IN ('medium', 'high') AND NEW.present = true;

  IF v_should_mirror THEN
    INSERT INTO public.venue_facilities (venue_id, facility_id, notes)
    VALUES (NEW.venue_id, v_facility_id, 'parent-confirmed')
    ON CONFLICT (venue_id, facility_id) DO UPDATE SET
      notes = 'parent-confirmed'
    WHERE public.venue_facilities.notes IS NULL
       OR public.venue_facilities.notes = 'parent-confirmed';
  ELSE
    -- Confidence dropped below medium, or the majority flipped to "not
    -- present". Remove ONLY the row we created -- the notes guard means a
    -- row added by an admin/business owner/enrichment script is never touched.
    DELETE FROM public.venue_facilities
    WHERE venue_id = NEW.venue_id
      AND facility_id = v_facility_id
      AND notes = 'parent-confirmed';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mirror_facility_stats_to_venue_facilities() FROM PUBLIC;

CREATE TRIGGER venue_facility_stats_mirror
  AFTER INSERT OR UPDATE ON public.venue_facility_stats
  FOR EACH ROW EXECUTE FUNCTION public.mirror_facility_stats_to_venue_facilities();


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 6: Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────

-- venue_facility_votes ---------------------------------------------------
-- Individual votes are PRIVATE. There is deliberately NO select policy for
-- anon or authenticated -- nobody can read raw vote rows back through the
-- client API, including the voter's own rows. The aggregation trigger runs
-- as SECURITY DEFINER, so it can still read every row to compute counts.
ALTER TABLE public.venue_facility_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_facility_votes_insert_own"
  ON public.venue_facility_votes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "venue_facility_votes_update_own"
  ON public.venue_facility_votes FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "venue_facility_votes_delete_own"
  ON public.venue_facility_votes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- venue_facility_stats ----------------------------------------------------
-- Aggregates only -- safe to expose publicly (counts, no identities). This
-- is what powers the "Confirmed by N parents" chip state for every visitor,
-- signed in or not.
ALTER TABLE public.venue_facility_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_facility_stats_select_public"
  ON public.venue_facility_stats FOR SELECT
  USING (true);

-- No INSERT/UPDATE/DELETE policy for any client role -- only the
-- SECURITY DEFINER trigger (recompute_facility_stats) writes this table.


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 7: Grants
-- ─────────────────────────────────────────────────────────────────────────────
-- Table-level grants gate which operations RLS even gets a chance to apply
-- to. Match them to the policies above: authenticated can write their own
-- votes; everyone (including anon) can read the public aggregate.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_facility_votes TO authenticated;
GRANT SELECT ON public.venue_facility_stats TO anon, authenticated;
