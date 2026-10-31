create type public.app_role as enum ('founder', 'manager', 'senior_staff', 'staff', 'trainee', 'accounts');

create sequence if not exists public.client_code_seq;
create sequence if not exists public.assignment_code_seq;
create sequence if not exists public.task_code_seq;
create sequence if not exists public.invoice_no_seq;
create sequence if not exists public.receipt_no_seq;
create sequence if not exists public.engagement_code_seq;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  phone text,
  designation text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  unique (user_id, role)
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_departments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  department_id uuid references public.departments(id) on delete cascade not null,
  unique (user_id, department_id)
);

create table public.workflow_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.workflow_stages (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.workflow_templates(id) on delete cascade not null,
  position int not null,
  title text not null,
  description text
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  service_group text not null,
  department_id uuid references public.departments(id),
  is_recurring boolean not null default false,
  recurrence_frequency text,
  default_fee numeric(12,2) not null default 0,
  billing_frequency text default 'Monthly',
  billing_milestone text,
  default_workflow_template_id uuid references public.workflow_templates(id),
  required_documents text,
  timeline_days int,
  default_staff_role text,
  requires_review boolean not null default true,
  reminder_schedule text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  client_code text not null unique,
  name text not null,
  trade_name text,
  client_type text not null default 'Individual',
  industry text,
  nature_of_business text,
  address_line text, city text, state text, pin_code text,
  contact_name text, contact_designation text,
  mobile text, whatsapp text, email text,
  alt_contact_name text, alt_contact_phone text, alt_contact_email text,
  pan text, gstin text, other_registrations text,
  onboarded_on date,
  source text, category text,
  relationship_manager uuid references public.profiles(id),
  primary_department uuid references public.departments(id),
  primary_staff uuid references public.profiles(id),
  status text not null default 'Active',
  recurring_fee numeric(12,2) not null default 0,
  billing_frequency text default 'Monthly',
  fee_terms text,
  payment_due_days int not null default 15,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade not null,
  name text not null, designation text,
  phone text, whatsapp text, email text,
  is_primary boolean not null default false,
  is_demo boolean not null default false
);

create table public.client_branches (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade not null,
  branch_name text not null,
  address text, state text, gstin text,
  is_primary boolean not null default false,
  is_demo boolean not null default false
);

