-- ИНВОЙСЫ И КРЕДИТ-НОТЫ СНОВА ВЫСТАВЛЯЮТСЯ (аудит 2026-10-03, найдено прогоном).
--
-- Сторож тарифа enforce_plan_limits висит на appointments, clients, services,
-- masters, receipts, invitations, teams и INVOICES. Ветка тарифов 02.10
-- («команда сверх лимита — только для просмотра») проверяет
--   tg_table_name in ('appointments', 'clients') and new.team_id is not null …
-- PL/pgSQL разбирает это выражение целиком, раньше проверки имени таблицы, а у
-- invoices колонки team_id нет (команда там — brigade_id). Итог: ЛЮБАЯ вставка
-- в invoices падает с «record "new" has no field "team_id"» — ни инвойс, ни
-- кредит-ноту (отмену инвойса) выставить нельзя с 02.10. Последний инвойс в
-- базе — 22.09. Прогон в откате на боевой 03.10: issue_invoice падал именно
-- так; после правки — проходит.
--
-- ПРАВКА ОДНОГО ВЫРАЖЕНИЯ ЖИВОГО ТЕЛА: тело берётся из базы, сверяется md5
-- (c7f705ed…, 03.10), меняется ровно одно условие — team_id читается через
-- to_jsonb(new), который есть у любой строки. Тело поменяли с тех пор —
-- миграция падает, а не затирает чужое.

do $migration$
declare
  fn regprocedure := 'public.enforce_plan_limits()'::regprocedure;
  def text;
  old_cond text := $old$  if tg_table_name in ('appointments', 'clients')
     and new.team_id is not null
     and not public.team_is_working(new.tenant_id, new.team_id) then$old$;
  new_cond text := $new$  -- `team_id` есть не у каждой таблицы этого сторожа (у инвойса команда —
  -- `brigade_id`): PL/pgSQL разбирает выражение целиком до проверки имени
  -- таблицы, и `new.team_id` ронял любую вставку инвойса (аудит 03.10).
  if tg_table_name in ('appointments', 'clients')
     and (to_jsonb(new) ->> 'team_id') is not null
     and not public.team_is_working(new.tenant_id, to_jsonb(new) ->> 'team_id') then$new$;
begin
  if (select md5(prosrc) from pg_proc where oid = fn) <> 'c7f705edd6edb6f63310001801ef3f49' then
    raise exception 'enforce_plan_limits изменилась после аудита 03.10 — перечитать тело перед правкой';
  end if;
  def := pg_get_functiondef(fn);
  if (length(def) - length(replace(def, old_cond, ''))) / length(old_cond) <> 1 then
    raise exception 'условие «команда сверх лимита» не найдено ровно один раз';
  end if;
  execute replace(def, old_cond, new_cond);
end
$migration$;
