-- Migration: 20261113220000_msg01_client_messages.sql
-- Description: MSG-01 Client message log: every WhatsApp message opened from the CRM is recorded
--              on the client. Append-only; the channel and status columns leave room for
--              automatic sending later.

begin;

-- 1. Message records
create table public.client_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  contact_id uuid references public.client_contacts(id) on delete set null,
  recipient_name text not null check (char_length(btrim(recipient_name)) between 1 and 120),
  recipient_number text not null check (recipient_number ~ '^[0-9]{10,15}$'),
  channel text not null check (channel in ('whatsapp')),
  purpose text not null check (purpose in ('document_request', 'deadline_reminder', 'payment_reminder', 'general')),
  assignment_id uuid references public.assignments(id) on delete restrict,
  invoice_id uuid references public.invoices(id) on delete restrict,
  body text not null check (char_length(btrim(body)) >= 1 and char_length(body) <= 2000),
  status text not null check (status in ('opened')),
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  is_demo boolean not null default false
);

create index client_messages_client_created_idx on public.client_messages (client_id, created_at desc);

-- 2. Write guard: is_demo is inherited from the client, the contact, assignment and invoice must
--    belong to the same client, and nothing changes after insert. The one exception is the contact
--    link going to null when the contact itself is deleted (on delete set null).
create or replace function public.guard_client_message_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_client_is_demo boolean;
begin
  if tg_op = 'INSERT' then
    select c.is_demo into v_client_is_demo from public.clients c where c.id = new.client_id;
    new.is_demo := coalesce(v_client_is_demo, false);
    if v_actor is not null then
      new.created_by := v_actor;
    end if;
    if new.contact_id is not null and not exists (
      select 1 from public.client_contacts cc where cc.id = new.contact_id and cc.client_id = new.client_id
    ) then
      raise exception 'The contact does not belong to this client.' using errcode = '23514';
    end if;
    if new.assignment_id is not null and not exists (
      select 1 from public.assignments a where a.id = new.assignment_id and a.client_id = new.client_id
    ) then
      raise exception 'The linked work does not belong to this client.' using errcode = '23514';
    end if;
    if new.invoice_id is not null and not exists (
      select 1 from public.invoices i where i.id = new.invoice_id and i.client_id = new.client_id
    ) then
      raise exception 'The linked work does not belong to this client.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.contact_id is null and old.contact_id is not null then
    -- the contact was deleted: only the link may go, and only to null
    if new.id is distinct from old.id
       or new.client_id is distinct from old.client_id
       or new.recipient_name is distinct from old.recipient_name
       or new.recipient_number is distinct from old.recipient_number
       or new.channel is distinct from old.channel
       or new.purpose is distinct from old.purpose
       or new.assignment_id is distinct from old.assignment_id
       or new.invoice_id is distinct from old.invoice_id
       or new.body is distinct from old.body
       or new.status is distinct from old.status
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.is_demo is distinct from old.is_demo then
      raise exception 'A recorded message cannot be changed.' using errcode = '23514';
    end if;
    return new;
  end if;

  raise exception 'A recorded message cannot be changed.' using errcode = '23514';
end;
$$;

create trigger guard_client_message_write
  before insert or update on public.client_messages
  for each row execute function public.guard_client_message_write();
create trigger prevent_demo_flag_tampering before update on public.client_messages
  for each row execute function public.prevent_demo_flag_tampering();
create trigger audit_client_messages after insert or update or delete on public.client_messages
  for each row execute function public.audit_row_change();

-- 3. Table access: whoever looks after the client; no update and no delete
alter table public.client_messages enable row level security;

create policy client_messages_select on public.client_messages
  for select to authenticated
  using (public.looks_after_client(client_id));
create policy client_messages_insert on public.client_messages
  for insert to authenticated
  with check (public.looks_after_client(client_id) and created_by = auth.uid());

revoke all on table public.client_messages from public, anon, authenticated;
grant select, insert on public.client_messages to authenticated;

-- 4. Demo removal: remove_demo_data() also clears demo message records before their clients
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
  v_operation_receipts_count bigint := 0;
  v_engagement_versions_count bigint := 0;
  v_engagements_count bigint := 0;
  v_services_count bigint := 0;
  v_client_documents_count bigint := 0;
  v_client_messages_count bigint := 0;
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
  where p.email like '%@sn-demo.local'
    and p.user_id <> v_actor;

  -- 3. Set transaction-local bypass GUCs
  perform set_config('app.demo_cleanup', 'on', true);
  perform set_config('app.demo_cleanup_actor', v_actor::text, true);

  -- 4. Execute dependent deletes in strict reverse-dependency order

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

  -- 4.10a Operation receipts
  delete from public.operation_receipts where is_demo = true;
  get diagnostics v_operation_receipts_count = row_count;

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

  -- 4.11a Client documents (the stored files are kept; only the records go)
  delete from public.client_documents where is_demo = true;
  get diagnostics v_client_documents_count = row_count;

  -- 4.11b Client messages
  delete from public.client_messages where is_demo = true;
  get diagnostics v_client_messages_count = row_count;

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
    'operation_receipts', v_operation_receipts_count,
    'engagement_versions', v_engagement_versions_count,
    'engagements', v_engagements_count,
    'service_catalog', v_services_count,
    'client_documents', v_client_documents_count,
    'client_messages', v_client_messages_count,
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