create table public.engagements (
  id uuid primary key default gen_random_uuid(),
  engagement_code text not null unique,
  client_id uuid references public.clients(id) on delete cascade not null,
  service_id uuid references public.services(id) on delete cascade not null,
  agreed_fee numeric(12,2) not null default 0,
  billing_frequency text default 'Monthly',
  fee_terms text,
  status text not null default 'Active',
  start_date date,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.work_assignments (
  id uuid primary key default gen_random_uuid(),
  assignment_code text not null unique,
  client_id uuid references public.clients(id) on delete cascade not null,
  engagement_id uuid references public.engagements(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  title text not null,
  work_period text,
  department_id uuid references public.departments(id),
  priority text not null default 'Medium',
  assigned_staff uuid references public.profiles(id),
  reviewer uuid references public.profiles(id),
  collaborators uuid[] not null default '{}',
  assigned_on date,
  internal_due date,
  statutory_due date,
  status text not null default 'New',
  workflow_stage int not null default 1,
  progress int not null default 0,
  agreed_fee numeric(12,2) not null default 0,
  est_completion date,
  actual_completion date,
  blocker text,
  follow_up_on date,
  completion_notes text,
  is_demo boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assignment_stages (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references public.work_assignments(id) on delete cascade not null,
  position int not null,
  title text not null,
  completed boolean not null default false,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id)
);

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references public.work_assignments(id) on delete cascade not null,
  title text not null,
  done boolean not null default false,
  done_by uuid references public.profiles(id),
  done_at timestamptz
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  task_code text not null unique,
  title text not null,
  description text,
  assignment_id uuid references public.work_assignments(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  assignee uuid references public.profiles(id),
  reviewer uuid references public.profiles(id),
  priority text not null default 'Medium',
  assigned_date date default current_date,
  due_date date,
  status text not null default 'Open',
  progress int not null default 0,
  blocker text,
  completed_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade not null,
  author_id uuid references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

create table public.assignment_comments (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references public.work_assignments(id) on delete cascade not null,
  author_id uuid references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

create table public.document_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade not null,
  assignment_id uuid references public.work_assignments(id) on delete cascade,
  name text not null,
  category text default 'Other',
  period text,
  requested_on date,
  due_date date,
  received_on date,
  status text not null default 'Not Requested',
  responsible uuid references public.profiles(id),
  file_path text,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.comm_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  message_type text not null,
  language text not null default 'en',
  subject text,
  body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.comm_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  assignment_id uuid references public.work_assignments(id) on delete set null,
  invoice_id uuid,
  template_id uuid references public.comm_templates(id) on delete set null,
  message_type text not null,
  content text not null,
  channel text not null default 'WhatsApp',
  status text not null default 'Draft',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  next_follow_up date
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  client_id uuid references public.clients(id) on delete cascade not null,
  engagement_id uuid references public.engagements(id) on delete set null,
  assignment_id uuid references public.work_assignments(id) on delete set null,
  description text,
  invoice_date date not null default current_date,
  due_date date,
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  tax_rate numeric(5,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_received numeric(12,2) not null default 0,
  status text not null default 'Draft',
  notes text,
  prepared_by uuid references public.profiles(id),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.invoices(id) on delete cascade not null,
  description text not null,
  quantity numeric(10,2) not null default 1,
  rate numeric(12,2) not null default 0,
  amount numeric(12,2) not null default 0,
  is_demo boolean not null default false
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  client_id uuid references public.clients(id) on delete cascade not null,
  receipt_date date not null default current_date,
  amount numeric(12,2) not null default 0,
  method text not null default 'Bank Transfer',
  reference_no text,
  bank_account text,
  recorded_by uuid references public.profiles(id),
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.payments(id) on delete cascade not null,
  invoice_id uuid references public.invoices(id) on delete cascade not null,
  amount numeric(12,2) not null default 0,
  is_demo boolean not null default false
);

create table public.collection_followups (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade not null,
  invoice_id uuid references public.invoices(id) on delete cascade,
  owner uuid references public.profiles(id),
  last_follow_up date,
  response text,
  promised_date date,
  next_follow_up date,
  notes text,
  is_demo boolean not null default false
);

create table public.client_tax_money (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade not null,
  purpose text not null default 'GST',
  assignment_id uuid references public.work_assignments(id) on delete set null,
  tax_period text,
  amount_received numeric(12,2) not null default 0,
  received_on date,
  amount_paid numeric(12,2) not null default 0,
  paid_on date,
  payment_reference text,
  responsible uuid references public.profiles(id),
  status text not null default 'Received',
  notes text,
  is_demo boolean not null default false
);

create table public.audit_engagements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade not null,
  audit_period text not null,
  scope text,
  team text,
  visit_dates text,
  areas_reviewed text,
  status text not null default 'Open',
  report_version text,
  follow_up_date date,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.audit_findings (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid references public.audit_engagements(id) on delete cascade not null,
  title text not null,
  description text,
  reference text,
  risk_category text not null default 'Medium',
  recommendation text,
  management_response text,
  responsible_person text,
  target_date date,
  status text not null default 'Open',
  closed_at timestamptz,
  is_demo boolean not null default false
);

create table public.advisory_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade not null,
  period text not null,
  source text default 'Manual entry',
  sales numeric(14,2),
  gross_profit numeric(14,2),
  gross_profit_pct numeric(6,2),
  operating_expenses numeric(14,2),
  net_profit numeric(14,2),
  receivables numeric(14,2),
  payables numeric(14,2),
  inventory numeric(14,2),
  cash_bank numeric(14,2),
  cash_flow numeric(14,2),
  budget_vs_actual text,
  key_ratios text,
  business_challenges text,
  recommendations text,
  meeting_notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.advisory_actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade not null,
  report_id uuid references public.advisory_reports(id) on delete set null,
  title text not null,
  owner text,
  due_date date,
  status text not null default 'Open',
  notes text,
  is_demo boolean not null default false
);

create table public.org_settings (
  id int primary key default 1 check (id = 1),
  firm_name text not null default 'SN & Associates',
  address text,
  phone text,
  email text,
  logo_url text,
  bank_name text,
  bank_account text,
  ifsc text,
  upi_id text,
  invoice_prefix text not null default 'INV-',
  tax_label text default 'GST',
  default_tax_rate numeric(5,2) not null default 0,
  whatsapp_provider text default 'Not connected',
  reminder_rules jsonb not null default '[7,3,1]',
  updated_at timestamptz not null default now()
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

-- ---------- Helper functions (after tables) ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email
  );
  if not exists (select 1 from public.user_roles where role = 'founder') then
    insert into public.user_roles (user_id, role) values (new.id, 'founder');
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.has_role(_role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = _role
  )
$$;

create or replace function public.has_any_role(_roles public.app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = any (_roles)
  )
$$;

create or replace function public.is_management()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['founder','manager']::public.app_role[])
$$;

create or replace function public.is_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['founder','accounts']::public.app_role[])
$$;

create or replace function public.is_finance_or_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['founder','accounts','manager']::public.app_role[])
$$;

