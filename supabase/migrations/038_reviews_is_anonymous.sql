-- Migration 038: Add is_anonymous column to reviews
--
-- Privacy purpose:
--   Parents can choose to post a review without their display name being shown.
--   The "Post anonymously" toggle in ReviewForm writes this flag at submission
--   time. ReviewCard reads it at render time and shows "Anonymous parent" in
--   place of the reviewer's username / full_name when the flag is true.
--
--   This fulfils the transparency promise shown in the UI (GDPR Art.5(1)(a)):
--   the user is told their name will be hidden, so we must persist and honour
--   that choice — failing to do so is both a false privacy promise and a GDPR
--   transparency violation.
--
-- Safety:
--   DEFAULT false means all existing rows remain non-anonymous — no retroactive
--   change of any reviewer's stated preference.
--
--   NOT NULL ensures the column is always well-defined; no NULL ambiguity in
--   display logic (NULL ≠ false in SQL boolean comparisons).
--
--   ADD COLUMN IF NOT EXISTS makes the migration idempotent — safe to re-run
--   in CI or after a partial deployment.

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN reviews.is_anonymous IS
  'Set true when the reviewer chose the "Post anonymously" option. '
  'When true, the display layer must show "Anonymous parent" and must not '
  'render the reviewer''s username, full_name, or avatar. '
  'DEFAULT false preserves the display name for all existing reviews.';
