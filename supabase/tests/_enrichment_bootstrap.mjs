// =============================================================================
// supabase/tests/_enrichment_bootstrap.mjs
//
// SHARED, REALISTIC enrichment test bootstrap.
//
// Every previous enrichment fixture was a simplified copy whose assumptions
// drifted from production -- which is how a test could pass while the real
// contract was broken. This module is the single source of truth for enrichment
// DB tests and models the ACTUAL contracts of:
//
//   056  venue_enrichment_runs, venue_field_proposals, snapshot_current_value
//   057  venue_enrichment_writes, _enrichment_apply_write, apply/auto_apply,
//        rollback_enrichment_run, the decision_* columns, applied_mode
//   062  the EXACT 10 authenticated profile UPDATE columns
//   063  the EXACT 15 authenticated venue INSERT columns + the invariant trigger
//   20260829205506  PP-011 owner UPDATE boundary (trigger + function)
//   20260830102402  privilege hardening (the four non-DML privileges revoked,
//                   default privileges narrowed, trigger helpers locked down)
//
// PRODUCTION TRUTH vs DRAFT DELTA
// -------------------------------
// `BOOTSTRAP` models production as it exists TODAY. It deliberately does NOT
// contain venues.booking_url or venues.operating_status, because those columns
// do not exist in production -- they are added by unapplied drafts 059/060.
// Call `DRAFT_COLUMNS` explicitly when a test needs to exercise draft-only
// behaviour. Keeping the two separate is what stops a fixture from quietly
// asserting a world that production is not in.
//
// =============================================================================
// PART A -- THE CANONICAL ENRICHMENT PROVENANCE / WRITE CONTRACT
// =============================================================================
//
// Migration 057 is canonical. The draft 059 design is NOT. Specifically:
//
//   CANONICAL                                   | REJECTED
//   --------------------------------------------|---------------------------
//   venue_field_proposals.applied_mode          | venue_field_proposals
//     ('auto' | 'manual')                       |   .applied_by TEXT
//     -- proposal-level mode                    |   ('system'/'admin')
//   venue_field_proposals.decision              |   -- a SECOND, competing
//     ('auto_apply'|'manual_review'             |   provenance truth that can
//      |'auto_reject'|'report_only')            |   disagree with applied_mode
//   venue_field_proposals.decision_reasons      |   and carries no actor id.
//   venue_field_proposals.decision_engine_version
//   venue_field_proposals.decision_at
//   venue_enrichment_writes.applied_by UUID     |
//     -- canonical ACTOR identity               |
//   venue_enrichment_writes.applied_mode        |
//
// RULE 1. There is exactly ONE proposal-level mode column: `applied_mode`.
//         059's text `applied_by` on venue_field_proposals must NOT be added.
//         It duplicates `applied_mode` with a different vocabulary, cannot
//         identify WHICH admin acted, and creates two truths that can diverge.
//
// RULE 2. Actor identity lives ONLY in venue_enrichment_writes.applied_by, a
//         uuid FK to profiles. For autonomous/service actions there is no auth
//         user, so:
//              applied_mode = 'auto'
//              applied_by   = NULL          <- legitimate, not a defect
//              decision_reasons / decision_engine_version must then carry the
//              machine justification: WHY automation was permitted to act.
//         A NULL applied_by with applied_mode='manual' is a contract violation.
//
// RULE 3. Every write to venues or opening_hours that originates from a
//         proposal MUST go through the single audited primitive so it produces
//         an immutable venue_enrichment_writes row containing: run_id,
//         proposal_id, venue_id, field, operation, old_value, old_value_hash,
//         new_value, new_value_hash, applied_mode, applied_by, decision_reasons,
//         source_url, evidence_snapshot. No parallel unlogged write path.
//
// RULE 4. Every such write must remain reachable by rollback_enrichment_run,
//         which re-checks the live hash against new_value_hash and skips with
//         'skipped_newer_change' if a human has edited since. Automation must
//         never be able to clobber a newer human edit during a rollback.
//
// RULE 5. Trusted-path exemption, not permission-widening. Enrichment writes
//         protected venue columns because the write runs inside a SECURITY
//         DEFINER function owned by postgres (so current_user is not
//         'authenticated' and the PP-011 / 063 triggers exempt it). The
//         claimed-owner allowlist is NEVER widened to accommodate enrichment.
//
// RULE 6. RELEASE ONE: no candidate auto-publishes. There is no
//         service_role-executable database function that inserts a row into
//         venues. A discovery candidate becomes a live venue only through
//         resolve_discovery_candidate, which requires a real auth.uid()
//         belonging to an admin and stamps reviewed_by/reviewed_at/
//         resolved_mode='manual' -- an audit trail the table's own CHECK
//         constraints refuse to let it omit.
//
// RULE 7. PROVENANCE IS MAPPED, NEVER PASSED THROUGH. A candidate's `source`
//         is not written to venues.data_source directly. It goes through
//         discovery_candidate_provenance, which returns the provider, the
//         licence of the underlying data, the canonical source identity and
//         the list of parties that must be credited -- and RAISES for anything
//         it cannot map, which the caller turns into a quarantine rather than
//         a publication. Storing these fields records what the product needs
//         to render correct attribution; it is not itself a licence
//         compliance claim.
// =============================================================================

