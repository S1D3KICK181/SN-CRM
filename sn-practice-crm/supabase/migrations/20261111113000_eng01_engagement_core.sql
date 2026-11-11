-- Migration: 20261111113000_eng01_engagement_core.sql
-- Description: ENG-01-A1 Engagement Core Schema, Authority, and Lifecycle

begin;

-- 1. Create Enums
create type public.engagement_status as enum ('draft', 'active', 'ended');
create type public.engagement_fee_model as enum ('fixed', 'recurring', 'milestone', 'time_based');
create type public.engagement_end_outcome as enum ('completed', 'terminated');

-- 2. Create Sequence for ENG codes (starting at 1001)
create sequence if not exists public.engagement_code_seq start with 1001;

revoke all on public.engagement_code_seq from anon;
grant usage, select on public.engagement_code_seq to authenticated;

-- 3. Create public.engagements aggregate table
create table public.engagements (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique default (
    'ENG-' || lpad(nextval('public.engagement_code_seq')::text, 6, '0')
  ),
  client_id uuid not null references public.clients(id) on delete restrict,
  service_id uuid not null references public.service_catalog(id) on delete restrict,
  status public.engagement_status not null default 'draft',
  approved_version_id uuid, -- foreign key added after engagement_versions table is created
  approved_at timestamptz,
  approved_by uuid references public.profiles(user_id) on delete restrict,
  ended_at timestamptz,
  ended_by uuid references public.profiles(user_id) on delete restrict,
  end_outcome public.engagement_end_outcome,
  end_reason text check (end_reason is null or char_length(trim(end_reason)) between 2 and 500),
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint engagement_status_lifecycle_check check (
    (
      status = 'draft'
      and approved_version_id is null
      and approved_at is null
      and approved_by is null
      and ended_at is null
      and ended_by is null
      and end_outcome is null
      and end_reason is null
    )
    or
    (
      status = 'active'
      and approved_version_id is not null
      and approved_at is not null
      and approved_by is not null
      and ended_at is null
      and ended_by is null
      and end_outcome is null
      and end_reason is null
    )
    or
    (
      status = 'ended'
      and approved_version_id is not null
      and approved_at is not null
      and approved_by is not null
      and ended_at is not null
      and ended_by is not null
      and end_outcome is not null
      and end_reason is not null
      and char_length(trim(end_reason)) >= 2
    )
  )
);

-- Indexes for public.engagements
create index engagements_client_idx on public.engagements (client_id);
create index engagements_service_idx on public.engagements (service_id);
create index engagements_status_idx on public.engagements (status);
create index engagements_approved_version_idx on public.engagements (approved_version_id);

-- 4. Create public.engagement_versions table
create table public.engagement_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  title text not null check (char_length(trim(title)) between 2 and 180),
  scope text not null check (char_length(trim(scope)) >= 2),
  exclusions text,
  responsible_partner_id uuid not null references public.profiles(user_id) on delete restrict,
  delivery_manager_id uuid not null references public.profiles(user_id) on delete restrict,
  fee_model public.engagement_fee_model not null,
  agreed_fee_paise bigint not null check (agreed_fee_paise between 0 and 9007199254740991),
  billing_terms text not null check (char_length(trim(billing_terms)) >= 2),
  start_date date not null,
  end_date date check (end_date is null or end_date >= start_date),
  approved_at timestamptz,
  approved_by uuid references public.profiles(user_id) on delete restrict,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),

  constraint engagement_version_unique_per_engagement unique (engagement_id, version_number),
  constraint engagement_version_approval_pair check (
    (approved_at is null and approved_by is null)
    or
    (approved_at is not null and approved_by is not null)
  )
);

-- Indexes for public.engagement_versions
create index engagement_versions_engagement_idx on public.engagement_versions (engagement_id);
create index engagement_versions_partner_idx on public.engagement_versions (responsible_partner_id);
create index engagement_versions_manager_idx on public.engagement_versions (delivery_manager_id);

-- Add foreign key constraint from engagements.approved_version_id to engagement_versions(id)
alter table public.engagements
  add constraint fk_engagements_approved_version
  foreign key (approved_version_id)
  references public.engagement_versions(id)
  on delete restrict;

