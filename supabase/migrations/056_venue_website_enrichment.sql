-- =============================================================================
-- 056_venue_website_enrichment.sql
-- Website enrichment: reviewable field proposals + fetch-run audit, plus the
-- RPCs that propose (atomically) and apply (admin-only, stale-guarded).
--
-- NOTHING here writes to venues/opening_hours EXCEPT the admin-only
-- apply_venue_proposal RPC. Design: WEBSITE_ENRICHMENT_SPEC.md v2 (§1, §2, §6c, §7).
--
-- Depends on (already in the schema): venues, opening_hours, profiles,
-- is_admin() [001], touch_updated_at() [001]. Uses core gen_random_uuid() and
-- sha256() (PG14+ / Supabase PG15) — no extension required.
-- =============================================================================

-- ── Parent: one row per website fetch attempt per venue ──────────────────────
-- Append-only: rows are immutable after insert (no updated_at / no UPDATE path).
create table venue_enrichment_runs (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references venues(id) on delete cascade,
  run_label       text not null,
  source_website  text,
  outcome         text not null check (outcome in (
                    'extracted',
                    'extracted_no_proposals',   -- fetched+parsed OK but every field deduped
                    'skipped_no_website',
                    'skipped_invalid_url',
                    'skipped_robots',
                    'skipped_redirect_offdomain',
                    'skipped_non_html',
                    'skipped_too_large',
                    'skipped_bot_protected',
                    'fetch_failed'
                  )),
  robots_checked_url text,
  robots_allowed     boolean,
  pages           jsonb not null default '[]',
  error_note      text,
  created_at      timestamptz not null default now()
);

create index venue_enrichment_runs_venue_idx   on venue_enrichment_runs(venue_id);
create index venue_enrichment_runs_label_idx   on venue_enrichment_runs(run_label);
create index venue_enrichment_runs_outcome_idx on venue_enrichment_runs(outcome);

-- ── Child: one row per (run, field) candidate ────────────────────────────────
-- DATA RETENTION / PII: evidence_snippet/evidence_raw may carry business-contact
-- data (PII-scrubbed by the extractor before insert). RLS keeps rows admin-only.
-- Operational policy (track in the DPIA, enforce via a future cleanup job, NOT
-- this migration): rejected → delete after 90 days; superseded → after 30 days;
-- applied → retained as the change audit trail. See WEBSITE_ENRICHMENT_SPEC.md §16/§18.
create table venue_field_proposals (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references venue_enrichment_runs(id) on delete cascade,
  venue_id           uuid not null references venues(id) on delete cascade,
  field              text not null check (field in (
                       'description','price_range','website','booking_url',
                       'phone','email','opening_hours'
                     )),

  proposed_value     jsonb not null,
  current_value      jsonb,
  current_value_hash text not null, -- always set by snapshot_current_value (defensive)

  source_url         text not null,
  evidence_snippet   text not null check (length(evidence_snippet) <= 512),
  evidence_raw       text check (evidence_raw is null or length(evidence_raw) <= 2048),
  retrieved_at       timestamptz not null,
  extraction_method  text not null check (extraction_method in ('jsonld','microdata','meta','heuristic')),
  confidence         text not null check (confidence in ('low','medium','high')),
  conflicts_existing boolean not null default false,

  status        text not null default 'pending'
                  check (status in ('pending','approved','rejected','applied','superseded')),
  reviewed_by   uuid references profiles(id),
  reviewed_at   timestamptz,
  review_notes  text,
  applied_at    timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger venue_field_proposals_updated_at
  before update on venue_field_proposals
  for each row execute function touch_updated_at();

create index venue_field_proposals_venue_idx on venue_field_proposals(venue_id);
create index venue_field_proposals_run_idx   on venue_field_proposals(run_id);
create index venue_field_proposals_field_idx on venue_field_proposals(field);
create index venue_field_proposals_pending_idx
  on venue_field_proposals(status) where status = 'pending';

-- At most ONE live pending proposal per (venue, field). A new run supersedes the
-- previous pending row (see propose_field); history rows are never blocked.
create unique index venue_field_proposals_one_pending_idx
  on venue_field_proposals(venue_id, field) where status = 'pending';

-- ── RLS: admin-only (may contain business-contact PII; not public) ───────────
alter table venue_enrichment_runs enable row level security;
alter table venue_field_proposals enable row level security;

create policy "runs_admin_all" on venue_enrichment_runs
  for all using (is_admin()) with check (is_admin());
create policy "proposals_admin_all" on venue_field_proposals
  for all using (is_admin()) with check (is_admin());

-- =============================================================================
-- RPC: snapshot_current_value(venue, field) → { "value": <jsonb>, "hash": <hex> }
-- Computes the field's CURRENT live value AND its sha256 hash entirely in
-- Postgres, so the propose-time snapshot and the apply-time re-check are byte-
-- identical (no cross-language serialisation drift). opening_hours is assembled
-- ordered by day_of_week for a stable hash.
-- =============================================================================
create or replace function snapshot_current_value(p_venue_id uuid, p_field text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_value jsonb;
  v_text  text;
begin
  if p_field = 'opening_hours' then
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'day_of_week', day_of_week,
                 'is_closed',   is_closed,
                 'opens_at',    opens_at,
                 'closes_at',   closes_at,
                 'notes',       notes
               ) order by day_of_week
             ),
             '[]'::jsonb)
      into v_value
      from opening_hours
     where venue_id = p_venue_id;
  elsif p_field = 'description' then
    select to_jsonb(description) into v_value from venues where id = p_venue_id;
  elsif p_field = 'price_range' then
    select to_jsonb(price_range) into v_value from venues where id = p_venue_id;
  elsif p_field = 'website' then
    select to_jsonb(website) into v_value from venues where id = p_venue_id;
  elsif p_field = 'phone' then
    select to_jsonb(phone) into v_value from venues where id = p_venue_id;
  elsif p_field = 'email' then
    select to_jsonb(email) into v_value from venues where id = p_venue_id;
  elsif p_field = 'booking_url' then
    v_value := null; -- no venues.booking_url column yet (deferred)
  else
    raise exception 'invalid_field:%', p_field;
  end if;

  -- Wrap scalar values as { "v": ... } so they compare with proposed_value.
  if p_field <> 'opening_hours' and v_value is not null then
    v_value := jsonb_build_object('v', v_value);
  end if;

  -- Field-prefixed so a NULL value hashes differently per field (defence in depth;
  -- the stale guard always compares same-field snapshots, so this never falses).
  v_text := p_field || ':' || coalesce(v_value::text, 'null');
  return jsonb_build_object(
    'value', v_value,
    'hash',  encode(sha256(convert_to(v_text, 'UTF8')), 'hex')
  );
