import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { VenueClaim } from '@/types';

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

export function useAdminVenueClaims() {
  return useQuery({
    queryKey: ['venue-claims', 'admin'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venue_claims')
        .select(`
          id, venue_id, user_id, verified_phone, status, notes, created_at,
          venue:venues(id, name, address_line1, city),
          claimant:profiles!venue_claims_user_id_fkey(id, username, full_name)
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(100); // cap admin queue to prevent unbounded payload at scale
      if (error) throw error;
      return data ?? [];
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
