-- Migration 0003: Demo Support, Immutability & Cleanup RPC
-- Adds is_demo flag to all 16 public tables, protects against tampering,
-- updates auth profile sync, defines cleanup trigger overrides, suppresses cleanup audit logging,
-- and creates the founder-only remove_demo_data() RPC.

-- 1. DDL: Add is_demo flag to all 16 public tables
alter table public.profiles add column if not exists is_demo boolean not null default false;
alter table public.user_roles add column if not exists is_demo boolean not null default false;
alter table public.staff_reporting_lines add column if not exists is_demo boolean not null default false;
alter table public.clients add column if not exists is_demo boolean not null default false;
alter table public.service_catalog add column if not exists is_demo boolean not null default false;
alter table public.recurring_schedules add column if not exists is_demo boolean not null default false;
alter table public.assignments add column if not exists is_demo boolean not null default false;
alter table public.assignment_reviewers add column if not exists is_demo boolean not null default false;
alter table public.work_items add column if not exists is_demo boolean not null default false;
alter table public.cash_accounts add column if not exists is_demo boolean not null default false;
alter table public.cash_ledger_entries add column if not exists is_demo boolean not null default false;
alter table public.invoices add column if not exists is_demo boolean not null default false;
alter table public.invoice_items add column if not exists is_demo boolean not null default false;
alter table public.payment_receipts add column if not exists is_demo boolean not null default false;
alter table public.payment_allocations add column if not exists is_demo boolean not null default false;
alter table public.audit_log add column if not exists is_demo boolean not null default false;

-- 2. Bidirectional is_demo immutability guard
create or replace function public.prevent_demo_flag_tampering()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.is_demo is distinct from old.is_demo then
    raise exception 'The is_demo flag is immutable.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger prevent_demo_flag_tampering before update on public.profiles
  for each row execute function public.prevent_demo_flag_tampering();
create trigger prevent_demo_flag_tampering before update on public.user_roles
  for each row execute function public.prevent_demo_flag_tampering();
create trigger prevent_demo_flag_tampering before update on public.staff_reporting_lines
  for each row execute function public.prevent_demo_flag_tampering();
create trigger prevent_demo_flag_tampering before update on public.clients
  for each row execute function public.prevent_demo_flag_tampering();
create trigger prevent_demo_flag_tampering before update on public.service_catalog
  for each row execute function public.prevent_demo_flag_tampering();
create trigger prevent_demo_flag_tampering before update on public.recurring_schedules
  for each row execute function public.prevent_demo_flag_tampering();
create trigger prevent_demo_flag_tampering before update on public.assignments
  for each row execute function public.prevent_demo_flag_tampering();
create trigger prevent_demo_flag_tampering before update on public.assignment_reviewers
  for each row execute function public.prevent_demo_flag_tampering();
create trigger prevent_demo_flag_tampering before update on public.work_items
  for each row execute function public.prevent_demo_flag_tampering();
create trigger prevent_demo_flag_tampering before update on public.cash_accounts
  for each row execute function public.prevent_demo_flag_tampering();
create trigger prevent_demo_flag_tampering before update on public.cash_ledger_entries
  for each row execute function public.prevent_demo_flag_tampering();
create trigger prevent_demo_flag_tampering before update on public.invoices
  for each row execute function public.prevent_demo_flag_tampering();
create trigger prevent_demo_flag_tampering before update on public.invoice_items
  for each row execute function public.prevent_demo_flag_tampering();
create trigger prevent_demo_flag_tampering before update on public.payment_receipts
  for each row execute function public.prevent_demo_flag_tampering();
create trigger prevent_demo_flag_tampering before update on public.payment_allocations
  for each row execute function public.prevent_demo_flag_tampering();

-- 3. Auth profile sync update: evaluate is_demo at insert
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_previous_flag text := current_setting('app.profile_sync', true);
  v_is_demo boolean;