create or replace function public.is_founder()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('founder')
$$;

create or replace function public.my_department_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select ud.department_id from public.user_departments ud where ud.user_id = auth.uid()
$$;

create or replace function public.client_visible(_client uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.is_finance_or_manager()
    or exists (
      select 1 from public.clients c
      where c.id = _client
        and (c.primary_staff = auth.uid() or c.relationship_manager = auth.uid())
    )
    or exists (
      select 1 from public.clients c
      join public.user_departments ud on ud.user_id = auth.uid()
      where c.id = _client and ud.department_id = c.primary_department
    )
    or exists (
      select 1 from public.work_assignments wa
      where wa.client_id = _client
        and (wa.assigned_staff = auth.uid() or wa.reviewer = auth.uid())
    )
$$;

create or replace function public.assignment_involvement(_assignment uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.work_assignments wa
    where wa.id = _assignment
      and (
        wa.assigned_staff = auth.uid()
        or wa.reviewer = auth.uid()
        or auth.uid() = any (wa.collaborators)
        or public.is_management()
      )
  )
$$;

-- ---------- Auto-numbering triggers ----------
create or replace function public.next_code(_seq regclass, _prefix text, _pad int)
returns text language sql volatile as $$
  select _prefix || lpad(nextval(_seq)::text, _pad, '0')
$$;

create or replace function public.set_client_code()
returns trigger language plpgsql as $$
begin
  if new.client_code is null or new.client_code = '' then
    new.client_code := public.next_code('public.client_code_seq', 'CL-', 4);
  end if;
  return new;
end $$;
create trigger trg_client_code before insert on public.clients
  for each row execute function public.set_client_code();

create or replace function public.set_engagement_code()
returns trigger language plpgsql as $$
begin
  if new.engagement_code is null or new.engagement_code = '' then
    new.engagement_code := public.next_code('public.engagement_code_seq', 'EN-', 4);
  end if;
  return new;
end $$;
create trigger trg_engagement_code before insert on public.engagements
  for each row execute function public.set_engagement_code();

create or replace function public.set_assignment_code()
returns trigger language plpgsql as $$
begin
  if new.assignment_code is null or new.assignment_code = '' then
    new.assignment_code := public.next_code('public.assignment_code_seq', 'WA-', 4);
  end if;
  return new;
end $$;
create trigger trg_assignment_code before insert on public.work_assignments
  for each row execute function public.set_assignment_code();

create or replace function public.set_task_code()
returns trigger language plpgsql as $$
begin
  if new.task_code is null or new.task_code = '' then
    new.task_code := public.next_code('public.task_code_seq', 'T-', 4);
  end if;
  return new;
end $$;
create trigger trg_task_code before insert on public.tasks
  for each row execute function public.set_task_code();

create or replace function public.set_invoice_number()
returns trigger language plpgsql as $$
begin
  if new.invoice_number is null or new.invoice_number = '' then
    select coalesce(invoice_prefix, 'INV-') into new.invoice_number
      from public.org_settings where id = 1;
    new.invoice_number := new.invoice_number || lpad(nextval('public.invoice_no_seq')::text, 4, '0');
  end if;
  return new;
end $$;
create trigger trg_invoice_number before insert on public.invoices
  for each row execute function public.set_invoice_number();

create or replace function public.set_receipt_number()
returns trigger language plpgsql as $$
begin
  if new.receipt_number is null or new.receipt_number = '' then
    new.receipt_number := public.next_code('public.receipt_no_seq', 'RC-', 4);
  end if;
  return new;
end $$;
create trigger trg_receipt_number before insert on public.payments
  for each row execute function public.set_receipt_number();

create or replace function public.recalc_invoice_on_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare _inv uuid; _paid numeric;
begin
  _inv := coalesce(new.invoice_id, old.invoice_id);
  select coalesce(sum(amount),0) into _paid from public.payment_allocations where invoice_id = _inv;
  update public.invoices
    set amount_received = _paid,
        status = case
          when status in ('Draft','Cancelled') then status
          when _paid >= total then 'Paid'
          when _paid > 0 then 'Partially Paid'
          else 'Unpaid'
        end
    where id = _inv;
  return null;
end $$;
create trigger trg_recalc_invoice after insert or update or delete on public.payment_allocations
  for each row execute function public.recalc_invoice_on_payment();

grant usage, select on all sequences in schema public to authenticated;
