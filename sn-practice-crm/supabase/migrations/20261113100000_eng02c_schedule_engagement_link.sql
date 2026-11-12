-- Migration: 20261113100000_eng02c_schedule_engagement_link.sql
-- Description: ENG-02c Link a Recurring Schedule to an Engagement (optional, set at creation only).
--   Generated assignments inherit the link; ending the engagement stops its schedules.

begin;

-- 1. Optional link and denormalized immutable engagement code
alter table public.recurring_schedules
  add column engagement_id uuid references public.engagements(id) on delete restrict,
  add column engagement_code text;

create index recurring_schedules_engagement_idx on public.recurring_schedules (engagement_id);

alter table public.recurring_schedules
  add constraint recurring_schedule_engagement_code_pair check (
    (engagement_id is null) = (engagement_code is null)
  );

-- 2. Link guard: same client, active engagement at creation; link and code immutable afterwards;
-- a schedule linked to a non-active engagement cannot be reactivated.
-- Security definer so the engagement can be read past the management-only engagements RLS.
create or replace function public.guard_recurring_schedule_engagement_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_engagement record;
begin
  if tg_op = 'INSERT' then
    -- engagement_code is always derived from the engagement; caller-supplied values are discarded
    if new.engagement_id is null then
      new.engagement_code := null;
      return new;
    end if;

    select e.code, e.client_id, e.status into v_engagement
    from public.engagements e
    where e.id = new.engagement_id;

    if not found then
      raise exception 'Engagement does not exist.' using errcode = '23503';
    end if;

    if v_engagement.client_id <> new.client_id then
      raise exception 'The Engagement must belong to the same client as the Recurring Schedule.'
        using errcode = '23514';
    end if;

    if v_engagement.status <> 'active' then
      raise exception 'A Recurring Schedule can only be linked to an active Engagement.'
        using errcode = '23514';
    end if;

    new.engagement_code := v_engagement.code;
    return new;
  end if;

  -- UPDATE: the link is fixed at creation in both directions
  if new.engagement_id is distinct from old.engagement_id
     or new.engagement_code is distinct from old.engagement_code then
    raise exception 'The Recurring Schedule engagement link is immutable after creation.'
      using errcode = '23514';
  end if;

  if old.engagement_id is not null and new.client_id is distinct from old.client_id then
    raise exception 'A linked Recurring Schedule cannot change client.'
      using errcode = '23514';
  end if;

  if new.is_active and not old.is_active and new.engagement_id is not null then
    select e.status into v_engagement
    from public.engagements e
    where e.id = new.engagement_id;

    if not found or v_engagement.status <> 'active' then
      raise exception 'A Recurring Schedule linked to an ended Engagement cannot be reactivated.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_recurring_schedule_engagement_link
  before insert or update of engagement_id, engagement_code, client_id, is_active on public.recurring_schedules
  for each row execute function public.guard_recurring_schedule_engagement_link();

-- 3. Ending an engagement stops its linked schedules in the same transaction
create or replace function public.stop_engagement_recurring_schedules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.recurring_schedules
  set is_active = false,
      updated_at = now()
  where engagement_id = new.id
    and is_active;
  return new;
end;
$$;

create trigger stop_engagement_recurring_schedules
  after update of status on public.engagements
  for each row
  when (old.status is distinct from new.status and new.status = 'ended')
  execute function public.stop_engagement_recurring_schedules();

-- 4. Materializer: generated assignments inherit the schedule's engagement link, and schedules
-- whose engagement is not active are skipped. Otherwise identical to the AS-01 hardening definition,
-- plus a fix: the output column `assignment_id` made `on conflict (assignment_id, reviewer_id)` in the
-- reviewer copy ambiguous, so any run that generated an assignment failed. `use_column` resolves SQL
-- names to table columns; the output fields are only ever assigned, never read in SQL.
create or replace function public.materialize_due_recurring_assignments(
  p_through_date date default current_date
)
returns table (
  schedule_id uuid,
  assignment_id uuid,
  occurrence_date date
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_schedule record;
  v_occurrence date;
  v_period_end date;
  v_due_date date;
  v_assignment_id uuid;
begin
  for v_schedule in
    select rs.*
    from public.recurring_schedules rs
    where rs.is_active
      and rs.next_occurrence_date <= p_through_date
      and (rs.end_date is null or rs.next_occurrence_date <= rs.end_date)
      and (
        rs.engagement_id is null
        or exists (
          select 1 from public.engagements e
          where e.id = rs.engagement_id and e.status = 'active'
        )
      )
    order by rs.next_occurrence_date, rs.id
    for update
  loop
    v_occurrence := v_schedule.next_occurrence_date;

    while v_occurrence <= p_through_date
      and (v_schedule.end_date is null or v_occurrence <= v_schedule.end_date)
    loop
      v_period_end := (
        v_occurrence + make_interval(months => v_schedule.interval_months) - interval '1 day'
      )::date;
      v_due_date := v_period_end + v_schedule.due_offset_days;
      v_assignment_id := null;

      insert into public.assignments (
        client_id,
        service_id,
        recurring_schedule_id,
        engagement_id,
        title,
        description,
        owner_id,
        status,
        priority,
        period_start,
        period_end,
        due_at,
        created_by,
        is_demo
      ) values (
        v_schedule.client_id,
        v_schedule.service_id,
        v_schedule.id,
        v_schedule.engagement_id,
        v_schedule.title,
        v_schedule.description,
        v_schedule.default_owner_id,
        'assigned',
        v_schedule.priority,
        v_occurrence,
        v_period_end,
        (v_due_date + time '23:59:00') at time zone 'Asia/Kolkata',
        v_schedule.created_by,
        v_schedule.is_demo
      )
      on conflict (recurring_schedule_id, period_start)
        where recurring_schedule_id is not null
      do nothing
      returning id into v_assignment_id;

      if v_assignment_id is not null then
        -- Copy reviewers from recurring schedule to generated assignment
        insert into public.assignment_reviewers (
          assignment_id,
          reviewer_id,
          assigned_by,
          assigned_at,
          is_demo
        )
        select
          v_assignment_id,
          rsr.reviewer_id,
          rsr.assigned_by,
          now(),
          v_schedule.is_demo
        from public.recurring_schedule_reviewers rsr
        where rsr.recurring_schedule_id = v_schedule.id
        on conflict (assignment_id, reviewer_id) do nothing;

        schedule_id := v_schedule.id;
        assignment_id := v_assignment_id;
        occurrence_date := v_occurrence;
        return next;
      end if;

      v_occurrence := (
        v_occurrence + make_interval(months => v_schedule.interval_months)
      )::date;
    end loop;

    update public.recurring_schedules
    set next_occurrence_date = v_occurrence,
        is_active = case
          when v_schedule.end_date is not null and v_occurrence > v_schedule.end_date then false
          else true
        end,
        updated_at = now()
    where id = v_schedule.id;
  end loop;
end;
$$;

commit;
