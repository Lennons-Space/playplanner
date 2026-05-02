-- Migration: 037_review_tags.sql
-- Purpose: Add tags column to reviews for parent-specific quick-pick feedback.
--
-- Why: The redesigned Write a Review flow (components/reviews/ReviewForm.tsx)
--   collects optional quick-pick tags alongside the freetext body. Tags let
--   parents signal key attributes (pram-friendly, clean-toilets, etc.) without
--   having to write them out — useful for fast reviews on a phone.
--
-- Safety:
--   * ADD COLUMN IF NOT EXISTS — idempotent, safe to re-run.
--   * Nullable — existing reviews without tags are not affected.
--
-- Privacy:
--   * Tags are limited to a predefined client-side set (TAG_LIST in ReviewForm).
--     No free-text input, so no PII can enter this column.
--   * Same RLS visibility as rating/body — no change to data exposure.

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS tags text[];

COMMENT ON COLUMN reviews.tags IS
  'Optional quick-pick parent tags (e.g. pram-friendly, clean-toilets). '
  'Null for reviews submitted before this column was added. '
  'Values are constrained client-side to TAG_LIST in ReviewForm.tsx.';
