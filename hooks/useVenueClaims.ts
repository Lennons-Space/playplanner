import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { VenueClaim } from '@/types';
import { useAuthIdentity } from '@/hooks/useAuthIdentity';

export function useVenueClaimStatus(venueId: string | undefined, userId: string | undefined) {
  return useQuery({
    // userId in the key prevents cross-user cache bleed on shared devices —
    // User B must not see User A's pending claim after signing in on the same device.
    queryKey: ['venue-claim', venueId, userId],
    enabled: !!venueId && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venue_claims')
        .select('id, status, created_at')
        .eq('venue_id', venueId!)
        // Filter by the requesting user's own claims only.
        // Without this, a pending claim from another user would hide the
        // "Claim this venue" button for everyone else AND expose their claim ID.
        .eq('user_id', userId!)
        .in('status', ['pending', 'approved'])
        .maybeSingle();
      if (error) throw error;
      return data as Pick<VenueClaim, 'id' | 'status' | 'created_at'> | null;
    },
    // Claim status changes only when an admin processes the claim — infrequent.
    // 5 minutes prevents a refetch on every venue-detail navigation.
    // useReviewClaim.onSuccess invalidates this key explicitly when status changes.
    staleTime: 5 * 60_000,
  });
}

export function useMyVenueClaims(userId: string | undefined) {
  return useQuery({
    queryKey: ['venue-claims', 'mine', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venue_claims')
        .select('id, venue_id, status, created_at, admin_notes')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false })
        .limit(50); // prevent unbounded growth for prolific submitters
      if (error) throw error;
      return (data ?? []) as Pick<VenueClaim, 'id' | 'venue_id' | 'status' | 'created_at' | 'admin_notes'>[];
    },
  });
}

/**
 * The app-facing shape of one admin-queue claim row.
 *
 * This is the ONLY shape `useAdminVenueClaims` ever returns, and it is identical
 * whichever backend schema is present. It carries `phone_last4` and has no
 * member capable of holding a recoverable full phone number.
 */
export interface AdminVenueClaimRow {
  id: string;
  venue_id: string;
  user_id: string;
  phone_last4: string | null;
  status: VenueClaim['status'];
  notes: string | null;
  created_at: string;
  venue: { id: string; name: string; address_line1: string | null; city: string } | null;
  claimant: { id: string; username: string | null; full_name: string | null } | null;
}

/**
 * Derive the display-safe last four digits from a legacy full phone number.
 *
 * Deliberately defined edge behaviour: anything that is not a string, or that
 * contains fewer than four digits, yields `null` rather than a partial value.
 * Returning "the last 2 digits of a 2-digit value" would just be the whole
 * value again, so a short/malformed input fails closed.
 */
export function derivePhoneLast4(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * True only for the exact condition that proves the server is still on the
 * pre-minimisation schema: `phone_last4` does not exist there yet.
 *
 * Two codes can carry that meaning, and nothing else may:
 *   - `42703`   PostgreSQL `undefined_column`, forwarded verbatim by PostgREST
 *               (verified empirically: `column "phone_last4" does not exist`).
 *   - `PGRST204` PostgREST's "column not found in schema cache" variant.
 *
 * The code alone is not sufficient — the error must also NAME this column. A
 * `42703` about some other column means a genuine bug in a different query and
 * must surface, not silently downgrade us to the legacy read. Auth (`PGRST301`),
 * RLS, network and malformed-response failures all fall through to `false`.
 */
export function isMissingPhoneLast4Column(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message, details } = error as {
    code?: unknown; message?: unknown; details?: unknown;
  };
  if (code !== '42703' && code !== 'PGRST204') return false;
  const text =
    `${typeof message === 'string' ? message : ''} ` +
    `${typeof details === 'string' ? details : ''}`;
  return text.includes('phone_last4');
}

/** Admin-queue field list. The phone column is the only part that varies. */
function adminClaimSelect(phoneColumn: 'phone_last4' | 'verified_phone'): string {
  return `
          id, venue_id, user_id, ${phoneColumn}, status, notes, created_at,
          venue:venues(id, name, address_line1, city),
          claimant:profiles!venue_claims_user_id_fkey(id, username, full_name)
        `;
}

/**
 * Build the app-facing row EXPLICITLY, field by field.
 *
 * This is the privacy boundary: the raw response row is never spread and never
 * returned, so a legacy `verified_phone` has no route by which to ride along
 * into the hook's result, the React Query cache, or the admin UI. Only the
 * already-derived last-4 crosses this function.
 */
