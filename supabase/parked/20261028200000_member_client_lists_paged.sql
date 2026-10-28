-- СПИСОК КЛИЕНТОВ ПАРТНЁРА И МАСТЕРА — СТРАНИЦАМИ (035, «Страница клиентов», Н4).
--
-- `list_member_clients` и `list_master_clients_safe` отдают SETOF jsonb одним
-- ответом, а PostgREST режет любой ответ на `max_rows` = 1000 и молчит о
-- срезанном. У партнёра и мастера с базой больше тысячи клиентов (перенос из
-- Bumpix — ≈2 200) список молча кончался на тысячной строке: клиента «нет»,
-- поиск его не находит, запись на него не заводится.
--
-- Теперь у обоих окон — `p_offset` / `p_limit`, как у
-- `list_master_appointments_safe`; приложение читает страницами по 1000
-- (`queries/member-reads.ts`). Порядок был и остаётся `full_name, id` —
-- устойчивый, страницы не повторяют и не теряют строк.
--
-- СТАРЫЕ СБОРКИ НЕ ЛОМАЮТСЯ: оба новых параметра со значением по умолчанию
-- (0 и «без предела»), вызов `{ p_client_id }` или без аргументов работает как
-- раньше. Перегрузку рядом не держим — PostgREST не выбрал бы между двумя
-- функциями с одинаковым `p_client_id` («could not choose the best candidate»),
-- поэтому прежняя подпись снимается в той же транзакции.
--
-- ЖУРНАЛ ВЫДАЧИ (`client_list_disclosures`) — строкой на страницу с её
-- числом клиентов: сумма по страницам — вся выдача. Карточка одного клиента
-- (`p_client_id`) по-прежнему не пишется.
--
-- Тело `list_master_clients_safe` — с боевой (md5 prosrc d3b24db0…), меняется
-- только хвост: `offset` / `limit`. Тело `list_member_clients_rows` не
-- меняется.

drop function if exists public.list_member_clients(uuid);

create or replace function public.list_member_clients(
  p_client_id uuid default null,
  p_offset integer default 0,
  p_limit integer default null
)
returns setof jsonb
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  given integer;
begin
  return query
    select x
      from public.list_member_clients_rows(p_client_id) x
    offset greatest(coalesce(p_offset, 0), 0)
     limit p_limit;
  get diagnostics given = row_count;
  -- Пустая страница за последней (число клиентов кратно странице) — не выдача.
  if p_client_id is null and (given > 0 or coalesce(p_offset, 0) = 0)
     and public.current_user_role() is distinct from 'owner' and auth.uid() is not null then
    insert into public.client_list_disclosures (tenant_id, user_id, clients_count)
    values (public.current_tenant_id(), auth.uid(), given);
  end if;
end;
$function$;

revoke all on function public.list_member_clients(uuid, integer, integer) from public, anon;
grant execute on function public.list_member_clients(uuid, integer, integer) to authenticated;

comment on function public.list_member_clients(uuid, integer, integer) is
  'Клиенты партнёра (тело — list_member_clients_rows), страницами p_offset/p_limit; выдача каждой страницы пишется в client_list_disclosures.';

drop function if exists public.list_master_clients_safe(uuid);

create or replace function public.list_master_clients_safe(
  p_client_id uuid default null,
  p_offset integer default 0,
  p_limit integer default null
)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $function$
  with me as materialized (
    select public.current_tenant_id() as tenant_id,
           public.current_user_role() as role,
           public.current_user_master_id() as master_id,
           public.current_user_team_ids() as team_ids
  ),
  client_teams as materialized (
    select public.access_calendars('record.client', 'read') as ids
  ),
  contact_sets as materialized (
    select public.access_contact_client_ids() as open_ids,
           public.access_client_ids() as visible_ids,
           public.tenant_business_date(public.current_tenant_id()) as today,
           public.member_record_window_starts() as window_starts
  )
  select jsonb_build_object(
    'id', c.id,
    'tenant_id', c.tenant_id,
    'full_name', c.full_name,
    -- Номер открыт сразу, когда блок «Клиент» он видит; иначе пусто.
    'phone', case when c.id = any(cs.open_ids) then c.phone else '' end,
    'created_at', c.created_at,
    'contacts_hidden', case
      when c.id = any(cs.open_ids) then null
      else 'right'
    end
  )
    from public.clients c
   cross join client_teams ct
   cross join contact_sets cs
   cross join me
   where me.role = 'master'
     and c.tenant_id = me.tenant_id
     and c.deleted_at is null
     and (p_client_id is null or c.id = p_client_id)
     and exists (
       select 1
         from public.appointments a
        where a.tenant_id = c.tenant_id
          and a.client_id = c.id
          and a.kind = 'work'
          and (a.master_id = me.master_id or a.team_id = any(me.team_ids))
     )
     -- Клиент записи, которую он видит: из видимой записи карточка
     -- открывается всегда.
     and exists (
       select 1
         from public.appointments a
        where a.tenant_id = c.tenant_id
          and a.client_id = c.id
          and a.kind = 'work'
          and a.team_id = any(ct.ids)
     )
     -- «Около записи» (защита базы): имя клиента мастер видит, пока клиент в
     -- окне записи этой команды, либо если клиент открыт ему правом «Клиенты»
     -- (набор `access_client_ids`), либо он завёл его сам, либо это клиент
     -- записи, которую он сам завёл, — так же, как клиент записи в
     -- `list_master_appointments_safe`. Иначе клиент другой команды на его же
     -- записи через неделю стоял бы без имени. Прошедшая запись старше окна
     -- «Ограничения» имени не открывает.
     and (
       c.id = any(cs.visible_ids)
       or c.created_by = auth.uid()
       or exists (
         select 1
           from public.appointments a
          where a.tenant_id = c.tenant_id
            and a.client_id = c.id
            and a.kind = 'work'
            and a.team_id = any(ct.ids)
            and a.status is distinct from 'cancelled'
            and a.date between (cs.today - 7)::text and (cs.today + 1)::text
       )
       or exists (
         select 1
           from public.appointments a
          where a.tenant_id = c.tenant_id
            and a.client_id = c.id
            and a.kind = 'work'
            and a.team_id = any(ct.ids)
            and a.created_by = auth.uid()
            and a.date >= coalesce(cs.window_starts ->> a.team_id, '')
       )
     )
   order by c.full_name, c.id
  offset greatest(coalesce(p_offset, 0), 0)
   limit p_limit
$function$;

revoke all on function public.list_master_clients_safe(uuid, integer, integer) from public, anon;
grant execute on function public.list_master_clients_safe(uuid, integer, integer) to authenticated;