-- 5. Enable RLS on both tables
alter table public.engagements enable row level security;
alter table public.engagement_versions enable row level security;

-- 6. RLS Policies: Management-only (Founder/Manager), No DELETE policies
create policy engagements_select on public.engagements
  for select to authenticated
  using (public.is_management());

create policy engagements_insert on public.engagements
  for insert to authenticated
  with check (public.is_management());

create policy engagements_update on public.engagements
  for update to authenticated
  using (public.is_management())
  with check (public.is_management());

create policy engagement_versions_select on public.engagement_versions
  for select to authenticated
  using (public.is_management());

create policy engagement_versions_insert on public.engagement_versions
  for insert to authenticated
  with check (public.is_management());

create policy engagement_versions_update on public.engagement_versions
  for update to authenticated
  using (public.is_management())
  with check (public.is_management());

grant select, insert, update on public.engagements to authenticated;
grant select, insert, update on public.engagement_versions to authenticated;

-- 7. Triggers: set_updated_at on engagements
create trigger set_engagements_updated_at
  before update on public.engagements
  for each row execute function public.set_updated_at();

-- 8. Triggers: audit_row_change on both tables
create trigger audit_engagements
  after insert or update or delete on public.engagements
  for each row execute function public.audit_row_change();

create trigger audit_engagement_versions
  after insert or update or delete on public.engagement_versions
  for each row execute function public.audit_row_change();

-- 9. Triggers: prevent_demo_flag_tampering on both tables
create trigger prevent_demo_flag_tampering
  before update on public.engagements
  for each row execute function public.prevent_demo_flag_tampering();

create trigger prevent_demo_flag_tampering
  before update on public.engagement_versions
  for each row execute function public.prevent_demo_flag_tampering();

-- 10. Write Guard Triggers and Domain Invariants

-- Guard function for public.engagement_versions
create or replace function public.guard_engagement_version_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.app_role;
  v_partner_role public.app_role;
  v_manager_role public.app_role;
  v_parent_engagement record;
begin
  -- Bypass if running within authorized demo cleanup
  if coalesce(current_setting('app.demo_cleanup', true), '') = 'on' then
    if tg_op = 'DELETE' then
      return old;
    else
      return new;
    end if;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Engagement versions cannot be deleted.' using errcode = '42501';
  end if;

  if v_actor is not null then
    v_actor_role := public.role_of(v_actor);
    if v_actor_role not in ('founder', 'manager') then
      raise exception 'Only Founder or Manager may create or revise engagement versions.'
        using errcode = '42501';
    end if;
  end if;

  -- Validate responsible_partner_id must resolve to an active Founder
  v_partner_role := public.role_of(new.responsible_partner_id);
  if v_partner_role is null or v_partner_role <> 'founder' then
    raise exception 'The responsible partner must be an active Founder.'
      using errcode = '23514';
  end if;

  -- Validate delivery_manager_id must resolve to an active management user (founder or manager)
  v_manager_role := public.role_of(new.delivery_manager_id);
  if v_manager_role is null or v_manager_role not in ('founder', 'manager') then
    raise exception 'The delivery manager must be an active Founder or Manager.'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.created_by := v_actor;
    end if;

    -- Verify parent engagement exists and is not ended
    select status, is_demo into v_parent_engagement
    from public.engagements
    where id = new.engagement_id;

    if not found then
      raise exception 'Parent engagement does not exist.' using errcode = '23503';
    end if;

    if v_parent_engagement.status = 'ended' then
      raise exception 'Cannot create versions on an ended engagement.' using errcode = '23514';
    end if;

    -- is_demo must match parent engagement
    if new.is_demo <> v_parent_engagement.is_demo then
      new.is_demo := v_parent_engagement.is_demo;
    end if;

    -- Approved fields on insert: only Founder may insert pre-approved version
    if new.approved_at is not null or new.approved_by is not null then
      if v_actor is not null and v_actor_role <> 'founder' then
        raise exception 'Only the Founder may approve an engagement version.'
          using errcode = '42501';
      end if;
      if v_actor is not null then
        new.approved_by := v_actor;
        new.approved_at := now();
      elsif new.approved_by is not null and new.approved_at is null then
        new.approved_at := now();
      end if;
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Verify parent engagement exists and is not ended
    select status into v_parent_engagement
    from public.engagements
    where id = new.engagement_id;

    if not found then
      raise exception 'Parent engagement does not exist.' using errcode = '23503';
    end if;

    if v_parent_engagement.status = 'ended' then
      raise exception 'Cannot update versions on an ended engagement.' using errcode = '23514';
    end if;

    -- Once approved, version is immutable
    if old.approved_at is not null then
      raise exception 'Approved engagement versions are strictly immutable.'
        using errcode = '23514';
    end if;

    -- Structural immutability on unapproved versions
    if new.engagement_id is distinct from old.engagement_id
       or new.version_number is distinct from old.version_number
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.is_demo is distinct from old.is_demo then
      raise exception 'Engagement version identity and provenance are immutable.'
        using errcode = '23514';
    end if;

    -- Approval transition: unapproved -> approved
    if new.approved_at is not null or new.approved_by is not null then
      if v_actor is not null and v_actor_role <> 'founder' then
        raise exception 'Only the Founder may approve an engagement version.'
          using errcode = '42501';
      end if;
      if v_actor is not null then
        new.approved_by := v_actor;
        new.approved_at := now();
      elsif new.approved_by is not null and new.approved_at is null then
        new.approved_at := now();
      end if;
    end if;

    return new;
  end if;

  return new;