function toAdminClaimRow(row: Record<string, unknown>, phoneLast4: string | null): AdminVenueClaimRow {
  return {
    id:          row.id as string,
    venue_id:    row.venue_id as string,
    user_id:     row.user_id as string,
    phone_last4: phoneLast4,
    status:      row.status as VenueClaim['status'],
    notes:       (row.notes as string | null) ?? null,
    created_at:  row.created_at as string,
    venue:       (row.venue as AdminVenueClaimRow['venue']) ?? null,
    claimant:    (row.claimant as AdminVenueClaimRow['claimant']) ?? null,
  };
}

export function useAdminVenueClaims() {
  // Identity-scoped: this result depends on who is asking (see
  // hooks/useAuthIdentity.ts). Keeps one identity's cached rows unreachable
  // from another identity, including after sign-out.
  const identity = useAuthIdentity();

  return useQuery({
    queryKey: ['venue-claims', 'admin', identity],
    queryFn: async (): Promise<AdminVenueClaimRow[]> => {
      // 2026-09-01 privacy remediation: select only the minimised phone
      // representation (phone_last4) for admin-queue display — never the
      // recoverable full number. See
      // supabase/migrations_drafts/20260901120000_venue_claims_phone_minimisation.sql.
      const modern = await supabase
        .from('venue_claims')
        .select(adminClaimSelect('phone_last4'))
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(100); // cap admin queue to prevent unbounded payload at scale

      if (!modern.error) {
        return (modern.data ?? []).map((row) => {
          const r = row as unknown as Record<string, unknown>;
          return toAdminClaimRow(r, typeof r.phone_last4 === 'string' ? r.phone_last4 : null);
        });
      }

      // ── TEMPORARY SCHEMA-COMPATIBILITY FALLBACK — remove after 20260901120000 is promoted and verified ──
      //
      // 20260901120000 still lives in supabase/migrations_drafts/, so a server
      // that has not had it applied has no `phone_last4` column and PostgREST
      // rejects the select above outright. Selecting both columns in one query
      // does NOT work: the request fails on whichever column is absent.
      //
      // So: try the new schema first, and downgrade ONLY on proof that the
      // server is still on the old one. Every other failure rethrows unchanged.
      //
      // This exists to stop the admin queue breaking during the window before
      // the migration is promoted — it is NOT a reason to leave the production
      // minimisation deferred. Delete this branch, `adminClaimSelect`'s legacy
      // argument and `derivePhoneLast4` once the migration is live and verified.
      if (!isMissingPhoneLast4Column(modern.error)) throw modern.error;

      const legacy = await supabase
        .from('venue_claims')
        .select(adminClaimSelect('verified_phone'))
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(100);

      // Rethrown as-is. PostgREST errors carry no row data, so the full number
      // cannot leak through an error path.
      if (legacy.error) throw legacy.error;

      // The full value is read once, converted, and dropped on the floor: it is
      // never logged, never stored, never thrown, and never placed on the
      // returned object. `legacy.data` itself goes out of scope here.
      return (legacy.data ?? []).map((row) => {
        const r = row as unknown as Record<string, unknown>;
        return toAdminClaimRow(r, derivePhoneLast4(r.verified_phone));
      });
    },
    // Admin queues don't need real-time freshness; 30 s prevents spam refetch
    // while still reflecting new claims within a reasonable time window.
    staleTime: 30_000,
  });
}

export function useReviewClaim() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      claimId,
      venueId,
      userId,
      decision,
      adminNotes,
    }: {
      claimId: string;
      venueId: string;
      userId: string;
      decision: 'approved' | 'rejected';
      adminNotes?: string;
    }) => {
      // All three writes (claim status, venue claimed_by, profile is_business_owner)
      // run inside a single Postgres transaction via the approve_venue_claim RPC.
      // Previously three sequential client calls — if step 2 or 3 failed after step 1
      // committed, the claim was gone from the admin queue but ownership was never set.
      const { error } = await supabase.rpc('review_venue_claim', {
        p_claim_id:   claimId,
        p_decision:   decision,
        p_admin_notes: adminNotes ?? null,
      });
      if (error) {
        if (error.code === 'PGRST301' || error.message?.includes('permission')) {
          throw new Error('Admin permissions may have changed. Sign out and back in, then try again.');
        }
        throw error;
      }
    },

    onSuccess: (_data, { venueId, userId }) => {
      queryClient.invalidateQueries({ queryKey: ['venue-claims', 'admin'] });
      queryClient.invalidateQueries({ queryKey: ['venue-claim', venueId, userId] });
      queryClient.invalidateQueries({ queryKey: ['venue', venueId] });
      queryClient.invalidateQueries({ queryKey: ['venue-claims', 'mine', userId] });
    },
  });
}