end;
$$;

-- =============================================================================
-- RPC: propose_field(...) → uuid
-- Atomic supersede + insert (one transaction = the function body). Snapshots the
-- current value + hash from snapshot_current_value. Dedups scalar fields whose
-- proposed value already equals the stored value (returns null, inserts nothing).
-- Called by the background enrichment script (service_role).
-- =============================================================================
create or replace function propose_field(
  p_run_id      uuid,
  p_venue_id    uuid,
  p_field       text,
  p_proposed    jsonb,
  p_source_url  text,
  p_evidence    text,
  p_evidence_raw text,
  p_method      text,
  p_confidence  text,
  p_conflicts   boolean,
  p_retrieved_at timestamptz default now()
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
begin
  v_snapshot := snapshot_current_value(p_venue_id, p_field);
  v_current  := v_snapshot -> 'value';
  v_hash     := v_snapshot ->> 'hash';

  -- Dedup (scalars only): proposing the value already stored is a no-op → null.
  -- opening_hours is NOT deduped here (its proposed shape differs from the stored
  -- rows); that dedup is the pure layer's job (canonicalWeek). The Phase 2C
  -- orchestrator must treat a null return as "skip", not an error.
  if p_field <> 'opening_hours'
     and v_current is not null
     and v_current = p_proposed then
    return null;
  end if;

  -- Supersede any existing live pending proposal for this (venue, field), then
  -- insert the new one — both inside this single function call (atomic).
  update venue_field_proposals
     set status = 'superseded'
   where venue_id = p_venue_id
     and field = p_field
     and status = 'pending';

  insert into venue_field_proposals (
    run_id, venue_id, field, proposed_value, current_value, current_value_hash,
    source_url, evidence_snippet, evidence_raw, retrieved_at,
    extraction_method, confidence, conflicts_existing
  ) values (
    p_run_id, p_venue_id, p_field, p_proposed, v_current, v_hash,
    p_source_url, p_evidence, p_evidence_raw, p_retrieved_at,
    p_method, p_confidence, coalesce(p_conflicts, false)
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

-- =============================================================================
-- RPC: apply_venue_proposal(proposal_id, applied_text) → jsonb
-- Admin-only. Stale-guarded. Writes the single field to venues / opening_hours.
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

  -- booking_url has no target column yet (deferred) — fail fast and clearly,
  -- before the stale guard, so an approved booking_url proposal errors immediately.
  if p.field = 'booking_url' then
    raise exception 'no_target_column';
  end if;

  -- Stale-current-value guard: live value must match the snapshot taken at propose
  -- time (value-equality via the SAME hash function — no temporal check).
  v_snap := snapshot_current_value(p.venue_id, p.field);
  if (v_snap ->> 'hash') is distinct from p.current_value_hash then
    raise exception 'stale_current_value';
  end if;

  if p.field = 'price_range' then
    v_val := p.proposed_value ->> 'v';
    if v_val is null or v_val not in ('free','budget','moderate','premium') then
      raise exception 'invalid_enum_value:%', coalesce(v_val, 'null');
    end if;
    update venues set price_range = v_val, updated_at = now() where id = p.venue_id;

  elsif p.field in ('website','phone','email') then
    v_val := p.proposed_value ->> 'v';
    if p.field = 'website' then
      update venues set website = v_val, updated_at = now() where id = p.venue_id;
    elsif p.field = 'phone' then
      update venues set phone = v_val, updated_at = now() where id = p.venue_id;
    else
      update venues set email = v_val, updated_at = now() where id = p.venue_id;
    end if;

  elsif p.field = 'description' then
    if p_applied_text is null or btrim(p_applied_text) = '' then
      raise exception 'description_text_required';
    end if;
    -- Must be an ORIGINAL summary, never the site's verbatim text (copyright).
    if btrim(p_applied_text) = btrim(coalesce(p.evidence_snippet, ''))
       or btrim(p_applied_text) = btrim(coalesce(p.evidence_raw, '')) then
      raise exception 'description_not_rewritten';
    end if;
    update venues set description = p_applied_text, updated_at = now() where id = p.venue_id;

  elsif p.field = 'opening_hours' then
    if jsonb_typeof(p.proposed_value -> 'days') is distinct from 'array'
       or jsonb_array_length(p.proposed_value -> 'days') <> 7 then
      raise exception 'incomplete_week';
    end if;
    v_seasonal := nullif(btrim(coalesce(p.proposed_value ->> 'seasonal_notes', '')), '');

    -- Replace-whole-week: delete then insert 7 fresh rows (no partial hybrid).
    delete from opening_hours where venue_id = p.venue_id;

    for v_day in select * from jsonb_array_elements(p.proposed_value -> 'days') loop
      v_dow := (v_day ->> 'day_of_week')::int;

      if coalesce((v_day ->> 'is_closed')::boolean, false)
         or coalesce(jsonb_array_length(v_day -> 'intervals'), 0) = 0 then
        insert into opening_hours (venue_id, day_of_week, is_closed)
          values (p.venue_id, v_dow, true);
      else
        -- Envelope: cast to time for correct ordering (handles '24:00' and any
        -- non-padded input safely, unlike lexicographic text min/max).
        select min((iv ->> 'opens')::time), max((iv ->> 'closes')::time)
          into v_open, v_close
          from jsonb_array_elements(v_day -> 'intervals') iv;

        v_notes := null;
        if jsonb_array_length(v_day -> 'intervals') > 1 then
          -- Ordered by array position so the notes string is deterministic.
          select string_agg((iv ->> 'opens') || '-' || (iv ->> 'closes'), ' and ' order by ord)
            into v_split
            from jsonb_array_elements(v_day -> 'intervals') with ordinality as t(iv, ord);
          v_notes := 'Open ' || v_split;
        end if;
        if v_seasonal is not null then
          v_notes := case when v_notes is null then v_seasonal else v_notes || ' | ' || v_seasonal end;
        end if;

        insert into opening_hours (venue_id, day_of_week, opens_at, closes_at, is_closed, notes)
          values (p.venue_id, v_dow, v_open, v_close, false, v_notes);
      end if;
    end loop;

  else
    raise exception 'invalid_field:%', p.field; -- booking_url handled earlier
  end if;

  update venue_field_proposals
     set status = 'applied', applied_at = now(), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_proposal_id;

  return jsonb_build_object('ok', true, 'field', p.field);
end;
$$;

-- =============================================================================
-- RPC: reject_venue_proposal(proposal_id, notes) → jsonb  (admin-only)
-- =============================================================================
create or replace function reject_venue_proposal(p_proposal_id uuid, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not is_admin() then
    raise exception 'not_admin';
  end if;

  select status into v_status from venue_field_proposals where id = p_proposal_id;
  if not found then
    raise exception 'not_found';
  end if;
  if v_status not in ('pending','approved') then
    raise exception 'not_pending:%', v_status;
  end if;

  update venue_field_proposals
     set status = 'rejected', review_notes = p_notes, reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_proposal_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ── Function grants ──────────────────────────────────────────────────────────
-- Proposing is a background (service_role) action; applying/rejecting is an
-- authenticated admin action (self-gated by is_admin()). Snapshot is harmless read.
revoke all on function snapshot_current_value(uuid, text) from public;
revoke all on function propose_field(uuid, uuid, text, jsonb, text, text, text, text, text, boolean, timestamptz) from public;
revoke all on function apply_venue_proposal(uuid, text) from public;
revoke all on function reject_venue_proposal(uuid, text) from public;

-- snapshot is an internal helper: only the background proposer needs it directly;
-- apply/reject call it as SECURITY DEFINER (owner privileges), so authenticated
-- callers do NOT need execute (avoids exposing venue field values to non-admins).
grant execute on function snapshot_current_value(uuid, text) to service_role;
grant execute on function propose_field(uuid, uuid, text, jsonb, text, text, text, text, text, boolean, timestamptz) to service_role;
grant execute on function apply_venue_proposal(uuid, text) to authenticated, service_role;
grant execute on function reject_venue_proposal(uuid, text) to authenticated, service_role;
