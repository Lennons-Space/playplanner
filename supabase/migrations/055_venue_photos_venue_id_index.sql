-- Migration 055: index venue_photos(venue_id) to fix get_nearby_venues timeout
--
-- PROBLEM (diagnosed 2026-06-19):
--   The anon `get_nearby_venues` RPC was timing out (Postgres 57014, statement
--   timeout) on the live data path — the "venues nearby" journey silently
--   returned nothing.
--
-- ROOT CAUSE:
--   get_nearby_venues computes `cover_photo_url` for EVERY venue inside the
--   search radius *before* the ORDER BY distance / LIMIT is applied. That
--   cover-photo value comes from a correlated subquery:
--       SELECT vp.url FROM venue_photos vp
--       WHERE vp.venue_id = v.id AND vp.status = 'approved'
--       ORDER BY vp.is_cover DESC, vp.sort_order ASC LIMIT 1
--   There was NO index on venue_photos(venue_id) (the only index was on
--   (status, created_at)), so each candidate venue triggered a FULL sequential
--   scan of all venue_photos rows. For a dense area (~900 venues in a 10km
--   London radius) that is ~900 full table scans → ~1.2s warm, and cold it
--   exceeds the short anon statement timeout.
--
-- FIX:
--   A partial, covering index keyed on venue_id and ordered to match the
--   subquery's ORDER BY. Limited to status = 'approved' (the only status the
--   subquery ever reads) so it stays small. This turns each per-venue lookup
--   into a single index probe — most venues have no approved photo, so the
--   probe returns immediately.
--
-- SAFETY:
--   - Purely additive: no data, RLS, grant, or function-logic change.
--   - Fully reversible (DROP INDEX venue_photos_venue_id_approved_idx).
--   - No venue can appear/disappear as a result; identical rows returned, faster.

CREATE INDEX IF NOT EXISTS venue_photos_venue_id_approved_idx
  ON public.venue_photos (venue_id, is_cover DESC, sort_order ASC)
  WHERE status = 'approved';
