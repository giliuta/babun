-- ВОЗВРАЩЁННАЯ ЗАПИСЬ СОХРАНЯЕТ ДЕНЬ СОЗДАНИЯ И НЕ ТРАТИТ КВОТУ МЕСЯЦА.
--
-- «Вернуть» (и «Отменить» в тосте удаления — та же дверь) вставляет запись из
-- «Удалённых записей» обратно с тем же id. Сторож квоты на любой вставке
-- ставил `created_at := statement_timestamp()`, и возвращённый визит
-- становился созданным сегодня: история клиента клала оплату прошлого визита
-- на день визита (`appointment_history_entry_date` сравнивает момент ввода с
-- `created_at`), расписание SMS пропускало напоминание как «запись создана
-- позже срока» (`sms_enqueue_due`), а квота месяца тратилась второй раз.
--
-- Теперь вставка «Вернуть» оставляет `created_at` снимка и квоту не трогает.
-- Узнаётся она по флагу дверей ящика `babun.appointment_restore` И по снимку:
-- в ящике лежит строка с тем же id, той же компанией и тем же `created_at`.
-- Поставить флаг своей транзакцией можно, но задним числом этим ничего не
-- создать: время обязано совпасть со снимком той же записи, а снимок пишет
-- только триггер удаления.
--
-- Правка — точечная замена в живом теле, якорь ровно один раз.

set local lock_timeout = '5s';

do $patch$
declare
  fn constant regprocedure := 'public.enforce_tenant_insert_quota()'::regprocedure;
  body text := pg_get_functiondef(fn);
  anchor constant text := E'    new.created_at := statement_timestamp();\n';
  replacement constant text := E'    -- «Вернуть» из «Удалённых записей» — та же запись, а не новая: день\n'
    || E'    -- создания и квоту месяца она уже имеет. Узнаётся по флагу дверей ящика\n'
    || E'    -- и по снимку той же записи с тем же `created_at` — задним числом так\n'
    || E'    -- ничего не создать.\n'
    || E'    if coalesce(current_setting(''babun.appointment_restore'', true), '''') = ''on''\n'
    || E'       and exists (\n'
    || E'         select 1 from public.deleted_appointments d\n'
    || E'          where d.id = new.id\n'
    || E'            and d.tenant_id = new.tenant_id\n'
    || E'            and (d.appointment->>''created_at'')::timestamptz = new.created_at\n'
    || E'       ) then\n'
    || E'      return new;\n'
    || E'    end if;\n'
    || anchor;
begin
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'enforce_tenant_insert_quota: якорь штампа created_at не найден ровно один раз';
  end if;
  execute replace(body, anchor, replacement);
end
$patch$;

do $guard$
declare
  fn_src text;
  fn_secdef boolean;
begin
  select prosrc, prosecdef into fn_src, fn_secdef
    from pg_proc where oid = 'public.enforce_tenant_insert_quota()'::regprocedure;
  if position('babun.appointment_restore' in fn_src) = 0
     or position('new.created_at := statement_timestamp();' in fn_src) = 0
     or position('babun.appointment_restore' in fn_src) > position('new.created_at := statement_timestamp();' in fn_src) then
    raise exception 'сторож: ветка «Вернуть» не стоит до штампа created_at';
  end if;
  if not fn_secdef then
    raise exception 'сторож: enforce_tenant_insert_quota потеряла security definer';
  end if;
end
$guard$;
