-- Migration: 20261112130000_eng02_assignment_engagement_link.sql
-- Description: ENG-02a Link an Assignment to an Engagement (optional, set at creation only)

begin;

-- 1. Optional link and denormalized immutable engagement code
alter table public.assignments
  add column engagement_id uuid references public.engagements(id) on delete restrict,
  add column engagement_code text;

create index assignments_engagement_idx on public.assignments (engagement_id);

alter table public.assignments
  add constraint assignment_engagement_code_pair check (
    (engagement_id is null) = (engagement_code is null)
  );

-- 2. Link guard: same client, active engagement at creation; link and code immutable afterwards.
-- Security definer so the engagement can be read past the management-only engagements RLS.
create or replace function public.guard_assignment_engagement_link()
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
      raise exception 'The Engagement must belong to the same client as the Assignment.'
        using errcode = '23514';
    end if;

    if v_engagement.status <> 'active' then
      raise exception 'An Assignment can only be linked to an active Engagement.'
        using errcode = '23514';
    end if;

    new.engagement_code := v_engagement.code;
    return new;
  end if;

  -- UPDATE: the link is fixed at creation in both directions
  if new.engagement_id is distinct from old.engagement_id
     or new.engagement_code is distinct from old.engagement_code then
    raise exception 'The Assignment engagement link is immutable after creation.'
      using errcode = '23514';
  end if;

  if old.engagement_id is not null and new.client_id is distinct from old.client_id then
    raise exception 'A linked Assignment cannot change client.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger guard_assignment_engagement_link
  before insert or update of engagement_id, engagement_code, client_id on public.assignments
  for each row execute function public.guard_assignment_engagement_link();

commit;
