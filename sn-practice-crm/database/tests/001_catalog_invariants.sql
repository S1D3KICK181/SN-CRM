-- Run after 0001_practice_core.sql against a Supabase/PostgreSQL database.
-- The test inspects the catalog and pure authority functions; it creates no
-- auth users or business data.

begin;

do $verify$
declare
  v_roles text[];
  v_rls_count integer;
  v_policy_count integer;
  v_audit_trigger_count integer;
  v_security_invoker_view_count integer;
  v_default_expression text;
begin
  select array_agg(e.enumlabel::text order by e.enumsortorder)
    into v_roles
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
    and t.typname = 'app_role';

  if v_roles is distinct from array[
    'founder', 'manager', 'senior_staff', 'staff', 'trainee'
  ]::text[] then
    raise exception 'app_role labels are wrong: %', v_roles;
  end if;

  if not public.role_may_delegate('founder', 'manager')
     or public.role_may_delegate('founder', 'founder')
     or not public.role_may_delegate('manager', 'senior_staff')
     or public.role_may_delegate('manager', 'manager')
     or not public.role_may_delegate('senior_staff', 'staff')
     or not public.role_may_delegate('senior_staff', 'trainee')
     or public.role_may_delegate('senior_staff', 'senior_staff')
     or not public.role_may_delegate('staff', 'trainee')
     or public.role_may_delegate('staff', 'staff')
     or public.role_may_delegate('trainee', 'trainee') then
    raise exception 'Delegation matrix does not match the authority model.';
  end if;

  if not public.assignment_transition_allowed(
       'assigned', 'ready_for_review', 'staff', true, false
     )
     or public.assignment_transition_allowed(
       'ready_for_review', 'approved', 'staff', true, false
     )
     or not public.assignment_transition_allowed(
       'ready_for_review', 'changes_requested', 'senior_staff', false, true
     )
     or public.assignment_transition_allowed(
       'ready_for_review', 'approved', 'senior_staff', false, true
     )
     or not public.assignment_transition_allowed(
       'ready_for_review', 'approved', 'manager', false, false
     ) then
    raise exception 'Assignment lifecycle authority does not match the domain contract.';
  end if;

  if not public.work_item_transition_allowed(
       'todo', 'completed', 'personal', true, false
     )
     or public.work_item_transition_allowed(
       'todo', 'completed', 'delegated', true, false
     )
     or not public.work_item_transition_allowed(
       'todo', 'ready_for_review', 'delegated', true, false
     )
     or not public.work_item_transition_allowed(
       'ready_for_review', 'completed', 'delegated', false, true
     ) then
    raise exception 'Work Item lifecycle authority does not match the domain contract.';
  end if;

  select count(*)
    into v_rls_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = any(array[
      'profiles',
      'user_roles',
      'staff_reporting_lines',
      'clients',
      'service_catalog',
      'recurring_schedules',
      'assignments',
      'assignment_reviewers',
      'work_items',
      'cash_accounts',
      'cash_ledger_entries',
      'invoices',
      'invoice_items',
      'payment_receipts',
      'payment_allocations',
      'audit_log'
    ])
    and c.relrowsecurity;

  if v_rls_count <> 16 then
    raise exception 'Expected RLS on 16 tables; found %.', v_rls_count;
  end if;

  select count(*)
    into v_policy_count
  from pg_policies
  where schemaname = 'public'
    and policyname = any(array[
      'profiles_select',
      'user_roles_select',
      'reporting_lines_select',
      'clients_select',
      'service_catalog_select',
      'recurring_schedules_select',
      'assignments_select',
      'assignment_reviewers_select',
      'work_items_select',
      'cash_accounts_select',
      'cash_ledger_select',
      'invoices_select',
      'invoice_items_select',
      'payment_receipts_select',
      'payment_allocations_select',
      'audit_log_select'
    ]);

  if v_policy_count <> 16 then
    raise exception 'One or more required SELECT policies are missing.';
  end if;

  if exists (
    with required_policy (table_name, policy_name) as (
      values
        ('profiles', 'profiles_select'),
        ('user_roles', 'user_roles_select'),
        ('staff_reporting_lines', 'reporting_lines_select'),
        ('clients', 'clients_select'),
        ('service_catalog', 'service_catalog_select'),
        ('recurring_schedules', 'recurring_schedules_select'),
        ('assignments', 'assignments_select'),
        ('assignment_reviewers', 'assignment_reviewers_select'),
        ('work_items', 'work_items_select'),
        ('cash_accounts', 'cash_accounts_select'),
        ('cash_ledger_entries', 'cash_ledger_select'),
        ('invoices', 'invoices_select'),
        ('invoice_items', 'invoice_items_select'),
        ('payment_receipts', 'payment_receipts_select'),
        ('payment_allocations', 'payment_allocations_select'),
        ('audit_log', 'audit_log_select')
    )
    select 1
    from required_policy required
    left join pg_policies policy
      on policy.schemaname = 'public'
     and policy.tablename = required.table_name
     and policy.policyname = required.policy_name
     and policy.cmd = 'SELECT'
    where policy.policyname is null
  ) then
    raise exception 'A required SELECT policy is attached to the wrong table or command.';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'assignments',
        'work_items',
        'cash_ledger_entries',
        'invoices',
        'payment_receipts',
        'audit_log'
      )
      and cmd = 'DELETE'
  ) then
    raise exception 'Core work, ledger, and audit records must not expose DELETE policies.';
  end if;

  if has_table_privilege('authenticated', 'public.assignments', 'DELETE')
     or has_table_privilege('authenticated', 'public.work_items', 'DELETE')
     or has_table_privilege('authenticated', 'public.cash_ledger_entries', 'DELETE')
     or has_table_privilege('authenticated', 'public.invoices', 'DELETE')
     or has_table_privilege('authenticated', 'public.payment_receipts', 'DELETE')
     or has_table_privilege('authenticated', 'public.audit_log', 'INSERT')
     or has_table_privilege('authenticated', 'public.audit_log', 'UPDATE')
     or has_table_privilege('authenticated', 'public.audit_log', 'DELETE') then
    raise exception 'Authenticated table grants violate immutability boundaries.';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.materialize_due_recurring_assignments(date)',
    'EXECUTE'
  ) then
    raise exception 'Recurring materialization must not be executable by authenticated clients.';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.materialize_due_recurring_assignments(date)',
    'EXECUTE'
  ) then
    raise exception 'service_role must be able to materialize recurring work.';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.recompute_invoice_totals(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.recompute_invoice_payment_state(uuid)',
       'EXECUTE'
     ) then
    raise exception 'Authenticated clients must not execute derived-finance recomputations.';
  end if;

  select count(*)
    into v_audit_trigger_count
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and not tg.tgisinternal
    and tg.tgname like 'audit_%';

  if v_audit_trigger_count <> 15 then
    raise exception 'Expected 15 business-table audit triggers; found %.', v_audit_trigger_count;
  end if;

  select count(*)
    into v_security_invoker_view_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = any(array[
      'cash_account_balances',
      'client_outstanding',
      'collections_snapshot',
      'billing_collections_monthly'
    ])
    and c.relkind = 'v'
    and coalesce(c.reloptions, array[]::text[]) @> array['security_invoker=true'];

  if v_security_invoker_view_count <> 4 then
    raise exception 'All four dashboard views must use security_invoker=true.';
  end if;

  if not exists (
       select 1
       from pg_trigger tg
       join pg_class c on c.oid = tg.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = 'user_roles'
         and tg.tgname = 'user_role_reporting_integrity'
         and tg.tgdeferrable
         and tg.tginitdeferred
     )
     or not exists (
       select 1
       from pg_trigger tg
       join pg_class c on c.oid = tg.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = 'staff_reporting_lines'
         and tg.tgname = 'reporting_line_integrity'
         and tg.tgdeferrable
         and tg.tginitdeferred
     ) then
    raise exception 'Role/reporting integrity triggers must be deferred constraint triggers.';
  end if;

  select pg_get_expr(ad.adbin, ad.adrelid)
    into v_default_expression
  from pg_attrdef ad
  join pg_class c on c.oid = ad.adrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum = ad.adnum
  where n.nspname = 'public'
    and c.relname = 'assignments'
    and a.attname = 'code';

  if v_default_expression is null
     or v_default_expression not like '%assignment_code_seq%' then
    raise exception 'Assignment codes are not database-generated from their sequence.';
  end if;
end;
$verify$;

rollback;
