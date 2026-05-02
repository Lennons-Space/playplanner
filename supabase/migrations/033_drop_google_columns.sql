-- Drop Google Places API columns — integration removed
ALTER TABLE venues
  DROP COLUMN IF EXISTS google_rating,
  DROP COLUMN IF EXISTS google_review_count;
