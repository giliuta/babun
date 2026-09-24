-- АУДИТ ПРАВ 24.09 (сессия 013, сверено с живой базой) — ПЯТЬ ДЫР (STORY-088).
--
--  1. Открепление не закрывало календарь. `current_user_team_ids()` (карточка
--     мастера `masters.team_id`, составы `teams.lead_ids/helper_ids/members`)
--     переживала `set_member_calendars`, и её читают пять функций: окно
--     записей, доступ к записи и клиенту, услуги, команды. Теперь у
--     сотрудника старая связь действует только внутри прикреплённых живых
--     календарей. Ветка «мастер записи» в окне записей снята.
--  2. Контакты клиента текли через чеки: `receipts_read_own_money` пускала к
--     чеку всякого, кто видит операцию, а в `client_snapshot` — имя и
--     телефон. Теперь чек с клиентом — только если клиент человеку виден и
--     «Телефоны и контакты» открыты.
--  3. Архивные календари не отсекались для сотрудника (`access_calendars_of`,
--     окно записей).
--  4. «Метка записи» ничего не открывала: `city` не приходил в окне записей.
--  5. «Статус записи: Не видит» обещал спрятать статус, а спрятать его нельзя
--     не соврав (отменённая запись выглядела бы живой). Положение снято;
--     строк с ним в базе нет.
--
-- Тела переписаны со снятого `pg_proc.prosrc`; изменены только помеченные
-- места.