end;
$$;

create trigger guard_engagement_version_write
  before insert or update or delete on public.engagement_versions
  for each row execute function public.guard_engagement_version_write();

-- Guard function for public.engagements
create or replace function public.guard_engagement_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.app_role;
  v_client_status public.client_status;
  v_service_active boolean;
  v_approved_ver record;
  v_version_approver_role public.app_role;
begin
  -- Bypass if running within authorized demo cleanup
  if coalesce(current_setting('app.demo_cleanup', true), '') = 'on' then
    if tg_op = 'DELETE' then
      return old;
    else
      return new;
    end if;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Engagements cannot be deleted.' using errcode = '42501';
  end if;

  if v_actor is not null then
    v_actor_role := public.role_of(v_actor);
    if v_actor_role not in ('founder', 'manager') then
      raise exception 'Only Founder or Manager may access engagements.'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.created_by := v_actor;
    end if;

    -- Every normal engagement INSERT must begin in draft
    if new.status <> 'draft' then
      raise exception 'Every new engagement must be created in draft status.'
        using errcode = '23514';
    end if;

    -- Draft insert must have all approval/end metadata null
    if new.approved_version_id is not null
       or new.approved_at is not null
       or new.approved_by is not null
       or new.ended_at is not null
       or new.ended_by is not null
       or new.end_outcome is not null
       or new.end_reason is not null then
      raise exception 'Draft engagement must not have approval or ending metadata.'
        using errcode = '23514';
    end if;

    -- Verify client exists and is active on draft INSERT
    select status into v_client_status
    from public.clients
    where id = new.client_id;

    if not found then
      raise exception 'Client does not exist.' using errcode = '23503';
    end if;

    if v_client_status <> 'active' then
      raise exception 'Client must be active for engagement creation.'
        using errcode = '23514';
    end if;

    -- Verify service exists and is active on draft INSERT
    select is_active into v_service_active
    from public.service_catalog
    where id = new.service_id;

    if not found then
      raise exception 'Service does not exist in catalog.' using errcode = '23503';
    end if;

    if not v_service_active then
      raise exception 'Service must be active in catalog for engagement creation.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Immutability of identity, service, and provenance
    if new.code is distinct from old.code
       or new.client_id is distinct from old.client_id
       or new.service_id is distinct from old.service_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.is_demo is distinct from old.is_demo then
      raise exception 'Engagement identity, client, service, and provenance are immutable.'
        using errcode = '23514';
    end if;

    -- Ended engagements are terminal and immutable
    if old.status = 'ended' then
      raise exception 'Ended engagements are terminal and immutable.'
        using errcode = '23514';
    end if;

    -- Status transitions
    if new.status <> old.status then
      -- Valid transitions: draft -> active, active -> ended
      if old.status = 'draft' and new.status = 'active' then
        if v_actor is not null and v_actor_role <> 'founder' then
          raise exception 'Only the Founder may activate an engagement.'
            using errcode = '42501';
        end if;

        -- Recheck active client on activation
        select status into v_client_status
        from public.clients
        where id = new.client_id;

        if not found or v_client_status <> 'active' then
          raise exception 'Client must be active for engagement activation.'
            using errcode = '23514';
        end if;

        -- Recheck active service on activation
        select is_active into v_service_active
        from public.service_catalog
        where id = new.service_id;

        if not found or not v_service_active then
          raise exception 'Service must be active in catalog for engagement activation.'
            using errcode = '23514';
        end if;

        -- Validate selected approved_version_id
        if new.approved_version_id is null then
          raise exception 'An approved version is required to activate an engagement.'
            using errcode = '23514';
        end if;

        select id, engagement_id, approved_at, approved_by into v_approved_ver
        from public.engagement_versions
        where id = new.approved_version_id;

        if not found then
          raise exception 'Approved version does not exist.' using errcode = '23503';
        end if;

        if v_approved_ver.engagement_id <> new.id then
          raise exception 'Approved version must belong to this engagement.' using errcode = '23514';
        end if;

        if v_approved_ver.approved_at is null or v_approved_ver.approved_by is null then
          raise exception 'Version must be approved before engagement activation.' using errcode = '23514';
        end if;

        v_version_approver_role := public.role_of(v_approved_ver.approved_by);
        if v_version_approver_role is null or v_version_approver_role <> 'founder' then
          raise exception 'Version approver must resolve to an active Founder.' using errcode = '23514';
        end if;

        -- Copy approval metadata from the approved version; do not trust caller-supplied values
        new.approved_at := v_approved_ver.approved_at;
        new.approved_by := v_approved_ver.approved_by;

      elsif old.status = 'active' and new.status = 'ended' then
        if v_actor is not null and v_actor_role <> 'founder' then
          raise exception 'Only the Founder may end an engagement.'
            using errcode = '42501';
        end if;

        -- Ending may not simultaneously change approved_version_id or approval metadata
        if new.approved_version_id is distinct from old.approved_version_id
           or new.approved_at is distinct from old.approved_at
           or new.approved_by is distinct from old.approved_by then
          raise exception 'Ending an engagement cannot change approved version or approval metadata.'
            using errcode = '23514';
        end if;

        if v_actor is not null then
          new.ended_at := now();
          new.ended_by := v_actor;
        else
          if new.ended_at is null then
            new.ended_at := now();
          end if;
        end if;

        if new.end_outcome is null or new.end_reason is null or char_length(trim(new.end_reason)) < 2 then
          raise exception 'An end outcome and reason are required to end an engagement.'
            using errcode = '23514';
        end if;

      else
        raise exception 'Invalid engagement status transition: % to %', old.status, new.status
          using errcode = '23514';
      end if;

    else
      -- Status does not change
      if old.status = 'active' then
        -- Amendment of approved_version_id on an active engagement
        if new.approved_version_id is distinct from old.approved_version_id then
          if v_actor is not null and v_actor_role <> 'founder' then
            raise exception 'Only the Founder may approve an amendment on an active engagement.'
              using errcode = '42501';
          end if;

          if new.approved_version_id is null then
            raise exception 'Active engagement must have an approved version.'
              using errcode = '23514';
          end if;

          select id, engagement_id, approved_at, approved_by into v_approved_ver
          from public.engagement_versions
          where id = new.approved_version_id;

          if not found then
            raise exception 'Approved version does not exist.' using errcode = '23503';
          end if;

          if v_approved_ver.engagement_id <> new.id then
            raise exception 'Approved version must belong to this engagement.' using errcode = '23514';
          end if;

          if v_approved_ver.approved_at is null or v_approved_ver.approved_by is null then
            raise exception 'Version must be approved before amending active engagement.' using errcode = '23514';
          end if;

          v_version_approver_role := public.role_of(v_approved_ver.approved_by);
          if v_version_approver_role is null or v_version_approver_role <> 'founder' then
            raise exception 'Version approver must resolve to an active Founder.' using errcode = '23514';
          end if;

          -- Copy approval metadata from the new approved version
          new.approved_at := v_approved_ver.approved_at;
          new.approved_by := v_approved_ver.approved_by;

        else
          -- If approved_version_id does not change, approved_at and approved_by are immutable
          if new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by then
            raise exception 'Approval metadata is immutable when approved version does not change.'
              using errcode = '23514';
          end if;
        end if;

        -- On active engagement, ended metadata must remain null
        if new.ended_at is not null or new.ended_by is not null or new.end_outcome is not null or new.end_reason is not null then
          raise exception 'Active engagement cannot have ending metadata.' using errcode = '23514';
        end if;

      elsif old.status = 'draft' then
        -- In draft state, approval and ending metadata must remain null
        if new.approved_version_id is not null
           or new.approved_at is not null
           or new.approved_by is not null
           or new.ended_at is not null
           or new.ended_by is not null
           or new.end_outcome is not null
           or new.end_reason is not null then
          raise exception 'Draft engagement must not have approval or ending metadata.'
            using errcode = '23514';
        end if;
      end if;

    end if;

    return new;
  end if;

  return new;
