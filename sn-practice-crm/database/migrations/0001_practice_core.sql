begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum (
  'founder',
  'manager',
  'senior_staff',
  'staff',
  'trainee'
);

create type public.client_status as enum ('active', 'on_hold', 'archived');
create type public.assignment_status as enum (
  'draft',
  'assigned',
  'in_progress',
  'ready_for_review',
  'changes_requested',
  'approved',
  'closed',
  'cancelled'
);
create type public.work_item_kind as enum ('delegated', 'internal', 'personal');
create type public.work_item_status as enum (
  'todo',
  'in_progress',
  'blocked',
  'ready_for_review',
  'changes_requested',
  'completed',
  'cancelled'
);
create type public.work_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.recurrence_cadence as enum ('monthly', 'quarterly', 'annual', 'custom');
create type public.cash_account_kind as enum ('cash', 'bank', 'petty_cash');
create type public.ledger_direction as enum ('receipt', 'payment');
create type public.ledger_status as enum ('posted', 'voided');
create type public.invoice_status as enum ('draft', 'issued', 'part_paid', 'paid', 'voided');
create type public.payment_method as enum ('cash', 'bank_transfer', 'cheque', 'upi', 'card', 'other');
create type public.payment_status as enum ('received', 'voided');

create sequence public.client_code_seq start with 1001;
create sequence public.schedule_code_seq start with 1001;
create sequence public.assignment_code_seq start with 1001;
create sequence public.work_item_code_seq start with 1001;
create sequence public.ledger_entry_code_seq start with 1001;
create sequence public.invoice_code_seq start with 1001;
create sequence public.receipt_code_seq start with 1001;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  email text not null,
  phone text,
  job_title text,
  avatar_url text,
  is_active boolean not null default true,
  joined_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_lower_key on public.profiles (lower(email));

