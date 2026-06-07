-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 052: complete the GDPR Art.17 erasure fix — venues.claimed_by
--
-- WHY THIS EXISTS
--   Migration 051 fixed six profiles-referencing FK columns that were on the
--   default NO ACTION and therefore silently blocked account deletion. A
--   post-deploy verification sweep (after 051 was applied to production on
--   2026-06-07) found ONE more column that both audit passes in 051 had missed:
--
--       venues.claimed_by  →  references profiles(id)  ON DELETE NO ACTION
--
--   This blocks `delete_own_account()` for any BUSINESS OWNER who has CLAIMED a
--   venue listing: deleting auth.users cascades to profiles, and Postgres then
--   raises a foreign-key violation on every venue still pointing at the deleted
--   profile via claimed_by. Same GDPR Art.17 ("right to erasure") failure that
--   051 set out to fix — just for a different class of user (claimants rather
--   than uploaders / submitters / flaggers / moderators).
--
-- POLICY DECISION (anonymise, consistent with 051)
--   `claimed_by` is an ATTRIBUTION link — "which business owner claimed this
--   venue listing" — not content about a person. The venue (name, address,
--   location) is factual information about a PLACE. ON DELETE SET NULL severs
--   the claim (the venue reverts to unclaimed) while the public listing, its
--   reviews and ratings survive untouched. This is the exact same
--   "erasure via anonymisation" treatment 051 applied to venues.submitted_by
--   (GDPR recital 26 — anonymous information is no longer personal data).
--   The column is nullable, so SET NULL is valid.
--
-- VERIFIED (2026-06-07, against production)
--   After this migration, a sweep of EVERY foreign key referencing
--   public.profiles OR auth.users found NONE remaining on NO ACTION/RESTRICT —
--   so account deletion can no longer be blocked by any FK. A self-contained,
--   force-rolled-back end-to-end test of delete_own_account() for a user who
--   had uploaded (approved+pending) photos, SUBMITTED and CLAIMED a venue, and
--   filed a review flag completed with no FK error and the expected outcomes:
--   pending photo deleted; approved photo kept with uploaded_by NULL; venue
--   kept with submitted_by AND claimed_by NULL; profile + auth.users gone;
--   GDPR audit row written then anonymised (user_id NULL).
--
-- The column was created in migration 001 as:
--   claimed_by uuid references profiles(id)
-- with no ON DELETE clause → default constraint name `venues_claimed_by_fkey`,
-- default action NO ACTION. Nullable, never altered since (confirmed in prod).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.venues
  DROP CONSTRAINT IF EXISTS venues_claimed_by_fkey;

ALTER TABLE public.venues
  ADD CONSTRAINT venues_claimed_by_fkey
  FOREIGN KEY (claimed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION SQL (run manually against a staging DB)
--
-- (a) Constraint is now SET NULL:
--   SELECT confdeltype FROM pg_constraint WHERE conname = 'venues_claimed_by_fkey';
--   -- Expect: 'n'  (SET NULL)
--
-- (b) No profiles/auth.users FK remains on NO ACTION/RESTRICT (full sweep):
--   SELECT rel.relname, att.attname
--   FROM pg_constraint con
--   JOIN pg_class rel ON rel.oid = con.conrelid
--   JOIN pg_class fref ON fref.oid = con.confrelid
--   JOIN pg_namespace frefnsp ON frefnsp.oid = fref.relnamespace
--   JOIN unnest(con.conkey) AS cols(attnum) ON true
--   JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = cols.attnum
--   WHERE con.contype = 'f' AND con.confdeltype IN ('a','r')
--     AND ((frefnsp.nspname='public' AND fref.relname='profiles')
--       OR (frefnsp.nspname='auth' AND fref.relname='users'));
--   -- Expect: 0 rows
--
-- (c) A business owner who claimed a venue can now delete their account:
--   -- as that user (auth.uid() = claimant): SELECT delete_own_account();
--   -- Expect: completes; the claimed venue survives with claimed_by IS NULL.
-- ─────────────────────────────────────────────────────────────────────────────