end;
$$;

create trigger guard_engagement_write
  before insert or update or delete on public.engagements
  for each row execute function public.guard_engagement_write();

-- 11. Extend public.remove_demo_data() to clean demo engagement data
create or replace function public.remove_demo_data()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.app_role;
  v_demo_users jsonb;
  v_counts jsonb;

  v_allocations_count bigint := 0;
  v_items_count bigint := 0;
  v_invoices_count bigint := 0;
  v_receipts_count bigint := 0;
  v_ledger_count bigint := 0;
  v_accounts_count bigint := 0;
  v_work_items_count bigint := 0;
  v_reviewers_count bigint := 0;
  v_schedule_reviewers_count bigint := 0;
  v_assignments_count bigint := 0;
  v_schedules_count bigint := 0;
  v_engagement_versions_count bigint := 0;
  v_engagements_count bigint := 0;
  v_services_count bigint := 0;
  v_clients_count bigint := 0;
  v_reporting_count bigint := 0;
  v_audit_count bigint := 0;
  v_non_founder_roles_count bigint := 0;
  v_founder_roles_count bigint := 0;
  v_roles_count bigint := 0;
begin
  -- 1. Founder security gate
  if v_actor is null or not public.is_founder(v_actor) then
    raise exception 'Unauthorized: remove_demo_data may only be executed by a Founder.'
      using errcode = '42501';
  end if;

  -- Capture actor role before any role deletions
  v_actor_role := public.role_of(v_actor);

  -- 2. Snapshot demo auth users before teardown
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', p.user_id,
        'email', p.email,
        'full_name', p.full_name
      )
    ),
    '[]'::jsonb
  )
  into v_demo_users
  from public.profiles p
  where p.is_demo = true;

  -- 3. Set transaction-local GUCs for cleanup authorization
  perform set_config('app.demo_cleanup', 'on', true);
  perform set_config('app.demo_cleanup_actor', v_actor::text, true);

  -- 4. Teardown sequence (strict reverse-dependency order)

  -- 4.1 Payment allocations
  delete from public.payment_allocations where is_demo = true;
  get diagnostics v_allocations_count = row_count;

  -- 4.2 Invoice items
  delete from public.invoice_items where is_demo = true;
  get diagnostics v_items_count = row_count;

  -- 4.3 Invoices
  delete from public.invoices where is_demo = true;
  get diagnostics v_invoices_count = row_count;

  -- 4.4 Payment receipts
  delete from public.payment_receipts where is_demo = true;
  get diagnostics v_receipts_count = row_count;

  -- 4.5 Cash ledger entries
  delete from public.cash_ledger_entries where is_demo = true;
  get diagnostics v_ledger_count = row_count;

  -- 4.6 Cash accounts
  delete from public.cash_accounts where is_demo = true;
  get diagnostics v_accounts_count = row_count;

  -- 4.7 Work items
  delete from public.work_items where is_demo = true;
  get diagnostics v_work_items_count = row_count;

  -- 4.8 Assignment reviewers
  delete from public.assignment_reviewers where is_demo = true;
  get diagnostics v_reviewers_count = row_count;

  -- 4.8b Recurring schedule reviewers
  delete from public.recurring_schedule_reviewers where is_demo = true;
  get diagnostics v_schedule_reviewers_count = row_count;

  -- 4.9 Assignments
  delete from public.assignments where is_demo = true;
  get diagnostics v_assignments_count = row_count;

  -- 4.10 Recurring schedules
  delete from public.recurring_schedules where is_demo = true;
  get diagnostics v_schedules_count = row_count;

  -- 4.10b Engagements & Engagement Versions
  -- Normalize demo engagements to a valid draft state to satisfy constraints and break cyclic FKs
  update public.engagements
  set status = 'draft',
      approved_version_id = null,
      approved_at = null,
      approved_by = null,
      ended_at = null,
      ended_by = null,
      end_outcome = null,
      end_reason = null
  where is_demo = true;

  delete from public.engagement_versions where is_demo = true;
  get diagnostics v_engagement_versions_count = row_count;

  delete from public.engagements where is_demo = true;
  get diagnostics v_engagements_count = row_count;

  -- 4.11 Service catalog
  delete from public.service_catalog where is_demo = true;
  get diagnostics v_services_count = row_count;

  -- 4.12 Clients
  delete from public.clients where is_demo = true;
  get diagnostics v_clients_count = row_count;

  -- 4.13 Staff reporting lines (must precede role deletion)
  delete from public.staff_reporting_lines where is_demo = true;
  get diagnostics v_reporting_count = row_count;

  -- 4.14 Demo audit log entries (must precede role deletion to ensure clean teardown)
  delete from public.audit_log where is_demo = true;
  get diagnostics v_audit_count = row_count;

  -- 4.15 User roles: Non-founder demo roles deleted first
  delete from public.user_roles where is_demo = true and role <> 'founder';
  get diagnostics v_non_founder_roles_count = row_count;

  -- 4.16 User roles: Founder demo role deleted last
  delete from public.user_roles where is_demo = true and role = 'founder';
  get diagnostics v_founder_roles_count = row_count;

  v_roles_count := v_non_founder_roles_count + v_founder_roles_count;

  -- 5. Construct summary (in-memory, no role lookup)
  v_counts := jsonb_build_object(
    'allocations', v_allocations_count,
    'invoice_items', v_items_count,
    'invoices', v_invoices_count,
    'payment_receipts', v_receipts_count,
    'cash_ledger_entries', v_ledger_count,
    'cash_accounts', v_accounts_count,
    'work_items', v_work_items_count,
    'assignment_reviewers', v_reviewers_count,
    'recurring_schedule_reviewers', v_schedule_reviewers_count,
    'assignments', v_assignments_count,
    'recurring_schedules', v_schedules_count,
    'engagement_versions', v_engagement_versions_count,
    'engagements', v_engagements_count,
    'service_catalog', v_services_count,
    'clients', v_clients_count,
    'staff_reporting_lines', v_reporting_count,
    'audit_entries', v_audit_count,
    'user_roles', v_roles_count
  );

  -- 6. Deactivate cleanup authorization BEFORE final audit insert
  perform set_config('app.demo_cleanup', 'off', true);
  perform set_config('app.demo_cleanup_actor', '', true);

  -- 7. Insert permanent non-demo cleanup audit entry using captured v_actor_role
  insert into public.audit_log (
    actor_id, actor_role, table_name, operation, record_pk, old_row, new_row, request_id, is_demo
  ) values (
    v_actor, v_actor_role, 'system', 'DELETE', 'demo_dataset', v_counts, null, null, false
  );

  -- 8. Return result payload
  return jsonb_build_object('ok', true, 'deleted', v_counts, 'demo_auth_users', v_demo_users);
end;
$$;

revoke all on function public.remove_demo_data() from public, anon;
grant execute on function public.remove_demo_data() to authenticated;

commit;
