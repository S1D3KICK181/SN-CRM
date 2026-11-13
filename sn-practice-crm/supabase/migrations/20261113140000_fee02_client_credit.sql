-- Migration: 20261113140000_fee02_client_credit.sql
-- Description: FEE-02a Client credit from overpayments (allocation source)

begin;

-- 1. Where an allocation came from: a payment recorded against the bill, or client credit applied to it
alter table public.payment_allocations
  add column source text not null default 'payment';

alter table public.payment_allocations
  add constraint payment_allocations_source_check check (source in ('payment', 'credit'));

-- 2. guard_payment_allocation_write: unchanged from FEE-01a except that source is immutable
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
  elsif new.source is distinct from old.source then
    raise exception 'Allocation source is immutable.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

commit;
