-- The API uses optimistic concurrency for business aggregates. Existing rows
-- start at version 1; subsequent updates are advanced by a shared trigger.
alter table public.clients add column if not exists version bigint not null default 1;
alter table public.engagements add column if not exists version bigint not null default 1;
alter table public.work_assignments add column if not exists version bigint not null default 1;
alter table public.invoices add column if not exists version bigint not null default 1;
alter table public.payments add column if not exists version bigint not null default 1;

create or replace function public.bump_record_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.version := old.version + 1;
  if to_jsonb(new) ? 'updated_at' then
    new.updated_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists trg_clients_version on public.clients;
create trigger trg_clients_version
  before update on public.clients
  for each row execute function public.bump_record_version();

drop trigger if exists trg_engagements_version on public.engagements;
create trigger trg_engagements_version
  before update on public.engagements
  for each row execute function public.bump_record_version();

drop trigger if exists trg_work_assignments_version on public.work_assignments;
create trigger trg_work_assignments_version
  before update on public.work_assignments
  for each row execute function public.bump_record_version();

drop trigger if exists trg_invoices_version on public.invoices;
create trigger trg_invoices_version
  before update on public.invoices
  for each row execute function public.bump_record_version();

drop trigger if exists trg_payments_version on public.payments;
create trigger trg_payments_version
  before update on public.payments
  for each row execute function public.bump_record_version();

