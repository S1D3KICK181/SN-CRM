-- Migration: 20261113120000_fee01_vyapar_bills.sql
-- Description: FEE-01a Track Vyapar bills and payments (invoices, receipts, allocations)

begin;

-- 1. Vyapar bill number on invoices, unique per financial year among live bills
alter table public.invoices
  add column vyapar_bill_number text;

alter table public.invoices
  add constraint invoice_vyapar_bill_number_length check (
    vyapar_bill_number is null or char_length(btrim(vyapar_bill_number)) between 1 and 30
  );

-- Financial year (April to March) as the calendar year in which it starts.
create or replace function public.financial_year_start(p_date date)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select (extract(year from p_date))::integer
    - case when extract(month from p_date) < 4 then 1 else 0 end;
$$;

create unique index invoices_vyapar_bill_fy_uidx
  on public.invoices (upper(btrim(vyapar_bill_number)), public.financial_year_start(issue_date))
  where vyapar_bill_number is not null and status <> 'voided';

-- 2. guard_invoice_write: Vyapar number is immutable after insert.
-- The payment-state recompute (security definer, flagged) may touch an invoice on behalf of
-- Senior Staff and Staff who are allowed to record payments; every other write stays management-only.
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
  if v_actor is not null and not v_internal_recompute and not public.is_management(v_actor) then
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
     or new.vyapar_bill_number is distinct from old.vyapar_bill_number
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

-- 3. Fee visibility helpers
create or replace function public.user_fee_visible(
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
    or (
      public.role_of(p_user_id) in ('senior_staff', 'staff')
      and (
        exists (
          select 1 from public.clients c
          where c.id = p_client_id and c.relationship_owner_id = p_user_id
        )
        or exists (
          select 1 from public.assignments a
          where a.client_id = p_client_id
            and (
              a.owner_id = p_user_id
              or exists (
                select 1 from public.assignment_reviewers ar
                where ar.assignment_id = a.id and ar.reviewer_id = p_user_id
              )
            )
        )
      )
    );
$$;

create or replace function public.fee_visible(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.user_fee_visible(auth.uid(), p_client_id);
$$;

-- 4. Row level security: fee-visible reads, fee-visible payment inserts
drop policy invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (public.fee_visible(client_id));

drop policy invoice_items_select on public.invoice_items;
create policy invoice_items_select on public.invoice_items
  for select to authenticated
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_id and public.fee_visible(i.client_id)
    )
  );

drop policy payment_receipts_select on public.payment_receipts;
create policy payment_receipts_select on public.payment_receipts
  for select to authenticated
  using (public.fee_visible(client_id));

drop policy payment_receipts_insert on public.payment_receipts;
create policy payment_receipts_insert on public.payment_receipts
  for insert to authenticated
  with check (public.fee_visible(client_id) and created_by = auth.uid());

drop policy payment_allocations_select on public.payment_allocations;
create policy payment_allocations_select on public.payment_allocations
  for select to authenticated
  using (
    exists (
      select 1 from public.payment_receipts pr
      where pr.id = receipt_id and public.fee_visible(pr.client_id)
    )
  );

drop policy payment_allocations_insert on public.payment_allocations;
create policy payment_allocations_insert on public.payment_allocations
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.payment_receipts pr
      where pr.id = receipt_id and public.fee_visible(pr.client_id)
    )
  );

-- 5. guard_payment_receipt_write: Senior Staff and Staff may record payments for fee-visible clients
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
    if tg_op <> 'INSERT' then
      raise exception 'Only the Founder or Manager may operate payment receipts.'
        using errcode = '42501';
    end if;
    if not public.user_fee_visible(v_actor, new.client_id)
       or new.ledger_entry_id is not null then
      raise exception 'Only the Founder or Manager, or staff looking after this client, may record payments.'
        using errcode = '42501';
    end if;
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

-- 6. guard_payment_allocation_write: Senior Staff and Staff may allocate on insert for fee-visible clients
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
    if tg_op <> 'INSERT' then
      raise exception 'Only the Founder or Manager may allocate payments.' using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.payment_receipts pr
      where pr.id = new.receipt_id
        and public.user_fee_visible(v_actor, pr.client_id)
    ) then
      raise exception 'Only the Founder or Manager, or staff looking after this client, may record payments.'
        using errcode = '42501';
    end if;
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

-- 7. Operation receipts: any fee-capable role may keep its own idempotency receipts
drop policy operation_receipts_select on public.operation_receipts;
create policy operation_receipts_select on public.operation_receipts
  for select to authenticated
  using (
    public.current_app_role() in ('founder', 'manager', 'senior_staff', 'staff')
    and actor_id = auth.uid()
  );

drop policy operation_receipts_insert on public.operation_receipts;
create policy operation_receipts_insert on public.operation_receipts
  for insert to authenticated
  with check (
    public.current_app_role() in ('founder', 'manager', 'senior_staff', 'staff')
    and actor_id = auth.uid()
  );

commit;
