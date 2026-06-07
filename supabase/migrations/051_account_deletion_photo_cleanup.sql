-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 051: Account-deletion FK cleanup (GDPR Art.17 compliance fix)
--
-- PROBLEM
--   Several columns across the schema reference `profiles(id)` with NO
--   `ON DELETE` action (the Postgres default is `NO ACTION`). Deleting a
--   user via `delete_own_account()` deletes `auth.users`, which cascades to
--   `profiles` — but Postgres then refuses to null out or cascade any table
--   that still points at the deleted profile via a `NO ACTION` FK, and
--   raises a foreign-key-violation error. Each such column silently blocks
--   account deletion for any user who ever performed the matching action.
--   That is a GDPR Art.17 (“right to erasure”) failure — and it makes the
--   Play/App Store Data Safety claim "users can request deletion" untrue
--   for those accounts.
--
--   This migration fixes FIVE such columns, found across two audit passes:
--
--     1. venue_photos.uploaded_by   — affects users who uploaded a photo
--     2. venue_photos.moderated_by  — affects admins who moderated a photo
--     3. venues.submitted_by        — affects users who submitted a venue
--                                      (REAL, COMMON — likely the most
--                                      frequently hit of all five)
--     4. venues.moderated_by        — affects admins who moderated a venue
--                                      (edge case — admin accounts only)
--     5. reviews.moderated_by       — affects admins who moderated a review
--                                      (edge case — admin accounts only)
--     6. review_flags.reported_by   — affects users who flagged/reported a
--                                      review for abuse (REAL — any user who
--                                      used the "report review" feature)
--
--   NOTE ON `venue_reports.reported_by`: a second-pass audit also checked
--   this column (the venue-quality-report equivalent of review_flags). It is
--   ALREADY `ON DELETE SET NULL` — set correctly at table-creation time in
--   migration 014 — so it is NOT touched here. It is documented below for
--   completeness so a future reader can see the full picture in one place.
--
-- POLICY DECISION (anonymise approved / delete unapproved)
--   Venue photos are pictures of PLACES, not people (EXIF/GPS is stripped
--   before upload — see migration that adds `venue-photos` storage bucket,
--   and the upload hook). Once a photo has passed moderation it is public
--   venue content with no remaining personal angle other than the foreign
--   key linking it to the uploader's account.
--
--     • APPROVED photos  → KEEP the row and file, but SEVER the link to the
--       uploader by setting `uploaded_by` (and `moderated_by`) to NULL on
--       deletion. After this, the row carries no personal data — it is
--       fully anonymised, equivalent to "erasure" under GDPR recital 26
--       (anonymous information is no longer personal data).
--
--     • PENDING / REJECTED photos → FULLY DELETE the row (this migration,
--       inside `delete_own_account()`) AND the underlying storage object
--       (handled client-side — see app/(tabs)/profile.tsx — because SQL
--       cannot reliably delete Supabase Storage blobs from inside a
--       SECURITY DEFINER function; storage lives outside Postgres). These
--       photos never went public, so there is no public-interest reason to
--       keep them, and deleting them removes the personal link entirely.
--
--   Net effect: a user's personal link to ALL their photos is removed on
--   deletion. Public/approved images remain only as anonymous venue content
--   (a legitimate, privacy-respecting outcome — not a retention of personal
--   data), while anything that was never published is erased outright.
--
-- POLICY DECISION (anonymise attribution links on venues / reviews / flags)
--   Unlike photos, `venues.submitted_by`, `venues.moderated_by`,
--   `reviews.moderated_by` and `review_flags.reported_by` are pure
--   ATTRIBUTION links — "who did this administrative/contribution action" —
--   not user-authored content in their own right:
--
--     • venues.submitted_by  — who originally submitted the venue listing.
--       The venue itself (name, address, opening hours, etc.) is factual
--       information about a PLACE, not about the submitting person.
--     • venues.moderated_by / reviews.moderated_by — which admin actioned a
--       moderation decision. Useful for accountability while the admin's
--       account exists; not personal data about the venue/review subject.
--     • review_flags.reported_by — who flagged a review for abuse. The flag
--       record (which review, what reason) is a moderation-queue artefact
--       that must persist for the moderation history even after the
--       reporter's account is gone.
--
--   For all four, `ON DELETE SET NULL` anonymises the attribution — the
--   venue/review/flag row survives intact (preserving the public content and
--   the moderation history) while the link to the now-deleted person is
--   severed. This is the same "erasure via anonymisation" outcome described
--   above for approved photos (GDPR recital 26), applied to attribution
--   metadata instead of media rows.
--
-- WHAT THIS MIGRATION DOES
--   1. Re-points the `venue_photos.uploaded_by` FK at `profiles(id)` with
--      `ON DELETE SET NULL` so the cascade from `auth.users` → `profiles`
--      no longer raises an FK violation — it anonymises instead.
--   2. Does the same for `venue_photos.moderated_by` (defensive: an admin
--      deleting their own account must not be blocked by, or wrongly
--      cascade through, photos they once moderated).
--   3. Does the same for `venues.submitted_by` — the column most likely to
--      block a NORMAL (non-admin) user's deletion, since submitting a venue
--      is a common, everyday contribution action.
--   4. Does the same for `venues.moderated_by` and `reviews.moderated_by`
--      (admin-attribution edge cases — only blocks an admin deleting their
--      own account, but still a real Art.17 failure if hit).
--   5. Does the same for `review_flags.reported_by` — blocks any user who
--      has ever used the "report review" abuse-flagging feature.
--   6. Re-creates `delete_own_account()` to first delete the calling user's
--      own PENDING/REJECTED photo rows (`status <> 'approved'`), before the
--      `auth.users` delete runs. The `auth.users` delete then cascades to
--      `profiles`, which — thanks to (1)-(5) — anonymises any remaining
--      attribution links instead of failing.
--
--   Storage-file cleanup for the deleted pending/rejected rows is performed
--   by the CLIENT immediately before calling this RPC (see
--   app/(tabs)/profile.tsx). Approved photos' files are intentionally
--   retained — they are now anonymous venue images.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: venue_photos.uploaded_by → ON DELETE SET NULL ───────────────────
-- The column was created in migration 001 as:
--   uploaded_by uuid references profiles(id)
-- with no ON DELETE clause, so Postgres assigned the default constraint name
-- `venue_photos_uploaded_by_fkey` and the default action `NO ACTION`.
ALTER TABLE public.venue_photos
  DROP CONSTRAINT IF EXISTS venue_photos_uploaded_by_fkey;

