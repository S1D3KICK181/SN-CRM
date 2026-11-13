-- Migration: 20261113200000_doc01_client_documents.sql
-- Description: DOC-01a Client document storage: a private Storage bucket, the document record,
--              and Postgres-decided access for upload and download

begin;

-- 1. Private bucket: 25 MB, document types only
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-documents',
  'client-documents',
  false,
  26214400,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

-- 2. Document records
create table public.client_documents (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 2 and 160),
  category text not null check (
    category in ('kyc', 'financial_statements', 'returns_filed', 'acknowledgements', 'agreements', 'correspondence', 'other')
  ),
  financial_year_start smallint check (financial_year_start is null or financial_year_start between 2000 and 2100),
  file_name text not null check (char_length(file_name) between 1 and 200 and file_name !~ '[/\\]'),
  mime_type text not null check (
    mime_type in (
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  ),
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  storage_path text not null unique,
  status text not null default 'pending' check (status in ('pending', 'available', 'removed')),
  removed_reason text,
  removed_by uuid references public.profiles(user_id) on delete restrict,
  removed_at timestamptz,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_demo boolean not null default false,
  constraint client_documents_removal_facts check (
    (status = 'removed' and removed_reason is not null and removed_by is not null and removed_at is not null)
    or (status <> 'removed' and removed_reason is null and removed_by is null and removed_at is null)
  ),
  constraint client_documents_removed_reason_length check (
    removed_reason is null or char_length(btrim(removed_reason)) between 3 and 500
  )
);

create index client_documents_client_status_idx on public.client_documents (client_id, status);

-- 3. Write guard: is_demo is inherited from the client, identity never changes, and the
--    status only moves pending -> available (the uploader confirming) or available -> removed
--    (Founder or Manager, with a reason). Removed is terminal.
create or replace function public.guard_client_document_write()
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
    if new.status <> 'pending' then
      raise exception 'A document starts as a pending upload.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.client_id is distinct from old.client_id
     or new.storage_path is distinct from old.storage_path
     or new.file_name is distinct from old.file_name
     or new.created_by is distinct from old.created_by then
    raise exception 'The client, file and uploader of a document never change.' using errcode = '23514';
  end if;

  if old.status = 'removed' then
    raise exception 'A removed document cannot be changed.' using errcode = '23514';
  end if;

  if new.status = old.status then
    if new.removed_reason is distinct from old.removed_reason
       or new.removed_by is distinct from old.removed_by
       or new.removed_at is distinct from old.removed_at
       or new.size_bytes is distinct from old.size_bytes then
      raise exception 'Removal facts and file size change only with the status.' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status = 'pending' and new.status = 'available' then
    if v_actor is not null and v_actor <> old.created_by then
      raise exception 'Only the uploader may confirm an upload.' using errcode = '42501';
    end if;
    if new.removed_reason is not null or new.removed_by is not null or new.removed_at is not null then
      raise exception 'Removal facts change only when a document is removed.' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status = 'available' and new.status = 'removed' then
    if v_actor is not null and not public.is_management(v_actor) then
      raise exception 'Only the Founder or Manager may remove a document.' using errcode = '42501';
    end if;
    if nullif(btrim(new.removed_reason), '') is null then
      raise exception 'A reason is required to remove a document.' using errcode = '23514';
    end if;
    if new.size_bytes is distinct from old.size_bytes then
      raise exception 'File size changes only when an upload is confirmed.' using errcode = '23514';
    end if;
    new.removed_by := coalesce(v_actor, new.removed_by);
    new.removed_at := now();
    return new;
  end if;

  raise exception 'This document status change is not allowed.' using errcode = '23514';
end;
$$;

create trigger guard_client_document_write
  before insert or update on public.client_documents
  for each row execute function public.guard_client_document_write();
create trigger prevent_demo_flag_tampering before update on public.client_documents
  for each row execute function public.prevent_demo_flag_tampering();
create trigger set_client_documents_updated_at before update on public.client_documents
  for each row execute function public.set_updated_at();
create trigger audit_client_documents after insert or update or delete on public.client_documents
  for each row execute function public.audit_row_change();

-- 4. Table access: whoever looks after the client; nobody deletes
alter table public.client_documents enable row level security;

create policy client_documents_select on public.client_documents
  for select to authenticated
  using (public.looks_after_client(client_id));
create policy client_documents_insert on public.client_documents
  for insert to authenticated
  with check (public.looks_after_client(client_id) and created_by = auth.uid() and status = 'pending');
create policy client_documents_update on public.client_documents
  for update to authenticated
  using (public.looks_after_client(client_id))
  with check (public.looks_after_client(client_id));

revoke all on table public.client_documents from public, anon;
grant select, insert, update on public.client_documents to authenticated;

-- 5. Storage checks. The existence tests run as the function owner, so the object policies
--    do not depend on the caller's rights on client_documents.
create or replace function public.document_upload_allowed(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.client_documents d
    where d.storage_path = p_path
      and d.status = 'pending'
      and d.created_by = auth.uid()
      and public.looks_after_client(d.client_id)
  );
$$;

create or replace function public.document_download_allowed(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.client_documents d
    where d.storage_path = p_path
      and d.status = 'available'
      and public.looks_after_client(d.client_id)
  );
$$;

-- The size of the stored file behind a document, or null when nothing is stored yet
create or replace function public.document_object_size(p_document_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (o.metadata->>'size')::bigint
  from public.client_documents d
  join storage.objects o
    on o.bucket_id = 'client-documents' and o.name = d.storage_path
  where d.id = p_document_id
    and public.looks_after_client(d.client_id);
$$;

revoke all on function public.document_upload_allowed(text) from public, anon;
revoke all on function public.document_download_allowed(text) from public, anon;
revoke all on function public.document_object_size(uuid) from public, anon;
grant execute on function public.document_upload_allowed(text) to authenticated;
grant execute on function public.document_download_allowed(text) to authenticated;
grant execute on function public.document_object_size(uuid) to authenticated;

-- No update or delete policies: a stored file can be neither overwritten nor deleted from the browser.
create policy client_documents_objects_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'client-documents' and public.document_upload_allowed(name));
create policy client_documents_objects_select on storage.objects
  for select to authenticated
  using (bucket_id = 'client-documents' and public.document_download_allowed(name));

-- 6. Demo removal: remove_demo_data() also clears demo document records before their clients
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
