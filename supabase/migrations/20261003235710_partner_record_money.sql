-- ДЕНЬГИ В ЗАПИСИ У ПАРТНЁРА (аудит сессии 017, 03.10; права — сессия 016).
--
-- 1. «ОПЛАТА В ЗАПИСИ: МЕНЯЕТ» НЕ РАБОТАЛА НИКОГДА. Пять денежных дверей
--    записи (`record_appointment_payment`, `cancel_appointment_payment`,
--    `set_appointment_prepayment`, `reset_appointment_payment`,
--    `undo_appointment_payment`) — SECURITY DEFINER и сами проверяют право
--    (`current_user_can_pay_appointment`, миграция 20260920221952). Но
--    запись в `appointments` они делают без пропуска сторожа колонок
--    (`appointments_master_column_guard`): тот пускает правку партнёра только
--    с флагом транзакции `babun.member_write` изнутри definer-функции. Итог:
--    плитка оплаты у партнёра зеленела и откатывалась с «master role can only
--    update status and comment on work appointments» (прогон в откате 017:
--    `current_user_can_pay_appointment` → true, оплата → отказ сторожа).
--    Теперь каждая из пяти дверей ставит флаг в начале тела. Это безопасно:
--    флаг действует только внутри definer-функции (сторож требует
--    `current_user <> 'authenticated'`), а колонки, которые трогает дверь,
--    решает сама дверь после своей проверки права. Отказ дальше откатывает
--    всю транзакцию вместе с флагом.
--
-- 2. СКИДКА И VAT В ЗАПИСИ ПАРТНЁРА. Список записей сотрудника
--    (`list_master_appointments_safe`) отдавал `global_discount` пустым,
--    `service_price_overrides` — пустым объектом, а `vat_mode` / `vat_rate`
--    не отдавал вовсе. У партнёра с «Сумма: Видит» «Итого» расходилось с
--    записью («Итог изменился — сохраните» в «Оплате»), а с «Сумма: Меняет»
--    сохранение СТИРАЛО скидку записи: форма отправляла пустую. Теперь эти
--    поля приходят по тому же правилу, что сумма (`see_amount`).
--
-- ПРАВКА ЖИВЫХ ТЕЛ ПО ЯКОРЮ: тело берётся из базы, сверяется md5 (03.10),
-- меняется ровно один фрагмент. Тело поменяли с тех пор — миграция падает,
-- а не затирает чужое.

set local lock_timeout = '5s';

-- ─── 1. Пять денежных дверей записи — с пропуском сторожа ───

do $migration$
declare
  target record;
  expected text;
  def text;
  body_start integer;
  flag constant text := $flag$  -- Пропуск сторожа колонок записи (03.10): право на деньги проверяет
  -- сама дверь ниже, а сторож пускает партнёра только с этим флагом.
  perform set_config('babun.member_write', 'on', true);
$flag$;
begin
  for target in
    select p.oid::regprocedure as fn, p.proname, md5(p.prosrc) as sum
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('record_appointment_payment', 'cancel_appointment_payment',
                         'set_appointment_prepayment', 'reset_appointment_payment',
                         'undo_appointment_payment')
  loop
    -- Ожидаемая сумма — переменной: THEN из CASE внутри IF обрывал условие.
    expected := case target.proname
         when 'record_appointment_payment' then '441bc01bea5e1ee6c303f4f622670e31'
         when 'cancel_appointment_payment' then '05641608d187083203faae033cf477d8'
         when 'set_appointment_prepayment' then '0012d02c4412abf174ea0c13aa233961'
         when 'reset_appointment_payment' then '8c6ec4d7523ba9752c3a760552adfb54'
         when 'undo_appointment_payment' then 'a648041057f2e176dbc1fc74c707a96c'
       end;
    if target.sum is distinct from expected then
      raise exception '% изменилась после аудита 03.10 — перечитать тело перед правкой', target.fn;
    end if;
    def := pg_get_functiondef(target.fn);
    -- Первое «begin» тела — после «$function$» и блока declare.
    body_start := position(E'\nbegin\n' in substr(def, position('$function$' in def)));
    if body_start = 0 then
      raise exception '% — начало тела не найдено', target.fn;
    end if;
    body_start := position('$function$' in def) + body_start - 1 + length(E'\nbegin\n');
    execute overlay(def placing flag from body_start for 0);
  end loop;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('record_appointment_payment', 'cancel_appointment_payment',
                           'set_appointment_prepayment', 'reset_appointment_payment',
                           'undo_appointment_payment')
         and position('babun.member_write' in p.prosrc) > 0) <> 5 then
    raise exception 'сторож: не все пять денежных дверей получили пропуск';
  end if;
end
$migration$;

-- ─── 2. Скидка, цены услуг и VAT записи — партнёру по «Сумме» ───

do $migration$
declare
  fn regprocedure := 'public.list_master_appointments_safe(integer, integer)'::regprocedure;
  def text;
  old_part text := $old$    'service_price_overrides', '{}'::jsonb,
    'global_discount', null$old$;
  new_part text := $new$    -- Скидка, цены услуг и VAT — по тому же правилу, что сумма (03.10):
    -- пустыми они расходились с «Итого», а сохранение стирало скидку.
    'service_price_overrides', case
      when v.see_amount then coalesce(a.service_price_overrides, '{}'::jsonb)
      else '{}'::jsonb
    end,
    'global_discount', case when v.see_amount then a.global_discount end
  -- VAT — второй сборкой: в первой уже 100 аргументов, больше Postgres не
  -- принимает (прогон в откате 03.10).
  ) || jsonb_build_object(
    'vat_mode', case when v.see_amount then a.vat_mode end,
    'vat_rate', case when v.see_amount then a.vat_rate end$new$;
begin
  if (select md5(prosrc) from pg_proc where oid = fn) <> 'e95e60efe1888e5973bce4336ea2a2d5' then
    raise exception 'list_master_appointments_safe изменилась после аудита 03.10 — перечитать тело перед правкой';
  end if;
  def := pg_get_functiondef(fn);
  if (length(def) - length(replace(def, old_part, ''))) / length(old_part) <> 1 then
    raise exception 'скидка и цены услуг не найдены ровно один раз';
  end if;
  execute replace(def, old_part, new_part);
end
$migration$;

-- ─── 3. Сторож ───

do $guard$
begin
  -- `create or replace` права исполнения не меняет — сверяем, что остались.
  if has_function_privilege('anon', 'public.list_master_appointments_safe(integer, integer)', 'execute') then
    raise exception 'сторож: список записей сотрудника открылся anon';
  end if;
  if position($q$'vat_rate'$q$ in (select prosrc from pg_proc
       where oid = 'public.list_master_appointments_safe(integer, integer)'::regprocedure)) = 0 then
    raise exception 'сторож: VAT записи партнёру не отдаётся';
  end if;
end
$guard$;