begin
  perform set_config('app.profile_sync', 'on', true);

  v_is_demo := (
    coalesce(new.email, '') like '%@sn-demo.local'
    or coalesce((new.raw_user_meta_data ->> 'is_demo')::boolean, false)
  );

  insert into public.profiles (user_id, full_name, email, is_demo)
  values (
    new.id,
    coalesce(
      case when char_length(trim(coalesce(new.raw_user_meta_data ->> 'full_name', ''))) >= 2
        then trim(new.raw_user_meta_data ->> 'full_name') end,
      case when char_length(trim(split_part(coalesce(new.email, ''), '@', 1))) >= 2
        then trim(split_part(new.email, '@', 1)) end,
      'New employee'
    ),
    coalesce(new.email, new.id::text || '@pending.local'),
    v_is_demo
  )
  on conflict (user_id) do update
  set
    full_name = excluded.full_name,
    email = excluded.email;

  perform set_config('app.profile_sync', coalesce(v_previous_flag, ''), true);
  return new;
end;
$$;

-- 4. Trigger overrides with cleanup authorization
create or replace function public.guard_invoice_item_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_invoice_id uuid := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  v_status public.invoice_status;
begin
  -- Cleanup override: Bypass issued/paid immutability for demo items during authorized cleanup
  if tg_op = 'DELETE'
     and old.is_demo = true
     and coalesce(current_setting('app.demo_cleanup', true), '') = 'on'
     and v_actor is not null
     and v_actor::text = coalesce(current_setting('app.demo_cleanup_actor', true), '') then
    return old;
  end if;

  if v_actor is not null and not public.is_management(v_actor) then
    raise exception 'Only the Founder or Manager may edit Invoice Items.' using errcode = '42501';
  end if;
  select i.status into v_status from public.invoices i where i.id = v_invoice_id;
  if v_status is null then
    raise exception 'Invoice not found.' using errcode = '23503';
  end if;
  if v_status <> 'draft' then
    raise exception 'Invoice Items are immutable after issue; void and reissue instead.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if new.invoice_id is distinct from old.invoice_id then
      raise exception 'An Invoice Item cannot be moved between Invoices.' using errcode = '23514';
    end if;
    new.updated_at := now();
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.prevent_financial_document_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.is_demo = true
     and coalesce(current_setting('app.demo_cleanup', true), '') = 'on'
     and auth.uid() is not null
     and auth.uid()::text = coalesce(current_setting('app.demo_cleanup_actor', true), '') then
    return old;
  end if;
  raise exception 'Financial documents are voided, never deleted.' using errcode = '23514';
end;
$$;

create or replace function public.prevent_cash_ledger_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.is_demo = true
     and coalesce(current_setting('app.demo_cleanup', true), '') = 'on'
     and auth.uid() is not null
     and auth.uid()::text = coalesce(current_setting('app.demo_cleanup_actor', true), '') then
    return old;
  end if;
  raise exception 'Ledger Entries are append-and-void records and cannot be deleted.' using errcode = '23514';
end;
$$;

create or replace function public.guard_user_role_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  -- Cleanup override: Permits deleting both non-founder and founder demo roles
  if tg_op = 'DELETE'
     and old.is_demo = true
     and coalesce(current_setting('app.demo_cleanup', true), '') = 'on'
     and v_actor is not null
     and v_actor::text = coalesce(current_setting('app.demo_cleanup_actor', true), '') then
    return old;
  end if;

  if v_actor is not null and not public.is_founder(v_actor) then
    raise exception 'Only the Founder may create or change staff roles.'
      using errcode = '42501';
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.role = 'founder' then
    raise exception 'The Founder role is immutable. Transfer requires a controlled migration.'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'A role belongs to one employee and cannot be transferred.'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new.role = 'trainee' and old.role <> 'trainee' then
    if exists (
      select 1 from public.assignments a
      where a.owner_id = old.user_id and a.status not in ('closed', 'cancelled')
    ) or exists (
      select 1 from public.recurring_schedules rs
      where rs.default_owner_id = old.user_id and rs.is_active
    ) or exists (
      select 1 from public.clients c
      where c.relationship_owner_id = old.user_id and c.status <> 'archived'
    ) then
      raise exception 'Reassign active client responsibility before changing this employee to Trainee.'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and new.role not in ('founder', 'manager', 'senior_staff')
     and exists (
       select 1 from public.assignment_reviewers ar where ar.reviewer_id = old.user_id
     ) then
    raise exception 'Remove Assignment reviewer duties before changing to this role.'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.assigned_by is null and v_actor is not null then
    new.assigned_by := v_actor;
  end if;
  new.assigned_at := case when tg_op = 'INSERT' then now() else old.assigned_at end;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE'
     and old.is_demo = true
     and coalesce(current_setting('app.demo_cleanup', true), '') = 'on'
     and auth.uid() is not null
     and auth.uid()::text = coalesce(current_setting('app.demo_cleanup_actor', true), '') then
    return old;
  end if;
  raise exception 'The audit trail is immutable.' using errcode = '23514';