create or replace function public.current_user_team_ids()
 returns text[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with identity as (
    select public.current_user_master_id() as master_id,
           public.current_tenant_id() as tenant_id
  ), assigned as (
    select m.team_id as team_id
      from public.masters m
      join identity i on i.tenant_id = m.tenant_id and i.master_id = m.id
     where m.team_id is not null
    union
    select t.id
      from public.teams t
      cross join identity i
     where t.tenant_id = i.tenant_id
       and i.master_id is not null
       and (
         coalesce(t.lead_ids, '[]'::jsonb) ? i.master_id
         or coalesce(t.helper_ids, '[]'::jsonb) ? i.master_id
         or exists (
           select 1
             from jsonb_array_elements(
               case
                 when jsonb_typeof(t.members) = 'array' then t.members
                 else '[]'::jsonb
               end
             ) member
            where case jsonb_typeof(member)
              when 'string' then member #>> '{}'
              when 'object' then coalesce(member ->> 'master_id', member ->> 'id')
              else null
            end = i.master_id
         )
       )
  )
  select coalesce(array_agg(distinct team_id order by team_id), array[]::text[])
    from assigned
   where team_id is not null
     -- АУДИТ 24.09: старая связь «мастер ↔ команда» (карточка мастера,
     -- составы команды) переживала открепление — снятый с календаря человек
     -- продолжал видеть его записи, клиентов, файлы и услуги. У сотрудника
     -- она теперь действует только внутри прикреплённых живых календарей.
     and (
       public.current_user_role() is distinct from 'master'
       or team_id in (
         select mc.team_id
           from public.member_calendars mc
           join public.teams t on t.tenant_id = mc.tenant_id and t.id = mc.team_id and t.is_active
          where mc.tenant_id = public.current_tenant_id()
            and mc.user_id = auth.uid()
       )
     )
$function$;

create or replace function public.access_calendars_of(p_tenant uuid, p_user uuid, p_block text, p_min text)
 returns text[]
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  min_rank integer := array_position(array['off', 'read', 'write'], p_min);
  member_role text;
  block_row public.access_blocks%rowtype;
  granted text[];
begin
  if p_tenant is null or p_user is null or min_rank is null or min_rank < 2 then
    return array[]::text[];
  end if;

  select * into block_row
    from public.access_blocks b
   where b.key = p_block
     and b.scope = 'calendar';
  if not found then
    return array[]::text[];
  end if;

  select tm.role into member_role
    from public.tenant_members tm
   where tm.tenant_id = p_tenant
     and tm.user_id = p_user;
  if member_role is null then
    return array[]::text[];
  end if;

  if member_role = 'owner' then
    select coalesce(array_agg(t.id order by t.id), array[]::text[])
      into granted
      from public.teams t
     where t.tenant_id = p_tenant;
    return granted;
  end if;

  if not block_row.live or block_row.owner_only then
    return array[]::text[];
  end if;

  select coalesce(array_agg(mc.team_id order by mc.team_id), array[]::text[])
    into granted
    from public.member_calendars mc
    -- Архивный календарь сотруднику закрыт целиком (аудит 24.09).
    join public.teams t
      on t.tenant_id = mc.tenant_id
     and t.id = mc.team_id
     and t.is_active
    left join public.member_access ma
      on ma.tenant_id = mc.tenant_id
     and ma.user_id = mc.user_id
     and ma.block = block_row.key
     and ma.team_id = mc.team_id
   where mc.tenant_id = p_tenant
     and mc.user_id = p_user
     and array_position(array['off', 'read', 'write'], coalesce(ma.level, block_row.levels[1])) >= min_rank
     and (
       block_row.key = 'calendar.records'
       or array_position(array['read', 'write'], public.access_records_level(p_tenant, p_user, mc.team_id)) is not null
     );

  return granted;
end;
$function$;

create or replace function public.list_master_appointments_safe(p_offset integer default 0, p_limit integer default 1000)
 returns setof jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as materialized (
    select public.current_user_role()                        as role,
           public.current_tenant_id()                        as tenant_id,
           public.current_user_master_id()                   as master_id,
           public.current_user_team_ids()                    as legacy_team_ids,
           public.current_user_calendar_ids('view')          as granted_team_ids,
           public.access_calendars('record.client', 'read')   as client_teams,
           public.access_calendars('record.object', 'read')   as object_teams,
           public.access_calendars('record.services', 'read') as services_teams,
           public.access_calendars('record.amount', 'read')   as amount_teams,
           public.access_calendars('record.payment', 'read')  as payment_teams,
           public.access_calendars('calendar.events', 'read') as event_teams,
           public.access_calendars('record.label', 'read')    as label_teams
  )
  select jsonb_build_object(
    'id', a.id,
    'tenant_id', a.tenant_id,
    'client_id', case when v.see_client then a.client_id end,
    'team_id', a.team_id,
    'master_id', a.master_id,
    'location_id', case when v.see_object then a.location_id end,
    'date', a.date,
    'time_start', a.time_start,
    'time_end', a.time_end,
    'kind', a.kind,
    'status', a.status,
    'comment', a.comment,
    'address', case when v.see_object then a.address else '' end,
    'address_note', case when v.see_object then a.address_note else '' end,
    'address_lat', case when v.see_object then a.address_lat end,
    'address_lng', case when v.see_object then a.address_lng end,
    'cancel_reason', a.cancel_reason,
    'source', a.source,
    'is_online_booking', a.is_online_booking,
    'consent_given', a.consent_given,
    'color_override', a.color_override,
    -- Метка записи — по «Метка записи: Видит» (аудит 24.09: поле не
    -- приходило вовсе, и строка права ничего не открывала).
    'city', case when a.kind <> 'work' or a.team_id = any(me.label_teams) then a.city end,
    'reminder_enabled', a.reminder_enabled,
    'reminder_offsets', a.reminder_offsets,
    'reminder_template', a.reminder_template,
    'service_ids', case
      when v.see_services then coalesce(a.service_ids, '[]'::jsonb)
      else '[]'::jsonb
    end,
    'total_duration', a.total_duration,
    'created_by', a.created_by,
    'created_at', a.created_at,
    'updated_at', a.updated_at,
    'event_all_day', a.event_all_day,
    'event_notes', a.event_notes,
    'event_url', a.event_url,
    'event_push_enabled', a.event_push_enabled,
    'event_push_offsets', a.event_push_offsets,
    'event_push_at', a.event_push_at,
    'event_repeat', a.event_repeat,
    'total_amount', case when v.see_amount then coalesce(a.total_amount, 0) else 0 end,
    'custom_total', case when v.see_amount then coalesce(a.custom_total, false) else false end,
    'discount_amount', case when v.see_amount then coalesce(a.discount_amount, 0) else 0 end,
    'prepaid_amount', 0,
    'paid_amount', case
      when v.see_payment and v.see_amount then coalesce(a.paid_amount, 0)
      else 0
    end,
    'payment_status', case
      when v.see_payment then coalesce(a.payment_status, 'unpaid')
      else 'unpaid'
    end,
    'payment_method', null,
    'payments', '[]'::jsonb,
    'payment', null,
    'expenses', '[]'::jsonb,
    'services', case
      when not v.see_services or jsonb_typeof(a.services) is distinct from 'array'
        then '[]'::jsonb
      when v.see_amount then a.services
      else (
        select coalesce(jsonb_agg(
                 jsonb_strip_nulls(jsonb_build_object(
                   'serviceId', line -> 'serviceId',
                   'serviceName', line -> 'serviceName',
                   'quantity', line -> 'quantity',
                   'unit', line -> 'unit',
                   'duration', line -> 'duration',
                   'variantId', line -> 'variantId'
                 )) || '{"pricePerUnit": 0, "originalPrice": 0, "totalPrice": 0}'::jsonb
                 order by ord), '[]'::jsonb)
          from jsonb_array_elements(a.services) with ordinality as l(line, ord)
      )
    end,
    'service_price_overrides', '{}'::jsonb,
    'global_discount', null
  )
    from public.appointments a
    cross join me
    cross join lateral (
      select
        coalesce(a.kind <> 'work' or a.team_id = any(me.client_teams), false)   as see_client,
        coalesce(a.kind <> 'work' or a.team_id = any(me.object_teams), false)   as see_object,
        coalesce(a.kind <> 'work' or a.team_id = any(me.services_teams), false) as see_services,
        coalesce(a.kind <> 'work' or a.team_id = any(me.amount_teams), false)   as see_amount,
        coalesce(a.kind <> 'work' or a.team_id = any(me.payment_teams), false)  as see_payment
    ) v
   where me.role = 'master'
     and a.tenant_id = me.tenant_id
     -- Архивный календарь сотруднику не показывается (аудит 24.09).
     and exists (
       select 1 from public.teams t
        where t.tenant_id = a.tenant_id and t.id = a.team_id and t.is_active
     )
     and (
       (
         a.kind = 'work'
         -- Только прикреплённые календари (аудит 24.09): ветка «мастер записи»
         -- пускала к работе в календаре, от которого человека открепили.
         and (
           a.team_id = any(me.legacy_team_ids)
           or a.team_id = any(me.granted_team_ids)
         )
       )
       or (
         a.kind in ('event', 'personal')
         and a.team_id is not null
         -- STORY-088: события команды — по «События: Видит».
         and a.team_id = any(me.event_teams)
         and (
           a.team_id = any(me.legacy_team_ids)
           or a.team_id = any(me.granted_team_ids)
         )
       )
     )
   order by a.date, a.time_start, a.id
   offset greatest(coalesce(p_offset, 0), 0)
   limit greatest(1, least(coalesce(p_limit, 1000), 1000))
$function$;

-- Набор клиентов (`access_client_ids`) — внутреннее тело, вошедшим закрыт
-- (20260919230000). Политике чеков нужен его узкий срез: клиенты, чьи
-- контакты сотруднику открыты. Массив скалярным подзапросом не обернуть
-- (`= any ((select …))` ждёт строки, не массив) — политика берёт его
-- некоррелированным `in (select unnest(…))`, и он считается один раз.
create or replace function public.access_contact_client_ids()
returns uuid[]
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
    when public.access_company('clients.contacts', 'read') then public.access_client_ids()
    else array[]::uuid[]
  end
$function$;

comment on function public.access_contact_client_ids() is
  'Клиенты, чьи имя и телефон открыты вошедшему сотруднику: его набор при '
  '«Контакты: Видит», иначе пусто. Владельца пускают свои политики.';

revoke all on function public.access_contact_client_ids() from public, anon, authenticated, service_role;
grant execute on function public.access_contact_client_ids() to authenticated;

drop policy if exists receipts_read_own_money on public.receipts;
create policy receipts_read_own_money on public.receipts
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and transaction_id in (
      select ft.id from public.finance_transactions ft
       where ft.tenant_id = (select public.current_tenant_id())
    )
    -- Снимок клиента в чеке — имя и телефон: только тому, кому клиент и его
    -- контакты открыты (аудит 24.09).
    and (
      client_id is null
      or client_id in (select unnest(public.access_contact_client_ids()))
    )
  );

update public.access_blocks set levels = array['read', 'write'] where key = 'record.status';
update public.member_access set level = 'read' where block = 'record.status' and level = 'off';

do $audit$
begin
  if exists (select 1 from public.access_blocks where key = 'record.status' and 'off' = any(levels)) then
    raise exception 'record.status still offers off';
  end if;
  if has_function_privilege('anon', 'public.access_contact_client_ids()', 'execute') then
    raise exception 'access_contact_client_ids is callable by anon';
  end if;
  if position('is_active' in (select prosrc from pg_proc where proname = 'access_calendars_of')) = 0 then
    raise exception 'access_calendars_of does not check archived calendars';
  end if;
end
$audit$;
