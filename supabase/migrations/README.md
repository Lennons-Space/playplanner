# Supabase migrations — naming and application rules

**Read this before creating a migration. Getting it wrong has already cost this project a
production/repo history split that took a full audit to unpick.**

---

## 1. What is in this directory

Three kinds of file, all of them real migration versions as far as the Supabase CLI is concerned:

| Kind | Examples | Notes |
|---|---|---|
| **Legacy numbered** | `001_initial_schema.sql` … `058_fix_venue_photos_rls_recursion.sql`, `062_…` … `067_…` | Historical. Applied to production. Left exactly as they are. |
| **Historical timestamp placeholders** | `20260605211756_security_hardening.sql` and six others | Comments only, **no executable SQL**. Production genuinely ran these versions; the same SQL also ships under a numbered name. See the header inside each file. Never add SQL to them. |
| **Current-convention migrations** | `20260801213434_facility_votes_select_own.sql` | The shape every new migration must take. |

Unapplied drafts live in **`../migrations_drafts/`** and are deliberately invisible to the CLI.
See that directory's README.

## 2. Production also contains timestamp versions

`supabase_migrations.schema_migrations` in production holds both numbered versions and
`YYYYMMDDHHMMSS` versions. That is expected and correct — it is history, not a mistake.

The CLI matches local files to remote rows **by version string only**. It does not compare names
and it does not checksum content. A local file with the right version and the *wrong* SQL will
never be reported as a problem. Version allocation is therefore the whole safety mechanism.

## 3. NEVER resume sequential numbering

**Do not create `068_*.sql`, `069_*.sql`, or any other numbered migration. Ever.**

Migration versions are TEXT and sort lexicographically, so every `2026…` version sorts **after**
every `0xx` version. A new `068` would sort *before* migrations already applied to production,
which makes `supabase db push` refuse with `LegacyDbPushMissingRemoteError` and push you toward
`--include-all` — the flag that applies everything pending, including anything you did not intend
to ship. That is exactly the trap this convention exists to close.

## 4. All new migrations use timestamp versions

```
YYYYMMDDHHMMSS_description.sql        e.g. 20260801213434_facility_votes_select_own.sql
```

The easiest correct way to get one:

```
supabase migration new short_description
```

**Commit the file it creates.** Every one of the seven placeholders in this directory exists
because someone ran that command, pushed the result to production, and never committed it.

## 5. Version prefixes must be globally unique

The prefix before the **first** underscore is the version. It must be unique across the whole
project — not just unique on your branch.

**Never reuse a version allocated on another branch.** The 057 collision happened because two
branches that never merged each took "the next free number" on their own line: one produced
`057_enrichment_auto_decision.sql` (which production ran) and the other
`057_facility_votes_select_own.sql`. Nothing warned anybody. Timestamps make this collision
essentially impossible, which is the main reason for the rule.

**Before creating a migration**, check what already exists:

```
git log --all --name-only -- supabase/migrations/     # every version on every branch
git branch -a                                          # branches that may hold their own
supabase migration list --db-url "<connection string>" # what production actually has
```

## 6. `supabase db push` is not a routine command

Production migration history is part of the release and security boundary. A push can create,
alter or drop RLS policies, grants and SECURITY DEFINER functions — treat it like a deploy.

- **Never** run `db push` casually, and never reach for `--include-all` to make an error go away.
  Read what the error is actually telling you.
- **Always** inspect first:
  ```
  supabase migration list --db-url "<connection string>"
  supabase db push --dry-run --db-url "<connection string>"
  supabase db push --dry-run --include-all --db-url "<connection string>"
  ```
  The dry-run prints the exact file list it would apply. If that list contains anything you did
  not intend to ship, stop.
- `--db-url` talks straight to Postgres and avoids the Management API (which has returned 403 on
  this project).
- `supabase migration repair --status applied` writes a ledger row and executes **no SQL**.
  `--status reverted` **deletes** a row — it destroys a truthful record of something production
  really ran. Do not use it to tidy up a listing.

## 7. Layout guard

`supabase/tests/migration_history_layout.mjs` enforces most of the above from filenames alone and
runs as part of `npm run test:db`. If it fails, the layout is wrong — fix the layout, not the test.
