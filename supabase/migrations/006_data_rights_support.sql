-- Migration 006: Data rights support
-- Adds INSERT policy on gdpr_audit_log so the client-side writeAuditLog()
-- service can record GDPR Art.15 data export requests and consent events.
-- Without this policy, all audit writes from the app fail silently, which
-- breaks the legal accountability requirement under GDPR Art.5(2).

CREATE POLICY "Users can log own audit events" ON gdpr_audit_log
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND auth.uid() = performed_by
    AND action IN (
      'data_export_requested',
      'location_consent_granted',
      'location_consent_withdrawn'
    )
  );
