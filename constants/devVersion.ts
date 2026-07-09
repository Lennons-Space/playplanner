/**
 * Dev-only version tag — bumped MANUALLY each design iteration so it's
 * obvious on-device exactly which build/iteration is being viewed, and to
 * avoid stale-bundle confusion after a reload.
 *
 * Single source of truth: bump this string, nothing else. Never read in
 * production — every render site MUST gate on `__DEV__` (see
 * components/ui/DevVersionBadge.tsx). Contains no personal, location or
 * otherwise sensitive data — safe to leave in source control.
 */
export const DEV_VERSION = 'v2';
