-- Migration 029: Google rating columns on venues
-- Stores the Google Places rating and review count fetched during the photo
-- import pipeline. Used as a secondary trust signal in the UI (badge only —
-- never used for ranking or filtering without explicit user action).
--
-- Both columns are nullable — NULL means we have no Google data for this venue
-- (not that the rating is 0). The app always checks for NULL before displaying.

alter table venues
  add column if not exists google_rating       decimal(3,2) default null,
  add column if not exists google_review_count integer      default null;

comment on column venues.google_rating       is 'Google Places rating (1.0–5.0), null if unknown';
comment on column venues.google_review_count is 'Google Places user_ratings_total, null if unknown';
