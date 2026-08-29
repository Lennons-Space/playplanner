// =============================================================================
// scripts/enrich/discovery/spatialPrefilterPolicy.ts
//
// Enrichment 2.1 — Phase D: pure TypeScript mirror of the bounds/clamping
// logic in migration 060's `enrichment_nearby_venues_for_dedupe` RPC.
//
// PARITY NOTE (read this before changing either side — same convention as
// migration 050's confidence-threshold parity with lib/facilities/confidence.ts):
// the radius/limit clamps here MUST stay in lockstep with the
// `LEAST(GREATEST(...))` expressions in
// supabase/migrations_drafts/060_enrichment_2_1.sql's
// `enrichment_nearby_venues_for_dedupe`
// function body. If you change a bound here, change it there too.
//
// WHY THIS FILE EXISTS: this repo's pinned `@electric-sql/pglite@0.5.3` does
// not bundle a PostGIS contrib module (verified: `ls
// node_modules/@electric-sql/pglite/dist/contrib` lists 40+ extensions, no
// postgis) — the spatial RPC itself cannot be loaded or behaviourally tested
// in-sandbox at all (`CREATE FUNCTION` referencing `geography`/`ST_Point`/
// `ST_DWithin` fails immediately without the extension). This file is the
// only part of that RPC's design that CAN be verified here; the rest needs a
// real Postgres+PostGIS instance — see
// supabase/tests/060_enrichment_2_1_staging_checklist.sql, written to be run
// by Liam against a real dev/staging database, not executed by this build.
//
// No I/O, deterministic, no '@/' path alias.
// =============================================================================

/** Mirrors `LEAST(GREATEST(p_radius_m, 0), 5000)` — identity-appropriate radius, never consumer-search-wide. */
export const MAX_DEDUPE_RADIUS_M = 5000;
export const MIN_DEDUPE_RADIUS_M = 0;
export const DEFAULT_DEDUPE_RADIUS_M = 1500;

/** Mirrors `LEAST(GREATEST(p_limit, 1), 100)` — hard result cap, independent of radius. */
export const MAX_DEDUPE_RESULT_LIMIT = 100;
export const MIN_DEDUPE_RESULT_LIMIT = 1;
export const DEFAULT_DEDUPE_RESULT_LIMIT = 50;

export function clampDedupeRadiusM(radiusM: number): number {
  return Math.min(Math.max(radiusM, MIN_DEDUPE_RADIUS_M), MAX_DEDUPE_RADIUS_M);
}

export function clampDedupeResultLimit(limit: number): number {
  return Math.min(Math.max(limit, MIN_DEDUPE_RESULT_LIMIT), MAX_DEDUPE_RESULT_LIMIT);
}

/** Mirrors the RPC's `p_lat`/`p_lng` range guard — same bounds as get_nearby_venues (002/045). */
export function isValidLatLng(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat === null || lat === undefined || lat < -90 || lat > 90) return false;
  if (lng === null || lng === undefined || lng < -180 || lng > 180) return false;
  return true;
}
