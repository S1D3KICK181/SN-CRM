-- Migration 0002: Add reminder_at to work_items and enforce terminal immutability
-- Authority: Supervisor Decision (Slice 1P0a Security, Lifecycle & Reminder Foundation)

alter table public.work_items
  add column if not exists reminder_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'work_items_reminder_before_or_at_due'
      and conrelid = 'public.work_items'::regclass
  ) then
    alter table public.work_items
      add constraint work_items_reminder_before_or_at_due check (
        reminder_at is null or due_at is null or reminder_at <= due_at
      );
  end if;
end $$;

create index if not exists work_items_reminder_open_idx
  on public.work_items (reminder_at)
  where status not in ('completed', 'cancelled') and archived_at is null and reminder_at is not null;

comment on column public.work_items.reminder_at is
  'Scheduled notification timestamp for the work item. Must be on or before due_at.';

create or replace function public.guard_work_item_reminder_immutability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status in ('completed', 'cancelled')
       and new.reminder_at is distinct from old.reminder_at then
      raise exception 'Completed and cancelled Work Items are immutable except for archiving.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_work_item_reminder_immutability on public.work_items;
create trigger guard_work_item_reminder_immutability
  before update of reminder_at on public.work_items
  for each row execute function public.guard_work_item_reminder_immutability();