create table public.user_roles (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  role public.app_role not null,
  assigned_by uuid references public.profiles(user_id) on delete restrict,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index one_founder_per_practice
  on public.user_roles (role)
  where role = 'founder';

create table public.staff_reporting_lines (
  employee_id uuid primary key references public.profiles(user_id) on delete cascade,
  supervisor_id uuid not null references public.profiles(user_id) on delete restrict,
  assigned_by uuid references public.profiles(user_id) on delete restrict,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_cannot_report_to_self check (employee_id <> supervisor_id)
);

create index staff_reporting_lines_supervisor_idx
  on public.staff_reporting_lines (supervisor_id);

create table public.clients (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique default (
    'CL-' || lpad(nextval('public.client_code_seq')::text, 6, '0')
  ),
  display_name text not null check (char_length(trim(display_name)) between 2 and 180),
  legal_name text,
  gstin text,
  pan text,
  email text,
  phone text,
  relationship_owner_id uuid references public.profiles(user_id) on delete set null,
  status public.client_status not null default 'active',
  notes text,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clients_relationship_owner_idx on public.clients (relationship_owner_id);
create index clients_status_idx on public.clients (status);

create table public.service_catalog (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 2 and 120),
  description text,
  default_duration_days smallint check (default_duration_days is null or default_duration_days >= 0),
  is_statutory boolean not null default false,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recurring_schedules (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique default (
    'RS-' || lpad(nextval('public.schedule_code_seq')::text, 6, '0')
  ),
  client_id uuid not null references public.clients(id) on delete restrict,
  service_id uuid references public.service_catalog(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 2 and 180),
  description text,
  cadence public.recurrence_cadence not null,
  interval_months smallint not null check (interval_months between 1 and 120),
  due_offset_days smallint not null default 0 check (due_offset_days between -365 and 365),
  start_date date not null,
  end_date date,
  next_occurrence_date date not null,
  default_owner_id uuid not null references public.profiles(user_id) on delete restrict,
  priority public.work_priority not null default 'normal',
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_schedule_date_order check (end_date is null or end_date >= start_date),
  constraint recurring_schedule_next_date check (next_occurrence_date >= start_date),
  constraint recurring_schedule_cadence_interval check (
    (cadence = 'monthly' and interval_months = 1)
    or (cadence = 'quarterly' and interval_months = 3)
    or (cadence = 'annual' and interval_months = 12)
    or cadence = 'custom'
  )
);

create index recurring_schedules_due_idx
  on public.recurring_schedules (next_occurrence_date)
  where is_active;
create index recurring_schedules_client_idx on public.recurring_schedules (client_id);
create index recurring_schedules_owner_idx on public.recurring_schedules (default_owner_id);

create table public.assignments (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique default (
    'AS-' || lpad(nextval('public.assignment_code_seq')::text, 6, '0')
  ),
  client_id uuid not null references public.clients(id) on delete restrict,
  service_id uuid references public.service_catalog(id) on delete restrict,
  recurring_schedule_id uuid references public.recurring_schedules(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 2 and 180),
  description text,
  owner_id uuid not null references public.profiles(user_id) on delete restrict,
  status public.assignment_status not null default 'assigned',
  priority public.work_priority not null default 'normal',
  period_start date,
  period_end date,
  due_at timestamptz not null,
  progress_percent smallint not null default 0 check (progress_percent between 0 and 100),
  delivery_notes text,
  review_notes text,
  started_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles(user_id) on delete restrict,
  closed_at timestamptz,
  closed_by uuid references public.profiles(user_id) on delete restrict,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assignment_period_order check (
    period_start is null or period_end is null or period_end >= period_start
  ),
  constraint assignment_recurring_period check (
    recurring_schedule_id is null or period_start is not null
  ),
  constraint assignment_approval_metadata check (
    status not in ('approved', 'closed')
    or (approved_at is not null and approved_by is not null)
  ),
  constraint assignment_close_metadata check (
    status <> 'closed'
    or (closed_at is not null and closed_by is not null)
  )
);

create unique index assignments_schedule_occurrence_key
  on public.assignments (recurring_schedule_id, period_start)
  where recurring_schedule_id is not null;
create index assignments_owner_status_idx on public.assignments (owner_id, status);
create index assignments_client_status_idx on public.assignments (client_id, status);
create index assignments_due_open_idx on public.assignments (due_at)
  where status not in ('closed', 'cancelled');

create table public.assignment_reviewers (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(user_id) on delete restrict,
  assigned_by uuid not null references public.profiles(user_id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key (assignment_id, reviewer_id)
);

create index assignment_reviewers_user_idx
  on public.assignment_reviewers (reviewer_id);

create table public.work_items (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique default (
    'WI-' || lpad(nextval('public.work_item_code_seq')::text, 6, '0')
  ),
  kind public.work_item_kind not null,
  assignment_id uuid references public.assignments(id) on delete restrict,
  context_client_id uuid references public.clients(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 2 and 220),
  description text,
  assignee_id uuid not null references public.profiles(user_id) on delete restrict,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  status public.work_item_status not null default 'todo',
  priority public.work_priority not null default 'normal',
  due_at timestamptz,
  progress_percent smallint not null default 0 check (progress_percent between 0 and 100),
  completion_note text,
  reviewed_by uuid references public.profiles(user_id) on delete restrict,
  reviewed_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delegated_work_has_assignment check (
    kind <> 'delegated' or assignment_id is not null
  ),
  constraint internal_work_has_no_client_context check (
    kind <> 'internal' or (assignment_id is null and context_client_id is null)
  ),
  constraint personal_work_is_self_owned check (
    kind <> 'personal' or created_by = assignee_id
  ),
  constraint completed_work_has_timestamp check (
    status <> 'completed' or completed_at is not null
  )
);

create index work_items_assignee_status_idx on public.work_items (assignee_id, status);
create index work_items_assignment_idx on public.work_items (assignment_id)
  where assignment_id is not null;
create index work_items_due_open_idx on public.work_items (due_at)
  where status not in ('completed', 'cancelled') and archived_at is null;

create table public.cash_accounts (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 2 and 120),
  kind public.cash_account_kind not null,
  opening_balance numeric(14, 2) not null default 0,
  opening_balance_on date not null default current_date,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cash_ledger_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique default (
    'LE-' || lpad(nextval('public.ledger_entry_code_seq')::text, 7, '0')
  ),
  account_id uuid not null references public.cash_accounts(id) on delete restrict,
  entry_date date not null,
  direction public.ledger_direction not null,
  amount numeric(14, 2) not null check (amount > 0),
  category text not null check (char_length(trim(category)) between 2 and 120),
  narration text not null check (char_length(trim(narration)) between 2 and 500),
  reference text,
  status public.ledger_status not null default 'posted',
  reconciled_at timestamptz,
  void_reason text,
  voided_at timestamptz,
  voided_by uuid references public.profiles(user_id) on delete restrict,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  updated_by uuid references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ledger_void_metadata check (
    (status = 'posted' and voided_at is null and voided_by is null)
    or (status = 'voided' and voided_at is not null and voided_by is not null and void_reason is not null)
  )
);

create index cash_ledger_account_date_idx
  on public.cash_ledger_entries (account_id, entry_date desc);

create table public.invoices (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique default (
    'INV-' || lpad(nextval('public.invoice_code_seq')::text, 7, '0')
  ),
  client_id uuid not null references public.clients(id) on delete restrict,
  assignment_id uuid references public.assignments(id) on delete restrict,
  issue_date date not null default current_date,
  due_date date not null,
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  subtotal_amount numeric(14, 2) not null default 0 check (subtotal_amount >= 0),
  tax_amount numeric(14, 2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(14, 2) not null default 0 check (total_amount >= 0),
  amount_received numeric(14, 2) not null default 0 check (amount_received >= 0),
  status public.invoice_status not null default 'draft',
  notes text,
  issued_at timestamptz,
  void_reason text,
  voided_at timestamptz,
  voided_by uuid references public.profiles(user_id) on delete restrict,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_date_order check (due_date >= issue_date),
  constraint invoice_total_math check (total_amount = subtotal_amount + tax_amount),
  constraint invoice_receipt_limit check (amount_received <= total_amount),
  constraint invoice_issue_metadata check (
    status in ('draft', 'voided') or issued_at is not null
  ),
  constraint invoice_void_metadata check (
    status <> 'voided'
    or (voided_at is not null and voided_by is not null and nullif(trim(void_reason), '') is not null)
  )
);

create index invoices_client_status_idx on public.invoices (client_id, status);
create index invoices_due_open_idx on public.invoices (due_date)
  where status in ('issued', 'part_paid');

create table public.invoice_items (
  id uuid primary key default extensions.gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null check (char_length(trim(description)) between 2 and 300),
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  tax_rate numeric(5, 2) not null default 0 check (tax_rate between 0 and 100),
  line_subtotal numeric(14, 2) generated always as (
    round(quantity * unit_price, 2)
  ) stored,
  line_tax numeric(14, 2) generated always as (
    round(quantity * unit_price * tax_rate / 100, 2)
  ) stored,
  line_total numeric(14, 2) generated always as (
    round(quantity * unit_price * (1 + tax_rate / 100), 2)
  ) stored,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index invoice_items_invoice_idx on public.invoice_items (invoice_id, sort_order, id);

create table public.payment_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique default (
    'RCT-' || lpad(nextval('public.receipt_code_seq')::text, 7, '0')
  ),
  client_id uuid not null references public.clients(id) on delete restrict,
  ledger_entry_id uuid unique references public.cash_ledger_entries(id) on delete restrict,
  received_on date not null default current_date,
  amount numeric(14, 2) not null check (amount > 0),
  method public.payment_method not null,
  reference text,
  notes text,
  status public.payment_status not null default 'received',
  void_reason text,
  voided_at timestamptz,
  voided_by uuid references public.profiles(user_id) on delete restrict,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint receipt_void_metadata check (
    status <> 'voided'
    or (voided_at is not null and voided_by is not null and nullif(trim(void_reason), '') is not null)
  )
);

create index payment_receipts_client_date_idx
  on public.payment_receipts (client_id, received_on desc);

create table public.payment_allocations (
  id uuid primary key default extensions.gen_random_uuid(),
  receipt_id uuid not null references public.payment_receipts(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (receipt_id, invoice_id)
);

create index payment_allocations_invoice_idx on public.payment_allocations (invoice_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid,
  actor_role public.app_role,
  table_name text not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  record_pk text,
  old_row jsonb,
  new_row jsonb,
  request_id text
);

create index audit_log_record_idx on public.audit_log (table_name, record_pk, occurred_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, occurred_at desc);

comment on table public.assignments is
  'A client delivery obligation. Only Founder or Manager may create, assign, approve, or close it.';
comment on table public.work_items is
  'Delegated child work, non-client internal work, or a private self-owned personal task.';
comment on column public.work_items.assignment_id is
  'Required and immutable for delegated work; delegation never transfers Assignment ownership.';
comment on table public.cash_ledger_entries is
  'Append-and-void office ledger. Posted financial facts are never rewritten or deleted.';
comment on column public.invoices.amount_received is
  'Derived only from Payment Allocations; application code must never update it directly.';

-- ---------------------------------------------------------------------------
-- Shared authority helpers. These functions are the policy seam: application
-- code may hide controls, but database authorization always resolves here.
-- ---------------------------------------------------------------------------

create or replace function public.role_of(p_user_id uuid)
returns public.app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ur.role
  from public.user_roles ur
  join public.profiles p on p.user_id = ur.user_id
  where ur.user_id = p_user_id
    and p.is_active;
$$;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.role_of(auth.uid());
$$;

create or replace function public.is_active_employee(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.user_id
    where p.user_id = p_user_id
      and p.is_active
  );
$$;

create or replace function public.is_founder(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.role_of(p_user_id) = 'founder';
$$;

create or replace function public.is_management(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.role_of(p_user_id) in ('founder', 'manager');
$$;

create or replace function public.role_may_delegate(
  p_actor_role public.app_role,
  p_target_role public.app_role
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_actor_role
    when 'founder' then p_target_role <> 'founder'
    when 'manager' then p_target_role in ('senior_staff', 'staff', 'trainee')
    when 'senior_staff' then p_target_role in ('staff', 'trainee')
    when 'staff' then p_target_role = 'trainee'
    when 'trainee' then false
  end;
$$;

create or replace function public.can_manage_reporting_line(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case public.current_app_role()
    when 'founder' then true
    when 'manager' then public.role_of(p_employee_id) in ('senior_staff', 'staff', 'trainee')
    else false
  end;
$$;

create or replace function public.user_has_assignment_authority(
  p_user_id uuid,
  p_assignment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_management(p_user_id)
    or exists (
      select 1
      from public.assignments a
      where a.id = p_assignment_id
        and a.owner_id = p_user_id
    )
    or exists (
      select 1
      from public.assignment_reviewers ar
      where ar.assignment_id = p_assignment_id
        and ar.reviewer_id = p_user_id
    );
$$;

create or replace function public.user_assignment_involvement(
  p_user_id uuid,
  p_assignment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.user_has_assignment_authority(p_user_id, p_assignment_id)
    or exists (
      select 1
      from public.work_items wi
      where wi.assignment_id = p_assignment_id
        and (wi.assignee_id = p_user_id or wi.created_by = p_user_id)
    );
$$;

create or replace function public.assignment_involvement(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.user_assignment_involvement(auth.uid(), p_assignment_id);
$$;

create or replace function public.user_client_visible(
  p_user_id uuid,
  p_client_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_management(p_user_id)
    or exists (
      select 1 from public.clients c
      where c.id = p_client_id and c.relationship_owner_id = p_user_id
    )
    or exists (
      select 1 from public.assignments a
      where a.client_id = p_client_id
        and public.user_assignment_involvement(p_user_id, a.id)
    )
    or exists (
      select 1 from public.work_items wi
      where wi.kind = 'personal'
        and wi.context_client_id = p_client_id
        and wi.assignee_id = p_user_id
    );
$$;

create or replace function public.client_visible(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.user_client_visible(auth.uid(), p_client_id);
$$;

create or replace function public.user_can_view_work_item(
  p_user_id uuid,
  p_work_item_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.work_items wi
    where wi.id = p_work_item_id
      and case wi.kind
        when 'personal' then
          wi.assignee_id = p_user_id
          or (
            wi.assignment_id is not null
            and public.user_has_assignment_authority(p_user_id, wi.assignment_id)
          )
        when 'internal' then
          public.is_management(p_user_id)
          or wi.assignee_id = p_user_id
          or wi.created_by = p_user_id
        when 'delegated' then
          public.is_management(p_user_id)
          or wi.assignee_id = p_user_id
          or wi.created_by = p_user_id
          or public.user_assignment_involvement(p_user_id, wi.assignment_id)
      end
  );
$$;

create or replace function public.can_view_work_item(p_work_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.user_can_view_work_item(auth.uid(), p_work_item_id);
$$;

create or replace function public.can_create_work_item(
  p_kind public.work_item_kind,
  p_assignment_id uuid,
  p_client_id uuid,
  p_assignee_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.app_role := public.role_of(auth.uid());
  v_target_role public.app_role := public.role_of(p_assignee_id);
begin
  if v_actor is null or v_actor_role is null or v_target_role is null then
    return false;
  end if;

  case p_kind
    when 'personal' then
      return p_assignee_id = v_actor
        and (p_assignment_id is null or public.user_assignment_involvement(v_actor, p_assignment_id))
        and (p_client_id is null or public.user_client_visible(v_actor, p_client_id));
    when 'internal' then
      return p_assignment_id is null
        and p_client_id is null
        and public.role_may_delegate(v_actor_role, v_target_role);
    when 'delegated' then
      return p_assignment_id is not null
        and public.user_has_assignment_authority(v_actor, p_assignment_id)
        and public.role_may_delegate(v_actor_role, v_target_role);
  end case;
end;
$$;

create or replace function public.can_update_work_item(p_work_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.work_items wi
    where wi.id = p_work_item_id
      and case wi.kind
        when 'personal' then wi.assignee_id = auth.uid()
        when 'internal' then
          public.is_management()
          or wi.assignee_id = auth.uid()
          or wi.created_by = auth.uid()
        when 'delegated' then
          public.is_management()
          or wi.assignee_id = auth.uid()
          or wi.created_by = auth.uid()
          or public.user_has_assignment_authority(auth.uid(), wi.assignment_id)
      end
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_previous_flag text := current_setting('app.profile_sync', true);
begin
  perform set_config('app.profile_sync', 'on', true);
  insert into public.profiles (user_id, full_name, email)
  values (
    new.id,
    coalesce(
      case
        when char_length(trim(coalesce(new.raw_user_meta_data ->> 'full_name', ''))) >= 2
          then trim(new.raw_user_meta_data ->> 'full_name')
      end,
      case
        when char_length(trim(split_part(coalesce(new.email, ''), '@', 1))) >= 2
          then trim(split_part(new.email, '@', 1))
      end,
      'New employee'
    ),
    coalesce(new.email, new.id::text || '@pending.local')
  )
  on conflict (user_id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        updated_at = now();
  perform set_config('app.profile_sync', coalesce(v_previous_flag, ''), true);
  return new;
end;
$$;

create trigger sn_crm_on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if coalesce(current_setting('app.profile_sync', true), '') = 'on' then
    return new;
  end if;

  if new.user_id is distinct from old.user_id
     or new.email is distinct from old.email
     or new.created_at is distinct from old.created_at then
    raise exception 'Profile identity and Auth-synchronised fields are immutable.'
      using errcode = '23514';
  end if;

  if v_actor is null or public.is_founder(v_actor) then
    if old.is_active and not new.is_active then
      if public.role_of(old.user_id) = 'founder' then
        raise exception 'The Founder profile cannot be deactivated.' using errcode = '23514';
      end if;
      if exists (
        select 1
        from public.staff_reporting_lines srl
        join public.profiles subordinate on subordinate.user_id = srl.employee_id
        where srl.supervisor_id = old.user_id
          and subordinate.is_active
      ) then
        raise exception 'Reassign active direct reports before deactivating this employee.'
          using errcode = '23514';
      end if;
      if exists (
        select 1 from public.assignments a
        where a.owner_id = old.user_id
          and a.status not in ('closed', 'cancelled')
      ) or exists (
        select 1 from public.recurring_schedules rs
        where rs.default_owner_id = old.user_id
          and rs.is_active
      ) or exists (
        select 1 from public.work_items wi
        where wi.assignee_id = old.user_id
          and wi.status not in ('completed', 'cancelled')
          and wi.archived_at is null
      ) or exists (
        select 1 from public.clients c
        where c.relationship_owner_id = old.user_id
          and c.status <> 'archived'
      ) then
        raise exception 'Reassign active clients and work before deactivating this employee.'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  if v_actor <> old.user_id then
    raise exception 'Only the Founder may update another employee profile.'
      using errcode = '42501';
  end if;

  if new.is_active is distinct from old.is_active
     or new.joined_on is distinct from old.joined_on then
    raise exception 'Employees may update display details only.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

create or replace function public.guard_user_role_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
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

create trigger guard_user_role_write
  before insert or update or delete on public.user_roles
  for each row execute function public.guard_user_role_write();

create or replace function public.validate_reporting_line()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_role public.app_role := public.role_of(new.employee_id);
  v_supervisor_role public.app_role := public.role_of(new.supervisor_id);
  v_actor uuid := auth.uid();
begin
  if v_employee_role is null or v_supervisor_role is null then
    raise exception 'Both employee and supervisor must have active roles.'
      using errcode = '23514';
  end if;

  if v_actor is not null and not public.can_manage_reporting_line(new.employee_id) then
    raise exception 'This actor cannot manage the selected reporting line.'
      using errcode = '42501';
  end if;

  if v_employee_role = 'founder' then
    raise exception 'The Founder cannot report to another employee.'
      using errcode = '23514';
  elsif v_employee_role = 'manager' and v_supervisor_role <> 'founder' then
    raise exception 'A Manager must report to the Founder.'
      using errcode = '23514';
  elsif v_employee_role in ('senior_staff', 'staff', 'trainee')
    and v_supervisor_role not in ('founder', 'manager') then
    raise exception 'Senior Staff, Staff, and Trainees must report to a Founder or Manager.'
      using errcode = '23514';
  end if;

  if new.assigned_by is null and v_actor is not null then
    new.assigned_by := v_actor;
  end if;
  new.assigned_at := case when tg_op = 'INSERT' then now() else old.assigned_at end;
  new.updated_at := now();
  return new;
end;
$$;

create trigger validate_reporting_line
  before insert or update on public.staff_reporting_lines
  for each row execute function public.validate_reporting_line();

create or replace function public.assert_reporting_integrity_for(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.app_role;
  v_supervisor_role public.app_role;
begin
  select ur.role into v_role
  from public.user_roles ur
  where ur.user_id = p_user_id;

  if v_role is null then
    if exists (
      select 1 from public.staff_reporting_lines srl
      where srl.employee_id = p_user_id or srl.supervisor_id = p_user_id
    ) then
      raise exception 'A reporting line cannot reference an employee without a role.'
        using errcode = '23514';
    end if;
    return;
  end if;

  if v_role = 'founder' then
    if exists (select 1 from public.staff_reporting_lines where employee_id = p_user_id) then
      raise exception 'The Founder cannot have a reporting line.' using errcode = '23514';
    end if;
    return;
  end if;

  select public.role_of(srl.supervisor_id)
    into v_supervisor_role
  from public.staff_reporting_lines srl
  where srl.employee_id = p_user_id;

  if v_supervisor_role is null then
    raise exception 'Every non-Founder must have one reporting line.' using errcode = '23514';
  end if;

  if v_role = 'manager' and v_supervisor_role <> 'founder' then
    raise exception 'A Manager must report to the Founder.' using errcode = '23514';
  elsif v_role in ('senior_staff', 'staff', 'trainee')
    and v_supervisor_role not in ('founder', 'manager') then
    raise exception 'This role must report to a Founder or Manager.' using errcode = '23514';
  end if;
end;
$$;

create or replace function public.check_user_role_reporting_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_subordinate record;
begin
  v_user_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  perform public.assert_reporting_integrity_for(v_user_id);
  for v_subordinate in
    select srl.employee_id
    from public.staff_reporting_lines srl
    where srl.supervisor_id = v_user_id
  loop
    perform public.assert_reporting_integrity_for(v_subordinate.employee_id);
  end loop;
  return null;
end;
$$;

create constraint trigger user_role_reporting_integrity
  after insert or update or delete on public.user_roles
  deferrable initially deferred
  for each row execute function public.check_user_role_reporting_integrity();

create or replace function public.check_reporting_line_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.assert_reporting_integrity_for(old.employee_id);
  end if;
  if tg_op <> 'DELETE' then
    perform public.assert_reporting_integrity_for(new.employee_id);
  end if;
  return null;
end;
$$;

create constraint trigger reporting_line_integrity
  after insert or update or delete on public.staff_reporting_lines
  deferrable initially deferred
  for each row execute function public.check_reporting_line_integrity();

create or replace function public.set_staff_authority(
  p_user_id uuid,
  p_role public.app_role,
  p_supervisor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.is_founder(v_actor) then
    raise exception 'Only the Founder may assign or change roles.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where user_id = p_user_id and is_active) then
    raise exception 'The employee profile is missing or inactive.' using errcode = '23503';
  end if;

  insert into public.user_roles (user_id, role, assigned_by)
  values (p_user_id, p_role, v_actor)
  on conflict (user_id) do update
    set role = excluded.role,
        assigned_by = coalesce(v_actor, public.user_roles.assigned_by),
        updated_at = now();

  if p_role = 'founder' then
    delete from public.staff_reporting_lines where employee_id = p_user_id;
  else
    if p_supervisor_id is null then
      raise exception 'A non-Founder requires a supervisor.' using errcode = '23514';
    end if;
    insert into public.staff_reporting_lines (employee_id, supervisor_id, assigned_by)
    values (p_user_id, p_supervisor_id, v_actor)
    on conflict (employee_id) do update
      set supervisor_id = excluded.supervisor_id,
          assigned_by = coalesce(v_actor, public.staff_reporting_lines.assigned_by),
          updated_at = now();
  end if;
end;
$$;

create or replace function public.set_reporting_line(
  p_employee_id uuid,
  p_supervisor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.can_manage_reporting_line(p_employee_id) then
    raise exception 'This actor cannot manage the selected reporting line.' using errcode = '42501';
  end if;
  insert into public.staff_reporting_lines (employee_id, supervisor_id, assigned_by)
  values (p_employee_id, p_supervisor_id, v_actor)
  on conflict (employee_id) do update
    set supervisor_id = excluded.supervisor_id,
        assigned_by = coalesce(v_actor, public.staff_reporting_lines.assigned_by),
        updated_at = now();
end;
$$;

create or replace function public.assignment_transition_allowed(
  p_old public.assignment_status,
  p_new public.assignment_status,
  p_actor_role public.app_role,
  p_is_owner boolean,
  p_is_reviewer boolean
)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_old = p_new then
    return true;
  end if;

  if p_actor_role in ('founder', 'manager') then
    return case p_old
      when 'draft' then p_new in ('assigned', 'cancelled')
      when 'assigned' then p_new in ('in_progress', 'ready_for_review', 'cancelled')
      when 'in_progress' then p_new in ('ready_for_review', 'changes_requested', 'cancelled')
      when 'ready_for_review' then p_new in ('approved', 'changes_requested', 'cancelled')
      when 'changes_requested' then p_new in ('in_progress', 'ready_for_review', 'cancelled')
      when 'approved' then p_new = 'closed'
      when 'closed' then false
      when 'cancelled' then false
    end;
  end if;

  if p_is_owner then
    return (p_old = 'assigned' and p_new in ('in_progress', 'ready_for_review'))
      or (p_old = 'in_progress' and p_new = 'ready_for_review')
      or (p_old = 'changes_requested' and p_new in ('in_progress', 'ready_for_review'));
  end if;

  if p_is_reviewer then
    return p_old = 'ready_for_review' and p_new = 'changes_requested';
  end if;

  return false;
end;
$$;

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

  if old.status in ('closed', 'cancelled')
     and (new.service_id is distinct from old.service_id
       or new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.owner_id is distinct from old.owner_id
       or new.priority is distinct from old.priority
       or new.due_at is distinct from old.due_at
       or new.progress_percent is distinct from old.progress_percent
       or new.delivery_notes is distinct from old.delivery_notes
       or new.review_notes is distinct from old.review_notes) then
    raise exception 'Closed and cancelled Assignments are immutable.' using errcode = '23514';
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
        raise exception 'Delivery employees may update progress and review fields only.'
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

create trigger guard_assignment_write
  before insert or update on public.assignments
  for each row execute function public.guard_assignment_write();

create or replace function public.guard_assignment_reviewer_write()
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

create trigger guard_assignment_reviewer_write
  before insert or update or delete on public.assignment_reviewers
  for each row execute function public.guard_assignment_reviewer_write();

create or replace function public.guard_recurring_schedule_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_owner_role public.app_role := public.role_of(new.default_owner_id);
begin
  if v_owner_role is null or v_owner_role = 'trainee' then
    raise exception 'A Trainee cannot be the default owner of a Recurring Schedule.'
      using errcode = '23514';
  end if;

  if v_actor is not null and not public.is_management(v_actor) then
    raise exception 'Only the Founder or Manager may manage Recurring Schedules.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.created_by := v_actor;
    end if;
  elsif new.code is distinct from old.code
     or new.created_by is distinct from old.created_by then
    raise exception 'Schedule code and creator are immutable.' using errcode = '23514';
  end if;

  if new.end_date is not null and new.next_occurrence_date > new.end_date then
    new.is_active := false;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger guard_recurring_schedule_write
  before insert or update on public.recurring_schedules
  for each row execute function public.guard_recurring_schedule_write();

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
        created_by
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
        v_schedule.created_by
      )
      on conflict (recurring_schedule_id, period_start)
        where recurring_schedule_id is not null
      do nothing
      returning id into v_assignment_id;

      if v_assignment_id is not null then
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

create or replace function public.work_item_transition_allowed(
  p_old public.work_item_status,
  p_new public.work_item_status,
  p_kind public.work_item_kind,
  p_is_assignee boolean,
  p_can_review boolean
)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_old = p_new then
    return true;
  end if;

  if p_kind = 'personal' and p_is_assignee then
    return case p_old
      when 'todo' then p_new in ('in_progress', 'blocked', 'completed', 'cancelled')
      when 'in_progress' then p_new in ('todo', 'blocked', 'completed', 'cancelled')
      when 'blocked' then p_new in ('todo', 'in_progress', 'completed', 'cancelled')
      when 'ready_for_review' then p_new in ('in_progress', 'completed', 'cancelled')
      when 'changes_requested' then p_new in ('in_progress', 'completed', 'cancelled')
      when 'completed' then false
      when 'cancelled' then false
    end;
  end if;

  if p_can_review then
    return case p_old
      when 'todo' then p_new in ('in_progress', 'blocked', 'cancelled')
      when 'in_progress' then p_new in ('blocked', 'ready_for_review', 'completed', 'cancelled')
      when 'blocked' then p_new in ('in_progress', 'cancelled')
      when 'ready_for_review' then p_new in ('completed', 'changes_requested', 'cancelled')
      when 'changes_requested' then p_new in ('in_progress', 'completed', 'cancelled')
      when 'completed' then false
      when 'cancelled' then false
    end;
  end if;

  if p_is_assignee then
    return (p_old = 'todo' and p_new in ('in_progress', 'blocked', 'ready_for_review'))
      or (p_old = 'in_progress' and p_new in ('blocked', 'ready_for_review'))
      or (p_old = 'blocked' and p_new in ('in_progress', 'ready_for_review'))
      or (p_old = 'changes_requested' and p_new in ('in_progress', 'ready_for_review'));
  end if;

  return false;
end;
$$;

create or replace function public.guard_work_item_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_effective_actor uuid;
  v_actor_role public.app_role;
  v_target_role public.app_role;
  v_assignment_client uuid;
  v_assignment_status public.assignment_status;
  v_is_assignee boolean;
  v_can_review boolean;
begin
  v_effective_actor := coalesce(v_actor, new.created_by);
  v_actor_role := public.role_of(v_effective_actor);
  v_target_role := public.role_of(new.assignee_id);

  if v_actor_role is null or v_target_role is null then
    raise exception 'Work Item creator and assignee must have active roles.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.created_by := v_actor;
      if new.status <> 'todo' then
        raise exception 'A new Work Item must begin in Todo.' using errcode = '23514';
      end if;
    end if;

    case new.kind
      when 'personal' then
        if new.assignee_id <> v_effective_actor then
          raise exception 'A Personal Task must be created for self.' using errcode = '23514';
        end if;
        if new.assignment_id is not null then
          select a.client_id into v_assignment_client
          from public.assignments a where a.id = new.assignment_id;
          if v_assignment_client is null then
            raise exception 'The linked Assignment does not exist.' using errcode = '23503';
          end if;
          if not public.user_assignment_involvement(v_effective_actor, new.assignment_id) then
            raise exception 'The employee cannot link a Personal Task to this Assignment.'
              using errcode = '42501';
          end if;
          if new.context_client_id is not null and new.context_client_id <> v_assignment_client then
            raise exception 'Personal Task client context conflicts with its Assignment.'
              using errcode = '23514';
          end if;
          new.context_client_id := v_assignment_client;
        elsif new.context_client_id is not null
          and not public.user_client_visible(v_effective_actor, new.context_client_id) then
          raise exception 'The employee cannot link a Personal Task to this Client.'
            using errcode = '42501';
        end if;

      when 'internal' then
        if new.assignment_id is not null or new.context_client_id is not null then
          raise exception 'Internal work cannot represent client delivery.' using errcode = '23514';
        end if;
        if not public.role_may_delegate(v_actor_role, v_target_role) then
          raise exception 'Internal Tasks may be assigned downward only.' using errcode = '42501';
        end if;

      when 'delegated' then
        select a.client_id, a.status
          into v_assignment_client, v_assignment_status
        from public.assignments a
        where a.id = new.assignment_id;
        if v_assignment_client is null then
          raise exception 'A Delegated Task requires a parent Assignment.' using errcode = '23503';
        end if;
        if v_assignment_status in ('approved', 'closed', 'cancelled') then
          raise exception 'New work cannot be delegated from a terminal Assignment.'
            using errcode = '23514';
        end if;
        if not public.user_has_assignment_authority(v_effective_actor, new.assignment_id) then
          raise exception 'Only leadership, the Assignment owner, or a reviewer may delegate its work.'
            using errcode = '42501';
        end if;
        if not public.role_may_delegate(v_actor_role, v_target_role) then
          raise exception 'The selected assignee is outside this role''s delegation authority.'
            using errcode = '42501';
        end if;
        if new.context_client_id is not null and new.context_client_id <> v_assignment_client then
          raise exception 'Delegated Task client context must match its Assignment.'
            using errcode = '23514';
        end if;
        new.context_client_id := v_assignment_client;
    end case;

    return new;
  end if;

  if new.code is distinct from old.code
     or new.kind is distinct from old.kind
     or new.created_by is distinct from old.created_by
     or new.assignment_id is distinct from old.assignment_id
     or new.context_client_id is distinct from old.context_client_id then
    raise exception 'Work Item kind, creator, and parent context are immutable.'
      using errcode = '23514';
  end if;

  if old.status in ('completed', 'cancelled')
     and (new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.assignee_id is distinct from old.assignee_id
       or new.priority is distinct from old.priority
       or new.due_at is distinct from old.due_at
       or new.progress_percent is distinct from old.progress_percent
       or new.completion_note is distinct from old.completion_note
       or new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at
       or new.completed_at is distinct from old.completed_at) then
    raise exception 'Completed and cancelled Work Items are immutable except for archiving.'
      using errcode = '23514';
  end if;

  v_is_assignee := v_actor is not null and v_actor = old.assignee_id;
  v_can_review := v_actor is not null and (
    public.is_management(v_actor)
    or v_actor = old.created_by
    or (
      old.assignment_id is not null
      and public.user_has_assignment_authority(v_actor, old.assignment_id)
    )
  );

  if v_actor is not null then
    if old.kind = 'personal' then
      if not v_is_assignee then
        raise exception 'Only the owner may update a Personal Task.' using errcode = '42501';
      end if;
      if new.assignee_id is distinct from old.assignee_id then
        raise exception 'A Personal Task cannot be transferred.' using errcode = '23514';
      end if;
    else
      if not v_is_assignee and not v_can_review then
        raise exception 'This employee cannot update the Work Item.' using errcode = '42501';
      end if;
      if v_is_assignee and not v_can_review then
        if new.title is distinct from old.title
           or new.description is distinct from old.description
           or new.assignee_id is distinct from old.assignee_id
           or new.priority is distinct from old.priority
           or new.due_at is distinct from old.due_at
           or new.reviewed_by is distinct from old.reviewed_by
           or new.reviewed_at is distinct from old.reviewed_at
           or new.completed_at is distinct from old.completed_at
           or new.archived_at is distinct from old.archived_at then
          raise exception 'Assignees may update progress and completion notes only.'
            using errcode = '42501';
        end if;
      end if;
    end if;

    if new.assignee_id is distinct from old.assignee_id then
      if old.kind = 'personal' or not v_can_review then
        raise exception 'This Work Item cannot be transferred by the current actor.'
          using errcode = '42501';
      end if;
      if not public.role_may_delegate(v_actor_role, v_target_role) then
        raise exception 'The new assignee is outside this role''s delegation authority.'
          using errcode = '42501';
      end if;
    end if;

    if not public.work_item_transition_allowed(
      old.status,
      new.status,
      old.kind,
      v_is_assignee,
      v_can_review
    ) then
      raise exception 'Invalid Work Item status transition for this actor.' using errcode = '23514';
    end if;
  end if;

  if old.status <> new.status then
    if new.status in ('changes_requested', 'completed', 'cancelled') and v_can_review then
      new.reviewed_by := v_actor;
      new.reviewed_at := now();
    end if;
    if new.status = 'completed' then
      new.completed_at := now();
      new.progress_percent := 100;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger guard_work_item_write
  before insert or update on public.work_items
  for each row execute function public.guard_work_item_write();

create or replace function public.guard_management_owned_record()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is not null and not public.is_management(v_actor) then
    raise exception 'Only the Founder or Manager may change this record.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.created_by := v_actor;
    end if;
  elsif new.created_by is distinct from old.created_by then
    raise exception 'Creator provenance is immutable.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE'
     and tg_table_name = 'clients'
     and to_jsonb(new) ->> 'code' is distinct from to_jsonb(old) ->> 'code' then
    raise exception 'Client codes are database-generated and immutable.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger guard_client_write
  before insert or update on public.clients
  for each row execute function public.guard_management_owned_record();

create or replace function public.validate_client_relationship_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_role public.app_role;
begin
  if new.relationship_owner_id is null then
    return new;
  end if;
  v_owner_role := public.role_of(new.relationship_owner_id);
  if v_owner_role is null or v_owner_role = 'trainee' then
    raise exception 'A Client relationship owner must be active and cannot be a Trainee.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger validate_client_relationship_owner
  before insert or update of relationship_owner_id on public.clients
  for each row execute function public.validate_client_relationship_owner();
create trigger guard_service_catalog_write
  before insert or update on public.service_catalog
  for each row execute function public.guard_management_owned_record();
create trigger guard_cash_account_write
  before insert or update on public.cash_accounts
  for each row execute function public.guard_management_owned_record();

create or replace function public.guard_cash_ledger_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is not null and not public.is_management(v_actor) then
    raise exception 'Office Accounts are operated by the Manager with Founder oversight.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'posted' then
      raise exception 'A Ledger Entry must first be posted.' using errcode = '23514';
    end if;
    if v_actor is not null then
      new.created_by := v_actor;
      new.updated_by := v_actor;
    end if;
    return new;
  end if;

  if old.status = 'voided' then
    raise exception 'A voided Ledger Entry is immutable.' using errcode = '23514';
  end if;

  if new.code is distinct from old.code
     or new.account_id is distinct from old.account_id
     or new.entry_date is distinct from old.entry_date
     or new.direction is distinct from old.direction
     or new.amount is distinct from old.amount
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Posted financial facts cannot be rewritten; void and post a correction.'
      using errcode = '23514';
  end if;

  if old.reconciled_at is not null
     and (new.category is distinct from old.category
       or new.narration is distinct from old.narration
       or new.reference is distinct from old.reference) then
    raise exception 'Reconciled Ledger Entry details are immutable.' using errcode = '23514';
  end if;

  if old.status = 'posted' and new.status = 'voided' then
    if exists (
      select 1
      from public.payment_receipts pr
      where pr.ledger_entry_id = old.id
        and pr.status = 'received'
    ) then
      raise exception 'Void the linked Payment Receipt before voiding its Ledger Entry.'
        using errcode = '23514';
    end if;
    if nullif(trim(new.void_reason), '') is null then
      raise exception 'A void reason is required.' using errcode = '23514';
    end if;
    new.voided_at := now();
    new.voided_by := coalesce(v_actor, new.voided_by);
  elsif new.status <> old.status then
    raise exception 'Invalid Ledger Entry status transition.' using errcode = '23514';
  else
    new.void_reason := null;
  end if;

  new.updated_by := coalesce(v_actor, new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;

create trigger guard_cash_ledger_write
  before insert or update on public.cash_ledger_entries
  for each row execute function public.guard_cash_ledger_write();

create or replace function public.prevent_cash_ledger_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Ledger Entries are append-and-void records and cannot be deleted.'
    using errcode = '23514';
end;
$$;

create trigger prevent_cash_ledger_delete
  before delete on public.cash_ledger_entries
  for each row execute function public.prevent_cash_ledger_delete();

create or replace function public.guard_invoice_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_internal_recompute boolean := coalesce(
    current_setting('app.invoice_recompute', true), ''
  ) = 'on';
  v_assignment_client uuid;
begin
  if v_actor is not null and not public.is_management(v_actor) then
    raise exception 'Only the Founder or Manager may operate billing records.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.created_by := v_actor;
    end if;
    if new.status <> 'draft'
       or new.subtotal_amount <> 0
       or new.tax_amount <> 0
       or new.total_amount <> 0
       or new.amount_received <> 0 then
      raise exception 'A new Invoice must begin as an empty Draft.' using errcode = '23514';
    end if;
    if new.assignment_id is not null then
      select a.client_id into v_assignment_client
      from public.assignments a where a.id = new.assignment_id;
      if v_assignment_client is null then
        raise exception 'Linked Assignment not found.' using errcode = '23503';
      end if;
      if v_assignment_client <> new.client_id then
        raise exception 'Invoice and linked Assignment must belong to the same Client.'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  if new.code is distinct from old.code
     or new.client_id is distinct from old.client_id
     or new.assignment_id is distinct from old.assignment_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Invoice identity and provenance are immutable.' using errcode = '23514';
  end if;

  if v_internal_recompute then
    new.updated_at := now();
    return new;
  end if;

  if new.subtotal_amount is distinct from old.subtotal_amount
     or new.tax_amount is distinct from old.tax_amount
     or new.total_amount is distinct from old.total_amount then
    raise exception 'Invoice totals are derived from Invoice Items.' using errcode = '23514';
  end if;
  if new.amount_received is distinct from old.amount_received then
    raise exception 'Invoice amount received is derived from Payment Allocations.'
      using errcode = '23514';
  end if;
  if old.status = 'voided' then
    raise exception 'A voided Invoice is immutable.' using errcode = '23514';
  end if;

  if old.status = 'draft' then
    if new.status = 'issued' then
      if new.total_amount <= 0 then
        raise exception 'An Invoice needs at least one positive line before issue.'
          using errcode = '23514';
      end if;
      new.issued_at := now();
    elsif new.status = 'voided' then
      if nullif(trim(new.void_reason), '') is null then
        raise exception 'A void reason is required.' using errcode = '23514';
      end if;
      new.voided_at := now();
      new.voided_by := coalesce(v_actor, new.voided_by);
    elsif new.status <> 'draft' then
      raise exception 'A Draft Invoice may only be issued or voided.' using errcode = '23514';
    end if;
  else
    if new.issue_date is distinct from old.issue_date
       or new.due_date is distinct from old.due_date
       or new.currency is distinct from old.currency then
      raise exception 'Issue and due facts are immutable after an Invoice is issued.'
        using errcode = '23514';
    end if;
    if new.status = 'voided' and old.status <> 'voided' then
      if exists (
        select 1
        from public.payment_allocations pa
        join public.payment_receipts pr on pr.id = pa.receipt_id
        where pa.invoice_id = old.id
          and pr.status = 'received'
      ) then
        raise exception 'Remove received-payment allocations before voiding this Invoice.'
          using errcode = '23514';
      end if;
      if nullif(trim(new.void_reason), '') is null then
        raise exception 'A void reason is required.' using errcode = '23514';
      end if;
      new.voided_at := now();
      new.voided_by := coalesce(v_actor, new.voided_by);
    elsif new.status is distinct from old.status then
      raise exception 'Invoice payment status is derived from allocations.' using errcode = '23514';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger guard_invoice_write
  before insert or update on public.invoices
  for each row execute function public.guard_invoice_write();

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

create trigger guard_invoice_item_write
  before insert or update or delete on public.invoice_items
  for each row execute function public.guard_invoice_item_write();

create or replace function public.recompute_invoice_totals(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subtotal numeric(14, 2);
  v_tax numeric(14, 2);
  v_previous_flag text := current_setting('app.invoice_recompute', true);
begin
  select
    coalesce(sum(ii.line_subtotal), 0),
    coalesce(sum(ii.line_tax), 0)
  into v_subtotal, v_tax
  from public.invoice_items ii
  where ii.invoice_id = p_invoice_id;

  perform set_config('app.invoice_recompute', 'on', true);
  update public.invoices
  set subtotal_amount = v_subtotal,
      tax_amount = v_tax,
      total_amount = v_subtotal + v_tax,
      updated_at = now()
  where id = p_invoice_id;
  perform set_config('app.invoice_recompute', coalesce(v_previous_flag, ''), true);
end;
$$;

create or replace function public.recompute_invoice_totals_after_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_invoice_totals(old.invoice_id);
  else
    perform public.recompute_invoice_totals(new.invoice_id);
  end if;
  return null;
end;
$$;

create trigger recompute_invoice_totals_after_item
  after insert or update or delete on public.invoice_items
  for each row execute function public.recompute_invoice_totals_after_item();

create or replace function public.recompute_invoice_payment_state(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_received numeric(14, 2);
  v_total numeric(14, 2);
  v_status public.invoice_status;
  v_next_status public.invoice_status;
  v_previous_flag text := current_setting('app.invoice_recompute', true);
begin
  select i.total_amount, i.status
    into v_total, v_status
  from public.invoices i
  where i.id = p_invoice_id
  for update;

  if not found then
    return;
  end if;

  select coalesce(sum(pa.amount), 0)
    into v_received
  from public.payment_allocations pa
  join public.payment_receipts pr on pr.id = pa.receipt_id
  where pa.invoice_id = p_invoice_id
    and pr.status = 'received';

  if v_received > v_total then
    raise exception 'Payment allocations exceed the Invoice total.' using errcode = '23514';
  end if;

  v_next_status := case
    when v_status = 'voided' then 'voided'::public.invoice_status
    when v_status = 'draft' then 'draft'::public.invoice_status
    when v_received = 0 then 'issued'::public.invoice_status
    when v_received < v_total then 'part_paid'::public.invoice_status
    else 'paid'::public.invoice_status
  end;

  perform set_config('app.invoice_recompute', 'on', true);
  update public.invoices
  set amount_received = v_received,
      status = v_next_status,
      updated_at = now()
  where id = p_invoice_id;
  perform set_config('app.invoice_recompute', coalesce(v_previous_flag, ''), true);
end;
$$;

create or replace function public.guard_payment_receipt_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_ledger_direction public.ledger_direction;
  v_ledger_amount numeric(14, 2);
  v_ledger_status public.ledger_status;
begin
  if v_actor is not null and not public.is_management(v_actor) then
    raise exception 'Only the Founder or Manager may operate payment receipts.'
      using errcode = '42501';
  end if;

  if new.ledger_entry_id is not null then
    select cle.direction, cle.amount, cle.status
      into v_ledger_direction, v_ledger_amount, v_ledger_status
    from public.cash_ledger_entries cle
    where cle.id = new.ledger_entry_id;
    if v_ledger_direction is null then
      raise exception 'Linked Ledger Entry not found.' using errcode = '23503';
    end if;
    if v_ledger_direction <> 'receipt'
       or v_ledger_amount <> new.amount
       or v_ledger_status <> 'posted' then
      raise exception 'A Receipt must link to an equal, posted receipt Ledger Entry.'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'received' then
      raise exception 'A new Payment Receipt must begin as Received.' using errcode = '23514';
    end if;
    if v_actor is not null then
      new.created_by := v_actor;
    end if;
    return new;
  end if;

  if new.code is distinct from old.code
     or new.client_id is distinct from old.client_id
     or new.ledger_entry_id is distinct from old.ledger_entry_id
     or new.received_on is distinct from old.received_on
     or new.amount is distinct from old.amount
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Receipt amount, client, date, and provenance are immutable.'
      using errcode = '23514';
  end if;
  if old.status = 'voided' then
    raise exception 'A voided Payment Receipt is immutable.' using errcode = '23514';
  end if;
  if new.status = 'voided' and old.status = 'received' then
    if nullif(trim(new.void_reason), '') is null then
      raise exception 'A void reason is required.' using errcode = '23514';
    end if;
    new.voided_at := now();
    new.voided_by := coalesce(v_actor, new.voided_by);
  elsif new.status is distinct from old.status then
    raise exception 'Invalid Payment Receipt status transition.' using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger guard_payment_receipt_write
  before insert or update on public.payment_receipts
  for each row execute function public.guard_payment_receipt_write();

create or replace function public.guard_payment_allocation_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_receipt_client uuid;
  v_receipt_amount numeric(14, 2);
  v_receipt_status public.payment_status;
  v_invoice_client uuid;
  v_invoice_total numeric(14, 2);
  v_invoice_status public.invoice_status;
  v_receipt_allocated numeric(14, 2);
  v_invoice_allocated numeric(14, 2);
  v_excluded_id uuid;
begin
  if v_actor is not null and not public.is_management(v_actor) then
    raise exception 'Only the Founder or Manager may allocate payments.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  v_excluded_id := case when tg_op = 'UPDATE' then old.id else null end;
  select pr.client_id, pr.amount, pr.status
    into v_receipt_client, v_receipt_amount, v_receipt_status
  from public.payment_receipts pr
  where pr.id = new.receipt_id
  for update;
  select i.client_id, i.total_amount, i.status
    into v_invoice_client, v_invoice_total, v_invoice_status
  from public.invoices i
  where i.id = new.invoice_id
  for update;

  if v_receipt_client is null or v_invoice_client is null then
    raise exception 'Receipt or Invoice not found.' using errcode = '23503';
  end if;
  if v_receipt_status <> 'received' then
    raise exception 'A voided Receipt cannot be allocated.' using errcode = '23514';
  end if;
  if v_invoice_status not in ('issued', 'part_paid')
     and not (tg_op = 'UPDATE' and v_invoice_status = 'paid') then
    raise exception 'Payments may be allocated only to an open, issued Invoice.'
      using errcode = '23514';
  end if;
  if v_receipt_client <> v_invoice_client then
    raise exception 'Receipt and Invoice must belong to the same Client.' using errcode = '23514';
  end if;

  select coalesce(sum(pa.amount), 0)
    into v_receipt_allocated
  from public.payment_allocations pa
  where pa.receipt_id = new.receipt_id
    and (v_excluded_id is null or pa.id <> v_excluded_id);
  if v_receipt_allocated + new.amount > v_receipt_amount then
    raise exception 'Payment allocations exceed the Receipt amount.' using errcode = '23514';
  end if;

  select coalesce(sum(pa.amount), 0)
    into v_invoice_allocated
  from public.payment_allocations pa
  join public.payment_receipts pr on pr.id = pa.receipt_id
  where pa.invoice_id = new.invoice_id
    and pr.status = 'received'
    and (v_excluded_id is null or pa.id <> v_excluded_id);
  if v_invoice_allocated + new.amount > v_invoice_total then
    raise exception 'Payment allocations exceed the Invoice balance.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.created_by := v_actor;
    end if;
  elsif new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Allocation provenance is immutable.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger guard_payment_allocation_write
  before insert or update or delete on public.payment_allocations
  for each row execute function public.guard_payment_allocation_write();

create or replace function public.recompute_invoice_after_allocation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_invoice_payment_state(old.invoice_id);
  elsif tg_op = 'INSERT' then
    perform public.recompute_invoice_payment_state(new.invoice_id);
  else
    if new.invoice_id is distinct from old.invoice_id then
      perform public.recompute_invoice_payment_state(old.invoice_id);
    end if;
    perform public.recompute_invoice_payment_state(new.invoice_id);
  end if;
  return null;
end;
$$;

create trigger recompute_invoice_after_allocation
  after insert or update or delete on public.payment_allocations
  for each row execute function public.recompute_invoice_after_allocation();

create or replace function public.recompute_invoices_after_receipt_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice record;
begin
  if old.status is distinct from new.status then
    for v_invoice in
      select distinct pa.invoice_id
      from public.payment_allocations pa
      where pa.receipt_id = new.id
    loop
      perform public.recompute_invoice_payment_state(v_invoice.invoice_id);
    end loop;
  end if;
  return null;
end;
$$;

create trigger recompute_invoices_after_receipt_status
  after update of status on public.payment_receipts
  for each row execute function public.recompute_invoices_after_receipt_status();

create or replace function public.prevent_financial_document_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Financial documents are voided, never deleted.' using errcode = '23514';
end;
$$;

create trigger prevent_invoice_delete
  before delete on public.invoices
  for each row execute function public.prevent_financial_document_delete();
create trigger prevent_payment_receipt_delete
  before delete on public.payment_receipts
  for each row execute function public.prevent_financial_document_delete();

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
begin
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;

  if tg_table_name = 'work_items'
     and coalesce(v_new ->> 'kind', v_old ->> 'kind') = 'personal' then
    if v_old is not null then
      v_old := v_old - 'title' - 'description' - 'completion_note';
    end if;
    if v_new is not null then
      v_new := v_new - 'title' - 'description' - 'completion_note';
    end if;
  end if;

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
    request_id
  ) values (
    auth.uid(),
    public.role_of(auth.uid()),
    tg_table_name,
    tg_op,
    v_record_pk,
    v_old,
    v_new,
    v_request_id
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'The audit trail is immutable.' using errcode = '23514';
end;
$$;

create trigger prevent_audit_mutation
  before update or delete on public.audit_log
  for each row execute function public.prevent_audit_mutation();

create trigger set_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();
create trigger set_service_catalog_updated_at before update on public.service_catalog
  for each row execute function public.set_updated_at();
create trigger set_cash_accounts_updated_at before update on public.cash_accounts
  for each row execute function public.set_updated_at();

create trigger audit_profiles after insert or update or delete on public.profiles
  for each row execute function public.audit_row_change();
create trigger audit_user_roles after insert or update or delete on public.user_roles
  for each row execute function public.audit_row_change();
create trigger audit_staff_reporting_lines after insert or update or delete on public.staff_reporting_lines
  for each row execute function public.audit_row_change();
create trigger audit_clients after insert or update or delete on public.clients
  for each row execute function public.audit_row_change();
create trigger audit_service_catalog after insert or update or delete on public.service_catalog
  for each row execute function public.audit_row_change();
create trigger audit_recurring_schedules after insert or update or delete on public.recurring_schedules
  for each row execute function public.audit_row_change();
create trigger audit_assignments after insert or update or delete on public.assignments
  for each row execute function public.audit_row_change();
create trigger audit_assignment_reviewers after insert or update or delete on public.assignment_reviewers
  for each row execute function public.audit_row_change();
create trigger audit_work_items after insert or update or delete on public.work_items
  for each row execute function public.audit_row_change();
create trigger audit_cash_accounts after insert or update or delete on public.cash_accounts
  for each row execute function public.audit_row_change();
create trigger audit_cash_ledger_entries after insert or update or delete on public.cash_ledger_entries
  for each row execute function public.audit_row_change();
create trigger audit_invoices after insert or update or delete on public.invoices
  for each row execute function public.audit_row_change();
create trigger audit_invoice_items after insert or update or delete on public.invoice_items
  for each row execute function public.audit_row_change();
create trigger audit_payment_receipts after insert or update or delete on public.payment_receipts
  for each row execute function public.audit_row_change();
create trigger audit_payment_allocations after insert or update or delete on public.payment_allocations
  for each row execute function public.audit_row_change();

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.staff_reporting_lines enable row level security;
alter table public.clients enable row level security;
alter table public.service_catalog enable row level security;
alter table public.recurring_schedules enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_reviewers enable row level security;
alter table public.work_items enable row level security;
alter table public.cash_accounts enable row level security;
alter table public.cash_ledger_entries enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payment_receipts enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.audit_log enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    public.is_active_employee()
    and (public.is_management() or is_active or user_id = auth.uid())
  );
create policy profiles_update on public.profiles
  for update to authenticated
  using (public.is_founder() or user_id = auth.uid())
  with check (public.is_founder() or user_id = auth.uid());

create policy user_roles_select on public.user_roles
  for select to authenticated
  using (public.is_active_employee());
create policy user_roles_insert on public.user_roles
  for insert to authenticated
  with check (public.is_founder() and assigned_by = auth.uid());
create policy user_roles_update on public.user_roles
  for update to authenticated
  using (public.is_founder())
  with check (public.is_founder());
create policy user_roles_delete on public.user_roles
  for delete to authenticated
  using (public.is_founder());

create policy reporting_lines_select on public.staff_reporting_lines
  for select to authenticated
  using (
    public.is_management()
    or employee_id = auth.uid()
    or supervisor_id = auth.uid()
  );
create policy reporting_lines_insert on public.staff_reporting_lines
  for insert to authenticated
  with check (public.can_manage_reporting_line(employee_id));
create policy reporting_lines_update on public.staff_reporting_lines
  for update to authenticated
  using (public.can_manage_reporting_line(employee_id))
  with check (public.can_manage_reporting_line(employee_id));
create policy reporting_lines_delete on public.staff_reporting_lines
  for delete to authenticated
  using (public.can_manage_reporting_line(employee_id));

create policy clients_select on public.clients
  for select to authenticated
  using (public.client_visible(id));
create policy clients_insert on public.clients
  for insert to authenticated
  with check (public.is_management() and created_by = auth.uid());
create policy clients_update on public.clients
  for update to authenticated
  using (public.is_management())
  with check (public.is_management());

create policy service_catalog_select on public.service_catalog
  for select to authenticated
  using (public.is_active_employee());
create policy service_catalog_insert on public.service_catalog
  for insert to authenticated
  with check (public.is_management() and created_by = auth.uid());
create policy service_catalog_update on public.service_catalog
  for update to authenticated
  using (public.is_management())
  with check (public.is_management());

create policy recurring_schedules_select on public.recurring_schedules
  for select to authenticated
  using (public.is_management() or default_owner_id = auth.uid());
create policy recurring_schedules_insert on public.recurring_schedules
  for insert to authenticated
  with check (public.is_management() and created_by = auth.uid());
create policy recurring_schedules_update on public.recurring_schedules
  for update to authenticated
  using (public.is_management())
  with check (public.is_management());

create policy assignments_select on public.assignments
  for select to authenticated
  using (public.assignment_involvement(id));
create policy assignments_insert on public.assignments
  for insert to authenticated
  with check (public.is_management() and created_by = auth.uid());
create policy assignments_update on public.assignments
  for update to authenticated
  using (public.assignment_involvement(id))
  with check (public.assignment_involvement(id));

create policy assignment_reviewers_select on public.assignment_reviewers
  for select to authenticated
  using (public.assignment_involvement(assignment_id));
create policy assignment_reviewers_insert on public.assignment_reviewers
  for insert to authenticated
  with check (public.is_management() and assigned_by = auth.uid());
create policy assignment_reviewers_update on public.assignment_reviewers
  for update to authenticated
  using (public.is_management())
  with check (public.is_management());
create policy assignment_reviewers_delete on public.assignment_reviewers
  for delete to authenticated
  using (public.is_management());

create policy work_items_select on public.work_items
  for select to authenticated
  using (public.can_view_work_item(id));
create policy work_items_insert on public.work_items
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.can_create_work_item(kind, assignment_id, context_client_id, assignee_id)
  );
create policy work_items_update on public.work_items
  for update to authenticated
  using (public.can_update_work_item(id))
  with check (public.can_update_work_item(id));

create policy cash_accounts_select on public.cash_accounts
  for select to authenticated
  using (public.is_management());
create policy cash_accounts_insert on public.cash_accounts
  for insert to authenticated
  with check (public.is_management() and created_by = auth.uid());
create policy cash_accounts_update on public.cash_accounts
  for update to authenticated
  using (public.is_management())
  with check (public.is_management());

create policy cash_ledger_select on public.cash_ledger_entries
  for select to authenticated
  using (public.is_management());
create policy cash_ledger_insert on public.cash_ledger_entries
  for insert to authenticated
  with check (public.is_management() and created_by = auth.uid());
create policy cash_ledger_update on public.cash_ledger_entries
  for update to authenticated
  using (public.is_management())
  with check (public.is_management());

create policy invoices_select on public.invoices
  for select to authenticated
  using (public.is_management());
create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (public.is_management() and created_by = auth.uid());
create policy invoices_update on public.invoices
  for update to authenticated
  using (public.is_management())
  with check (public.is_management());

create policy invoice_items_select on public.invoice_items
  for select to authenticated
  using (public.is_management());
create policy invoice_items_insert on public.invoice_items
  for insert to authenticated
  with check (public.is_management());
create policy invoice_items_update on public.invoice_items
  for update to authenticated
  using (public.is_management())
  with check (public.is_management());
create policy invoice_items_delete on public.invoice_items
  for delete to authenticated
  using (public.is_management());

create policy payment_receipts_select on public.payment_receipts
  for select to authenticated
  using (public.is_management());
create policy payment_receipts_insert on public.payment_receipts
  for insert to authenticated
  with check (public.is_management() and created_by = auth.uid());
create policy payment_receipts_update on public.payment_receipts
  for update to authenticated
  using (public.is_management())
  with check (public.is_management());

create policy payment_allocations_select on public.payment_allocations
  for select to authenticated
  using (public.is_management());
create policy payment_allocations_insert on public.payment_allocations
  for insert to authenticated
  with check (public.is_management() and created_by = auth.uid());
create policy payment_allocations_update on public.payment_allocations
  for update to authenticated
  using (public.is_management())
  with check (public.is_management());
create policy payment_allocations_delete on public.payment_allocations
  for delete to authenticated
  using (public.is_management());

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.is_management());

create view public.cash_account_balances
with (security_invoker = true)
as
select
  ca.id as account_id,
  ca.name,
  ca.kind,
  ca.opening_balance
    + coalesce(sum(
      case
        when cle.status = 'posted' and cle.direction = 'receipt' then cle.amount
        when cle.status = 'posted' and cle.direction = 'payment' then -cle.amount
        else 0
      end
    ), 0) as current_balance,
  max(cle.entry_date) filter (where cle.status = 'posted') as last_entry_date
from public.cash_accounts ca
left join public.cash_ledger_entries cle on cle.account_id = ca.id
group by ca.id, ca.name, ca.kind, ca.opening_balance;

comment on view public.cash_account_balances is
  'Security-invoker summary; underlying finance RLS keeps it visible to Founder and Manager only.';

create view public.client_outstanding
with (security_invoker = true)
as
select
  c.id as client_id,
  c.code as client_code,
  c.display_name,
  coalesce(sum(i.total_amount - i.amount_received) filter (
    where i.status in ('issued', 'part_paid')
  ), 0) as outstanding_amount,
  min(i.due_date) filter (
    where i.status in ('issued', 'part_paid')
      and i.total_amount > i.amount_received
  ) as oldest_due_date
from public.clients c
left join public.invoices i on i.client_id = c.id
group by c.id, c.code, c.display_name;

create view public.collections_snapshot
with (security_invoker = true)
as
select
  coalesce(sum(i.total_amount - i.amount_received), 0) as total_outstanding,
  coalesce(sum(i.total_amount - i.amount_received) filter (
    where i.due_date >= current_date
  ), 0) as current_amount,
  coalesce(sum(i.total_amount - i.amount_received) filter (
    where i.due_date < current_date
      and i.due_date >= current_date - 30
  ), 0) as overdue_1_30,
  coalesce(sum(i.total_amount - i.amount_received) filter (
    where i.due_date < current_date - 30
      and i.due_date >= current_date - 60
  ), 0) as overdue_31_60,
  coalesce(sum(i.total_amount - i.amount_received) filter (
    where i.due_date < current_date - 60
      and i.due_date >= current_date - 90
  ), 0) as overdue_61_90,
  coalesce(sum(i.total_amount - i.amount_received) filter (
    where i.due_date < current_date - 90
  ), 0) as overdue_90_plus
from public.invoices i
where i.status in ('issued', 'part_paid');

create view public.billing_collections_monthly
with (security_invoker = true)
as
with movements as (
  select
    date_trunc('month', i.issue_date)::date as month_start,
    i.total_amount as billed_amount,
    0::numeric as collected_amount
  from public.invoices i
  where i.status not in ('draft', 'voided')

  union all

  select
    date_trunc('month', pr.received_on)::date as month_start,
    0::numeric as billed_amount,
    pr.amount as collected_amount
  from public.payment_receipts pr
  where pr.status = 'received'
)
select
  month_start,
  sum(billed_amount) as billed_amount,
  sum(collected_amount) as collected_amount
from movements
group by month_start;

comment on view public.client_outstanding is
  'Per-client open receivables for the Top Client Outstanding dashboard module.';
comment on view public.collections_snapshot is
  'Current and ageing buckets for the Collections Snapshot dashboard module.';
comment on view public.billing_collections_monthly is
  'Monthly billed-versus-collected series for the leadership dashboard.';

revoke all on table
  public.profiles,
  public.user_roles,
  public.staff_reporting_lines,
  public.clients,
  public.service_catalog,
  public.recurring_schedules,
  public.assignments,
  public.assignment_reviewers,
  public.work_items,
  public.cash_accounts,
  public.cash_ledger_entries,
  public.invoices,
  public.invoice_items,
  public.payment_receipts,
  public.payment_allocations,
  public.audit_log,
  public.cash_account_balances,
  public.client_outstanding,
  public.collections_snapshot,
  public.billing_collections_monthly
from anon;

revoke all on table
  public.profiles,
  public.user_roles,
  public.staff_reporting_lines,
  public.clients,
  public.service_catalog,
  public.recurring_schedules,
  public.assignments,
  public.assignment_reviewers,
  public.work_items,
  public.cash_accounts,
  public.cash_ledger_entries,
  public.invoices,
  public.invoice_items,
  public.payment_receipts,
  public.payment_allocations,
  public.audit_log,
  public.cash_account_balances,
  public.client_outstanding,
  public.collections_snapshot,
  public.billing_collections_monthly
from authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_roles to authenticated;
grant select, insert, update, delete on public.staff_reporting_lines to authenticated;
grant select, insert, update on public.clients to authenticated;
grant select, insert, update on public.service_catalog to authenticated;
grant select, insert, update on public.recurring_schedules to authenticated;
grant select, insert, update on public.assignments to authenticated;
grant select, insert, update, delete on public.assignment_reviewers to authenticated;
grant select, insert, update on public.work_items to authenticated;
grant select, insert, update on public.cash_accounts to authenticated;
grant select, insert, update on public.cash_ledger_entries to authenticated;
grant select, insert, update on public.invoices to authenticated;
grant select, insert, update, delete on public.invoice_items to authenticated;
grant select, insert, update on public.payment_receipts to authenticated;
grant select, insert, update, delete on public.payment_allocations to authenticated;
grant select on public.audit_log to authenticated;
grant select on public.cash_account_balances to authenticated;
grant select on public.client_outstanding to authenticated;
grant select on public.collections_snapshot to authenticated;
grant select on public.billing_collections_monthly to authenticated;

revoke all on sequence
  public.client_code_seq,
  public.schedule_code_seq,
  public.assignment_code_seq,
  public.work_item_code_seq,
  public.ledger_entry_code_seq,
  public.invoice_code_seq,
  public.receipt_code_seq
from anon;
grant usage, select on sequence
  public.client_code_seq,
  public.schedule_code_seq,
  public.assignment_code_seq,
  public.work_item_code_seq,
  public.ledger_entry_code_seq,
  public.invoice_code_seq,
  public.receipt_code_seq
to authenticated;

revoke all on function public.role_of(uuid) from public, anon;
revoke all on function public.current_app_role() from public, anon;
revoke all on function public.is_active_employee(uuid) from public, anon;
revoke all on function public.is_founder(uuid) from public, anon;
revoke all on function public.is_management(uuid) from public, anon;
revoke all on function public.role_may_delegate(public.app_role, public.app_role) from public, anon;
revoke all on function public.can_manage_reporting_line(uuid) from public, anon;
revoke all on function public.user_has_assignment_authority(uuid, uuid) from public, anon;
revoke all on function public.user_assignment_involvement(uuid, uuid) from public, anon;
revoke all on function public.assignment_involvement(uuid) from public, anon;
revoke all on function public.user_client_visible(uuid, uuid) from public, anon;
revoke all on function public.client_visible(uuid) from public, anon;
revoke all on function public.user_can_view_work_item(uuid, uuid) from public, anon;
revoke all on function public.can_view_work_item(uuid) from public, anon;
revoke all on function public.can_create_work_item(public.work_item_kind, uuid, uuid, uuid) from public, anon;
revoke all on function public.can_update_work_item(uuid) from public, anon;
revoke all on function public.set_staff_authority(uuid, public.app_role, uuid) from public, anon;
revoke all on function public.set_reporting_line(uuid, uuid) from public, anon;
revoke all on function public.materialize_due_recurring_assignments(date) from public, anon, authenticated;
revoke all on function public.recompute_invoice_totals(uuid) from public, anon, authenticated;
revoke all on function public.recompute_invoice_payment_state(uuid) from public, anon, authenticated;

grant execute on function public.role_of(uuid) to authenticated;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_active_employee(uuid) to authenticated;
grant execute on function public.is_founder(uuid) to authenticated;
grant execute on function public.is_management(uuid) to authenticated;
grant execute on function public.role_may_delegate(public.app_role, public.app_role) to authenticated;
grant execute on function public.can_manage_reporting_line(uuid) to authenticated;
grant execute on function public.user_has_assignment_authority(uuid, uuid) to authenticated;
grant execute on function public.user_assignment_involvement(uuid, uuid) to authenticated;
grant execute on function public.assignment_involvement(uuid) to authenticated;
grant execute on function public.user_client_visible(uuid, uuid) to authenticated;
grant execute on function public.client_visible(uuid) to authenticated;
grant execute on function public.user_can_view_work_item(uuid, uuid) to authenticated;
grant execute on function public.can_view_work_item(uuid) to authenticated;
grant execute on function public.can_create_work_item(public.work_item_kind, uuid, uuid, uuid) to authenticated;
grant execute on function public.can_update_work_item(uuid) to authenticated;
grant execute on function public.set_staff_authority(uuid, public.app_role, uuid) to authenticated;
grant execute on function public.set_reporting_line(uuid, uuid) to authenticated;
grant execute on function public.materialize_due_recurring_assignments(date) to service_role;

commit;
