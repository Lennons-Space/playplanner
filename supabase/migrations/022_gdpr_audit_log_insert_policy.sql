-- MED-03: Allow authenticated users to write their own GDPR audit records.
-- Without an INSERT policy, RLS silently blocks every writeAuditLog() call from the client JWT.
create policy "Users can log own gdpr events" on gdpr_audit_log
  for insert
  with check (
    auth.uid() = user_id
    and auth.uid() = performed_by
  );
