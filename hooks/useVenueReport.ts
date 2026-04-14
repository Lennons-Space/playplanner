/**
 * useVenueReport.ts
 *
 * Provides a mutation to submit a venue data quality report.
 *
 * WHY a dedicated hook? Keeps the mutation logic, error handling, and
 * type safety in one place rather than scattered across UI components.
 * The venue screen only needs to call `reportVenue.mutate(...)`.
 */

import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/hooks/useAuth';

export type ReportReason =
  | 'permanently_closed'
  | 'wrong_info'
  | 'inappropriate_content'
  | 'duplicate'
  | 'other';

interface ReportPayload {
  venueId: string;
  reason:  ReportReason;
  notes?:  string;
}

export function useReportVenue() {
  const user = useUser();

  return useMutation({
    mutationFn: async ({ venueId, reason, notes }: ReportPayload) => {
      const { error } = await supabase.from('venue_reports').insert({
        venue_id:    venueId,
        // reported_by is nullable (allows anonymous reports if policy permits),
        // but the RLS policy requires auth.uid() = reported_by for INSERT,
        // so in practice the user must be signed in.
        reported_by: user?.id ?? null,
        reason,
        // Trim whitespace and enforce the 2000-char DB CHECK constraint on the
        // client side too, so the user sees a clean truncation rather than a
        // cryptic Postgres constraint error.
        notes: notes?.trim().slice(0, 2000) || null,
      });

      if (error) {
        // Log error code and hint only — never log venue_id or user_id
        // as those are personal data in a moderation context.
        console.error('useReportVenue error:', error.code, error.hint);
        throw new Error('Could not submit report. Please try again.');
      }
    },
  });
}
