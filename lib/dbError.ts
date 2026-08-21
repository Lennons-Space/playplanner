/**
 * dbError.ts — privacy-safe diagnostics for Supabase/PostgREST failures.
 *
 * WHY THIS EXISTS
 * ---------------
 * After migration 065 tightened the profile read boundary, three screens began
 * showing generic "please try again" messages on a real device. The underlying
 * failure was a hard `42501 permission denied` raised while evaluating an RLS
 * policy — but every call site either swallowed the error entirely
 * (`catch { setError(true) }`) or logged only `code`/`hint`, so a *permission*
 * failure was indistinguishable from a *network* failure. Diagnosing it needed
 * a rebuild. This module makes that distinction visible without ever logging
 * personal data.
 *
 * PRIVACY RULES (CLAUDE.md: "no secrets or sensitive logs")
 * ---------------------------------------------------------
 *  - `code`, `hint` and `details` are safe in any build: they describe the
 *    schema and the constraint, never a user's data.
 *  - `message` is logged ONLY under `__DEV__`. PostgREST echoes request
 *    parameters into some messages, and those parameters can include a user id
 *    or filter values — personal data under UK/EU GDPR. It must never reach a
 *    production log sink.
 *  - The raw error object is NEVER logged: for a failed write it can contain
 *    the row being written, which for this app may include a review body
 *    describing a child.
 */

/** The shape supabase-js returns in `error` (PostgrestError), narrowed safely. */
export type DbErrorLike = {
  code?: string | null;
  hint?: string | null;
  details?: string | null;
  message?: string | null;
};

/** PostgreSQL `insufficient_privilege`. Raised when a role lacks a table, */
/** column or function privilege — including inside an RLS policy expression. */
export const PG_INSUFFICIENT_PRIVILEGE = '42501';

/** PostgreSQL `undefined_column`. Usually a client selecting a column that was */
/** dropped or was never granted in a way PostgREST can resolve. */
export const PG_UNDEFINED_COLUMN = '42703';

function asDbError(error: unknown): DbErrorLike {
  if (error && typeof error === 'object') return error as DbErrorLike;
  return {};
}

/**
 * True when the failure is a database *permission* problem rather than a
 * transport problem. Use this to avoid telling a user to "check your
 * connection" when their connection is fine and the query is being refused.
 */
export function isPermissionError(error: unknown): boolean {
  return asDbError(error).code === PG_INSUFFICIENT_PRIVILEGE;
}

/**
 * True when the request never reached Postgres. supabase-js surfaces these as
 * a TypeError from fetch, with no PostgREST `code`.
 */
export function isNetworkError(error: unknown): boolean {
  const e = asDbError(error);
  if (e.code) return false;
  return error instanceof TypeError || /network|fetch|timeout/i.test(e.message ?? '');
}

/**
 * Logs a database failure with enough detail to classify it, and nothing more.
 *
 * `scope` should identify the query, e.g. 'useMyReviews' or
 * 'buildDataExport:reviews' — it is a developer string, never user content.
 */
export function logDbError(scope: string, error: unknown): void {
  const e = asDbError(error);

  const safe = {
    code:    e.code    ?? null,
    hint:    e.hint    ?? null,
    details: e.details ?? null,
    kind:    isPermissionError(error) ? 'permission'
           : isNetworkError(error)    ? 'network'
           : 'other',
  };

  if (__DEV__) {
    // Dev builds only — see the privacy rules above.
    console.error(`[db] ${scope}`, { ...safe, message: e.message ?? null });
    if (isPermissionError(error)) {
      console.error(
        `[db] ${scope}: ${PG_INSUFFICIENT_PRIVILEGE} — a role is missing a table, ` +
        'column or function privilege. Check the RLS policies on this table for ' +
        'inline reads of columns the calling role cannot select.',
      );
    }
    return;
  }

  console.error(`[db] ${scope}`, safe);
}

/**
 * A short, non-identifying label for display in a `__DEV__` build only, so a
 * device smoke test can tell the two failure classes apart on screen instead of
 * needing a log capture. Returns null in production builds.
 */
export function devErrorLabel(error: unknown): string | null {
  if (!__DEV__) return null;
  const e = asDbError(error);
  if (isPermissionError(error)) return `DEV: permission denied (${PG_INSUFFICIENT_PRIVILEGE})`;
  if (isNetworkError(error))    return 'DEV: network/transport failure';
  return e.code ? `DEV: db error ${e.code}` : 'DEV: unknown failure';
}
