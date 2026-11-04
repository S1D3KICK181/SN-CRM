-- Run against seeded database.
-- Validates exact row counts, 100% demo tagging, cash balances, collections snapshot,
-- invoice derived statuses, and next sequence numbers.

begin;

do $verify$
declare
  v_count integer;
  v_hdfc_balance numeric(12, 2);
  v_petty_balance numeric(12, 2);
  v_tot_out numeric(12, 2);
  v_cur_amt numeric(12, 2);
  v_od_1_30 numeric(12, 2);
  v_od_31_60 numeric(12, 2);
  v_od_61_90 numeric(12, 2);
  v_od_90_plus numeric(12, 2);
  v_next_val bigint;
begin
  -- 1. Base counts
  select count(*) into v_count from auth.users where email like '%@sn-demo.local';
  if v_count <> 5 then raise exception 'Expected 5 demo users, found %', v_count; end if;

  select count(*) into v_count from public.profiles where is_demo = true;
  if v_count <> 5 then raise exception 'Expected 5 demo profiles, found %', v_count; end if;

  select count(*) into v_count from public.user_roles where is_demo = true;
  if v_count <> 5 then raise exception 'Expected 5 demo user_roles, found %', v_count; end if;

  select count(*) into v_count from public.staff_reporting_lines where is_demo = true;
  if v_count <> 4 then raise exception 'Expected 4 demo reporting lines, found %', v_count; end if;

  select count(*) into v_count from public.clients where is_demo = true;
  if v_count <> 6 then raise exception 'Expected 6 demo clients, found %', v_count; end if;

  select count(*) into v_count from public.service_catalog where is_demo = true;
  if v_count <> 6 then raise exception 'Expected 6 demo services, found %', v_count; end if;

  select count(*) into v_count from public.recurring_schedules where is_demo = true;
  if v_count <> 9 then raise exception 'Expected 9 demo schedules, found %', v_count; end if;

  select count(*) into v_count from public.assignments where is_demo = true;
  if v_count <> 6 then raise exception 'Expected 6 demo assignments, found %', v_count; end if;

  select count(*) into v_count from public.assignment_reviewers where is_demo = true;
  if v_count <> 6 then raise exception 'Expected 6 demo reviewers, found %', v_count; end if;

  select count(*) into v_count from public.work_items where is_demo = true;
  if v_count <> 6 then raise exception 'Expected 6 demo work items, found %', v_count; end if;

  select count(*) into v_count from public.cash_accounts where is_demo = true;
  if v_count <> 2 then raise exception 'Expected 2 demo cash accounts, found %', v_count; end if;

  select count(*) into v_count from public.cash_ledger_entries where is_demo = true;
  if v_count <> 8 then raise exception 'Expected 8 demo ledger entries, found %', v_count; end if;

  select count(*) into v_count from public.invoices where is_demo = true;
  if v_count <> 9 then raise exception 'Expected 9 demo invoices, found %', v_count; end if;

  select count(*) into v_count from public.invoice_items where is_demo = true;
  if v_count <> 9 then raise exception 'Expected 9 demo invoice items, found %', v_count; end if;

  select count(*) into v_count from public.payment_receipts where is_demo = true;
  if v_count <> 5 then raise exception 'Expected 5 demo receipts, found %', v_count; end if;

  select count(*) into v_count from public.payment_allocations where is_demo = true;
  if v_count <> 5 then raise exception 'Expected 5 demo allocations, found %', v_count; end if;

  -- 2. 100% demo tagging (zero non-demo rows in seeded tables)
  select count(*) into v_count from public.profiles where is_demo = false;
  if v_count <> 0 then raise exception 'Found non-demo profiles: %', v_count; end if;

  select count(*) into v_count from public.user_roles where is_demo = false;
  if v_count <> 0 then raise exception 'Found non-demo user_roles: %', v_count; end if;

  select count(*) into v_count from public.staff_reporting_lines where is_demo = false;
  if v_count <> 0 then raise exception 'Found non-demo staff_reporting_lines: %', v_count; end if;

  select count(*) into v_count from public.clients where is_demo = false;
  if v_count <> 0 then raise exception 'Found non-demo clients: %', v_count; end if;

  select count(*) into v_count from public.service_catalog where is_demo = false;
  if v_count <> 0 then raise exception 'Found non-demo service_catalog: %', v_count; end if;

  select count(*) into v_count from public.recurring_schedules where is_demo = false;
  if v_count <> 0 then raise exception 'Found non-demo recurring_schedules: %', v_count; end if;

  select count(*) into v_count from public.assignments where is_demo = false;
  if v_count <> 0 then raise exception 'Found non-demo assignments: %', v_count; end if;

  select count(*) into v_count from public.assignment_reviewers where is_demo = false;
  if v_count <> 0 then raise exception 'Found non-demo assignment_reviewers: %', v_count; end if;

  select count(*) into v_count from public.work_items where is_demo = false;
  if v_count <> 0 then raise exception 'Found non-demo work_items: %', v_count; end if;

  select count(*) into v_count from public.cash_accounts where is_demo = false;
  if v_count <> 0 then raise exception 'Found non-demo cash_accounts: %', v_count; end if;

  select count(*) into v_count from public.cash_ledger_entries where is_demo = false;
  if v_count <> 0 then raise exception 'Found non-demo cash_ledger_entries: %', v_count; end if;

  select count(*) into v_count from public.invoices where is_demo = false;
  if v_count <> 0 then raise exception 'Found non-demo invoices: %', v_count; end if;

  select count(*) into v_count from public.invoice_items where is_demo = false;
  if v_count <> 0 then raise exception 'Found non-demo invoice_items: %', v_count; end if;

  select count(*) into v_count from public.payment_receipts where is_demo = false;
  if v_count <> 0 then raise exception 'Found non-demo payment_receipts: %', v_count; end if;

  select count(*) into v_count from public.payment_allocations where is_demo = false;
  if v_count <> 0 then raise exception 'Found non-demo payment_allocations: %', v_count; end if;

  -- 3. Exact Cash Balances
  select current_balance into v_hdfc_balance from public.cash_account_balances where name = 'HDFC Current Account';
  if v_hdfc_balance <> 265750.00 then
    raise exception 'HDFC Current Account expected balance 265750.00, found %', v_hdfc_balance;
  end if;

  select current_balance into v_petty_balance from public.cash_account_balances where name = 'Office Petty Cash';
  if v_petty_balance <> 42680.00 then
    raise exception 'Office Petty Cash expected balance 42680.00, found %', v_petty_balance;
  end if;

  -- 4. Collections Snapshot Exact Arithmetic
  select
    coalesce(sum(total_outstanding), 0),
    coalesce(sum(current_amount), 0),
    coalesce(sum(overdue_1_30), 0),
    coalesce(sum(overdue_31_60), 0),
    coalesce(sum(overdue_61_90), 0),
    coalesce(sum(overdue_90_plus), 0)
  into v_tot_out, v_cur_amt, v_od_1_30, v_od_31_60, v_od_61_90, v_od_90_plus
  from public.collections_snapshot;

  if v_tot_out <> 156750.00 then raise exception 'total_outstanding expected 156750.00, found %', v_tot_out; end if;
  if v_cur_amt <> 41750.00 then raise exception 'current_amount expected 41750.00, found %', v_cur_amt; end if;
  if v_od_1_30 <> 26500.00 then raise exception 'overdue_1_30 expected 26500.00, found %', v_od_1_30; end if;
  if v_od_31_60 <> 0.00 then raise exception 'overdue_31_60 expected 0.00, found %', v_od_31_60; end if;
  if v_od_61_90 <> 88500.00 then raise exception 'overdue_61_90 expected 88500.00, found %', v_od_61_90; end if;
  if v_od_90_plus <> 0.00 then raise exception 'overdue_90_plus expected 0.00, found %', v_od_90_plus; end if;

  -- 5. Invoice Status and Derived State Checks
  if not exists (select 1 from public.invoices where code = 'INV-0001001' and status = 'issued' and total_amount = 88500.00 and amount_received = 0.00) then
    raise exception 'INV-0001001 invariant failed';
  end if;
  if not exists (select 1 from public.invoices where code = 'INV-0001002' and status = 'paid' and total_amount = 14500.00 and amount_received = 14500.00) then
    raise exception 'INV-0001002 invariant failed';
  end if;
  if not exists (select 1 from public.invoices where code = 'INV-0001003' and status = 'paid' and total_amount = 15000.00 and amount_received = 15000.00) then
    raise exception 'INV-0001003 invariant failed';
  end if;
  if not exists (select 1 from public.invoices where code = 'INV-0001004' and status = 'part_paid' and total_amount = 20000.00 and amount_received = 13250.00) then
    raise exception 'INV-0001004 invariant failed';
  end if;
  if not exists (select 1 from public.invoices where code = 'INV-0001005' and status = 'part_paid' and total_amount = 35000.00 and amount_received = 23000.00) then
    raise exception 'INV-0001005 invariant failed';
  end if;
  if not exists (select 1 from public.invoices where code = 'INV-0001006' and status = 'paid' and total_amount = 75000.00 and amount_received = 75000.00) then
    raise exception 'INV-0001006 invariant failed';
  end if;
  if not exists (select 1 from public.invoices where code = 'INV-0001007' and status = 'issued' and total_amount = 14500.00 and amount_received = 0.00) then
    raise exception 'INV-0001007 invariant failed';
  end if;
  if not exists (select 1 from public.invoices where code = 'INV-0001008' and status = 'issued' and total_amount = 35000.00 and amount_received = 0.00) then
    raise exception 'INV-0001008 invariant failed';
  end if;
  if not exists (select 1 from public.invoices where code = 'INV-0001009' and status = 'draft' and total_amount = 15000.00 and amount_received = 0.00) then
    raise exception 'INV-0001009 invariant failed';
  end if;

  -- 6. Sequence Synchronization Verification (nextval must match expected)
  v_next_val := nextval('public.client_code_seq');
  if v_next_val <> 1007 then raise exception 'client_code_seq next expected 1007, found %', v_next_val; end if;

  v_next_val := nextval('public.schedule_code_seq');
  if v_next_val <> 1010 then raise exception 'schedule_code_seq next expected 1010, found %', v_next_val; end if;

  v_next_val := nextval('public.assignment_code_seq');
  if v_next_val <> 1007 then raise exception 'assignment_code_seq next expected 1007, found %', v_next_val; end if;

  v_next_val := nextval('public.work_item_code_seq');
  if v_next_val <> 1007 then raise exception 'work_item_code_seq next expected 1007, found %', v_next_val; end if;

  v_next_val := nextval('public.ledger_entry_code_seq');
  if v_next_val <> 1009 then raise exception 'ledger_entry_code_seq next expected 1009, found %', v_next_val; end if;

  v_next_val := nextval('public.invoice_code_seq');
  if v_next_val <> 1010 then raise exception 'invoice_code_seq next expected 1010, found %', v_next_val; end if;

  v_next_val := nextval('public.receipt_code_seq');
  if v_next_val <> 1006 then raise exception 'receipt_code_seq next expected 1006, found %', v_next_val; end if;

  -- Restore sequences so test remains strictly idempotent without permanent offset drift
  perform setval('public.client_code_seq', 1006);
  perform setval('public.schedule_code_seq', 1009);
  perform setval('public.assignment_code_seq', 1006);
  perform setval('public.work_item_code_seq', 1006);
  perform setval('public.ledger_entry_code_seq', 1008);
  perform setval('public.invoice_code_seq', 1009);
  perform setval('public.receipt_code_seq', 1005);

  raise notice '002_seed_invariants: ALL INVARIANTS VERIFIED SUCCESSFULLY';
end $verify$;

rollback;
