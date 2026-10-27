-- СПИСОК КЛИЕНТОВ ЗАПИСЕЙ У ПАРТНЁРА — «КТО Я» СЧИТАЕТСЯ ОДИН РАЗ
-- (аудит 035, srv/B-07).
--
-- `list_master_clients_safe` — самая медленная функция базы: в среднем
-- 114 мс, до 1 с, при 46 клиентах компании (`pg_stat_statements`, 684 вызова).
-- Главная причина — CTE `contact_sets` и `client_teams`: Postgres встраивает
-- CTE, на который ссылаются один раз, поэтому `access_contact_client_ids()`
-- (~18 мс) и соседние наборы считались на КАЖДОЙ строке клиента, по два-три
-- раза. `MATERIALIZED` заставляет посчитать их один раз. Второе —
-- `current_user_can_access_client(c.id)` на каждого клиента: внутри неё на
-- каждую его запись снова считались `current_tenant_id()`,
-- `current_user_role()`, `current_user_master_id()` и `current_user_team_ids()`.
--
-- Смысл не меняется: мастер компании видит клиента, у которого есть рабочая
-- запись его карточки мастера или его команды, — ровно условие
-- `current_user_can_access_client` для роли `master` (роль и компания здесь
-- уже проверены). Только «кто я» (компания, роль, карточка, команды)
-- считается один раз в CTE `me`. Прогон с откатом у обоих партнёров боевой
-- базы: ответ до и после совпал построчно (md5), у партнёра с 43 клиентами
-- вызов стал 21 мс вместо 872 мс.
--
-- Тело правится по якорям в живом определении.

do $migration$
declare
  d text := pg_get_functiondef('public.list_master_clients_safe(uuid)'::regprocedure);
  a1 constant text := E'  with client_teams as (\n';
  b1 constant text := E'  with me as materialized (\n'
    || E'    select public.current_tenant_id() as tenant_id,\n'
    || E'           public.current_user_role() as role,\n'
    || E'           public.current_user_master_id() as master_id,\n'
    || E'           public.current_user_team_ids() as team_ids\n'
    || E'  ),\n'
    || E'  client_teams as materialized (\n';
  a2 constant text := E'   cross join contact_sets cs\n   where public.current_user_role() = ''master''\n     and c.tenant_id = public.current_tenant_id()\n';
  b2 constant text := E'   cross join contact_sets cs\n   cross join me\n   where me.role = ''master''\n     and c.tenant_id = me.tenant_id\n';
  a3 constant text := E'     and public.current_user_can_access_client(c.id)\n';
  a4 constant text := E'  contact_sets as (\n';
  b4 constant text := E'  contact_sets as materialized (\n';
  b3 constant text := E'     and exists (\n'
    || E'       select 1\n'
    || E'         from public.appointments a\n'
    || E'        where a.tenant_id = c.tenant_id\n'
    || E'          and a.client_id = c.id\n'
    || E'          and a.kind = ''work''\n'
    || E'          and (a.master_id = me.master_id or a.team_id = any(me.team_ids))\n'
    || E'     )\n';
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1
     or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1
     or (length(d) - length(replace(d, a3, ''))) / length(a3) <> 1
     or (length(d) - length(replace(d, a4, ''))) / length(a4) <> 1 then
    raise exception 'list_master_clients_safe: якоря не найдены ровно по одному разу';
  end if;
  execute replace(replace(replace(replace(d, a1, b1), a2, b2), a3, b3), a4, b4);
end;
$migration$;
