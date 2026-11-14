-- Migration: 20261113230000_msg01_demo_removal_order.sql
-- Description: remove_demo_data() deleted demo bills before demo messages that point to them, so
--   removing demo data failed once a demo message was linked to a demo bill. Messages now go first.
--   The function is otherwise identical to the MSG-01 version.

begin;

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

  -- 4.0 Client messages first: a message can point to a demo bill, assignment or contact
  delete from public.client_messages where is_demo = true;
  get diagnostics v_client_messages_count = row_count;

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
