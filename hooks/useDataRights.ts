/**
 * useDataRights — GDPR data-rights hooks and helpers.
 *
 * GDPR Art.15 (right of access): buildDataExport assembles a full copy of the
 *   user's personal data into a portable JSON file.
 *
 * GDPR Art.17 (right to erasure): useDeleteReview lets users permanently
 *   remove individual reviews they have authored.
 *
 * GDPR Art.5(2) (accountability): writeAuditLog is called only after ALL
 *   export queries succeed so we never record a partial export as complete.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { writeAuditLog } from '@/services/audit/gdprAuditLog';

// ---------------------------------------------------------------------------
// useMyReviews
// ---------------------------------------------------------------------------

/**
 * Returns all reviews written by the given user, most recent first.
 * Joins the venue name and city for display in the UI.
 */
export function useMyReviews(userId: string | undefined) {
  return useQuery({
    queryKey: ['reviews', 'mine', userId],
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reviews')
        .select('id, venue_id, rating, title, body, moderation_status, created_at, venues(name, city)')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
  });
}

// ---------------------------------------------------------------------------
// useDeleteReview
// ---------------------------------------------------------------------------

/**
 * Deletes a single review belonging to the authenticated user.
 * On success, invalidates the "my reviews" query so the list refreshes.
 * On error, does NOT invalidate — the list already reflects the real state.
 */
export function useDeleteReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ reviewId }: { reviewId: string; userId: string }) => {
      const { error } = await supabase
        .from('reviews')
        .delete()
        .eq('id', reviewId);

      if (error) throw error;
    },

    onSuccess: (_data, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['reviews', 'mine', userId] });
    },
    // onError intentionally absent — do not invalidate on failure
  });
}

// ---------------------------------------------------------------------------
// useMyVenues
// ---------------------------------------------------------------------------

/**
 * Returns all venues submitted by the given user, most recent first.
 */
export function useMyVenues(userId: string | undefined) {
  return useQuery({
    queryKey: ['venues', 'mine', userId],
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venues')
        .select('id, name, city, postcode, moderation_status, created_at')
        .eq('submitted_by', userId!)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
  });
}

// ---------------------------------------------------------------------------
// buildDataExport
// ---------------------------------------------------------------------------

/**
 * Assembles a portable JSON export of all personal data for the given user.
 *
 * GDPR Art.15: the user is entitled to a copy of all data held about them.
 * GDPR Art.5(2): we record the export action in the audit log, but ONLY after
 *   all queries succeed so we never mis-report a partial export.
 *
 * Excluded fields (must never appear in the output):
 *   id columns, stripe_customer_id, avatar_url, ip_hash, record_id, performed_by
 *
 * The profile DB column children_ages is mapped to children_age_groups in the
 * export to use plain language that doesn't reveal internal schema names.
 */
export async function buildDataExport(userId: string): Promise<string> {
  // --- 1. Profile ---
  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('username, full_name, bio, postcode, children_ages, show_in_search, show_reviews_publicly, marketing_consent, terms_accepted_at, created_at')
    .eq('id', userId)
    .single();

  if (profileError) throw profileError;

  // --- 2. Reviews ---
  const { data: reviewsData, error: reviewsError } = await supabase
    .from('reviews')
    .select('rating, title, body, visit_date, moderation_status, created_at, venues(name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (reviewsError) throw reviewsError;

  // --- 3. Favourites ---
  const { data: favouritesData, error: favouritesError } = await supabase
    .from('favourites')
    .select('list_name, created_at, venues(name)')
    .eq('user_id', userId);

  if (favouritesError) throw favouritesError;

  // --- 4. Submitted venues ---
  const { data: venuesData, error: venuesError } = await supabase
    .from('venues')
    .select('name, city, postcode, moderation_status, created_at')
    .eq('submitted_by', userId);

  if (venuesError) throw venuesError;

  // --- 5. Location consent log ---
  const { data: consentData, error: consentError } = await supabase
    .from('location_consent_log')
    .select('consented_at, consent_withdrawn_at, consent_version')
    .eq('user_id', userId);

  if (consentError) throw consentError;

  // --- 6. GDPR audit log ---
  const { data: auditData, error: auditError } = await supabase
    .from('gdpr_audit_log')
    .select('action, created_at')
    .eq('user_id', userId);

  if (auditError) throw auditError;

  // All queries succeeded — now record the export action.
  await writeAuditLog(userId, 'data_export_requested');

  // Build the bundle, applying field renames and exclusions.
  const bundle = {
    exported_at:    new Date().toISOString(),
    export_version: '1.0',

    profile: {
      username:            profileData?.username            ?? null,
      full_name:           profileData?.full_name           ?? null,
      bio:                 profileData?.bio                 ?? null,
      postcode:            profileData?.postcode            ?? null,
      // DB column is children_ages — export uses children_age_groups (plain language)
      children_age_groups: (profileData as any)?.children_ages ?? [],
      show_in_search:      profileData?.show_in_search      ?? false,
      show_reviews_publicly: profileData?.show_reviews_publicly ?? true,
      marketing_consent:   profileData?.marketing_consent   ?? false,
      terms_accepted_at:   profileData?.terms_accepted_at   ?? null,
      created_at:          profileData?.created_at          ?? null,
    },

    reviews: (reviewsData ?? []).map((r: any) => ({
      venue_name:        r.venues?.name       ?? null,
      rating:            r.rating,
      title:             r.title              ?? null,
      body:              r.body,
      visit_date:        r.visit_date         ?? null,
      moderation_status: r.moderation_status,
      created_at:        r.created_at,
    })),

    favourites: (favouritesData ?? []).map((f: any) => ({
      venue_name: f.venues?.name ?? null,
      list_name:  f.list_name,
      saved_at:   f.created_at,   // rename created_at → saved_at
    })),

    submitted_venues: (venuesData ?? []).map((v: any) => ({
      name:              v.name,
      city:              v.city,
      postcode:          v.postcode,
      moderation_status: v.moderation_status,
      submitted_at:      v.created_at,   // rename created_at → submitted_at
    })),

    location_consent_history: (consentData ?? []).map((c: any) => ({
      consented_at:          c.consented_at,
      consent_withdrawn_at:  c.consent_withdrawn_at ?? null,
      consent_version:       c.consent_version,
    })),

    audit_log: (auditData ?? []).map((a: any) => ({
      action:     a.action,
      created_at: a.created_at,
    })),
  };

  return JSON.stringify(bundle, null, 2);
}
