-- ============================================================
-- Migration 011: Add moderation tracking fields to reviews
-- ============================================================
--
-- WHAT THIS DOES
-- --------------
-- Adds three columns to the reviews table that are needed for the admin
-- moderation workflow and for GDPR Art.15 transparency to users:
--
--   moderation_notes  — free-text note set by an admin when rejecting a
--                       review. Shown to the user on their "My Reviews"
--                       screen so they understand why their review was not
--                       approved. Required by GDPR Art.13 (transparency).
--
--   moderated_by      — UUID of the admin who made the moderation decision.
--                       Required for the GDPR Art.5(2) accountability audit
--                       trail and to support internal dispute resolution.
--
--   moderated_at      — Timestamp of the moderation decision. Required for
--                       SLA tracking and for the audit log.
--
-- WHY NOT IN MIGRATION 001
-- ------------------------
-- These columns were not in the initial schema because the admin moderation
-- UI was built in a later phase. Adding them now as a separate migration
-- (rather than modifying 001) preserves the migration history and keeps
-- each migration atomic and focused.
--
-- RLS IMPACT
-- ----------
-- The admin UPDATE policy "Admins can update any review" was created in
-- migration 001 with FOR UPDATE USING (is_admin()). That policy already
-- allows admins to set any column on any review row — including these three
-- new columns — so no policy changes are needed here.
--
-- Users' "Users can edit own reviews" policy (migration 009) only allows
-- updates while moderation_status = 'pending' AND the updated row is still
-- 'pending'. Because moderation_notes/moderated_by/moderated_at are only
-- set when status transitions to 'approved' or 'rejected', a regular user
-- can NEVER write to these columns in practice.
--
-- IDEMPOTENCY
-- -----------
-- ADD COLUMN IF NOT EXISTS means this migration is safe to re-run.
-- ============================================================

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS moderation_notes text,
  ADD COLUMN IF NOT EXISTS moderated_by     uuid references profiles(id),
  ADD COLUMN IF NOT EXISTS moderated_at     timestamptz;

-- Index to speed up the admin moderation queue query (pending reviews,
-- oldest first). The existing index covers (venue_id, moderation_status);
-- this one supports the cross-venue admin view.
CREATE INDEX IF NOT EXISTS reviews_admin_queue_idx
  ON reviews (moderation_status, created_at)
  WHERE moderation_status = 'pending';
