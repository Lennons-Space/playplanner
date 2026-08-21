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
import { logDbError } from '@/lib/dbError';

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
        .select('id, venue_id, rating, title, body, is_anonymous, moderation_status, moderation_notes, created_at, venues(name, city)')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false });

      // Classify before rethrowing: a 42501 here means an RLS policy on
      // `reviews` is reading a profiles column this role cannot select, which
      // is NOT the "check your connection" problem the UI reports by default.
      if (error) { logDbError('useMyReviews', error); throw error; }
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
    mutationFn: async ({ reviewId, userId }: { reviewId: string; userId: string }) => {
      const { error } = await supabase
        .from('reviews')
        .delete()
        .eq('id', reviewId)
        .eq('user_id', userId);

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

      if (error) { logDbError('useMyVenues', error); throw error; }
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
 * The PROFILE section is complete with respect to the profiles table: it
 * carries every column that table holds about the user, sourced from
 * get_my_profile_export() (migration 064). That includes subscription state
 * and stripe_customer_id — those are data held about the user, so they belong
 * in the user's own copy of it, even though get_my_profile() deliberately keeps
 * them out of ordinary app state.
 *
 * Excluded from OTHER sections (deliberate, unchanged): ip_hash, record_id and
 * performed_by from the audit log — internal integrity/attribution fields
 * rather than profile data.
 *
 * The profile DB column children_ages is mapped to children_age_groups in the
 * export to use plain language that doesn't reveal internal schema names.
 */
/**
 * Every column `get_my_profile_export()` returns — i.e. every column of the
 * caller's own profiles row. Kept in step with the SQL function's explicit
 * return list; the DB test asserts that list covers the whole table, so a
 * column added later cannot silently vanish from exports.
 */
type ExportableProfile = {
  id:                      string;
  username:                string | null;
  full_name:               string | null;
  avatar_url:              string | null;
  bio:                     string | null;
  is_business_owner:       boolean;
  is_admin:                boolean;
  subscription_tier:       string | null;
  subscription_expires_at: string | null;
  stripe_customer_id:      string | null;
  children_ages:           string[] | null;
  marketing_consent:       boolean;
  terms_accepted_at:       string | null;
  created_at:              string | null;
  updated_at:              string | null;
  postcode:                string | null;
  show_in_search:          boolean;
  show_reviews_publicly:   boolean;
};

export async function buildDataExport(userId: string): Promise<string> {
  // --- 0. Bind the export to the LIVE session identity ---
  //
  // Every section below filters on a user id, and until now that id came only
  // from the caller (the screen reads it out of the Zustand store). If the
  // store and the actual session ever disagree — an account switch on a shared
  // device, a session that outlived a failed sign-out — the profile section
  // (resolved from auth.uid() server-side by the RPC) and the reviews /
  // favourites / venues sections (filtered by the passed id) would describe two
  // DIFFERENT people in one file. RLS means no other user's rows can actually
  // be read, so the failure mode is a wrong-but-empty export rather than a data
  // leak; even so, an Art.15 response must be provably about one data subject.
  //
  // So: resolve the identity from the session, refuse if it disagrees with the
  // caller, and use the session id for every query below.
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) { logDbError('buildDataExport:session', sessionError); throw sessionError; }

  const sessionUserId = sessionData?.session?.user?.id ?? null;
  if (!sessionUserId) {
    throw new Error('Your session has expired. Please sign in again to download your data.');
  }
  if (sessionUserId !== userId) {
    // Never echo either id — they are personal identifiers.
    throw new Error('Your account changed while preparing this download. Please try again.');
  }

  // --- 1. Profile ---
  // Migration 065 removes column-level SELECT on the privileged profile columns
  // from the `authenticated` role (that is what stops one user reading
  // another's children's ages, postcode and billing state), so the caller's own
  // row comes from a SECURITY DEFINER RPC added in 064.
  // This path uses get_my_profile_export(), NOT get_my_profile(): the export is
  // the user's own copy of their data and must be complete, whereas
  // get_my_profile() is trimmed to what the running app needs.
  // The RPC takes no argument — it resolves auth.uid() server-side, so `userId`
  // cannot influence whose data is returned and no other user's export can be
  // requested.
  const { data: profileRow, error: profileError } = await supabase
    .rpc('get_my_profile_export')
    .single();

  if (profileError) { logDbError('buildDataExport:profile', profileError); throw profileError; }

  // The Supabase client is not generated-type aware, so an RPC result is `{}`.
  // `ExportableProfile` names exactly the columns get_my_profile_export()
  // returns — every column of the caller's own profiles row, stripe_customer_id
  // INCLUDED. That identifier is data held about the user, so GDPR Art.15
  // requires it in their own copy; it is get_my_profile() (ordinary app state)
  // that deliberately omits it. See migration 064.
  const profileData = profileRow as ExportableProfile | null;

  // The RPC resolves auth.uid() server-side and takes no argument, so this
  // compares what the DATABASE thinks the caller is against what the client
  // thinks. A mismatch means the two disagree and the bundle must not be built.
  if (profileData && profileData.id !== sessionUserId) {
    throw new Error('Your account changed while preparing this download. Please try again.');
  }

  // --- 2. Reviews ---
  const { data: reviewsData, error: reviewsError } = await supabase
    .from('reviews')
    .select('rating, title, body, is_anonymous, visit_date, moderation_status, created_at, venues(name)')
    .eq('user_id', sessionUserId)
    .order('created_at', { ascending: false });

  if (reviewsError) { logDbError('buildDataExport:reviews', reviewsError); throw reviewsError; }

  // --- 3. Favourites ---
  const { data: favouritesData, error: favouritesError } = await supabase
    .from('favourites')
    .select('list_name, created_at, venues(name)')
    .eq('user_id', sessionUserId);

  if (favouritesError) { logDbError('buildDataExport:favourites', favouritesError); throw favouritesError; }

  // --- 4. Submitted venues ---
  const { data: venuesData, error: venuesError } = await supabase
    .from('venues')
    .select('name, city, postcode, moderation_status, created_at')
    .eq('submitted_by', sessionUserId);

  if (venuesError) { logDbError('buildDataExport:venues', venuesError); throw venuesError; }

  // --- 5. Location consent log ---
  const { data: consentData, error: consentError } = await supabase
    .from('location_consent_log')
    .select('consented_at, consent_withdrawn_at, consent_version')
    .eq('user_id', sessionUserId);

  if (consentError) { logDbError('buildDataExport:location_consent_log', consentError); throw consentError; }

  // --- 6. GDPR audit log ---
  const { data: auditData, error: auditError } = await supabase
    .from('gdpr_audit_log')
    .select('action, created_at')
    .eq('user_id', sessionUserId);

  if (auditError) { logDbError('buildDataExport:gdpr_audit_log', auditError); throw auditError; }

  // All queries succeeded — now record the export action.
  await writeAuditLog(sessionUserId, 'data_export_requested');

  // Build the bundle, applying field renames and exclusions.
  const bundle = {
    exported_at:    new Date().toISOString(),
    export_version: '1.0',

    profile: {
      account_id:          profileData?.id                  ?? null,
      username:            profileData?.username            ?? null,
      full_name:           profileData?.full_name           ?? null,
      avatar_url:          profileData?.avatar_url          ?? null,
      bio:                 profileData?.bio                 ?? null,
      postcode:            profileData?.postcode            ?? null,
      // DB column is children_ages — export uses children_age_groups (plain language)
      children_age_groups: profileData?.children_ages ?? [],
      show_in_search:      profileData?.show_in_search      ?? false,
      show_reviews_publicly: profileData?.show_reviews_publicly ?? true,
      marketing_consent:   profileData?.marketing_consent   ?? false,
      terms_accepted_at:   profileData?.terms_accepted_at   ?? null,
      is_business_owner:   profileData?.is_business_owner   ?? false,
      is_admin:            profileData?.is_admin            ?? false,
      // Subscription and billing identifiers are data held about the user, so
      // they belong in the user's own copy. They are NOT in get_my_profile()
      // and therefore never enter ordinary client state.
      subscription_tier:       profileData?.subscription_tier       ?? null,
      subscription_expires_at: profileData?.subscription_expires_at ?? null,
      stripe_customer_id:      profileData?.stripe_customer_id      ?? null,
      created_at:          profileData?.created_at          ?? null,
      updated_at:          profileData?.updated_at          ?? null,
    },

    reviews: (reviewsData ?? []).map((r: any) => ({
      venue_name:        r.venues?.name       ?? null,
      rating:            r.rating,
      title:             r.title              ?? null,
      body:              r.body,
      is_anonymous:      r.is_anonymous       ?? false,
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
