/**
 * useFacilities.ts
 * React Query hooks for the Parent Contribution facility-vote feature
 * (venue-detail only — see supabase/migrations/050_parent_facility_votes.sql).
 *
 * Privacy notes:
 * - We NEVER read or expose individual votes — there is no SELECT policy on
 *   `venue_facility_votes` for any client role (by design — see migration
 *   050). Only the public aggregate (`venue_facility_stats`) is readable.
 * - Vote payloads contain nothing but a venue id, the signed-in user's own
 *   id (required by RLS — auth.uid() = user_id), a facility slug, and a
 *   boolean. None of this is logged — on error we log only error.code/.hint,
 *   matching the pattern in useReviews.ts / useVenueReport.ts.
 * - This file does not read, store, or transmit location or child data.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';
import type { FacilityConfidence } from '@/lib/facilities/confidence';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** The only three facility slugs this MVP supports — matches the DB CHECK constraint. */
export const FACILITY_SLUGS = ['toilets', 'baby-change', 'parking'] as const;
export type FacilitySlug = (typeof FACILITY_SLUGS)[number];

/** Per-facility aggregate, shaped for the chip UI. */
export interface FacilityStat {
  slug: FacilitySlug;
  confidence: FacilityConfidence;
  /** Majority verdict. null = no votes yet ("Unknown"). */
  present: boolean | null;
  total: number;
}

/** Map keyed by slug for O(1) lookups in the UI. */
export type FacilityStatsMap = Record<FacilitySlug, FacilityStat>;

function emptyStatsMap(): FacilityStatsMap {
  const map = {} as FacilityStatsMap;
  for (const slug of FACILITY_SLUGS) {
    map[slug] = { slug, confidence: 'low', present: null, total: 0 };
  }
  return map;
}

/**
 * Thrown when a signed-out user attempts to cast a facility vote. The UI
 * should catch this (by checking `error instanceof FacilityVoteAuthError` or
 * `error.name === 'FacilityVoteAuthError'`) and route to the existing sign-in
 * flow (`/(auth)/login`) rather than showing a generic failure message.
 */
export class FacilityVoteAuthError extends Error {
  constructor() {
    super('Please sign in to confirm facilities at this venue.');
    this.name = 'FacilityVoteAuthError';
  }
}

// ---------------------------------------------------------------------------
// useVenueFacilityStats
// Public aggregate read — safe for signed-out users too (RLS: USING (true)).
// ---------------------------------------------------------------------------

export function useVenueFacilityStats(venueId: string | undefined) {
  return useQuery({
    queryKey: ['venueFacilityStats', venueId],
    queryFn: async (): Promise<FacilityStatsMap> => {
      const { data, error } = await supabase
        .from('venue_facility_stats')
        .select('facility_slug, yes_count, no_count, total_votes, confidence, present')
        .eq('venue_id', venueId!)
        .in('facility_slug', FACILITY_SLUGS as unknown as string[]);

      if (error) {
        // Only safe metadata — never the query or row contents.
        console.error('useVenueFacilityStats error:', error.code, error.hint);
        throw new Error('Could not load facility info. Please try again.');
      }

      const map = emptyStatsMap();
      for (const row of data ?? []) {
        const slug = row.facility_slug as FacilitySlug;
        if (!FACILITY_SLUGS.includes(slug)) continue; // defence in depth — ignore unexpected slugs
        map[slug] = {
          slug,
          confidence: row.confidence as FacilityConfidence,
          present: row.present,
          total: row.total_votes,
        };
      }
      return map;
    },
    enabled: !!venueId,
    // Aggregates change slowly (need several new votes to move the needle).
    // 60s matches the staleTime convention used by useVenue/useVenueReviews.
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// useCastFacilityVote
// Casts (or updates) a "yes, this is here" vote for one facility.
//
// MVP scope: present is always `true` — there is no "report missing" UI yet,
// so the only vote the client can ever send is a confirmation. The DB column
// supports `false` for future phases, but this hook never sends it.
// ---------------------------------------------------------------------------

interface CastFacilityVotePayload {
  venueId: string;
  slug: FacilitySlug;
}

export function useCastFacilityVote() {
  const queryClient = useQueryClient();
  const user = useUser();

  return useMutation({
    mutationFn: async ({ venueId, slug }: CastFacilityVotePayload) => {
      // Re-assert the session at call time — it may have expired between the
      // chip rendering and the tap (token revocation, sign-out elsewhere).
      if (!user?.id) {
        throw new FacilityVoteAuthError();
      }

      const { data, error } = await supabase
        .from('venue_facility_votes')
        .upsert(
          {
            venue_id:      venueId,
            user_id:       user.id,
            facility_slug: slug,
            present:       true,
          },
          { onConflict: 'venue_id,user_id,facility_slug' },
        )
        // WHY .select('id'): without it Supabase sends Prefer: return=minimal
        // and PostgREST returns 204 regardless of whether RLS silently
        // filtered the write. Chaining .select('id') forces a representation
        // response — a zero-row result means the write was blocked, and we
        // surface a real error instead of a false "success". Same pattern as
        // useModerateReview / app/admin/moderation.tsx.
        .select('id');

      if (error) {
        console.error('useCastFacilityVote error:', error.code, error.hint);
        throw new Error('Could not save your answer. Please try again.');
      }

      if (!data || data.length === 0) {
        throw new Error('Could not save your answer — your session may have changed. Please sign in again and retry.');
      }

      return { venueId, slug };
    },

    // ---- Optimistic update -------------------------------------------------
    // Tapping a chip should feel instant. We optimistically nudge the local
    // aggregate toward "you confirmed this" before the server responds, then
    // reconcile (or roll back) once the real aggregate comes back.
    onMutate: async ({ venueId, slug }) => {
      const queryKey = ['venueFacilityStats', venueId];
      await queryClient.cancelQueries({ queryKey });

      const previous = queryClient.getQueryData<FacilityStatsMap>(queryKey);

      queryClient.setQueryData<FacilityStatsMap>(queryKey, (current) => {
        const base = current ?? emptyStatsMap();
        const existing = base[slug];
        // Reflect "you confirmed this" instantly — bump the total and mark
        // present, but do NOT recompute the confidence tier here. We only
        // know this one vote, not the prior yes/no split (the previous
        // `total` may not have been unanimous), so any locally-derived
        // confidence would be a guess. On a children's app we must never
        // flash a confidence verdict we didn't actually compute correctly —
        // keep the existing tier until the server's authoritative aggregate
        // arrives via the `onSettled` invalidation below.
        return {
          ...base,
          [slug]: {
            slug,
            confidence: existing.confidence,
            present: true,
            total: existing.total + 1,
          },
        };
      });

      return { previous, queryKey };
    },

    onError: (_err, _payload, context) => {
      // Roll back to the pre-mutation snapshot — never leave the UI showing
      // a vote that didn't actually save.
      if (context?.previous) {
        queryClient.setQueryData(context.queryKey, context.previous);
      }
    },

    onSettled: (_data, _error, { venueId }) => {
      // Always refetch the authoritative aggregate (and the venue, whose
      // `facilities` join may now include a freshly-mirrored row) regardless
      // of whether the optimistic update matched the server outcome.
      queryClient.invalidateQueries({ queryKey: ['venueFacilityStats', venueId] });
      queryClient.invalidateQueries({ queryKey: ['venue', venueId] });
    },
  });
}
