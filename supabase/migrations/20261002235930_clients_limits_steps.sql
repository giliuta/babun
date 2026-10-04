-- «ОГРАНИЧЕНИЯ» — ШЕСТЬ ШАГОВ (владелец 02.10, вариант 1 из трёх).
--
-- «Отрисовываться только двумя неделями или месяцем маловато, надо продумать,
-- чтоб оно максимально удобно было» — выбран вариант «Шагами, одним тапом»:
-- Неделя · 2 недели · Месяц · 3 месяца · Полгода · Без ограничения. Окно
-- одно назад и вперёд и едет вместе с днём: клиент команды виден, если у него
-- есть неотменённая запись этой команды не дальше выбранного срока до или
-- после сегодня. «Без ограничения» — все клиенты команды.
--
-- Новые ступени `clients.scope`: `week`, `quarter`, `half` (прежние `near` —
-- «2 недели», `month`, `own` — на своих местах). Умолчание — первая ступень
-- реестра, самая узкая: «Неделя» (`access_team_level` берёт `levels[1]`), и
-- `access_client_ids_in` считает неизвестное так же.
--
-- Тело `access_client_ids_in` снято с боевой базы 02.10 (md5 3d40248b…, из
-- `20261002235800_clients_team_base_time_limit`): окна по ступеням собраны в
-- одну таблицу сроков. `create or replace` права исполнения не трогает.

update public.access_blocks
   set levels = array['week', 'near', 'month', 'quarter', 'half', 'own'],
       title_ru = 'Ограничения'
 where key = 'clients.scope';

create or replace function public.access_client_ids_in(p_teams text[])
 returns uuid[]
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid := public.current_tenant_id();
  today date;
begin
  if caller is null or active_tenant is null or coalesce(cardinality(p_teams), 0) = 0 then
    return array[]::uuid[];
  end if;

  today := public.tenant_business_date(active_tenant);

  -- 02.10: «только база клиентов, которая закреплена за командой, к которой
  -- у него есть доступ» — клиент с командой из открытых ему. «Ограничения»:
  -- «Без ограничения» — все клиенты команды; остальные ступени — клиент
  -- команды с неотменённой записью этой команды в окне до и после сегодня;
  -- неизвестное — самое узкое, «Неделя».
  return coalesce((
    with lv as (
      select t.team_id,
             coalesce(public.access_team_level(active_tenant, caller, 'clients.scope', t.team_id), 'week') as level
        from unnest(p_teams) as t(team_id)
    ),
    win as (
      select lv.team_id,
             case lv.level
               when 'near' then interval '14 days'
               when 'month' then interval '1 month'
               when 'quarter' then interval '3 months'
               when 'half' then interval '6 months'
               else interval '7 days'
             end as span
        from lv
       where lv.level not in ('own', 'all')
    )
    select array_agg(c.id order by c.id)
      from public.clients c
     where c.tenant_id = active_tenant
       and c.deleted_at is null
       and (
         c.team_id in (select lv.team_id from lv where lv.level in ('own', 'all'))
         or exists (
           select 1
             from win w
             join public.appointments a
               on a.tenant_id = active_tenant
              and a.client_id = c.id
              and a.team_id = w.team_id
            where w.team_id = c.team_id
              and a.status is distinct from 'cancelled'
              and a.date between (today - w.span)::date::text and (today + w.span)::date::text
         )
       )
  ), array[]::uuid[]);
end;
$function$;
