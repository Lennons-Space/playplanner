DROP FUNCTION IF EXISTS get_nearby_venues(
  float, float, float, uuid[], int, int, text[], boolean, int, uuid[], boolean
);

CREATE OR REPLACE FUNCTION get_nearby_venues(
  lat              float,
  lng              float,
  p_radius_km      float      DEFAULT 32,
  category_ids     uuid[]     DEFAULT NULL,
  p_min_age        int        DEFAULT NULL,
  p_max_age        int        DEFAULT NULL,
  price_ranges     text[]     DEFAULT NULL,
  open_now         boolean    DEFAULT false,
  p_limit          int        DEFAULT 50,
  p_facility_ids   uuid[]     DEFAULT NULL,
  p_premium_only   boolean    DEFAULT false
)
RETURNS TABLE (
  id                  uuid,
  name                text,
  slug                text,
  description         text,
  category_id         uuid,
  city                text,
  postcode            text,
  latitude            float8,
  longitude           float8,
  price_range         text,
  min_age             int,
  max_age             int,
  is_premium          boolean,
  is_verified         boolean,
  review_count        int,
  average_rating      numeric,
  google_rating       numeric,
  google_review_count int,
  featured_until      timestamptz,
  has_hours           boolean,
  distance_km         float,
  cover_photo_url     text
)
LANGUAGE plpgsql STABLE
SECURITY INVOKER
AS $$
BEGIN
  IF lat IS NULL OR lat < -90 OR lat > 90 THEN
    RAISE EXCEPTION 'lat must be between -90 and 90'
      USING errcode = 'check_violation';
  END IF;
  IF lng IS NULL OR lng < -180 OR lng > 180 THEN
    RAISE EXCEPTION 'lng must be between -180 and 180'
      USING errcode = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT
    sub.id, sub.name, sub.slug, sub.description, sub.category_id,
    sub.city, sub.postcode,
    sub.latitude::float8,
    sub.longitude::float8,
    sub.price_range, sub.min_age, sub.max_age,
    sub.is_premium, sub.is_verified, sub.review_count, sub.average_rating,
    sub.google_rating, sub.google_review_count,
    sub.featured_until, sub.has_hours, sub.distance_km,
    sub.cover_photo_url
  FROM (
    SELECT
      v.id, v.name, v.slug, v.description, v.category_id,
      v.city, v.postcode, v.latitude, v.longitude,
      v.price_range, v.min_age, v.max_age,
      v.is_premium, v.is_verified, v.review_count, v.average_rating,
      v.google_rating, v.google_review_count,
      v.featured_until,

      EXISTS(
        SELECT 1 FROM opening_hours oh WHERE oh.venue_id = v.id
      ) AS has_hours,

      ROUND((
        ST_Distance(v.location, ST_Point(lng, lat)::geography) / 1000.0
      )::numeric, 2)::float AS distance_km,

      (
        SELECT vp.url
        FROM venue_photos vp
        WHERE vp.venue_id = v.id
          AND vp.status = 'approved'
        ORDER BY vp.is_cover DESC, vp.sort_order ASC
        LIMIT 1
      ) AS cover_photo_url

    FROM venues v
    WHERE
      v.is_published        = true
      AND v.moderation_status = 'approved'
      AND v.location IS NOT NULL
      AND ST_DWithin(
        v.location,
        ST_Point(lng, lat)::geography,
        LEAST(p_radius_km, 80.0) * 1000.0
      )
      AND (category_ids IS NULL OR v.category_id = ANY(category_ids))
      AND (p_min_age IS NULL OR v.max_age >= p_min_age)
      AND (p_max_age IS NULL OR v.min_age <= p_max_age)
      AND (price_ranges IS NULL OR v.price_range = ANY(price_ranges))
      AND (
        open_now = false
        OR EXISTS (
          SELECT 1 FROM opening_hours oh
          WHERE oh.venue_id    = v.id
            AND oh.day_of_week = EXTRACT(DOW FROM now() AT TIME ZONE 'Europe/London')::int
            AND oh.is_closed   = false
            AND oh.opens_at   <= (now() AT TIME ZONE 'Europe/London')::time
            AND oh.closes_at  >  (now() AT TIME ZONE 'Europe/London')::time
        )
        OR NOT EXISTS (SELECT 1 FROM opening_hours oh WHERE oh.venue_id = v.id)
      )
      AND (
        p_facility_ids IS NULL
        OR EXISTS (
          SELECT 1 FROM venue_facilities vf
          WHERE vf.venue_id = v.id AND vf.facility_id = ANY(p_facility_ids)
        )
      )
      AND (
        p_premium_only = false
        OR (v.is_premium = true AND v.featured_until IS NOT NULL AND v.featured_until > now())
      )
  ) sub
  ORDER BY
    CASE
      WHEN sub.is_premium AND sub.featured_until IS NOT NULL AND sub.featured_until > now()
      THEN 0
      ELSE 1
    END,
    sub.distance_km ASC
  LIMIT LEAST(p_limit, 200);

END;
$$;

REVOKE EXECUTE ON FUNCTION get_nearby_venues(
  float, float, float, uuid[], int, int, text[], boolean, int, uuid[], boolean
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION get_nearby_venues(
  float, float, float, uuid[], int, int, text[], boolean, int, uuid[], boolean
) TO anon, authenticated;