end;
$$;

-- 5. Audit row change: suppress during cleanup, preserve personal redaction & composite PKs, propagate is_demo
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_record_pk text;
  v_headers jsonb;
  v_request_id text;
  v_is_demo boolean;
begin
  -- 1. Suppress per-row audit logging during authorized demo cleanup
  if coalesce(current_setting('app.demo_cleanup', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;

  -- 2. Personal work-item privacy redaction (retained verbatim from 0001_practice_core.sql)
  if tg_table_name = 'work_items'
     and coalesce(v_new ->> 'kind', v_old ->> 'kind') = 'personal' then
    if v_old is not null then
      v_old := v_old - 'title' - 'description' - 'completion_note';
    end if;
    if v_new is not null then
      v_new := v_new - 'title' - 'description' - 'completion_note';
    end if;
  end if;

  -- 3. Complete record PK extraction supporting single and composite PKs (retained verbatim)
  v_record_pk := coalesce(
    v_new ->> 'id',
    v_old ->> 'id',
    v_new ->> 'user_id',
    v_old ->> 'user_id',
    v_new ->> 'employee_id',
    v_old ->> 'employee_id',
    nullif(concat_ws(':', v_new ->> 'assignment_id', v_new ->> 'reviewer_id'), ''),
    nullif(concat_ws(':', v_old ->> 'assignment_id', v_old ->> 'reviewer_id'), '')
  );

  -- 4. Propagate is_demo flag (NEW for INSERT/UPDATE, OLD for DELETE, fallback false)
  v_is_demo := coalesce(
    (v_new ->> 'is_demo')::boolean,
    (v_old ->> 'is_demo')::boolean,
    false
  );

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_request_id := coalesce(v_headers ->> 'x-request-id', v_headers ->> 'x-correlation-id');
  exception when others then
    v_request_id := null;
  end;

  insert into public.audit_log (
    actor_id,
    actor_role,
    table_name,
    operation,
    record_pk,
    old_row,
    new_row,
    request_id,
    is_demo
  ) values (
    auth.uid(),
    public.role_of(auth.uid()),
    tg_table_name,
    tg_op,
    v_record_pk,
    v_old,
    v_new,
    v_request_id,
    v_is_demo
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- 6. Founder-authorized cleanup RPC
create or replace function public.remove_demo_data()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.app_role;
  v_counts jsonb;
  v_allocations_count integer;
  v_items_count integer;
  v_invoices_count integer;
  v_receipts_count integer;
  v_ledger_count integer;
  v_accounts_count integer;
  v_work_items_count integer;
  v_reviewers_count integer;
  v_assignments_count integer;
  v_schedules_count integer;
  v_services_count integer;
  v_clients_count integer;
  v_reporting_count integer;
  v_audit_count integer;
  v_non_founder_roles_count integer;
  v_founder_roles_count integer;
  v_roles_count integer;
  v_demo_users jsonb;
begin
  -- 1. Security Gate: Verify founder once at RPC entry and capture role
  if v_actor is null or not public.is_founder(v_actor) then
    raise exception 'Unauthorized: Only the Founder may remove demo data.' using errcode = '42501';
  end if;

  v_actor_role := public.role_of(v_actor);

  -- 2. Snapshot demo auth users before deleting roles/profiles for orchestration return
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email)), '[]'::jsonb)
  into v_demo_users
  from auth.users u
  where u.email like '%@sn-demo.local';

  -- 3. Activate transaction-local cleanup authorization and actor context
  perform set_config('app.demo_cleanup', 'on', true);
  perform set_config('app.demo_cleanup_actor', v_actor::text, true);

  -- 4. Reverse topological deletion (leaf to root)
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

  -- 4.9 Assignments
  delete from public.assignments where is_demo = true;
  get diagnostics v_assignments_count = row_count;

  -- 4.10 Recurring schedules
  delete from public.recurring_schedules where is_demo = true;
  get diagnostics v_schedules_count = row_count;

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
    'assignments', v_assignments_count,
    'recurring_schedules', v_schedules_count,
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