export const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
export const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
export const ADMIN = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

// 063 grants EXACTLY these 15 columns. Its own header says so twice.
export const VENUE_INSERT_COLUMNS_063 = [
  'name', 'description', 'category_id', 'address_line1', 'city', 'postcode',
  'latitude', 'longitude', 'phone', 'website', 'min_age', 'max_age',
  'submitted_by', 'moderation_status', 'is_published',
];

// 062 grants EXACTLY these 10 columns.
export const PROFILE_UPDATE_COLUMNS_062 = [
  'username', 'full_name', 'bio', 'avatar_url', 'children_ages', 'postcode',
  'show_in_search', 'show_reviews_publicly', 'marketing_consent',
  'terms_accepted_at',
];

// PP-011's owner allowlist. NEVER extend this to make enrichment work.
export const PP011_OWNER_ALLOWLIST = [
  'description', 'phone', 'email', 'website', 'price_range', 'min_age',
  'max_age', 'updated_at',
];

// The Geoapify Places `datasource` object, verbatim from the real captured
// fixture scripts/enrich/fixtures/geoapify-real/foyle-valley-railway-museum.json.
// Not invented, and not copied from documentation -- read out of a response the
// project actually received.
export const GEOAPIFY_OSM_DATASOURCE = {
  sourcename: 'openstreetmap',
  attribution: '\u00a9 OpenStreetMap contributors',
  license: 'Open Database License',
  url: 'https://www.openstreetmap.org/copyright',
};

export const ENRICHMENT_FIELDS_056 = [
  'description', 'price_range', 'website', 'booking_url', 'phone', 'email',
  'opening_hours',
];

