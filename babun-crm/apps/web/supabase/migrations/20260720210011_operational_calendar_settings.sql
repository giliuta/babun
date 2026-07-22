-- Safe company calendar projection for operational mobile roles.
-- The 14-digit prefix is a unique Supabase CLI migration version.
--
-- Masters need the company's timezone, visible/work hours and grid behavior
-- to render the same schedule as dispatchers. The raw calendar_settings row
-- is intentionally not master-readable because it also contains private
-- personal-calendar configuration. This parameterless SECURITY DEFINER RPC
-- pins the lookup to JWT membership and exposes only an explicit allow-list.

create or replace function public.read_operational_calendar_settings_safe()
returns table (
  start_hour       integer,
  end_hour         integer,
  grid_step        integer,
  week_start       text,
  timezone         text,
  buffer_minutes   integer,
  hide_cancelled   boolean,
  allow_overtime   boolean,
  work_start_hour  integer,
  work_end_hour    integer,
  scroll_open_hour integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_role text := public.current_user_role();
begin
  if auth.uid() is null
     or v_tenant_id is null
     or v_role is null
     or v_role not in ('owner', 'dispatcher', 'master') then
    raise exception 'calendar settings are unavailable for this membership'
      using errcode = '42501';
  end if;

  return query
  select cs.start_hour,
         cs.end_hour,
         cs.grid_step,
         cs.week_start,
         cs.timezone,
         cs.buffer_minutes,
         cs.hide_cancelled,
         cs.allow_overtime,
         cs.work_start_hour,
         cs.work_end_hour,
         cs.scroll_open_hour
    from public.calendar_settings cs
   where cs.tenant_id = v_tenant_id
   limit 1;
end;
$$;

revoke all on function public.read_operational_calendar_settings_safe()
  from public, anon, authenticated;
grant execute on function public.read_operational_calendar_settings_safe()
  to authenticated;
