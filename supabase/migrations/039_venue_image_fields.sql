-- Migration 039: Venue image metadata columns
--
-- Purpose:
--   Store enriched image URLs sourced from Wikimedia Commons (exact venue
--   matches) or pre-vetted category-level fallbacks. These supplement the
--   existing venue_photos table (user uploads) without replacing it.
--
-- Priority chain used by get_nearby_venues and app/venue/[id].tsx:
--   1. venue_photos (approved user upload)      ← highest priority, never modified
--   2. venues.image_url (Wikimedia / fallback)  ← populated by enrichment script
--   3. CategoryPlaceholder (local icon)         ← always available fallback
--
-- Reversibility:
--   All columns are nullable. To revert a venue:
--     UPDATE venues SET image_url = NULL, image_source = NULL,
--       image_attribution = NULL, image_license = NULL,
--       image_is_exact = false, image_updated_at = NULL
--     WHERE id = '...';
--
-- Safety:
--   image_source CHECK constraint limits values to known sources so stray
--   strings cannot enter the column (acts as a poor-man's enum, avoids
--   a migration to change it later compared to a real Postgres enum type).

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS image_url         text,
  ADD COLUMN IF NOT EXISTS image_source      text,
  ADD COLUMN IF NOT EXISTS image_attribution text,
  ADD COLUMN IF NOT EXISTS image_license     text,
  ADD COLUMN IF NOT EXISTS image_is_exact    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS image_updated_at  timestamptz;

-- Guard against arbitrary source strings.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'venues_image_source_check'
  ) THEN
    ALTER TABLE venues
      ADD CONSTRAINT venues_image_source_check
      CHECK (image_source IS NULL OR image_source IN ('wikimedia', 'category_fallback'));
  END IF;
END;
$$;

COMMENT ON COLUMN venues.image_url IS
  'Best available enriched image URL (Wikimedia CDN or category fallback). '
  'NULL until the enrichment script runs. The app displays user-uploaded '
  'cover photos from venue_photos in preference to this value.';

COMMENT ON COLUMN venues.image_source IS
  'Origin of image_url: ''wikimedia'' = exact venue match via Wikimedia Commons API; '
  '''category_fallback'' = generic category image when no exact match was found.';

COMMENT ON COLUMN venues.image_attribution IS
  'Required attribution string for the image, e.g. '
  '"John Smith / CC BY-SA 4.0 / Wikimedia Commons". '
  'Must be displayed when the image is shown (CC licence obligation).';

COMMENT ON COLUMN venues.image_license IS
  'Short licence identifier, e.g. ''CC BY-SA 4.0'', ''CC0 1.0''. '
  'Only CC0, CC BY, and CC BY-SA variants are accepted by the enrichment script.';

COMMENT ON COLUMN venues.image_is_exact IS
  'True when image_url was matched to this specific venue by name/city search. '
  'False when it is a generic category-level fallback image.';

COMMENT ON COLUMN venues.image_updated_at IS
  'Timestamp of the last enrichment run for this venue. '
  'Used by the script to skip recently processed rows on re-runs.';