-- Fail the migration if legacy data violates the new invariants. Shipping the
-- command API on top of unvalidated historical rows would make its guarantees
-- untrue, especially for payment allocation totals.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'work_assignments_progress_range'
      and conrelid = 'public.work_assignments'::regclass
  ) then
    alter table public.work_assignments
      add constraint work_assignments_progress_range check (progress between 0 and 100);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'work_assignments_fee_nonnegative'
      and conrelid = 'public.work_assignments'::regclass
  ) then
    alter table public.work_assignments
      add constraint work_assignments_fee_nonnegative check (agreed_fee >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_progress_range'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_progress_range check (progress between 0 and 100);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoices_amounts_nonnegative'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_amounts_nonnegative check (
        subtotal >= 0 and discount >= 0 and tax_amount >= 0 and total >= 0 and amount_received >= 0
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoices_tax_rate_range'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_tax_rate_range check (tax_rate between 0 and 100);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoices_due_date_order'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_due_date_order check (due_date is null or due_date >= invoice_date);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoice_items_positive_quantity'
      and conrelid = 'public.invoice_items'::regclass
  ) then
    alter table public.invoice_items
      add constraint invoice_items_positive_quantity check (quantity > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoice_items_amounts_nonnegative'
      and conrelid = 'public.invoice_items'::regclass
  ) then
    alter table public.invoice_items
      add constraint invoice_items_amounts_nonnegative check (rate >= 0 and amount >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'payments_amount_positive'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
      add constraint payments_amount_positive check (amount > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'payment_allocations_amount_positive'
      and conrelid = 'public.payment_allocations'::regclass
  ) then
    alter table public.payment_allocations
      add constraint payment_allocations_amount_positive check (amount > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'comm_logs_invoice_id_fkey'
      and conrelid = 'public.comm_logs'::regclass
      and contype = 'f'
  ) then
    alter table public.comm_logs
      add constraint comm_logs_invoice_id_fkey foreign key (invoice_id)
      references public.invoices(id) on delete set null;
  end if;
end
$$;

alter table public.work_assignments validate constraint work_assignments_progress_range;
alter table public.work_assignments validate constraint work_assignments_fee_nonnegative;
alter table public.tasks validate constraint tasks_progress_range;
alter table public.invoices validate constraint invoices_amounts_nonnegative;
alter table public.invoices validate constraint invoices_tax_rate_range;
alter table public.invoices validate constraint invoices_due_date_order;
alter table public.invoice_items validate constraint invoice_items_positive_quantity;
alter table public.invoice_items validate constraint invoice_items_amounts_nonnegative;
alter table public.payments validate constraint payments_amount_positive;
alter table public.payment_allocations validate constraint payment_allocations_amount_positive;
alter table public.comm_logs validate constraint comm_logs_invoice_id_fkey;

create index if not exists payment_allocations_payment_id_idx
  on public.payment_allocations (payment_id);
create index if not exists payment_allocations_invoice_id_idx
  on public.payment_allocations (invoice_id);
create index if not exists comm_logs_invoice_id_idx
  on public.comm_logs (invoice_id);

-- Serialize allocation edits around both affected ledgers and reject writes
-- that would over-allocate a receipt, exceed an invoice balance, or cross clients.
create or replace function public.validate_payment_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _payment_client uuid;
  _payment_amount numeric;
  _invoice_client uuid;
  _invoice_total numeric;
  _allocated_to_payment numeric;
  _allocated_to_invoice numeric;
  _old_payment uuid;
  _old_invoice uuid;
begin
  if new.amount <= 0 then
    raise exception using errcode = '23514', message = 'Allocation amount must be positive';
  end if;

  _old_payment := case when tg_op = 'UPDATE' then old.payment_id else new.payment_id end;
  _old_invoice := case when tg_op = 'UPDATE' then old.invoice_id else new.invoice_id end;

  perform p.id
  from public.payments p
  where p.id = any(array[new.payment_id, _old_payment])
  order by p.id
  for update;

  perform i.id
  from public.invoices i
  where i.id = any(array[new.invoice_id, _old_invoice])
  order by i.id
  for update;

  select client_id, amount
    into _payment_client, _payment_amount
  from public.payments
  where id = new.payment_id;

  select client_id, total
    into _invoice_client, _invoice_total
  from public.invoices
  where id = new.invoice_id;

  if _payment_client is null or _invoice_client is null then
    raise exception using errcode = '23503', message = 'Payment and invoice must exist';
  end if;

  if _payment_client <> _invoice_client then
    raise exception using errcode = '23514', message = 'Payment and invoice must belong to the same client';
  end if;

  select coalesce(sum(pa.amount), 0)
    into _allocated_to_payment
  from public.payment_allocations pa
  where pa.payment_id = new.payment_id and pa.id <> new.id;

  if _allocated_to_payment + new.amount > _payment_amount then
    raise exception using errcode = '23514', message = 'Allocations exceed the payment amount';
  end if;

  select coalesce(sum(pa.amount), 0)
    into _allocated_to_invoice
  from public.payment_allocations pa
  where pa.invoice_id = new.invoice_id and pa.id <> new.id;

  if _allocated_to_invoice + new.amount > _invoice_total then
    raise exception using errcode = '23514', message = 'Allocation exceeds the invoice balance';
  end if;

  return new;
end
$$;

drop trigger if exists trg_validate_payment_allocation on public.payment_allocations;
create trigger trg_validate_payment_allocation
  before insert or update of payment_id, invoice_id, amount on public.payment_allocations
  for each row execute function public.validate_payment_allocation();

-- Parent rows cannot be edited in a way that invalidates allocations already
-- recorded against them. This closes the inverse path around the allocation
-- trigger (for example, shrinking a receipt after it has been allocated).
create or replace function public.guard_payment_allocation_parent()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  _allocated numeric;
begin
  select coalesce(sum(amount), 0)
    into _allocated
  from public.payment_allocations
  where payment_id = old.id;

  if new.client_id is distinct from old.client_id and _allocated > 0 then
    raise exception using
      errcode = '23514',
      message = 'A payment client cannot change while allocations exist';
  end if;

  if new.amount < _allocated then
    raise exception using
      errcode = '23514',
      message = 'Payment amount cannot be lower than its allocations';
  end if;

  return new;
end
$$;

drop trigger if exists trg_guard_payment_allocation_parent on public.payments;
create trigger trg_guard_payment_allocation_parent
  before update of client_id, amount on public.payments
  for each row execute function public.guard_payment_allocation_parent();

create or replace function public.guard_invoice_allocation_parent()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  _allocated numeric;
begin
  select coalesce(sum(amount), 0)
    into _allocated
  from public.payment_allocations
  where invoice_id = old.id;

  if new.client_id is distinct from old.client_id and _allocated > 0 then
    raise exception using
      errcode = '23514',
      message = 'An invoice client cannot change while allocations exist';
  end if;

  if new.total < _allocated then
    raise exception using
      errcode = '23514',
      message = 'Invoice total cannot be lower than its allocations';
  end if;

  -- amount_received and the payment-derived status are owned by the allocation
  -- trigger. Nested depth is two when that trigger performs this invoice update.
  if pg_trigger_depth() = 1 and (
    new.amount_received is distinct from old.amount_received
    or new.status is distinct from old.status
  ) then
    raise exception using
      errcode = '42501',
      message = 'Invoice payment state is derived from allocations';
  end if;

  return new;
end
$$;

drop trigger if exists trg_guard_invoice_allocation_parent on public.invoices;
create trigger trg_guard_invoice_allocation_parent
  before update of client_id, total, amount_received, status on public.invoices
  for each row execute function public.guard_invoice_allocation_parent();

-- Recalculate every affected invoice. The original trigger refreshed only the
-- new invoice when an allocation moved, leaving the old invoice stale.
create or replace function public.refresh_invoice_payment_state(_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _paid numeric;
begin
  select coalesce(sum(amount), 0)
    into _paid
  from public.payment_allocations
  where invoice_id = _invoice_id;

  update public.invoices
  set amount_received = _paid,
      status = case
        when status in ('Draft', 'Cancelled') then status
        when _paid >= total and total > 0 then 'Paid'
        when _paid > 0 then 'Partially Paid'
        else 'Unpaid'
      end
  where id = _invoice_id
    and (amount_received, status) is distinct from (
      _paid,
      case
        when status in ('Draft', 'Cancelled') then status
        when _paid >= total and total > 0 then 'Paid'
        when _paid > 0 then 'Partially Paid'
        else 'Unpaid'
      end
    );
end
$$;

revoke all on function public.refresh_invoice_payment_state(uuid)
  from public, anon, authenticated;

create or replace function public.recalc_invoice_on_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_invoice_payment_state(old.invoice_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.invoice_id is distinct from old.invoice_id) then
    perform public.refresh_invoice_payment_state(new.invoice_id);
  end if;
  return null;
end
$$;

drop trigger if exists trg_recalc_invoice on public.payment_allocations;
create trigger trg_recalc_invoice
  after insert or update of amount, payment_id, invoice_id or delete on public.payment_allocations
  for each row execute function public.recalc_invoice_on_payment();

-- Durable-operation and compliance evidence foundations. These are deliberately
-- not exposed as general CRUD tables; the application server owns their writes.
create table if not exists public.operation_receipts (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key text not null,
  operation_type text not null,
  request_hash text not null,
  state text not null default 'accepted'
    check (state in ('completed', 'pending_approval', 'accepted', 'failed')),
  result jsonb,
  error jsonb,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (actor_id, idempotency_key),
  unique (correlation_id),
  check (
    (state = 'completed' and result is not null and error is null)
    or (state = 'failed' and result is null and error is not null)
    or (state in ('accepted', 'pending_approval') and result is null and error is null)
  )
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  operation_receipt_id uuid references public.operation_receipts(id) on delete restrict,
  event_ordinal smallint not null default 1 check (event_ordinal > 0),
  action text not null,
  subject_type text not null,
  subject_id uuid,
  reason text,
  before_data jsonb,
  after_data jsonb,
  request_id text not null check (char_length(request_id) between 1 and 128),
  correlation_id uuid not null,
  session_id text,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (operation_receipt_id, event_ordinal)
);

create table if not exists public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  operation_receipt_id uuid references public.operation_receipts(id) on delete restrict,
  event_ordinal smallint not null default 1 check (event_ordinal > 0),
  correlation_id uuid not null,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid,
  payload jsonb not null,
  state text not null default 'pending'
    check (state in ('pending', 'processing', 'delivered', 'failed', 'dead_letter')),
  attempts int not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (operation_receipt_id, event_ordinal)
);

create index if not exists outbox_events_claim_idx
  on public.outbox_events (state, available_at, created_at);
create index if not exists audit_events_correlation_idx
  on public.audit_events (correlation_id, created_at);
create index if not exists operation_receipts_actor_created_idx
  on public.operation_receipts (actor_id, created_at desc);

create table if not exists public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  payload jsonb not null,
  state text not null default 'queued'
    check (state in ('queued', 'running', 'completed', 'failed', 'dead_letter')),
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 5 check (max_attempts > 0),
  run_after timestamptz not null default now(),
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists background_jobs_claim_idx
  on public.background_jobs (state, run_after, created_at);

-- This policy is duplicated in the TypeScript server only for fast rejection.
-- The database copy is authoritative because the mutation and evidence write
-- must remain one transaction even when requests race.
create or replace function public.assignment_transition_allowed(
  _current_status text,
  _next_status text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select _current_status <> _next_status
    and case _current_status
      when 'New' then _next_status = any (array[
        'Awaiting Assignment', 'Assigned', 'On Hold', 'Cancelled'
      ])
      when 'Awaiting Assignment' then _next_status = any (array[
        'New', 'Assigned', 'On Hold', 'Cancelled'
      ])
      when 'Assigned' then _next_status = any (array[
        'Awaiting Assignment', 'Awaiting Client Documents', 'In Progress',
        'On Hold', 'Cancelled'
      ])
      when 'Awaiting Client Documents' then _next_status = any (array[
        'Assigned', 'In Progress', 'On Hold', 'Cancelled'
      ])
      when 'In Progress' then _next_status = any (array[
        'Awaiting Client Documents', 'Pending Internal Review', 'On Hold', 'Cancelled'
      ])
      when 'Pending Internal Review' then _next_status = any (array[
        'In Progress', 'Correction Required', 'Awaiting Client Approval',
        'Ready for Filing / Submission', 'Completed', 'On Hold', 'Cancelled'
      ])
      when 'Correction Required' then _next_status = any (array[
        'In Progress', 'Pending Internal Review', 'On Hold', 'Cancelled'
      ])
      when 'Awaiting Client Approval' then _next_status = any (array[
        'In Progress', 'Correction Required', 'Ready for Filing / Submission',
        'Completed', 'On Hold', 'Cancelled'
      ])
      when 'Ready for Filing / Submission' then _next_status = any (array[
        'Pending Internal Review', 'Correction Required', 'Awaiting Client Approval',
        'Filed / Submitted', 'Completed', 'On Hold', 'Cancelled'
      ])
      when 'Filed / Submitted' then _next_status = any (array[
        'Correction Required', 'Ready for Filing / Submission', 'Completed',
        'On Hold', 'Cancelled'
      ])
      when 'On Hold' then _next_status = any (array[
        'Awaiting Assignment', 'Assigned', 'Awaiting Client Documents', 'In Progress',
        'Pending Internal Review', 'Correction Required', 'Awaiting Client Approval',
        'Ready for Filing / Submission', 'Filed / Submitted', 'Cancelled'
      ])
      else false
    end
$$;

revoke all on function public.assignment_transition_allowed(text, text)
  from public, anon, authenticated;

-- Idempotency claim, optimistic-concurrency mutation, immutable audit evidence,
-- and outbox publication all commit or roll back together. The advisory
-- transaction lock serializes concurrent retries before the unique receipt is
-- inspected, so no durable processing lease can become stranded.
create or replace function public.transition_assignment_operation(
  _idempotency_key text,
  _request_hash text,
  _assignment_id uuid,
  _expected_version bigint,
  _expected_status text,
  _next_status text,
  _progress integer,
  _correlation_id uuid,
  _request_id text,
  _reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _actor uuid := auth.uid();
  _existing public.operation_receipts%rowtype;
  _receipt public.operation_receipts%rowtype;
  _before public.work_assignments%rowtype;
  _after public.work_assignments%rowtype;
  _next_progress integer;
  _failure jsonb;
  _result jsonb;
begin
  if _actor is null then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = _actor and p.is_active
  ) then
    raise exception using errcode = '42501', message = 'The actor profile is not active';
  end if;
  if char_length(_idempotency_key) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'Invalid idempotency key';
  end if;
  if _request_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid request hash';
  end if;
  if char_length(_request_id) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'Invalid request ID';
  end if;
  if _correlation_id is null then
    raise exception using errcode = '22023', message = 'Correlation ID is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(_actor::text || ':' || _idempotency_key, 0)
  );

  select *
    into _existing
  from public.operation_receipts
  where actor_id = _actor
    and idempotency_key = _idempotency_key;

  if found then
    if _existing.request_hash <> _request_hash then
      return jsonb_build_object(
        'operation_id', _existing.id,
        'operation_type', _existing.operation_type,
        'state', 'failed',
        'replayed', true,
        'result', null,
        'error', jsonb_build_object(
          'status', 409,
          'code', 'IDEMPOTENCY_KEY_REUSED',
          'message', 'The idempotency key was already used for a different request'
        ),
        'created_at', to_char(_existing.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'completed_at', to_char(_existing.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      );
    end if;

    if _existing.state in ('completed', 'failed') then
      return jsonb_build_object(
        'operation_id', _existing.id,
        'operation_type', _existing.operation_type,
        'state', _existing.state,
        'replayed', true,
        'result', _existing.result,
        'error', _existing.error,
        'created_at', to_char(_existing.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'completed_at', to_char(_existing.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      );
    end if;

    return jsonb_build_object(
      'operation_id', _existing.id,
      'operation_type', _existing.operation_type,
      'state', 'failed',
      'replayed', true,
      'result', null,
      'error', jsonb_build_object(
        'status', 409,
        'code', 'OPERATION_IN_PROGRESS',
        'message', 'The operation is already being processed'
      ),
      'created_at', to_char(_existing.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'completed_at', null
    );
  end if;

  insert into public.operation_receipts (
    actor_id,
    idempotency_key,
    operation_type,
    request_hash,
    state,
    correlation_id
  ) values (
    _actor,
    _idempotency_key,
    'assignment.transition',
    _request_hash,
    'accepted',
    _correlation_id
  )
  returning * into _receipt;

  <<apply_operation>>
  begin
    select wa.*
      into _before
    from public.work_assignments wa
    where wa.id = _assignment_id
      and public.assignment_involvement(wa.id)
    for update;

    if not found then
      _failure := jsonb_build_object(
        'status', 404,
        'code', 'ASSIGNMENT_NOT_FOUND',
        'message', 'The assignment was not found or is not accessible'
      );
      exit apply_operation;
    end if;

    if _before.version <> _expected_version
      or (_expected_status is not null and _before.status <> _expected_status) then
      _failure := jsonb_build_object(
        'status', 409,
        'code', 'ASSIGNMENT_VERSION_CONFLICT',
        'message', 'The assignment changed since it was loaded',
        'details', jsonb_build_object(
          'expectedVersion', _expected_version,
          'currentVersion', _before.version,
          'currentStatus', _before.status
        )
      );
      exit apply_operation;
    end if;

    if not public.assignment_transition_allowed(_before.status, _next_status) then
      _failure := jsonb_build_object(
        'status', 409,
        'code', 'INVALID_ASSIGNMENT_TRANSITION',
        'message', 'The requested assignment transition is not allowed',
        'details', jsonb_build_object(
          'currentStatus', _before.status,
          'nextStatus', _next_status,
          'reason', 'workflow_order'
        )
      );
      exit apply_operation;
    end if;

    if _next_status = 'Completed' then
      _next_progress := 100;
    else
      _next_progress := coalesce(_progress, _before.progress);
      if _next_progress < 0 or _next_progress >= 100 then
        _failure := jsonb_build_object(
          'status', 409,
          'code', 'INVALID_ASSIGNMENT_TRANSITION',
          'message', 'The requested assignment transition is not allowed',
          'details', jsonb_build_object(
            'currentStatus', _before.status,
            'nextStatus', _next_status,
            'reason', 'non_completed_progress_must_be_below_100'
          )
        );
        exit apply_operation;
      end if;
    end if;

    update public.work_assignments
    set status = _next_status,
        progress = _next_progress,
        actual_completion = case
          when _next_status = 'Completed'
            then (clock_timestamp() at time zone 'Asia/Kolkata')::date
          else null
        end,
        updated_at = clock_timestamp()
    where id = _assignment_id
      and version = _expected_version
    returning * into _after;

    if not found then
      _failure := jsonb_build_object(
        'status', 409,
        'code', 'ASSIGNMENT_VERSION_CONFLICT',
        'message', 'The assignment changed while the transition was being applied'
      );
      exit apply_operation;
    end if;

    _result := jsonb_build_object(
      'assignment', jsonb_build_object(
        'id', _after.id,
        'status', _after.status,
        'progress', _after.progress,
        'version', _after.version
      )
    );

    insert into public.audit_events (
      actor_id,
      operation_receipt_id,
      event_ordinal,
      action,
      subject_type,
      subject_id,
      reason,
      before_data,
      after_data,
      request_id,
      correlation_id
    ) values (
      _actor,
      _receipt.id,
      1,
      'assignment.transition',
      'work_assignment',
      _after.id,
      _reason,
      to_jsonb(_before),
      to_jsonb(_after),
      _request_id,
      _correlation_id
    );

    insert into public.outbox_events (
      operation_receipt_id,
      event_ordinal,
      correlation_id,
      event_type,
      aggregate_type,
      aggregate_id,
      payload
    ) values (
      _receipt.id,
      1,
      _correlation_id,
      'assignment.transitioned',
      'work_assignment',
      _after.id,
      jsonb_build_object(
        'assignmentId', _after.id,
        'previousStatus', _before.status,
        'status', _after.status,
        'version', _after.version
      )
    );
  end apply_operation;

  if _failure is not null then
    update public.operation_receipts
    set state = 'failed',
        error = _failure,
        updated_at = clock_timestamp()
    where id = _receipt.id
    returning * into _receipt;
  else
    update public.operation_receipts
    set state = 'completed',
        result = _result,
        updated_at = clock_timestamp()
    where id = _receipt.id
    returning * into _receipt;
  end if;

  return jsonb_build_object(
    'operation_id', _receipt.id,
    'operation_type', _receipt.operation_type,
    'state', _receipt.state,
    'replayed', false,
    'result', _receipt.result,
    'error', _receipt.error,
    'created_at', to_char(_receipt.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'completed_at', to_char(_receipt.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end
$$;

revoke all on function public.transition_assignment_operation(
  text, text, uuid, bigint, text, text, integer, uuid, text, text
) from public, anon;
grant execute on function public.transition_assignment_operation(
  text, text, uuid, bigint, text, text, integer, uuid, text, text
) to authenticated;

create or replace function public.reject_audit_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception using errcode = '55000', message = 'Audit events are append-only';
end
$$;

drop trigger if exists trg_audit_events_immutable on public.audit_events;
create trigger trg_audit_events_immutable
  before update or delete on public.audit_events
  for each row execute function public.reject_audit_event_mutation();

alter table public.operation_receipts enable row level security;
alter table public.audit_events enable row level security;
alter table public.outbox_events enable row level security;
alter table public.background_jobs enable row level security;

grant select on public.operation_receipts to authenticated;
grant select on public.audit_events to authenticated;

revoke all on public.operation_receipts, public.audit_events, public.outbox_events, public.background_jobs
  from service_role;
grant select, insert, update on public.operation_receipts to service_role;
grant select, insert on public.audit_events to service_role;
grant select, insert, update, delete on public.outbox_events to service_role;
grant select, insert, update, delete on public.background_jobs to service_role;

drop policy if exists "actors read operation receipts" on public.operation_receipts;
create policy "actors read operation receipts"
  on public.operation_receipts for select to authenticated
  using (actor_id = auth.uid() or public.is_founder());

drop policy if exists "audit events visible to founder" on public.audit_events;
create policy "audit events visible to founder"
  on public.audit_events for select to authenticated
  using (public.is_founder());
