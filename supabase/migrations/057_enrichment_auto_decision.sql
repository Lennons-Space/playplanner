-- =============================================================================
-- 057_enrichment_auto_decision.sql
--
-- Adds auto-decision columns to venue_field_proposals, an immutable write
-- ledger (venue_enrichment_writes), a shared internal apply helper
-- (_enrichment_apply_write), and two new admin RPCs:
--   auto_apply_venue_proposal  — applies a proposal the engine routed as
--                                auto_apply without a manual approve step
--   rollback_enrichment_run    — reverts all applied writes from a given run
--
-- SAFETY: idempotent where possible (ADD COLUMN IF NOT EXISTS,
-- CREATE TABLE IF NOT EXISTS, DROP CONSTRAINT IF EXISTS before re-add).
-- Do NOT apply to production until explicitly approved.
-- Do NOT run `supabase db push` or `supabase migration repair`.
--
-- Depends on (already in the schema from 056):
--   venue_field_proposals, venue_enrichment_runs, venues, opening_hours,
--   profiles, is_admin(), snapshot_current_value(), touch_updated_at().
-- =============================================================================

-- =============================================================================
-- A.  Extend venue_field_proposals (all ALTER TABLE statements are idempotent)
-- =============================================================================

-- New decision columns.
-- * decision        — the engine's routing verdict.
-- * decision_reasons — typed array so the admin UI can render structured reasons.
-- * applied_mode    — distinguishes manual admin applies from automated ones.
-- admin queue filter: WHERE status = 'pending' AND decision = 'manual_review'
-- (auto_reject and report_only rows are persisted for audit but excluded from
--  the actionable queue by that filter — they are never actioned automatically
--  and do not appear in the admin review list).
alter table venue_field_proposals
  add column if not exists decision text
    check (decision in ('auto_apply','manual_review','auto_reject','report_only')),
  add column if not exists decision_reasons jsonb not null default '[]'::jsonb
    check (jsonb_typeof(decision_reasons) = 'array'),
  add column if not exists decision_engine_version text,
  add column if not exists decision_at timestamptz,
  add column if not exists applied_mode text
    check (applied_mode in ('auto','manual'));

-- Extend the status CHECK to include 'report_only'.
-- PostgreSQL auto-names an unnamed inline CHECK as <table>_<col>_check.
-- We DROP and re-CREATE so the constraint is consistent whether this migration
-- runs on a fresh schema (first time) or on one that already ran 056.
alter table venue_field_proposals
  drop constraint if exists venue_field_proposals_status_check;
alter table venue_field_proposals
  add constraint venue_field_proposals_status_check
  check (status in ('pending','approved','rejected','applied','superseded','report_only'));

-- Backfill: stamp all pre-057 rows as legacy-pilot manual_review decisions.
-- ONLY the 5 new/decision columns are touched — status, confidence, evidence_*,
-- applied_at, reviewed_*, review_notes are intentionally left as-is.
-- The WHERE guard makes this safe to replay (idempotent re-run).
update venue_field_proposals
   set decision                = 'manual_review',
       decision_engine_version = 'legacy-pilot',
       decision_reasons        = '["legacy_manual_pilot"]'::jsonb,
       decision_at             = coalesce(reviewed_at, created_at),
       applied_mode            = case when status = 'applied' then 'manual' else null end
 where decision is null;

