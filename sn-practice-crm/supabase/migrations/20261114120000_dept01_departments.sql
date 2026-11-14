-- Migration: 20261114120000_dept01_departments.sql
-- Description: DEPT-01 Departments, their members and heads, the department of each service, and
--              read-only visibility of a department's assignments for its heads.
--
-- Heads gain READ access only: the new helpers are used by select policies and nothing else. The helpers
--   user_assignment_involvement, user_client_visible, user_looks_after_client and user_fee_visible are not
--   touched, so every write right, the full PAN and GSTIN, fees, documents and messages stay as they were.

begin;

-- 1. Departments: managed by the Founder, never deleted (deactivated instead)
create table public.departments (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index departments_name_normalized_key
  on public.departments (lower(btrim(name)));

create or replace function public.guard_department_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is not null and not public.is_founder(v_actor) then
    raise exception 'Only the Founder may manage departments.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.created_by := v_actor;
    end if;
    return new;
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'Creator provenance is immutable.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger guard_department_write
  before insert or update on public.departments
  for each row execute function public.guard_department_write();
create trigger set_departments_updated_at before update on public.departments
  for each row execute function public.set_updated_at();
create trigger audit_departments after insert or update or delete on public.departments
  for each row execute function public.audit_row_change();

-- 2. Department members. A person can be in several departments; more than one member can be a head.
--    Trainees can be members but never heads. A membership row is not a record, so it may be deleted.
create table public.department_members (
  id uuid primary key default extensions.gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  is_head boolean not null default false,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint department_members_department_user_key unique (department_id, user_id)
);

create index department_members_user_idx on public.department_members (user_id);

create or replace function public.guard_department_member_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is not null and not public.is_founder(v_actor) then
    raise exception 'Only the Founder may manage departments.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.is_head and public.role_of(new.user_id) = 'trainee' then
    raise exception 'Trainees can be members but not heads.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.created_by := v_actor;
    end if;
    return new;
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'Creator provenance is immutable.' using errcode = '23514';
  end if;
  if new.department_id is distinct from old.department_id or new.user_id is distinct from old.user_id then
    raise exception 'A membership cannot move to another department or person.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger guard_department_member_write
  before insert or update or delete on public.department_members
  for each row execute function public.guard_department_member_write();
create trigger set_department_members_updated_at before update on public.department_members
  for each row execute function public.set_updated_at();
create trigger audit_department_members after insert or update or delete on public.department_members
  for each row execute function public.audit_row_change();

-- 3. The department of a service: at most one, optional
alter table public.service_catalog
  add column department_id uuid references public.departments(id) on delete restrict;

create index service_catalog_department_idx on public.service_catalog (department_id);

-- 4. Table access
alter table public.departments enable row level security;
alter table public.department_members enable row level security;

create policy departments_select on public.departments
  for select to authenticated
  using (public.is_active_employee());
create policy departments_insert on public.departments
  for insert to authenticated
  with check (public.is_founder() and created_by = auth.uid());
create policy departments_update on public.departments
  for update to authenticated
  using (public.is_founder())
  with check (public.is_founder());

create policy department_members_select on public.department_members
  for select to authenticated
  using (public.is_active_employee());
create policy department_members_insert on public.department_members
  for insert to authenticated
  with check (public.is_founder() and created_by = auth.uid());
create policy department_members_update on public.department_members
  for update to authenticated
  using (public.is_founder())
  with check (public.is_founder());
create policy department_members_delete on public.department_members
  for delete to authenticated
  using (public.is_founder());

revoke all on table public.departments from public, anon, authenticated;
revoke all on table public.department_members from public, anon, authenticated;
grant select, insert, update on public.departments to authenticated;
grant select, insert, update, delete on public.department_members to authenticated;

-- 5. Heads read their department's work. A head is a head-flagged member of the ACTIVE department of the
--    assignment's service. Someone who is no longer an active employee, or is a Trainee, gets nothing.
create or replace function public.user_heads_department_of_assignment(
  p_user_id uuid,
  p_assignment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.assignments a
    join public.service_catalog s on s.id = a.service_id
    join public.departments d on d.id = s.department_id and d.is_active
    join public.department_members dm on dm.department_id = d.id and dm.user_id = p_user_id and dm.is_head
    where a.id = p_assignment_id
      and public.role_of(p_user_id) in ('founder', 'manager', 'senior_staff', 'staff')
  );
$$;

-- Read-only helpers for select policies. They are not used by any write policy, trigger or guard.
create or replace function public.user_can_read_assignment(
  p_user_id uuid,
  p_assignment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.user_assignment_involvement(p_user_id, p_assignment_id)
    or public.user_heads_department_of_assignment(p_user_id, p_assignment_id);
$$;

create or replace function public.can_read_assignment(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.user_can_read_assignment(auth.uid(), p_assignment_id);
$$;

-- The client row of a department assignment is readable by the head so the client's name shows.
-- Contacts, identifiers, documents, messages and fees keep using client_visible and looks_after_client.
create or replace function public.user_can_read_client(
  p_user_id uuid,
  p_client_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.user_client_visible(p_user_id, p_client_id)
    or exists (
      select 1 from public.assignments a
      where a.client_id = p_client_id
        and public.user_heads_department_of_assignment(p_user_id, a.id)
    );
$$;

create or replace function public.can_read_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.user_can_read_client(auth.uid(), p_client_id);
$$;

revoke all on function public.user_heads_department_of_assignment(uuid, uuid) from public, anon;
revoke all on function public.user_can_read_assignment(uuid, uuid) from public, anon;
revoke all on function public.can_read_assignment(uuid) from public, anon;
revoke all on function public.user_can_read_client(uuid, uuid) from public, anon;
revoke all on function public.can_read_client(uuid) from public, anon;
grant execute on function public.user_heads_department_of_assignment(uuid, uuid) to authenticated;
grant execute on function public.user_can_read_assignment(uuid, uuid) to authenticated;
grant execute on function public.can_read_assignment(uuid) to authenticated;
grant execute on function public.user_can_read_client(uuid, uuid) to authenticated;
grant execute on function public.can_read_client(uuid) to authenticated;

-- 6. Only the three select policies change. Insert, update and delete policies are not touched.
drop policy assignments_select on public.assignments;
create policy assignments_select on public.assignments
  for select to authenticated
  using (public.can_read_assignment(id));

drop policy assignment_reviewers_select on public.assignment_reviewers;
create policy assignment_reviewers_select on public.assignment_reviewers
  for select to authenticated
  using (public.can_read_assignment(assignment_id));

drop policy clients_select on public.clients;
create policy clients_select on public.clients
  for select to authenticated
  using (public.can_read_client(id));

commit;
