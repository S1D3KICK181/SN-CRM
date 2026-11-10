-- Migration: 20261110163000_as01_hardening.sql
-- Description: AS-01 hardening: recurring schedule reviewers, terminal immutability for approved/closed/cancelled assignments & reviewers, and materialization copying.

begin;

-- 1. Create recurring_schedule_reviewers table
create table if not exists public.recurring_schedule_reviewers (
  recurring_schedule_id uuid not null references public.recurring_schedules(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(user_id) on delete restrict,
  assigned_by uuid not null references public.profiles(user_id) on delete restrict,
  assigned_at timestamptz not null default now(),
  is_demo boolean not null default false,
  primary key (recurring_schedule_id, reviewer_id)
);

create index if not exists recurring_schedule_reviewers_user_idx
  on public.recurring_schedule_reviewers (reviewer_id);

alter table public.recurring_schedule_reviewers enable row level security;

-- 2. RLS policies for recurring_schedule_reviewers
drop policy if exists recurring_schedule_reviewers_select on public.recurring_schedule_reviewers;
create policy recurring_schedule_reviewers_select on public.recurring_schedule_reviewers
  for select to authenticated
  using (
    public.is_management()
    or reviewer_id = auth.uid()
    or exists (
      select 1 from public.recurring_schedules rs
      where rs.id = recurring_schedule_id and rs.default_owner_id = auth.uid()
    )
  );

drop policy if exists recurring_schedule_reviewers_insert on public.recurring_schedule_reviewers;
create policy recurring_schedule_reviewers_insert on public.recurring_schedule_reviewers
  for insert to authenticated
  with check (public.is_management());

drop policy if exists recurring_schedule_reviewers_delete on public.recurring_schedule_reviewers;
create policy recurring_schedule_reviewers_delete on public.recurring_schedule_reviewers
  for delete to authenticated
  using (public.is_management());

grant select, insert, delete on public.recurring_schedule_reviewers to authenticated;

-- 3. Trigger guard for recurring_schedule_reviewer_write
create or replace function public.guard_recurring_schedule_reviewer_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_reviewer_role public.app_role;
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.demo_cleanup', true), '') = 'on' then
      return old;
    end if;
    if v_actor is not null and not public.is_management(v_actor) then
      raise exception 'Only the Founder or Manager may remove recurring schedule reviewers.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if v_actor is not null and not public.is_management(v_actor) then
    raise exception 'Only the Founder or Manager may appoint recurring schedule reviewers.'
      using errcode = '42501';
  end if;

  v_reviewer_role := public.role_of(new.reviewer_id);
  if v_reviewer_role not in ('founder', 'manager', 'senior_staff') then
    raise exception 'A recurring schedule reviewer must be Founder, Manager, or Senior Staff.'
      using errcode = '23514';
  end if;

  if new.assigned_by is null and v_actor is not null then
    new.assigned_by := v_actor;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_recurring_schedule_reviewer_write on public.recurring_schedule_reviewers;
create trigger guard_recurring_schedule_reviewer_write
  before insert or update or delete on public.recurring_schedule_reviewers
  for each row execute function public.guard_recurring_schedule_reviewer_write();

drop trigger if exists audit_recurring_schedule_reviewers on public.recurring_schedule_reviewers;
create trigger audit_recurring_schedule_reviewers
  after insert or update or delete on public.recurring_schedule_reviewers
  for each row execute function public.audit_row_change();

drop trigger if exists prevent_demo_flag_tampering on public.recurring_schedule_reviewers;
create trigger prevent_demo_flag_tampering
  before update on public.recurring_schedule_reviewers
  for each row execute function public.prevent_demo_flag_tampering();

-- 4. Harden guard_assignment_write: approved assignments core fields and notes are immutable
create or replace function public.guard_assignment_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.app_role := public.role_of(auth.uid());
  v_owner_role public.app_role := public.role_of(new.owner_id);
  v_is_owner boolean := v_actor = new.owner_id;
  v_is_reviewer boolean := false;
  v_schedule_client uuid;
  v_schedule_service uuid;
begin
  if v_owner_role is null or v_owner_role = 'trainee' then
    raise exception 'A Trainee cannot own an Assignment.' using errcode = '23514';
  end if;

  if new.recurring_schedule_id is not null then
    select rs.client_id, rs.service_id
      into v_schedule_client, v_schedule_service
    from public.recurring_schedules rs
    where rs.id = new.recurring_schedule_id;

    if v_schedule_client is null then
      raise exception 'The Recurring Schedule does not exist.' using errcode = '23503';
    end if;
    if new.client_id <> v_schedule_client
       or new.service_id is distinct from v_schedule_service then
      raise exception 'A recurring Assignment must retain its Schedule client and service.'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if v_actor is not null then
      if v_actor_role not in ('founder', 'manager') then
        raise exception 'Only the Founder or Manager may create an Assignment.'
          using errcode = '42501';
      end if;
      new.created_by := v_actor;
      if new.status not in ('draft', 'assigned') then
        raise exception 'A new Assignment must begin as Draft or Assigned.' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  if new.code is distinct from old.code
     or new.created_by is distinct from old.created_by
     or new.client_id is distinct from old.client_id
     or new.recurring_schedule_id is distinct from old.recurring_schedule_id
     or new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end then
    raise exception 'Assignment identity and recurrence provenance are immutable.'
      using errcode = '23514';
  end if;

  if old.status in ('approved', 'closed', 'cancelled')
     and (new.service_id is distinct from old.service_id
       or new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.owner_id is distinct from old.owner_id
       or new.priority is distinct from old.priority
       or new.due_at is distinct from old.due_at
       or new.progress_percent is distinct from old.progress_percent
       or new.delivery_notes is distinct from old.delivery_notes
       or new.review_notes is distinct from old.review_notes) then
    raise exception 'Approved, closed, and cancelled Assignments are immutable.' using errcode = '23514';
  end if;

  if v_actor is not null then
    v_is_reviewer := exists (
      select 1 from public.assignment_reviewers ar
      where ar.assignment_id = old.id and ar.reviewer_id = v_actor
    );

    if v_actor_role not in ('founder', 'manager')
       and not v_is_owner
       and not v_is_reviewer then
      raise exception 'This employee cannot update the Assignment.' using errcode = '42501';
    end if;

    if v_actor_role not in ('founder', 'manager') then
      if new.service_id is distinct from old.service_id
         or new.title is distinct from old.title
         or new.description is distinct from old.description
         or new.owner_id is distinct from old.owner_id
         or new.priority is distinct from old.priority
         or new.due_at is distinct from old.due_at
         or new.started_at is distinct from old.started_at
         or new.submitted_at is distinct from old.submitted_at
         or new.approved_at is distinct from old.approved_at
         or new.approved_by is distinct from old.approved_by
         or new.closed_at is distinct from old.closed_at
         or new.closed_by is distinct from old.closed_by then
        raise exception 'Assigned staff can only update Assignment status, notes, and progress.'
          using errcode = '42501';
      end if;
    end if;

    if not public.assignment_transition_allowed(
      old.status,
      new.status,
      v_actor_role,
      v_is_owner,
      v_is_reviewer
    ) then
      raise exception 'Invalid Assignment status transition for this role.' using errcode = '23514';
    end if;
  end if;

  if old.status <> new.status then
    if new.status = 'in_progress' and new.started_at is null then
      new.started_at := now();
    elsif new.status = 'ready_for_review' then
      new.submitted_at := now();
    elsif new.status = 'approved' then
      new.approved_at := now();
      new.approved_by := coalesce(v_actor, new.approved_by);
      new.progress_percent := 100;
    elsif new.status = 'closed' then
      new.closed_at := now();
      new.closed_by := coalesce(v_actor, new.closed_by);
      new.progress_percent := 100;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- 5. Harden guard_assignment_reviewer_write: immutable when assignment is approved, closed, or cancelled
create or replace function public.guard_assignment_reviewer_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_reviewer_role public.app_role;
  v_assignment_status public.assignment_status;
  v_target_assignment_id uuid;
begin
  v_target_assignment_id := case when tg_op = 'DELETE' then old.assignment_id else new.assignment_id end;

  select status into v_assignment_status
  from public.assignments
  where id = v_target_assignment_id;

  if v_assignment_status in ('approved', 'closed', 'cancelled') then
    raise exception 'Cannot modify reviewers on an approved, closed, or cancelled Assignment.'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    if v_actor is not null and not public.is_management(v_actor) then
      raise exception 'Only the Founder or Manager may remove Assignment reviewers.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if v_actor is not null and not public.is_management(v_actor) then
    raise exception 'Only the Founder or Manager may appoint Assignment reviewers.'
      using errcode = '42501';
  end if;

  v_reviewer_role := public.role_of(new.reviewer_id);
  if v_reviewer_role not in ('founder', 'manager', 'senior_staff') then
    raise exception 'An Assignment reviewer must be Founder, Manager, or Senior Staff.'
      using errcode = '23514';
  end if;
  if new.assigned_by is null and v_actor is not null then
    new.assigned_by := v_actor;
  end if;
  return new;
end;
$$;

-- 6. Update materialize_due_recurring_assignments to copy reviewers
create or replace function public.materialize_due_recurring_assignments(
  p_through_date date default current_date
)
returns table (
  schedule_id uuid,
  assignment_id uuid,
  occurrence_date date
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_schedule record;
  v_occurrence date;
  v_period_end date;
  v_due_date date;
  v_assignment_id uuid;
begin
  for v_schedule in
    select rs.*
    from public.recurring_schedules rs
    where rs.is_active
      and rs.next_occurrence_date <= p_through_date
      and (rs.end_date is null or rs.next_occurrence_date <= rs.end_date)
    order by rs.next_occurrence_date, rs.id
    for update
  loop
    v_occurrence := v_schedule.next_occurrence_date;

    while v_occurrence <= p_through_date
      and (v_schedule.end_date is null or v_occurrence <= v_schedule.end_date)
    loop
      v_period_end := (
        v_occurrence + make_interval(months => v_schedule.interval_months) - interval '1 day'
      )::date;
      v_due_date := v_period_end + v_schedule.due_offset_days;
      v_assignment_id := null;

      insert into public.assignments (
        client_id,
        service_id,
        recurring_schedule_id,
        title,
        description,
        owner_id,
        status,
        priority,
        period_start,
        period_end,
        due_at,
        created_by,
        is_demo
      ) values (
        v_schedule.client_id,
        v_schedule.service_id,
        v_schedule.id,
        v_schedule.title,
        v_schedule.description,
        v_schedule.default_owner_id,
        'assigned',
        v_schedule.priority,
        v_occurrence,
        v_period_end,
        (v_due_date + time '23:59:00') at time zone 'Asia/Kolkata',
        v_schedule.created_by,
        v_schedule.is_demo
      )
      on conflict (recurring_schedule_id, period_start)
        where recurring_schedule_id is not null
      do nothing
      returning id into v_assignment_id;

      if v_assignment_id is not null then
        -- Copy reviewers from recurring schedule to generated assignment
        insert into public.assignment_reviewers (
          assignment_id,
          reviewer_id,
          assigned_by,
          assigned_at,
          is_demo
        )
        select
          v_assignment_id,
          rsr.reviewer_id,
          rsr.assigned_by,
          now(),
          v_schedule.is_demo
        from public.recurring_schedule_reviewers rsr
        where rsr.recurring_schedule_id = v_schedule.id
        on conflict (assignment_id, reviewer_id) do nothing;

        schedule_id := v_schedule.id;
        assignment_id := v_assignment_id;
        occurrence_date := v_occurrence;
        return next;
      end if;

      v_occurrence := (
        v_occurrence + make_interval(months => v_schedule.interval_months)
      )::date;
    end loop;

    update public.recurring_schedules
    set next_occurrence_date = v_occurrence,
        is_active = case
          when v_schedule.end_date is not null and v_occurrence > v_schedule.end_date then false
          else true
        end,
        updated_at = now()
    where id = v_schedule.id;
  end loop;
end;
$$;

-- 7. Update remove_demo_data to delete recurring_schedule_reviewers
create or replace function public.remove_demo_data()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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
  v_schedule_reviewers_count integer;
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

  -- 4.8b Recurring schedule reviewers
  delete from public.recurring_schedule_reviewers where is_demo = true;
  get diagnostics v_schedule_reviewers_count = row_count;

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
    'recurring_schedule_reviewers', v_schedule_reviewers_count,
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

commit;