-- =============================================================================
-- B.  Immutable ledger: venue_enrichment_writes
-- One row per apply (manual or auto) and one row per rollback.
-- Append-only by construction: clients have no INSERT/UPDATE/DELETE grant.
-- The only code path that can INSERT is _enrichment_apply_write and
-- rollback_enrichment_run (both SECURITY DEFINER, run as owner).
-- =============================================================================
create table if not exists venue_enrichment_writes (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid references venue_enrichment_runs(id),
  proposal_id       uuid references venue_field_proposals(id),
  venue_id          uuid not null references venues(id),
  field             text not null,
  operation         text not null check (operation in ('apply','rollback')),

  -- For apply:   old_value = value before the write, new_value = value written.
  -- For rollback: old_value = value before rollback (= apply.new_value),
  --               new_value = value restored (= apply.old_value).
  old_value         jsonb,
  old_value_hash    text,
  new_value         jsonb,
  new_value_hash    text,

  applied_mode      text check (applied_mode in ('auto','manual')),
  applied_by        uuid references profiles(id),
  decision_reasons  jsonb not null default '[]'::jsonb,
  source_url        text,
  evidence_snapshot text,
  applied_at        timestamptz not null default now(),

  -- Points to the apply row this rollback compensates. NULL for apply rows.
  reverts_write_id  uuid references venue_enrichment_writes(id)
);

create index if not exists venue_enrichment_writes_run_idx
  on venue_enrichment_writes(run_id);
create index if not exists venue_enrichment_writes_proposal_idx
  on venue_enrichment_writes(proposal_id);
create index if not exists venue_enrichment_writes_venue_idx
  on venue_enrichment_writes(venue_id);

-- RLS: admin SELECT only.  No insert/update/delete policy for any client role.
alter table venue_enrichment_writes enable row level security;

create policy "writes_admin_select" on venue_enrichment_writes
  for select using (is_admin());

-- Structurally block client mutations (belt-and-suspenders with RLS above and
-- the absence of any insert/update/delete policy).  Supabase default-privileges
-- auto-grant insert to authenticated/service_role on new tables, so we revoke
-- explicitly — same pattern as 056 function grants.
revoke insert, update, delete
    on venue_enrichment_writes
  from public, anon, authenticated, service_role;

