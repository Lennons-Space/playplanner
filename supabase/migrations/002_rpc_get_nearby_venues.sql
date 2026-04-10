-- ============================================================
-- RPC: get_nearby_venues
-- Called from hooks/useVenues.ts → useNearbyVenues()
-- Returns venues within p_radius_km of a lat/lng point,
-- with optional filters, distance_km, and has_hours flag attached.
--
-- Security: SECURITY INVOKER — the function runs as the calling role
-- (anon or authenticated). RLS on the venues table is the primary
-- access-control layer:
--   • anon role  → "Approved venues are public" policy applies
--                  (is_published = true AND moderation_status = 'approved')
--   • authenticated → same policy + "Owners can view own venues" policy
-- The WHERE clause duplicates the published/approved conditions for
-- query-planner performance, but RLS remains the authoritative guard.
-- If a WHERE clause bug is ever introduced, RLS prevents the leak.
-- Using SECURITY DEFINER here would bypass RLS and remove that safety net.
--
-- DPIA note (UK GDPR Art.5 / ICO Children's Code Standard 10):
--   This function returns venue coordinates (public business addresses).
--   It does NOT return or log the caller's location. The caller's lat/lng
--   are used only as query parameters and are never written to any table.
--   Rate limiting must be enforced at the application/API-gateway layer.
-- ============================================================

create or replace function get_nearby_venues(
  lat              float,
  lng              float,
  p_radius_km      float      default 10,
  category_ids     uuid[]     default null,
  p_min_age        int        default null,   -- renamed from min_age: avoids shadowing venues.min_age
  p_max_age        int        default null,   -- renamed from max_age: avoids shadowing venues.max_age
  price_ranges     text[]     default null,
  open_now         boolean    default false,
  p_limit          int        default 50      -- configurable; hard-capped at 200 below
)
returns table (
  id              uuid,
  name            text,
  slug            text,
  description     text,
  category_id     uuid,
  city            text,
  postcode        text,
  latitude        numeric,   -- schema stores decimal(9,6); numeric preserves exact precision
  longitude       numeric,
  price_range     text,
  min_age         int,
  max_age         int,
  is_premium      boolean,
  is_verified     boolean,
  review_count    int,
  average_rating  numeric,
  featured_until  timestamptz,
  has_hours       boolean,   -- true = venue has opening_hours rows; false = hours unknown
  distance_km     float
)
language plpgsql stable
security invoker
as $$
begin
  -- -------------------------------------------------------
  -- Input validation: intercept bad coordinates before
  -- PostGIS sees them. PostGIS raises internal error messages
  -- for out-of-range values that would expose implementation
  -- details to the caller — we raise a clean error first.
  -- NULL inputs are also caught here; they would otherwise
  -- cause st_dwithin to silently return zero rows.
  -- -------------------------------------------------------
  if lat is null or lat < -90 or lat > 90 then
    raise exception 'lat must be between -90 and 90'
      using errcode = 'check_violation';
  end if;
  if lng is null or lng < -180 or lng > 180 then
    raise exception 'lng must be between -180 and 180'
      using errcode = 'check_violation';
  end if;

  return query
  -- Outer SELECT lets ORDER BY reference the distance_km alias
  -- safely, regardless of query-planner inlining across Postgres versions.
  select
    sub.id,
    sub.name,
    sub.slug,
    sub.description,
    sub.category_id,
    sub.city,
    sub.postcode,
    sub.latitude,
    sub.longitude,
    sub.price_range,
    sub.min_age,
    sub.max_age,
    sub.is_premium,
    sub.is_verified,
    sub.review_count,
    sub.average_rating,
    sub.featured_until,
    sub.has_hours,
    sub.distance_km
  from (
    select
      v.id,
      v.name,
      v.slug,
      v.description,
      v.category_id,
      v.city,
      v.postcode,
      v.latitude,
      v.longitude,
      v.price_range,
      v.min_age,
      v.max_age,
      v.is_premium,
      v.is_verified,
      v.review_count,
      v.average_rating,
      v.featured_until,

      -- has_hours: tells the app whether opening hours exist for this venue.
      -- When false and the caller used open_now = true, the UI should show
      -- "Hours not confirmed" rather than presenting the venue as confirmed open.
      exists(
        select 1 from opening_hours oh where oh.venue_id = v.id
      ) as has_hours,

      -- Distance in km, rounded to 2 decimal places.
      -- Uses the same least()-capped radius as the WHERE clause.
      round((
        st_distance(
          v.location,
          st_point(lng, lat)::geography
        ) / 1000.0
      )::numeric, 2)::float as distance_km

    from venues v
    where
      -- RLS enforces this for all callers, but repeating it here lets the
      -- query planner use the moderation index (venues_moderation_idx) efficiently.
      v.is_published        = true
      and v.moderation_status = 'approved'

      -- Guard against rows where the location trigger did not fire
      -- (e.g. rows loaded via direct SQL, pg_restore, or bulk import).
      and v.location is not null

      -- Spatial filter: radius is hard-capped at 50 km to prevent
      -- full-table scans and denial-of-service via extreme radius values.
      and st_dwithin(
        v.location,
        st_point(lng, lat)::geography,
        least(p_radius_km, 50.0) * 1000.0
      )

      -- Category filter (null = all categories)
      and (category_ids is null or v.category_id = any(category_ids))

      -- Age range filter.
      -- p_min_age: "I want venues for a child at least this age"
      --   → include venue if venue.max_age >= p_min_age
      -- p_max_age: "I want venues for a child at most this age"
      --   → include venue if venue.min_age <= p_max_age
      and (p_min_age is null or v.max_age >= p_min_age)
      and (p_max_age is null or v.min_age <= p_max_age)

      -- Price range filter (null = all price ranges).
      -- Uses Postgres parameterised array — no SQL injection possible.
      and (price_ranges is null or v.price_range = any(price_ranges))

      -- Open-now filter.
      -- Uses 'Europe/London' explicitly so the filter is correct during
      -- British Summer Time (BST = UTC+1, late March–late October).
      -- Using localtime or now() without a timezone would be wrong by
      -- 1 hour for ~7 months of the year, breaking real-time venue lookup.
      --
      -- Three conditions (OR'd):
      --   1. open_now = false         → filter is off, include all venues
      --   2. Has a matching open row  → confirmed open right now
      --   3. Has no hours rows at all → hours unknown; include so newly-added
      --      venues don't vanish from the map (UI shows "Hours not confirmed")
      and (
        open_now = false
        or exists (
          select 1
          from opening_hours oh
          where oh.venue_id    = v.id
            and oh.day_of_week = extract(
                                   dow from now() at time zone 'Europe/London'
                                 )::int
            and oh.is_closed   = false
            and oh.opens_at   <= (now() at time zone 'Europe/London')::time
            and oh.closes_at  >  (now() at time zone 'Europe/London')::time
        )
        or not exists (
          select 1 from opening_hours oh where oh.venue_id = v.id
        )
      )
  ) sub
  order by
    -- Premium venues float to the top ONLY when featured_until is set and
    -- has not expired. NULL featured_until is treated as NOT featured
    -- (not as "featured indefinitely") to prevent a webhook failure or admin
    -- error from granting free permanent premium placement.
    -- For lifetime premium listings, use a sentinel far-future date
    -- (e.g. '9999-12-31') rather than leaving featured_until as NULL.
    case
      when sub.is_premium
       and sub.featured_until is not null
       and sub.featured_until > now()
      then 0
      else 1
    end,
    sub.distance_km asc
  -- p_limit is capped at 200 to limit response payload size and
  -- prevent rapid enumeration of the venue database by bots.
  limit least(p_limit, 200);

end;
$$;

-- Revoke the automatic PUBLIC execute grant that Postgres assigns to every
-- newly created function. Then re-grant only to the two roles PostgREST uses,
-- preventing unexpected callers (future internal roles, extensions, proxy users)
-- from executing this function.
revoke execute on function get_nearby_venues(
  float, float, float, uuid[], int, int, text[], boolean, int
) from public;

grant execute on function get_nearby_venues(
  float, float, float, uuid[], int, int, text[], boolean, int
) to anon, authenticated;