ALTER TABLE public.venue_photos
  ADD CONSTRAINT venue_photos_uploaded_by_fkey
  FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── Step 2: venue_photos.moderated_by → ON DELETE SET NULL ──────────────────
-- Added in migration 007 as:
--   moderated_by uuid references profiles(id)
-- again with no ON DELETE clause → default constraint name
-- `venue_photos_moderated_by_fkey`, default action `NO ACTION`.
ALTER TABLE public.venue_photos
  DROP CONSTRAINT IF EXISTS venue_photos_moderated_by_fkey;

ALTER TABLE public.venue_photos
  ADD CONSTRAINT venue_photos_moderated_by_fkey
  FOREIGN KEY (moderated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── Step 3: venues.submitted_by → ON DELETE SET NULL ────────────────────────
-- The column was created in migration 001 (line 99) as:
--   submitted_by uuid references profiles(id)
-- with no ON DELETE clause → default constraint name `venues_submitted_by_fkey`,
-- default action `NO ACTION`. Nullable (no NOT NULL), never altered since.
--
-- WHY SET NULL: this is an attribution link ("who submitted this venue"),
-- not content about a person — the venue listing describes a PLACE. Setting
-- it NULL anonymises "who submitted it" while the venue (and its public
-- listing, reviews, ratings) survives untouched. This is the column most
-- likely to block a NORMAL user's account deletion, since submitting a venue
-- is an everyday contribution action, not an admin-only one.
ALTER TABLE public.venues
  DROP CONSTRAINT IF EXISTS venues_submitted_by_fkey;

ALTER TABLE public.venues
  ADD CONSTRAINT venues_submitted_by_fkey
  FOREIGN KEY (submitted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── Step 4: venues.moderated_by → ON DELETE SET NULL ────────────────────────
-- The column was created in migration 001 (line 102) as:
--   moderated_by uuid references profiles(id)
-- with no ON DELETE clause → default constraint name `venues_moderated_by_fkey`,
-- default action `NO ACTION`. Nullable, never altered since.
--
-- WHY SET NULL: admin-attribution link ("which admin approved/rejected this
-- venue listing"). Anonymising it on deletion lets an admin close their own
-- account without an FK violation, while the venue's moderation_status and
-- moderation_notes (the actual decision and reasoning) remain intact — only
-- the "who" is severed. Edge case (admin accounts only) but still a real
-- Art.17 failure if an admin ever tries to delete their account.
ALTER TABLE public.venues
  DROP CONSTRAINT IF EXISTS venues_moderated_by_fkey;

ALTER TABLE public.venues
  ADD CONSTRAINT venues_moderated_by_fkey
  FOREIGN KEY (moderated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── Step 5: reviews.moderated_by → ON DELETE SET NULL ───────────────────────
-- The column was added in migration 011 (line 49) as:
--   ADD COLUMN IF NOT EXISTS moderated_by uuid references profiles(id)
-- with no ON DELETE clause → default constraint name `reviews_moderated_by_fkey`,
-- default action `NO ACTION`. Nullable, never altered since.
--
-- WHY SET NULL: same admin-attribution reasoning as venues.moderated_by —
-- "which admin moderated this review" is severed on deletion; the review's
-- own content, moderation_status and moderation_notes (the GDPR Art.13
-- transparency text shown to the review's author) are untouched. Edge case
-- (admin accounts only).
ALTER TABLE public.reviews
  DROP CONSTRAINT IF EXISTS reviews_moderated_by_fkey;

ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_moderated_by_fkey
  FOREIGN KEY (moderated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── Step 5b: review_flags.reported_by → ON DELETE SET NULL ──────────────────
-- The column was created in migration 001 (line 218) as:
--   reported_by uuid references profiles(id)
-- with no ON DELETE clause → default constraint name
-- `review_flags_reported_by_fkey`, default action `NO ACTION`. Nullable,
-- never altered since.
--
-- *** AUDIT CORRECTION ***
-- An earlier pass of this audit mis-identified the column at migration
-- 001 line 218 as `venue_reports.reported_by`. It is in fact
-- `review_flags.reported_by` — the abuse-flagging table for REVIEWS (the
-- sibling of `venue_reports`, which flags VENUES and already has its FK
-- correctly set to `ON DELETE SET NULL` from creation in migration 014 —
-- see the note at the top of this file; that column is intentionally NOT
-- altered here).
--
-- WHY SET NULL: `reported_by` here is an attribution link ("who flagged
-- this review for abuse"), not the report content itself (`reason`, which
-- is a short fixed-vocabulary code, not free text). Anonymising it lets any
-- user who has ever used "report review" delete their account, while the
-- flag row survives for the moderation history (so admins retain visibility
-- of which reviews were flagged and why — just not by whom, once that
-- person is gone).
--
-- COMPATIBILITY NOTE: `review_flags` has NO redaction trigger analogous to
-- `redact_venue_report_notes_on_profile_delete` (migration 014/025). That
-- trigger exists because `venue_reports.notes` is unbounded free text
-- (up to 2000 chars) that could contain personal data written by the
-- reporter. `review_flags.reason` is a short `text not null` value drawn
-- from the report UI's fixed reason options (not open free text), so there
-- is no equivalent personal-data-in-notes risk here, and no trigger is
-- needed or added (out of scope — see migration guardrails).
ALTER TABLE public.review_flags
  DROP CONSTRAINT IF EXISTS review_flags_reported_by_fkey;

ALTER TABLE public.review_flags
  ADD CONSTRAINT review_flags_reported_by_fkey
  FOREIGN KEY (reported_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── Step 6: delete_own_account() — delete unapproved photos pre-cascade ─────
-- CREATE OR REPLACE keeps the existing grants intact (GRANT EXECUTE ... TO
-- authenticated, from migration 003) — Postgres does not drop grants on
-- CREATE OR REPLACE FUNCTION. We re-state the GRANT below anyway, defensively
-- and for readability, matching the pattern used elsewhere in this codebase.
--
-- SECURITY DEFINER + SET search_path = public, auth is preserved exactly as
-- migration 003 defined it: `auth` must remain on the search_path because the
-- function calls `auth.uid()` and deletes from `auth.users` — removing `auth`
-- would break both of those references (this is NOT the generic
-- `public, pg_temp` pattern used for functions that only touch `public`).
CREATE OR REPLACE FUNCTION delete_own_account()
RETURNS void AS $$
BEGIN
  -- Write GDPR Art.17 audit record before deletion.
  -- This must happen first — once the auth.users row is deleted, auth.uid()
  -- returns null and we can no longer identify the requester.
  INSERT INTO gdpr_audit_log (user_id, action, performed_by)
  VALUES (auth.uid(), 'account_deletion_requested', auth.uid());

  -- Delete this user's own PENDING/REJECTED photo rows before the cascade
  -- runs. These never went public, so there is no reason to retain them —
  -- and deleting them here means the corresponding storage files (cleaned
  -- up client-side immediately before this RPC is called) become orphaned
  -- DB-row-free, rather than left pointing at a row that still exists.
  -- Scoped strictly to `auth.uid()` — a user can only ever remove their own
  -- unapproved submissions, never another user's or an admin's photos.
  DELETE FROM public.venue_photos
  WHERE uploaded_by = auth.uid() AND status <> 'approved';

  -- Delete the auth.users row. Supabase cascades this to profiles and all
  -- tables with ON DELETE CASCADE foreign keys, so no orphaned data remains.
  -- Any rows this user is linked to via an attribution FK now have that
  -- link set to NULL by the ON DELETE SET NULL constraints added above —
  -- anonymising them rather than blocking this delete with a foreign-key
  -- violation. Covers: venue_photos.uploaded_by / .moderated_by,
  -- venues.submitted_by / .moderated_by, reviews.moderated_by, and
  -- review_flags.reported_by (venue_reports.reported_by was already
  -- ON DELETE SET NULL from creation — see migration 014).
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- Allow any authenticated user to call this function (they can only ever
-- delete themselves, as enforced by auth.uid() = id inside the function).
-- NOT granted to anon/public — matches migrations 046/047 least-privilege review.
GRANT EXECUTE ON FUNCTION delete_own_account() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION SQL (run manually against a staging DB — requires real
-- auth.users rows, so this cannot run inside jest/CI which has no Postgres)
--
-- Setup: as an admin/service-role connection —
--   -- create test users via Supabase Auth admin API or dashboard:
--   --   userA — uploads photos, submits a venue, files a review-abuse flag
--   --   userC — an admin who moderates a venue, a review and a photo
--   --   userB — unrelated control user/admin whose rows must stay untouched
--   --
--   -- userA uploads two photos to the same venue:
--   update venue_photos set status = 'approved' where id = '<photoA1_id>' and uploaded_by = '<userA_id>';
--   update venue_photos set status = 'pending'  where id = '<photoA2_id>' and uploaded_by = '<userA_id>';
--   -- userA submits a venue and flags a review:
--   --   confirm venues.submitted_by = '<userA_id>' for '<venueA_id>'
--   --   confirm review_flags.reported_by = '<userA_id>' for '<flagA_id>'
--   -- userC (admin) moderated a venue, a review and a photo:
--   --   confirm venues.moderated_by = '<userC_id>' for '<venueC_id>'
--   --   confirm reviews.moderated_by = '<userC_id>' for '<reviewC_id>'
--   --   confirm venue_photos.moderated_by = '<userC_id>' for '<photoC_id>'
--   -- userB (or an admin) owns unrelated rows:
--   --   confirm photoB.uploaded_by = '<userB_id>' and photoB.status is untouched
--   --   confirm venueB.submitted_by = '<userB_id>' is untouched
--
-- (a) No FK error on delete — run as userA (so auth.uid() = userA_id):
--   select delete_own_account();
--   -- Expect: completes with no error (previously: FK violation on venue_photos
--   -- — and, for any user who had submitted a venue or filed a review flag,
--   -- would ALSO have hit FK violations on venues.submitted_by /
--   -- review_flags.reported_by once the photo block was fixed).
--
-- (a2) Same check for an admin who moderated content — run as userC:
--   select delete_own_account();
--   -- Expect: completes with no error (previously: FK violation on
--   -- venues.moderated_by / reviews.moderated_by / venue_photos.moderated_by).
--
-- (b) Post-deletion row state — photos (unchanged behaviour from this migration's
--     original scope, re-verified to ensure the new ALTERs didn't regress it):
--   select id, uploaded_by, moderated_by, status from venue_photos where id = '<photoA1_id>';
--   -- Expect: 1 row, uploaded_by IS NULL, status = 'approved'  (anonymised, kept)
--   select id from venue_photos where id = '<photoA2_id>';
--   -- Expect: 0 rows (pending photo + its row fully removed)
--
-- (b2) Post-deletion row state — venue submitted by userA:
--   select id, name, submitted_by, is_published from venues where id = '<venueA_id>';
--   -- Expect: 1 row, submitted_by IS NULL, listing/content unchanged
--   -- (the venue stays live — anonymised attribution, not erasure of content)
--
-- (b3) Post-deletion row state — review flag filed by userA:
--   select id, review_id, reported_by, reason from review_flags where id = '<flagA_id>';
--   -- Expect: 1 row, reported_by IS NULL, reason unchanged (moderation
--   -- history preserved, reporter identity anonymised)
--
-- (b4) Post-deletion row state — content moderated by admin userC:
--   select id, moderated_by, moderation_status, moderation_notes from venues   where id = '<venueC_id>';
--   select id, moderated_by, moderation_status, moderation_notes from reviews  where id = '<reviewC_id>';
--   select id, moderated_by, status                              from venue_photos where id = '<photoC_id>';
--   -- Expect: each row survives, moderated_by IS NULL, the moderation
--   -- decision/notes/status are all unchanged (only the "who" is severed)
--
-- (c) Other users'/admins' rows untouched:
--   select id, uploaded_by, status   from venue_photos where id = '<photoB_id>';
--   select id, submitted_by          from venues       where id = '<venueB_id>';
--   -- Expect: uploaded_by/submitted_by = '<userB_id>' (unchanged), nothing nulled
--
-- (d) auth.users / profiles rows for the deleted users are gone:
--   select count(*) from auth.users where id in ('<userA_id>', '<userC_id>');  -- Expect: 0
--   select count(*) from profiles  where id in ('<userA_id>', '<userC_id>');   -- Expect: 0
--
-- (e) venue_reports.reported_by — confirm pre-existing SET NULL still works
--     unchanged (sanity check that this migration did not need to, and did
--     not, touch it):
--   select id, reported_by, notes from venue_reports where reported_by is null
--     and id = '<reportA_id>';
--   -- Expect: reported_by IS NULL (was already SET NULL pre-migration) AND
--   -- notes IS NULL (redacted by trg_redact_report_notes_on_profile_delete,
--   -- migration 014/025 — confirms the trigger and the FK SET NULL compose
--   -- correctly: link severed + free text redacted = fully anonymised report)
-- ─────────────────────────────────────────────────────────────────────────────
