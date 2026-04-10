/**
 * GDPR audit log service — GDPR Art.5(2) accountability.
 *
 * All consent and data-processing events are written through here.
 * Using one central function means we can never accidentally forget a field,
 * and it gives us one place to change if the schema evolves.
 */
import { supabase } from '@/lib/supabase';

export type AuditAction =
  | 'terms_accepted'
  | 'location_consent_granted'
  | 'location_consent_withdrawn'
  | 'account_deleted'
  | 'data_export_requested';

/**
 * Write a single entry to the GDPR audit log.
 *
 * @param userId   - The Supabase user ID of the person taking the action.
 * @param action   - What happened (must be one of the AuditAction values above).
 * @param tableNameParam  - Optional: which table was affected (e.g. 'profiles').
 * @param recordId - Optional: the ID of the specific row that was affected.
 */
export async function writeAuditLog(
  userId: string,
  action: AuditAction,
  tableNameParam?: string,
  recordId?: string,
): Promise<void> {
  await supabase.from('gdpr_audit_log').insert({
    user_id:      userId,
    action,
    table_name:   tableNameParam,
    record_id:    recordId,
    performed_by: userId,
  });
}
