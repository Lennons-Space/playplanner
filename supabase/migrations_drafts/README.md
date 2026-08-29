# Draft migrations — NOT APPLIED

Every `.sql` file in this directory is **unapplied**. None of it has run against production, and
none of it has a row in `supabase_migrations.schema_migrations`.

## Why they are here and not in `../migrations/`

This directory is **intentionally outside Supabase CLI migration discovery.** The CLI only reads
`supabase/migrations/`, so nothing here is enumerated by `migration list`, and **`supabase db push`
must never see these files — including `db push --include-all`.**

That is the entire point. While `059`/`060`/`061` sat in `supabase/migrations/`, a dry-run reported
them as the only pending migrations and the CLI itself suggested `--include-all`, which would have
applied all three to production. Bare `db push` refused only incidentally, because of how versions
sort — that refusal was never protection. Moving them out is the protection.

## Current contents

| File | Status |
|---|---|
| `059_enrichment_autonomy.sql` | Written, reviewed, **never applied** |
| `060_enrichment_2_1.sql` | Written, reviewed, **never applied** |
| `061_enrichment_review_paths.sql` | Written, reviewed, **never applied** |

Their pglite test suites still live in `supabase/tests/` and read the SQL from this directory.
They pass; passing tests do **not** mean the migration is deployed.

## Do NOT move these back into `../migrations/`

Restoring the old sequential filename would assert that version `059`/`060`/`061` is part of
production history. It is not, and the numbered form is banned outright — see
`../migrations/README.md` §3.

## How to promote a draft when it is finally authorised

1. Get explicit authorisation to apply it. These are deferred for product and safety reasons, not
   because nobody got round to them.
2. **Review the SQL again, at promotion time.** It was written against the schema as it stood when
   it was drafted; migrations applied since may have changed what it depends on. Re-run its test
   suite against the current schema.
3. Allocate a **new, current** timestamp identity — `supabase migration new <description>` — and
   move the reviewed SQL into that file under `../migrations/`.
4. Repoint the test's `readFileSync` path at the new filename and update `package.json` if the
   suite is wired into `npm run test:db`.
5. Dry-run before applying: `supabase db push --dry-run --db-url "<connection string>"`, and read
   the file list it prints.

Never pretend the old sequential version occurred in production. The ledger is a record of what
actually ran; keep it honest.