-- =============================================================================
-- C.  _enrichment_apply_write — shared internal write helper
-- Contains the field-validation, stale-guard, DB-write, proposal-status-flip,
-- and ledger-insert logic extracted from apply_venue_proposal.  Called by both
-- apply_venue_proposal (mode='manual') and auto_apply_venue_proposal (mode='auto').
-- SECURITY DEFINER so it can INSERT into venue_enrichment_writes despite the
-- revokes above (runs as function owner, not caller role).
-- Revoked from ALL roles after creation — internal only.
-- =============================================================================
create or replace function _enrichment_apply_write(
  p_proposal_id      uuid,
  p_applied_text     text,     -- description rewrite; null for non-description fields
  p_mode             text,     -- 'manual' | 'auto'
  p_applied_by       uuid,     -- auth.uid() captured at the public call site
  p_decision_reasons jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p          venue_field_proposals%rowtype;
  v_snap     jsonb;
  v_val      text;
  v_seasonal text;
  v_day      jsonb;
  v_dow      int;
  v_open     time;
  v_close    time;
  v_notes    text;
  v_split    text;
  v_new_hash text;
  v_new_val  jsonb;
begin
  select * into p from venue_field_proposals where id = p_proposal_id;
  if not found then
    raise exception 'not_found';
  end if;

  -- booking_url: no target column yet (defence-in-depth; callers also guard)
  if p.field = 'booking_url' then
    raise exception 'no_target_column';
  end if;

  -- Stale-current-value guard: live hash must equal the hash taken at propose time.
  -- Uses the SAME snapshot function so the byte representation is identical.
  v_snap := snapshot_current_value(p.venue_id, p.field);
  if (v_snap ->> 'hash') is distinct from p.current_value_hash then
    raise exception 'stale_current_value';
  end if;

  -- ── Field-specific validation + write ─────────────────────────────────────
  if p.field = 'price_range' then
    v_val := p.proposed_value ->> 'v';
    if v_val is null or v_val not in ('free','budget','moderate','premium') then
      raise exception 'invalid_enum_value:%', coalesce(v_val, 'null');
    end if;
    update venues set price_range = v_val, updated_at = now() where id = p.venue_id;
    v_new_val := jsonb_build_object('v', v_val);

  elsif p.field in ('website','phone','email') then
    v_val := p.proposed_value ->> 'v';
    if p.field = 'email'
       and (v_val is null
            or v_val !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
      raise exception 'invalid_email';
    end if;
    if    p.field = 'website' then
      update venues set website = v_val, updated_at = now() where id = p.venue_id;
    elsif p.field = 'phone'   then
      update venues set phone   = v_val, updated_at = now() where id = p.venue_id;
    else
      update venues set email   = v_val, updated_at = now() where id = p.venue_id;
    end if;
    v_new_val := jsonb_build_object('v', v_val);

  elsif p.field = 'description' then
    if p_applied_text is null or btrim(p_applied_text) = '' then
      raise exception 'description_text_required';
    end if;
    -- Must be an original summary; verbatim scrape copy is copyright infringement.
    if btrim(p_applied_text) = btrim(coalesce(p.evidence_snippet, ''))
       or btrim(p_applied_text) = btrim(coalesce(p.evidence_raw, '')) then
      raise exception 'description_not_rewritten';
    end if;
    update venues set description = p_applied_text, updated_at = now()
     where id = p.venue_id;
    v_new_val := jsonb_build_object('v', p_applied_text);

  elsif p.field = 'opening_hours' then
    if jsonb_typeof(p.proposed_value -> 'days') is distinct from 'array'
       or jsonb_array_length(p.proposed_value -> 'days') <> 7 then
      raise exception 'incomplete_week';
    end if;
    -- M3: duplicate-day guard BEFORE the destructive delete so pre-existing rows
    -- are never at risk (no rollback required if the guard fires).
    if (select count(distinct (d ->> 'day_of_week'))
          from jsonb_array_elements(p.proposed_value -> 'days') d)
       <> jsonb_array_length(p.proposed_value -> 'days') then
      raise exception 'duplicate_day_of_week';
    end if;

    v_seasonal := nullif(btrim(coalesce(p.proposed_value ->> 'seasonal_notes', '')), '');
    delete from opening_hours where venue_id = p.venue_id;

    for v_day in select * from jsonb_array_elements(p.proposed_value -> 'days') loop
      v_dow := (v_day ->> 'day_of_week')::int;
      if coalesce((v_day ->> 'is_closed')::boolean, false)
         or coalesce(jsonb_array_length(v_day -> 'intervals'), 0) = 0 then
        insert into opening_hours (venue_id, day_of_week, is_closed)
          values (p.venue_id, v_dow, true);
      else
        select min((iv ->> 'opens')::time), max((iv ->> 'closes')::time)
          into v_open, v_close
          from jsonb_array_elements(v_day -> 'intervals') iv;
        v_notes := null;
        if jsonb_array_length(v_day -> 'intervals') > 1 then
          select string_agg(
                   (iv ->> 'opens') || '-' || (iv ->> 'closes'),
                   ' and '
                   order by ord
                 )
            into v_split
            from jsonb_array_elements(v_day -> 'intervals')
                   with ordinality as t(iv, ord);
          v_notes := 'Open ' || v_split;
        end if;
        if v_seasonal is not null then
          v_notes := case
            when v_notes is null then v_seasonal
            else v_notes || ' | ' || v_seasonal
          end;
        end if;
        insert into opening_hours
          (venue_id, day_of_week, opens_at, closes_at, is_closed, notes)
          values (p.venue_id, v_dow, v_open, v_close, false, v_notes);
      end if;
    end loop;
    v_new_val := p.proposed_value;

  else
    raise exception 'invalid_field:%', p.field;
  end if;

  -- Capture the post-write hash (same snapshot function → byte-identical)
  v_new_hash := snapshot_current_value(p.venue_id, p.field) ->> 'hash';

  -- Flip proposal status atomically within this function's transaction
  update venue_field_proposals
     set status      = 'applied',
         applied_at  = now(),
         reviewed_by = p_applied_by,
         reviewed_at = now(),
         applied_mode = p_mode
   where id = p_proposal_id;

  -- Append immutable ledger row.  INSERT is only possible here because this
  -- function is SECURITY DEFINER and all client roles have had INSERT revoked.
  insert into venue_enrichment_writes (
    run_id,            proposal_id,         venue_id,    field,
    operation,         old_value,           old_value_hash,
    new_value,         new_value_hash,
    applied_mode,      applied_by,          decision_reasons,
    source_url,        evidence_snapshot
  ) values (
    p.run_id,          p.id,                p.venue_id,  p.field,
    'apply',           p.current_value,     p.current_value_hash,
    v_new_val,         v_new_hash,
    p_mode,            p_applied_by,        coalesce(p_decision_reasons, '[]'::jsonb),
    p.source_url,      p.evidence_snippet
  );

  return jsonb_build_object('ok', true, 'field', p.field);
end;
$$;

-- Revoke from all: callable only from sibling SECURITY DEFINER functions above.
revoke all
    on function _enrichment_apply_write(uuid, text, text, uuid, jsonb)
  from public, anon, authenticated, service_role;

-- =============================================================================
-- C2.  Refactor apply_venue_proposal — delegate write to _enrichment_apply_write
-- Public signature and visible behaviour are UNCHANGED from 056.
-- The ledger now records every manual apply.
-- Grants unchanged: authenticated + service_role (see grants section below).
-- =============================================================================
create or replace function apply_venue_proposal(
  p_proposal_id uuid,
  p_applied_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p venue_field_proposals%rowtype;
begin
  if not is_admin() then
    raise exception 'not_admin';
  end if;

  select * into p from venue_field_proposals where id = p_proposal_id;
  if not found then
    raise exception 'not_found';
  end if;
  if p.status <> 'approved' then
    raise exception 'not_approved:%', p.status;
  end if;

  -- booking_url has no target column yet — fail fast before the write helper.
  if p.field = 'booking_url' then
    raise exception 'no_target_column';
  end if;

  return _enrichment_apply_write(
    p_proposal_id,
    p_applied_text,
    'manual',
    auth.uid(),
    coalesce(p.decision_reasons, '[]'::jsonb)
  );
end;
$$;

-- =============================================================================
-- D.  auto_apply_venue_proposal(p_proposal_id, p_applied_text) → jsonb
-- Admin-only.  Applies a proposal the engine routed as decision='auto_apply'
-- without requiring a manual approve step.
-- Guards (executed BEFORE any write or ledger row):
--   1. is_admin() — returns not_authorized if false.
--   2. decision='auto_apply' — else returns moved_to_manual_review.
--   3. Non-empty live value guard — never auto-overwrite existing data.
--   4. Stale hash — returns stale if hash has changed since propose time.
--   5. Field validation — returns validation_failed.
-- NOT granted to service_role: (a) no EXECUTE grant; (b) is_admin()=false for
-- service_role since it has no auth.uid() / profiles row (double guard).
-- =============================================================================
create or replace function auto_apply_venue_proposal(
  p_proposal_id uuid,
  p_applied_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p          venue_field_proposals%rowtype;
  v_snap     jsonb;
  v_live     jsonb;
  v_live_str text;
  v_val      text;
begin
  if not is_admin() then
    return jsonb_build_object('outcome', 'not_authorized', 'field', null);
  end if;

  select * into p from venue_field_proposals where id = p_proposal_id;
  if not found then
    raise exception 'not_found';
  end if;

  -- Only pending proposals are candidates for auto-apply.
  if p.status <> 'pending' then
    return jsonb_build_object('outcome', 'not_pending', 'field', p.field);
  end if;

  -- Only proposals the engine has explicitly routed to auto_apply are eligible.
  if coalesce(p.decision, '') <> 'auto_apply' then
    update venue_field_proposals
       set decision    = 'manual_review',
           decision_at = now()
     where id = p_proposal_id;
    return jsonb_build_object('outcome', 'moved_to_manual_review', 'field', p.field);
  end if;

  -- Guard: never auto-overwrite a valid non-empty live value.
  -- Takes a single snapshot here; reused for the stale check below (same tx).
  v_snap := snapshot_current_value(p.venue_id, p.field);
  v_live := v_snap -> 'value';

  if p.field = 'opening_hours' then
    -- Non-empty = any existing rows returned by snapshot_current_value
    if v_live is not null
       and jsonb_typeof(v_live) = 'array'
       and jsonb_array_length(v_live) > 0 then
      update venue_field_proposals
         set decision    = 'manual_review',
             decision_at = now()
       where id = p_proposal_id;
      return jsonb_build_object('outcome', 'moved_to_manual_review', 'field', p.field);
    end if;
  else
    -- Scalar: non-empty = {'v': non-null non-empty string}
    v_live_str := v_live ->> 'v';
    if v_live_str is not null and btrim(v_live_str) <> '' then
      update venue_field_proposals
         set decision    = 'manual_review',
             decision_at = now()
       where id = p_proposal_id;
      return jsonb_build_object('outcome', 'moved_to_manual_review', 'field', p.field);
    end if;
  end if;

  -- Stale guard (hash from the snapshot computed above)
  if (v_snap ->> 'hash') is distinct from p.current_value_hash then
    return jsonb_build_object('outcome', 'stale', 'field', p.field);
  end if;

  -- Pre-validate before delegating to _enrichment_apply_write so we can return
  -- structured JSON outcomes rather than raising.  _enrichment_apply_write also
  -- validates (defence-in-depth for race conditions).
  if p.field = 'price_range' then
    v_val := p.proposed_value ->> 'v';
    if v_val is null or v_val not in ('free','budget','moderate','premium') then
      return jsonb_build_object(
        'outcome', 'validation_failed', 'field', p.field,
        'reason', 'invalid_enum_value'
      );
    end if;

  elsif p.field = 'email' then
    v_val := p.proposed_value ->> 'v';
    if v_val is null
       or v_val !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      return jsonb_build_object(
        'outcome', 'validation_failed', 'field', p.field,
        'reason', 'invalid_email'
      );
    end if;

  elsif p.field = 'description' then
    -- Description always requires a human rewrite — never auto-applicable.
    return jsonb_build_object(
      'outcome', 'validation_failed', 'field', p.field,
      'reason', 'description_requires_human_rewrite'
    );

  elsif p.field = 'opening_hours' then
    if jsonb_typeof(p.proposed_value -> 'days') is distinct from 'array'
       or jsonb_array_length(p.proposed_value -> 'days') <> 7 then
      return jsonb_build_object(
        'outcome', 'validation_failed', 'field', p.field,
        'reason', 'incomplete_week'
      );
    end if;
    if (select count(distinct (d ->> 'day_of_week'))
          from jsonb_array_elements(p.proposed_value -> 'days') d)
       <> jsonb_array_length(p.proposed_value -> 'days') then
      return jsonb_build_object(
        'outcome', 'validation_failed', 'field', p.field,
        'reason', 'duplicate_day_of_week'
      );
    end if;

  elsif p.field = 'booking_url' then
    return jsonb_build_object(
      'outcome', 'validation_failed', 'field', p.field,
      'reason', 'no_target_column'
    );
  end if;

  -- All pre-checks passed.  Delegate to shared apply helper.
  -- _enrichment_apply_write re-runs the stale guard and validation internally
  -- as defence-in-depth (guards a race between our check and the actual write).
  begin
    perform _enrichment_apply_write(
      p_proposal_id,
      p_applied_text,
      'auto',
      auth.uid(),
      coalesce(p.decision_reasons, '[]'::jsonb)
    );
  exception when others then
    -- Race condition: internal guard fired after our pre-checks passed.
    if sqlerrm like '%stale_current_value%' then
      return jsonb_build_object('outcome', 'stale', 'field', p.field);
    end if;
    return jsonb_build_object(
      'outcome', 'validation_failed', 'field', p.field,
      'reason', sqlerrm
    );
  end;

  return jsonb_build_object('outcome', 'applied', 'field', p.field);
end;
$$;

-- =============================================================================
-- E.  rollback_enrichment_run(p_run_id) → jsonb  (admin-only)
-- For each operation='apply' ledger row in the run:
--   already_rolled_back   — a rollback row referencing it already exists.
--   skipped_newer_change  — live hash ≠ apply.new_value_hash (human edited since).
--   restored              — old_value restored; compensating rollback row appended.
--   failed:<msg>          — per-field error; loop continues for other fields.
-- NEVER edits/deletes original ledger rows.
-- NEVER deletes proposals (history is preserved).
-- NOT granted to service_role.
-- =============================================================================
create or replace function rollback_enrichment_run(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w          venue_enrichment_writes%rowtype;
  v_snap     jsonb;
  v_results  jsonb := '[]'::jsonb;
  v_outcome  text;
  v_val      text;
  v_day      jsonb;
  v_dow      int;
begin
  if not is_admin() then
    raise exception 'not_authorized';
  end if;

  for w in
    select ew.*
      from venue_enrichment_writes ew
     where ew.run_id = p_run_id
       and ew.operation = 'apply'
     order by ew.applied_at
  loop
    begin

      if exists (
        select 1 from venue_enrichment_writes
         where reverts_write_id = w.id
           and operation = 'rollback'
      ) then
        v_outcome := 'already_rolled_back';

      else
        -- Re-check the live hash against what we wrote.
        v_snap := snapshot_current_value(w.venue_id, w.field);
        if (v_snap ->> 'hash') is distinct from w.new_value_hash then
          v_outcome := 'skipped_newer_change';
        else
          -- Restore old_value to the live table(s).
          if w.field = 'opening_hours' then
            -- Replace the whole week (same semantics as the original apply).
            delete from opening_hours where venue_id = w.venue_id;
            if w.old_value is not null
               and jsonb_typeof(w.old_value) = 'array'
               and jsonb_array_length(w.old_value) > 0 then
              for v_day in
                select * from jsonb_array_elements(w.old_value)
              loop
                v_dow := (v_day ->> 'day_of_week')::int;
                if coalesce((v_day ->> 'is_closed')::boolean, false) then
                  insert into opening_hours (venue_id, day_of_week, is_closed)
                    values (w.venue_id, v_dow, true);
                else
                  insert into opening_hours
                    (venue_id, day_of_week, opens_at, closes_at, is_closed, notes)
                    values (
                      w.venue_id,
                      v_dow,
                      (v_day ->> 'opens_at')::time,
                      (v_day ->> 'closes_at')::time,
                      false,
                      v_day ->> 'notes'
                    );
                end if;
              end loop;
            end if;
            -- If old_value was null/'[]', the DELETE above is the complete restore.

          elsif w.field = 'price_range' then
            -- old_value may be null (field was null before the apply)
            v_val := w.old_value ->> 'v';   -- safe: null ->> 'v' returns null in PG
            update venues set price_range = v_val, updated_at = now()
             where id = w.venue_id;
          elsif w.field = 'website' then
            v_val := w.old_value ->> 'v';
            update venues set website = v_val, updated_at = now()
             where id = w.venue_id;
          elsif w.field = 'phone' then
            v_val := w.old_value ->> 'v';
            update venues set phone = v_val, updated_at = now()
             where id = w.venue_id;
          elsif w.field = 'email' then
            v_val := w.old_value ->> 'v';
            update venues set email = v_val, updated_at = now()
             where id = w.venue_id;
          elsif w.field = 'description' then
            v_val := w.old_value ->> 'v';
            update venues set description = v_val, updated_at = now()
             where id = w.venue_id;
          end if;

          -- Append compensating ledger row.  old/new values are REVERSED
          -- from the apply perspective (rollback undoes the apply).
          -- This INSERT is inside a PL/pgSQL EXCEPTION subtransaction; if it
          -- fails, the restore above also rolls back (atomicity preserved).
          insert into venue_enrichment_writes (
            run_id,          proposal_id,        venue_id,   field,
            operation,
            old_value,       old_value_hash,
            new_value,       new_value_hash,
            applied_mode,    applied_by,         decision_reasons,
            source_url,      evidence_snapshot,  reverts_write_id
          ) values (
            w.run_id,        w.proposal_id,      w.venue_id, w.field,
            'rollback',
            w.new_value,     w.new_value_hash,   -- what the state was before this rollback
            w.old_value,     w.old_value_hash,   -- what we restored to
            'manual',        auth.uid(),         coalesce(w.decision_reasons, '[]'::jsonb),
            w.source_url,    w.evidence_snapshot, w.id
          );

          v_outcome := 'restored';
        end if;
      end if;

    exception when others then
      -- Per-field failure: record and continue so other fields in the run are
      -- still attempted.  Subtransaction rollback ensures the failed field's
      -- restore + ledger insert are both undone atomically.
      v_outcome := 'failed:' || sqlerrm;
    end;

    v_results := v_results || jsonb_build_object(
      'write_id',    w.id,
      'proposal_id', w.proposal_id,
      'venue_id',    w.venue_id,
      'field',       w.field,
      'outcome',     v_outcome
    );
  end loop;

  return v_results;
end;
$$;

-- =============================================================================
-- F.  Extend propose_field to persist the engine verdict (§6b — REQUIRED)
--
-- The 056 propose_field has an 11-arg signature. Adding 3 defaulted params
-- creates a NEW overload (not a replace), causing ambiguity on 11-arg call sites.
-- To avoid that we DROP the 11-arg signature first, then CREATE the 14-arg
-- version. Callers that still pass 11 positional args continue to work because
-- the last 3 params have defaults. Idempotent: DROP IF EXISTS is a no-op on a
-- second run; CREATE OR REPLACE replaces the existing 14-arg version.
--
-- New behaviour vs 056:
--   * Validates p_decision against the CHECK set.
--   * Maps decision → initial status per DECISION_TO_INITIAL_STATUS:
--       auto_apply / manual_review → 'pending'
--       auto_reject               → 'rejected'   (terminal; audit only)
--       report_only               → 'report_only' (terminal; audit/retry only)
--   * Stores decision, decision_reasons, decision_engine_version, decision_at
--     on INSERT so auto_apply_venue_proposal can gate on decision='auto_apply'.
--   * Preserves scalar-dedup behaviour (returns null → no insert).
-- =============================================================================

drop function if exists
  propose_field(uuid, uuid, text, jsonb, text, text, text, text, text, boolean, timestamptz);

create or replace function propose_field(
  p_run_id                  uuid,
  p_venue_id                uuid,
  p_field                   text,
  p_proposed                jsonb,
  p_source_url              text,
  p_evidence                text,
  p_evidence_raw            text,
  p_method                  text,
  p_confidence              text,
  p_conflicts               boolean,
  p_retrieved_at            timestamptz default now(),
  p_decision                text        default 'manual_review',
  p_decision_reasons        jsonb       default '[]'::jsonb,
  p_decision_engine_version text        default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_current  jsonb;
  v_hash     text;
  v_new_id   uuid;
  v_status   text;
begin
  -- Validate p_decision against the same set as the decision CHECK constraint.
  -- Mirrors the EnrichmentDecision union in types/enrichmentDecision.ts (pinned
  -- in DECISION_CONTRACT.md §1; verified at the Phase 3 reconciliation gate).
  if p_decision is null
     or p_decision not in ('auto_apply','manual_review','auto_reject','report_only') then
    raise exception 'invalid_decision:%', coalesce(p_decision, 'null');
  end if;

  v_snapshot := snapshot_current_value(p_venue_id, p_field);
  v_current  := v_snapshot -> 'value';
  v_hash     := v_snapshot ->> 'hash';

  -- Dedup (scalars only): proposing the value already stored is a no-op → null.
  -- opening_hours is NOT deduped here (its proposed shape differs from stored
  -- rows); that dedup is the pure layer's job (canonicalWeek). The Phase 2C
  -- orchestrator must treat a null return as "skip", not an error.
  if p_field <> 'opening_hours'
     and v_current is not null
     and v_current = p_proposed then
    return null;
  end if;

  -- Map decision to its initial stored status per DECISION_TO_INITIAL_STATUS:
  --   auto_apply    → 'pending'      (applied by the in-app batch later)
  --   manual_review → 'pending'      (admin resolves: apply / reject)
  --   auto_reject   → 'rejected'     (terminal; persisted for audit only)
  --   report_only   → 'report_only'  (terminal; persisted for audit/retry)
  v_status := case p_decision
    when 'auto_reject'  then 'rejected'
    when 'report_only'  then 'report_only'
    else                     'pending'
  end;

  -- Supersede any existing live pending proposal for this (venue, field), then
  -- insert the new one — both inside this single function call (atomic).
  update venue_field_proposals
     set status = 'superseded'
   where venue_id = p_venue_id
     and field    = p_field
     and status   = 'pending';

  insert into venue_field_proposals (
    run_id, venue_id, field, proposed_value, current_value, current_value_hash,
    source_url, evidence_snippet, evidence_raw, retrieved_at,
    extraction_method, confidence, conflicts_existing, status,
    decision, decision_reasons, decision_engine_version, decision_at
  ) values (
    p_run_id, p_venue_id, p_field, p_proposed, v_current, v_hash,
    p_source_url, p_evidence, p_evidence_raw, p_retrieved_at,
    p_method, p_confidence, coalesce(p_conflicts, false), v_status,
    p_decision, coalesce(p_decision_reasons, '[]'::jsonb),
    p_decision_engine_version, now()
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

-- Grant: service_role only (same policy as the original 056 propose_field).
-- Supabase default-privileges auto-grant EXECUTE to anon/authenticated/service_role
-- on every new function; revoke named roles explicitly (revoke from public alone
-- does not remove those named-role grants — verified on a live stack 2026-06-27).
revoke all on function
  propose_field(uuid, uuid, text, jsonb, text, text, text, text, text, boolean,
                timestamptz, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function
  propose_field(uuid, uuid, text, jsonb, text, text, text, text, text, boolean,
                timestamptz, text, jsonb, text)
  to service_role;

-- =============================================================================
-- Grants
-- Final intended matrix (mirrors 056's explicit-revoke pattern; Supabase
-- default-privileges auto-grant EXECUTE to anon/authenticated/service_role on
-- every new function — revoke ... from public alone is insufficient):
--
--   snapshot_current_value     service_role only          (056 — unchanged)
--   propose_field              service_role only          (056 — unchanged)
--   apply_venue_proposal       authenticated + service_role (056 — unchanged)
--   reject_venue_proposal      authenticated + service_role (056 — unchanged)
--   _enrichment_apply_write    NONE (internal definer; revoked at creation)
--   auto_apply_venue_proposal  authenticated ONLY
--   rollback_enrichment_run    authenticated ONLY
-- =============================================================================

revoke all on function auto_apply_venue_proposal(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function rollback_enrichment_run(uuid)
  from public, anon, authenticated, service_role;

-- authenticated ONLY — service_role is intentionally excluded.
grant execute on function auto_apply_venue_proposal(uuid, text) to authenticated;
grant execute on function rollback_enrichment_run(uuid) to authenticated;

-- Re-affirm 056 grants (idempotent after CREATE OR REPLACE; safe to repeat).
revoke all on function apply_venue_proposal(uuid, text)  from public, anon;
revoke all on function reject_venue_proposal(uuid, text) from public, anon;
grant execute on function apply_venue_proposal(uuid, text)  to authenticated, service_role;
grant execute on function reject_venue_proposal(uuid, text) to authenticated, service_role;