// ── Production-truth bootstrap ───────────────────────────────────────────────
export const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create or replace function auth.uid() returns uuid language sql stable as $fn$
    select nullif(current_setting('test.uid', true), '')::uuid
  $fn$;

  create schema private;
  revoke all on schema private from public;
  revoke all on schema private from anon;
  grant usage on schema private to authenticated;
  create or replace function private.current_uid() returns uuid
  language sql security definer stable set search_path = '' as $fn$ select auth.uid() $fn$;
  revoke execute on function private.current_uid() from public;
  grant execute on function private.current_uid() to authenticated;

  -- Supabase default privileges, as production has them AFTER 20260830102402:
  -- DML still inherited, the four non-DML privileges no longer.
  alter default privileges in schema public
    grant select, insert, update, delete on tables to anon, authenticated;
  alter default privileges in schema public
    grant all on tables to service_role;

  -- ── profiles (062 contract) ────────────────────────────────────────────────
  create table profiles (
    id uuid primary key,
    is_admin boolean default false,
    is_business_owner boolean default false,
    username text, full_name text, bio text, avatar_url text,
    children_ages int[], postcode text,
    show_in_search boolean default true, show_reviews_publicly boolean default true,
    marketing_consent boolean default false, terms_accepted_at timestamptz,
    updated_at timestamptz default now());

  create or replace function is_admin() returns boolean
  language sql security definer stable set search_path = public as $fn$
    select coalesce((select is_admin from profiles where id = auth.uid()), false);
  $fn$;

  -- ── categories ────────────────────────────────────────────────────────────
  -- venues.category_id and venue_discovery_candidates.category_id both point
  -- here. Present because the discovery schema declares a real FK to it, not
  -- because any enrichment test reads a category.
  create table categories (
    id uuid primary key default gen_random_uuid(),
    name text unique not null,
    slug text unique not null);

  -- ── venues (production column surface; NO booking_url / operating_status) ──
  create table venues (
    id uuid primary key default gen_random_uuid(),
    name text not null, slug text unique, description text,
    category_id uuid references categories(id), address_line1 text, address_line2 text,
    city text not null, postcode text, country text default 'GB',
    latitude decimal(9,6) not null, longitude decimal(9,6) not null,
    location text,
    phone text, email text, website text,
    price_range text check (price_range in ('free','budget','moderate','premium')),
    min_age int default 0, max_age int default 12,
    is_published boolean default false, is_verified boolean default false,
    claimed_by uuid references profiles(id), submitted_by uuid references profiles(id),
    moderation_status text default 'pending'
      check (moderation_status in ('pending','approved','rejected')),
    moderation_notes text, moderated_by uuid references profiles(id),
    moderated_at timestamptz,
    is_premium boolean default false, featured_until timestamptz,
    review_count int default 0, average_rating decimal(3,2) default 0,
    -- 012's CHECK. 'geoapify' is deliberately ABSENT: that is a real constraint
    -- the discovery drafts violate, not a fixture simplification.
    data_source text default 'manual'
      check (data_source in ('manual','user_submitted','osm','ogl','foursquare','business_claimed')),
    license text, osm_id text unique,
    discovery_approved boolean not null default true,
    image_url text, image_source text, image_attribution text, image_license text,
    created_at timestamptz default now(), updated_at timestamptz default now());

  -- ── 001: facilities (needed by 061's resolve_facility_conflict) ───────────
  create table facilities (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    slug text not null unique,
    icon text not null default 'x',
    created_at timestamptz default now());
  create table venue_facilities (
    venue_id uuid references venues(id) on delete cascade,
    facility_id uuid references facilities(id) on delete cascade,
    notes text,
    primary key (venue_id, facility_id));

  create table opening_hours (
    id uuid primary key default gen_random_uuid(),
    venue_id uuid references venues(id) on delete cascade,
    day_of_week int not null, opens_at time, closes_at time,
    is_closed boolean default false, notes text);

  create or replace function touch_updated_at() returns trigger
  language plpgsql as $fn$ begin new.updated_at = now(); return new; end $fn$;
  create trigger venues_updated_at before update on venues
    for each row execute function touch_updated_at();

  -- ── 056: enrichment runs + proposals, with 057's decision columns ──────────
  create table venue_enrichment_runs (
    id uuid primary key default gen_random_uuid(),
    venue_id uuid not null references venues(id) on delete cascade,
    run_label text not null, source_website text,
    outcome text not null, created_at timestamptz default now());

  create table venue_field_proposals (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null references venue_enrichment_runs(id) on delete cascade,
    venue_id uuid not null references venues(id) on delete cascade,
    field text not null check (field in (
      'description','price_range','website','booking_url','phone','email','opening_hours')),
    proposed_value jsonb not null,
    current_value jsonb,
    current_value_hash text not null,
    source_url text not null,
    evidence_snippet text not null,
    evidence_raw text,
    retrieved_at timestamptz not null default now(),
    extraction_method text not null default 'heuristic',
    confidence text not null default 'medium',
    conflicts_existing boolean not null default false,
    status text not null default 'pending'
      check (status in ('pending','approved','rejected','applied','superseded','report_only')),
    applied_at timestamptz,
    reviewed_by uuid references profiles(id),
    reviewed_at timestamptz,
    review_notes text,
    -- 057 decision columns. THE canonical provenance surface.
    decision text check (decision in ('auto_apply','manual_review','auto_reject','report_only')),
    decision_reasons jsonb not null default '[]'::jsonb
      check (jsonb_typeof(decision_reasons) = 'array'),
    decision_engine_version text,
    decision_at timestamptz,
    applied_mode text check (applied_mode in ('auto','manual')));

  -- ── 056 snapshot_current_value: the LIVE definition, verbatim ─────────────
  -- 057 did NOT redefine this. booking_url returns a hardcoded null because the
  -- column does not exist in production.
  create or replace function snapshot_current_value(p_venue_id uuid, p_field text)
  returns jsonb language plpgsql stable security definer set search_path = public as $fn$
  declare v_value jsonb; v_text text;
  begin
    if p_field = 'opening_hours' then
      select coalesce(jsonb_agg(jsonb_build_object(
               'day_of_week', day_of_week, 'is_closed', is_closed,
               'opens_at', opens_at, 'closes_at', closes_at, 'notes', notes
             ) order by day_of_week), '[]'::jsonb)
        into v_value from opening_hours where venue_id = p_venue_id;
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
    if p_field <> 'opening_hours' and v_value is not null then
      v_value := jsonb_build_object('v', v_value);
    end if;
    v_text := p_field || ':' || coalesce(v_value::text, 'null');
    return jsonb_build_object('value', v_value,
      'hash', encode(sha256(convert_to(v_text, 'UTF8')), 'hex'));
  end $fn$;

  -- ── 057: the immutable ledger ─────────────────────────────────────────────
  create table venue_enrichment_writes (
    id uuid primary key default gen_random_uuid(),
    run_id uuid references venue_enrichment_runs(id),
    proposal_id uuid references venue_field_proposals(id),
    venue_id uuid not null references venues(id),
    field text not null,
    operation text not null check (operation in ('apply','rollback')),
    old_value jsonb, old_value_hash text,
    new_value jsonb, new_value_hash text,
    applied_mode text check (applied_mode in ('auto','manual')),
    applied_by uuid references profiles(id) on delete set null,
    decision_reasons jsonb not null default '[]'::jsonb,
    source_url text, evidence_snapshot text,
    applied_at timestamptz not null default now(),
    reverts_write_id uuid references venue_enrichment_writes(id));

  alter table venue_enrichment_writes enable row level security;
  create policy "writes_admin_select" on venue_enrichment_writes
    for select using (is_admin());
  -- 057's deliberate revoke: append-only, service_role included.
  revoke insert, update, delete on venue_enrichment_writes
    from public, anon, authenticated, service_role;

  -- ── 057: the single audited write primitive ───────────────────────────────
  create or replace function _enrichment_apply_write(
    p_proposal_id uuid, p_applied_text text, p_mode text,
    p_applied_by uuid, p_decision_reasons jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $fn$
  declare
    p venue_field_proposals%rowtype;
    v_snap jsonb; v_val text; v_new_hash text; v_new_val jsonb;
    v_day jsonb; v_dow int; v_open time; v_close time;
  begin
    select * into p from venue_field_proposals where id = p_proposal_id;
    if not found then raise exception 'not_found'; end if;

    -- booking_url has no target column in production. THIS is the extension
    -- point the 057 rebase must address (see PART E in the redline suite).
    if p.field = 'booking_url' then raise exception 'no_target_column'; end if;

    v_snap := snapshot_current_value(p.venue_id, p.field);
    if (v_snap ->> 'hash') is distinct from p.current_value_hash then
      raise exception 'stale_current_value';
    end if;

    if p.field = 'price_range' then
      v_val := p.proposed_value ->> 'v';
      if v_val is null or v_val not in ('free','budget','moderate','premium') then
        raise exception 'invalid_enum_value:%', coalesce(v_val,'null');
      end if;
      update venues set price_range = v_val, updated_at = now() where id = p.venue_id;
      v_new_val := jsonb_build_object('v', v_val);
    elsif p.field in ('website','phone','email') then
      v_val := p.proposed_value ->> 'v';
      if p.field = 'email' and (v_val is null
         or v_val !~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$') then
        raise exception 'invalid_email';
      end if;
      if p.field = 'website' then
        update venues set website = v_val, updated_at = now() where id = p.venue_id;
      elsif p.field = 'phone' then
        update venues set phone = v_val, updated_at = now() where id = p.venue_id;
      else
        update venues set email = v_val, updated_at = now() where id = p.venue_id;
      end if;
      v_new_val := jsonb_build_object('v', v_val);
    elsif p.field = 'description' then
      if p_applied_text is null or btrim(p_applied_text) = '' then
        raise exception 'description_text_required';
      end if;
      if btrim(p_applied_text) = btrim(coalesce(p.evidence_snippet,''))
         or btrim(p_applied_text) = btrim(coalesce(p.evidence_raw,'')) then
        raise exception 'description_not_rewritten';
      end if;
      update venues set description = p_applied_text, updated_at = now() where id = p.venue_id;
      v_new_val := jsonb_build_object('v', p_applied_text);
    elsif p.field = 'opening_hours' then
      if jsonb_typeof(p.proposed_value -> 'days') is distinct from 'array'
         or jsonb_array_length(p.proposed_value -> 'days') <> 7 then
        raise exception 'incomplete_week';
      end if;
      delete from opening_hours where venue_id = p.venue_id;
      for v_day in select * from jsonb_array_elements(p.proposed_value -> 'days') loop
        v_dow := (v_day ->> 'day_of_week')::int;
        if coalesce((v_day ->> 'is_closed')::boolean, false) then
          insert into opening_hours (venue_id, day_of_week, is_closed)
            values (p.venue_id, v_dow, true);
        else
          select min((iv ->> 'opens')::time), max((iv ->> 'closes')::time)
            into v_open, v_close from jsonb_array_elements(v_day -> 'intervals') iv;
          insert into opening_hours (venue_id, day_of_week, opens_at, closes_at, is_closed)
            values (p.venue_id, v_dow, v_open, v_close, false);
        end if;
      end loop;
      v_new_val := p.proposed_value;
    else
      raise exception 'invalid_field:%', p.field;
    end if;

    v_new_hash := snapshot_current_value(p.venue_id, p.field) ->> 'hash';

    update venue_field_proposals
       set status = 'applied', applied_at = now(),
           reviewed_by = p_applied_by, reviewed_at = now(), applied_mode = p_mode
     where id = p_proposal_id;

    insert into venue_enrichment_writes (
      run_id, proposal_id, venue_id, field, operation,
      old_value, old_value_hash, new_value, new_value_hash,
      applied_mode, applied_by, decision_reasons, source_url, evidence_snapshot)
    values (
      p.run_id, p.id, p.venue_id, p.field, 'apply',
      p.current_value, p.current_value_hash, v_new_val, v_new_hash,
      p_mode, p_applied_by, coalesce(p_decision_reasons,'[]'::jsonb),
      p.source_url, p.evidence_snippet);

    return jsonb_build_object('ok', true, 'field', p.field);
  end $fn$;
  revoke all on function _enrichment_apply_write(uuid, text, text, uuid, jsonb)
    from public, anon, authenticated, service_role;

  -- ── 057: admin manual apply + autonomous apply ────────────────────────────
  create or replace function apply_venue_proposal(p_proposal_id uuid, p_applied_text text default null)
  returns jsonb language plpgsql security definer set search_path = public as $fn$
  begin
    if not is_admin() then raise exception 'not_admin'; end if;
    return _enrichment_apply_write(p_proposal_id, p_applied_text, 'manual', auth.uid(), '[]'::jsonb);
  end $fn$;
  revoke all on function apply_venue_proposal(uuid, text) from public, anon;
  grant execute on function apply_venue_proposal(uuid, text) to authenticated, service_role;

  create or replace function auto_apply_venue_proposal(p_proposal_id uuid, p_applied_text text default null)
  returns jsonb language plpgsql security definer set search_path = public as $fn$
  declare p venue_field_proposals%rowtype; v_live jsonb;
  begin
    if not is_admin() then return jsonb_build_object('ok', false, 'reason','not_authorized'); end if;
    select * into p from venue_field_proposals where id = p_proposal_id;
    if not found then return jsonb_build_object('ok', false, 'reason','not_found'); end if;
    if p.decision is distinct from 'auto_apply' then
      return jsonb_build_object('ok', false, 'reason','moved_to_manual_review');
    end if;
    -- 057's non-empty live value guard: never auto-overwrite existing data.
    v_live := snapshot_current_value(p.venue_id, p.field) -> 'value';
    if v_live is not null and p.field <> 'opening_hours' then
      return jsonb_build_object('ok', false, 'reason','live_value_not_empty');
    end if;
    return _enrichment_apply_write(p_proposal_id, p_applied_text, 'auto',
                                   auth.uid(), p.decision_reasons);
  end $fn$;
  revoke all on function auto_apply_venue_proposal(uuid, text)
    from public, anon, authenticated, service_role;
  grant execute on function auto_apply_venue_proposal(uuid, text) to authenticated;

  -- ── 057: rollback, with the newer-change guard ────────────────────────────
  create or replace function rollback_enrichment_run(p_run_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $fn$
  declare w record; v_snap jsonb; v_val text; v_out text; v_results jsonb := '[]'::jsonb;
  begin
    if not is_admin() then raise exception 'not_authorized'; end if;
    for w in select * from venue_enrichment_writes ew
              where ew.run_id = p_run_id and ew.operation = 'apply'
              order by ew.applied_at desc loop
      if exists (select 1 from venue_enrichment_writes
                  where reverts_write_id = w.id and operation = 'rollback') then
        v_out := 'already_rolled_back';
      else
        v_snap := snapshot_current_value(w.venue_id, w.field);
        if (v_snap ->> 'hash') is distinct from w.new_value_hash then
          v_out := 'skipped_newer_change';
        else
          v_val := w.old_value ->> 'v';
          if w.field = 'website' then
            update venues set website = v_val, updated_at = now() where id = w.venue_id;
          elsif w.field = 'phone' then
            update venues set phone = v_val, updated_at = now() where id = w.venue_id;
          elsif w.field = 'email' then
            update venues set email = v_val, updated_at = now() where id = w.venue_id;
          elsif w.field = 'description' then
            update venues set description = v_val, updated_at = now() where id = w.venue_id;
          elsif w.field = 'price_range' then
            update venues set price_range = v_val, updated_at = now() where id = w.venue_id;
          elsif w.field = 'opening_hours' then
            delete from opening_hours where venue_id = w.venue_id;
          else
            -- NOTE: no branch for booking_url or operating_status. Any field the
            -- rebase adds to the ledger MUST also be added here or its writes
            -- become unrollbackable.
            v_out := 'unsupported_field';
          end if;
          if v_out is distinct from 'unsupported_field' then
            insert into venue_enrichment_writes (
              run_id, proposal_id, venue_id, field, operation,
              old_value, old_value_hash, new_value, new_value_hash,
              applied_mode, applied_by, reverts_write_id)
            values (w.run_id, w.proposal_id, w.venue_id, w.field, 'rollback',
              w.new_value, w.new_value_hash, w.old_value, w.old_value_hash,
              w.applied_mode, auth.uid(), w.id);
            v_out := 'rolled_back';
          end if;
        end if;
      end if;
      v_results := v_results || jsonb_build_object('field', w.field, 'outcome', v_out);
    end loop;
    return jsonb_build_object('ok', true, 'results', v_results);
  end $fn$;
  revoke all on function rollback_enrichment_run(uuid)
    from public, anon, authenticated, service_role;
  grant execute on function rollback_enrichment_run(uuid) to authenticated;

  -- ── 056: reject_venue_proposal, verbatim ──────────────────────────────────
  -- Field-agnostic by construction: it only ever moves a proposal's status and
  -- never touches a target column, which is why adding booking_url to the
  -- enrichment field set needed no change to the REJECT half of the workflow.
  -- 057 did NOT redefine it.
  create or replace function reject_venue_proposal(p_proposal_id uuid, p_notes text)
  returns jsonb language plpgsql security definer set search_path = public as $fn$
  declare v_status text;
  begin
    if not is_admin() then raise exception 'not_admin'; end if;
    select status into v_status from venue_field_proposals where id = p_proposal_id;
    if not found then raise exception 'not_found'; end if;
    if v_status not in ('pending','approved') then
      raise exception 'not_pending:%', v_status; end if;
    update venue_field_proposals
       set status = 'rejected', review_notes = p_notes,
           reviewed_by = auth.uid(), reviewed_at = now()
     where id = p_proposal_id;
    return jsonb_build_object('ok', true);
  end $fn$;
  revoke all on function reject_venue_proposal(uuid, text)
    from public, anon, authenticated, service_role;
  grant execute on function reject_venue_proposal(uuid, text) to authenticated, service_role;

  -- ── 063: submission invariants + the EXACT 15-column INSERT grant ─────────
  create or replace function enforce_venue_submission_invariants() returns trigger
  language plpgsql security invoker set search_path = '' as $fn$
  begin
    if current_user not in ('anon','authenticated') then return new; end if;
    if new.claimed_by is not null then raise exception 'venue cannot be claimed at insert'
      using errcode = '42501'; end if;
    if new.is_verified then raise exception 'is_verified must be false'
      using errcode = '42501'; end if;
    if new.is_published then raise exception 'is_published must be false'
      using errcode = '42501'; end if;
    if new.moderation_status is distinct from 'pending' then
      raise exception 'moderation_status must be pending' using errcode = '42501'; end if;
    if new.submitted_by is distinct from (select auth.uid()) then
      raise exception 'submitted_by must be the caller' using errcode = '42501'; end if;
    return new;
  end $fn$;
  create trigger venues_enforce_submission_invariants before insert on venues
    for each row execute function enforce_venue_submission_invariants();

  revoke insert on public.venues from public, anon, authenticated;
  grant insert (name, description, category_id, address_line1, city, postcode,
                latitude, longitude, phone, website, min_age, max_age,
                submitted_by, moderation_status, is_published)
    on public.venues to authenticated;

  revoke update on public.profiles from public, anon, authenticated;
  grant update (username, full_name, bio, avatar_url, children_ages, postcode,
                show_in_search, show_reviews_publicly, marketing_consent,
                terms_accepted_at)
    on public.profiles to authenticated;

  -- ── PP-011: the owner UPDATE boundary ─────────────────────────────────────
  create or replace function enforce_venue_owner_update_boundary() returns trigger
  language plpgsql security invoker set search_path = '' as $fn$
  declare
    c_owner_editable constant text[] := array['description','phone','email','website',
      'price_range','min_age','max_age','updated_at'];
    v_old jsonb; v_new jsonb; v_changed text[]; v_uid uuid;
  begin
    if current_user = 'anon' then
      raise exception 'venues: anonymous callers may not update venues' using errcode = '42501';
    end if;
    if current_user <> 'authenticated' then return new; end if;
    v_old := to_jsonb(OLD) - c_owner_editable;
    v_new := to_jsonb(NEW) - c_owner_editable;
    if v_old is not distinct from v_new then
      v_uid := private.current_uid();
      if v_uid is not null and v_uid = OLD.claimed_by then return new; end if;
      if public.is_admin() then return new; end if;
      raise exception 'venues: only the claimed owner or an admin may update this venue'
        using errcode = '42501';
    end if;
    if public.is_admin() then return new; end if;
    select array_agg(e.key order by e.key) into v_changed
      from jsonb_each(v_old) as e where e.value is distinct from (v_new -> e.key);
    raise exception 'venues: a claimed owner may not change %', array_to_string(v_changed, ', ')
      using errcode = '42501';
  end $fn$;
  create trigger venues_enforce_owner_update_boundary before update on venues
    for each row execute function enforce_venue_owner_update_boundary();

  alter table venues enable row level security;
  create policy "Approved venues are public" on venues
    for select using (is_published = true and moderation_status = 'approved');
  create policy "Owners can view own venues" on venues
    for select using (auth.uid() = submitted_by or auth.uid() = claimed_by);
  create policy "Admins can view all venues" on venues for select using (is_admin());
  create policy "Authenticated users can submit venues" on venues
    for insert to authenticated with check (
      auth.uid() = submitted_by and moderation_status = 'pending'
      and is_published = false and is_verified = false);
  create policy "Owners can update claimed venue" on venues
    for update to authenticated
    using ((select auth.uid()) = claimed_by) with check ((select auth.uid()) = claimed_by);
  create policy "Admins can update any venue" on venues
    for update to authenticated using (is_admin());

  -- ── 20260830102402: privilege hardening, as production now stands ─────────
  revoke truncate, references, trigger on all tables in schema public
    from anon, authenticated;
  do $do$ begin
    if current_setting('server_version_num')::int >= 170000 then
      execute 'revoke maintain on all tables in schema public from anon, authenticated';
    end if;
  end $do$;
  revoke execute on function touch_updated_at() from public, anon, authenticated, service_role;

  insert into profiles (id, is_admin) values
    ('${OWNER}', false), ('${OTHER}', false), ('${ADMIN}', true);
`;

// ── Draft-only delta ─────────────────────────────────────────────────────────
// Applied ONLY by tests that need to exercise unapplied 059/060 behaviour.
// Keeping this separate is what stops the bootstrap asserting a world that
// production is not in.
// ⚠ These definitions must stay BYTE-COMPATIBLE with draft 059's own
// ALTER TABLE venues. Because both use ADD COLUMN IF NOT EXISTS, whichever runs
// first wins and the other silently no-ops -- so a stub that disagrees does not
// fail loudly, it just makes every downstream test assert the wrong world. An
// earlier version of this stub declared operating_status DEFAULT 'open' with no
// CHECK, while 059 declares DEFAULT 'active' CHECK (active|suspected_closed|
// confirmed_closed). The redline asserts the two agree (test H0).
export const DRAFT_COLUMNS = `
  alter table venues
    add column if not exists booking_url text,
    add column if not exists operating_status text not null default 'active'
      check (operating_status in ('active', 'suspected_closed', 'confirmed_closed')),
    add column if not exists operating_status_updated_at timestamptz;
`;

// ── Migration-text extractors ────────────────────────────────────────────────
// Every enrichment suite loads the REAL draft SQL rather than a reproduction of
// it, which means every suite needs these two. They lived as a copy-paste in
// five files until a bug in one of them (silently dropping a REVOKE/GRANT block
// that sat behind an explanatory comment, so the function under test kept its
// DEFAULT ACL and the ACL test passed anyway) had to be fixed five times. One
// definition now.

// Pulls "CREATE OR REPLACE FUNCTION <name>(" through its terminating $$; and the
// REVOKE/GRANT statements that belong to it.
export function extractFn(sql, name) {
  const lines = sql.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^CREATE OR REPLACE FUNCTION ${name}\\s*\\(`, 'i').test(l));
  if (start < 0) throw new Error(`function ${name} not found in draft`);
  let end = start;
  while (end < lines.length && lines[end].trim() !== '$$;') end += 1;
  if (end >= lines.length) throw new Error(`unterminated ${name}`);

  let tail = end + 1;
  let accepted = tail;      // last position we KNOW belongs to this function
  let inStatement = false;
  while (tail < lines.length) {
    const l = lines[tail];
    if (inStatement) {
      tail += 1;
      if (l.trim().endsWith(';')) { inStatement = false; accepted = tail; }
      continue;
    }
    // Blank lines and -- comments routinely separate a function from its own
    // REVOKE/GRANT block, because the grants carry the reasoning for WHY a role
    // is or is not permitted. Scan past them, but only KEEP them if a matching
    // grant actually turns up; otherwise rewind, so a comment belonging to the
    // next object is never swallowed.
    if (/^[ \t]*$/.test(l) || /^[ \t]*--/.test(l)) { tail += 1; continue; }
    if (/^(REVOKE|GRANT)/i.test(l) && l.includes(name)) {
      inStatement = !l.trim().endsWith(';');
      tail += 1;
      if (!inStatement) accepted = tail;
      continue;
    }
    break;
  }
  return lines.slice(start, accepted).join('\n');
}

// Pulls a marked block:  -- @test-section: <name> ... -- @end-section: <name>
export function extractSection(sql, name) {
  const a = sql.indexOf(`-- @test-section: ${name}`);
  const b = sql.indexOf(`-- @end-section: ${name}`);
  if (a < 0 || b < 0 || b < a) throw new Error(`section ${name} not found in draft`);
  return sql.slice(sql.indexOf('\n', a) + 1, b);
}

// ── Shared helpers ───────────────────────────────────────────────────────────
export function makeHelpers(db) {
  const q = (sql, params) => db.query(sql, params);
  const asUser = async (uid) => {
    await db.query(`select set_config('test.uid', $1, false)`, [uid]);
    await db.exec('set role authenticated');
  };
  const asAnon = async () => {
    await db.query(`select set_config('test.uid','',false)`);
    await db.exec('set role anon');
  };
  const asService = async () => {
    await db.query(`select set_config('test.uid','',false)`);
    await db.exec('set role service_role');
  };
  const reset = async () => {
    await db.exec('reset role');
    await db.query(`select set_config('test.uid','',false)`);
  };

  async function newVenue(opts = {}) {
    await reset();
    const r = await q(
      `insert into venues (name, city, postcode, latitude, longitude, submitted_by,
                           claimed_by, is_published, moderation_status, website, phone,
                           description, data_source)
       values ($1,'Bath','BA1 1AA',51.38,-2.36,$2,$3,true,'approved',$4,$5,$6,'manual')
       returning id`,
      [opts.name ?? `V-${Math.random().toString(36).slice(2, 9)}`,
       opts.submitted_by ?? OWNER, opts.claimed_by ?? null,
       opts.website ?? null, opts.phone ?? null, opts.description ?? null]);
    return r.rows[0].id;
  }

  // Creates a run + a proposal whose current_value_hash is a REAL snapshot, so
  // the stale guard behaves exactly as it does in production.
  async function newProposal(venueId, field, proposedValue, opts = {}) {
    await reset();
    const run = (await q(
      `insert into venue_enrichment_runs (venue_id, run_label, outcome)
       values ($1,'test-run','extracted') returning id`, [venueId])).rows[0].id;
    const snap = (await q(`select snapshot_current_value($1,$2) as s`, [venueId, field])).rows[0].s;
    const p = (await q(
      `insert into venue_field_proposals
         (run_id, venue_id, field, proposed_value, current_value, current_value_hash,
          source_url, evidence_snippet, decision, decision_reasons,
          decision_engine_version, decision_at)
       values ($1,$2,$3,$4,$5,$6,'https://example.test','evidence',
               $7,$8,$9,now())
       returning id`,
      [run, venueId, field, JSON.stringify(proposedValue), JSON.stringify(snap.value),
       snap.hash, opts.decision ?? 'auto_apply',
       JSON.stringify(opts.decision_reasons ?? [{ code: 'test' }]),
       opts.decision_engine_version ?? 'test-1.0'])).rows[0].id;
    return { run, proposal: p, snap };
  }

  // Creates a discovery candidate. Only usable once the draft discovery
  // schema is loaded. Defaults are a candidate that passes every accept gate,
  // so a test states ONLY the thing it is actually varying.
  async function newCandidate(opts = {}) {
    await reset();
    const row = {
      name: `C-${Math.random().toString(36).slice(2, 9)}`,
      latitude: 51.38, longitude: -2.36,
      postcode: 'BA1 1AA', address_line1: '1 High St', city: 'Bath',
      phone: null, website: null,
      source: 'osm', source_id: `node/${Math.floor(Math.random() * 1e9)}`,
      dedupe_decision: 'distinct', confidence_score: 99,
      has_family_relevant_category: true, has_valid_uk_coordinates: true,
      has_valid_address: true, is_trusted_source: true,
      official_verification: true, has_closure_signal: false,
      required_fields_complete: true, status: 'candidate',
      ...opts,
    };
    // A geoapify candidate is unpublishable without the provider's own
    // datasource statement (059's provenance mapping FAILS CLOSED on it), so a
    // realistic one is supplied by default -- byte-identical to the shape in
    // scripts/enrich/fixtures/geoapify-real/. A test that wants to exercise the
    // fail-closed path passes `source_datasource: null` explicitly.
    if (row.source === 'geoapify' && !('source_datasource' in opts)) {
      row.source_datasource = GEOAPIFY_OSM_DATASOURCE;
    }
    const cols = Object.keys(row);
    const r = await q(
      `insert into venue_discovery_candidates (${cols.join(', ')})
       values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
      cols.map((c) => (c === 'source_datasource' && row[c] !== null
        ? JSON.stringify(row[c]) : row[c])));
    return r.rows[0].id;
  }

  const candidate = async (id) =>
    (await q(`select * from venue_discovery_candidates where id = $1`, [id])).rows[0];

  const venueByName = async (name) =>
    (await q(`select * from venues where name = $1`, [name])).rows[0] ?? null;

  const ledgerFor = async (proposalId) =>
    (await q(`select * from venue_enrichment_writes where proposal_id = $1
               and operation = 'apply' order by applied_at desc`, [proposalId])).rows;

  const colPrivs = async (role, table, privs) => {
    const out = {};
    for (const p of privs) {
      out[p] = (await q(`select has_table_privilege($1,$2,$3) as x`, [role, table, p])).rows[0].x;
    }
    return out;
  };

  const fnAcl = async (fn) => ({
    exists: (await q(`select to_regprocedure($1) is not null as x`, [fn])).rows[0].x,
    PUBLIC: (await q(
      `select exists (select 1 from pg_proc p,
         lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
        where p.oid = to_regprocedure($1) and g.grantee = 0
          and g.privilege_type = 'EXECUTE') as x`, [fn])).rows[0].x,
    anon: (await q(`select has_function_privilege('anon', to_regprocedure($1),'EXECUTE') as x`, [fn])).rows[0].x,
    authenticated: (await q(`select has_function_privilege('authenticated', to_regprocedure($1),'EXECUTE') as x`, [fn])).rows[0].x,
    service_role: (await q(`select has_function_privilege('service_role', to_regprocedure($1),'EXECUTE') as x`, [fn])).rows[0].x,
  });

  return { q, asUser, asAnon, asService, reset, newVenue, newProposal,
           newCandidate, candidate, venueByName, ledgerFor, colPrivs, fnAcl };
}

// ── Shared assert harness ────────────────────────────────────────────────────
export function makeHarness() {
  const state = { passed: 0, failures: [], red: [] };
  async function test(name, fn) {
    try { await fn(); state.passed += 1; console.log(`  PASS  ${name}`); }
    catch (e) {
      state.failures.push({ name, message: e?.message ?? String(e) });
      console.log(`  FAIL  ${name}\n        ${e?.message ?? e}`);
    }
  }
  // A RED test documents a KNOWN current defect. It is expected to fail now and
  // must go green only when the 057 rebase lands. Reported separately so a real
  // regression is never hidden among intentional reds.
  async function red(name, fn) {
    try {
      await fn();
      state.red.push({ name, outcome: 'UNEXPECTEDLY GREEN' });
      console.log(`  RED?  ${name}\n        unexpectedly PASSED -- defect may already be fixed`);
    } catch (e) {
      state.red.push({ name, outcome: 'red (expected)', message: e?.message ?? String(e) });
      console.log(`  RED   ${name}\n        ${(e?.message ?? String(e)).slice(0, 150)}`);
    }
  }
  function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
  function eq(a, b, m) {
    if (a !== b) throw new Error(`${m || 'not equal'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
  async function throws(pr, re, m) {
    try { await pr; } catch (e) {
      const s = e?.message ?? String(e);
      if (re && !re.test(s)) throw new Error(`${m || 'wrong error'}: ${s}`);
      return s;
    }
    throw new Error(m || `expected a throw matching ${re}`);
  }
  return { state, test, red, assert, eq, throws };
}
