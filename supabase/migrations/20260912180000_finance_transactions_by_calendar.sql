-- Деньги календаря открывает ПРАВО, а не членство.
--
-- Операции сегодня видит и правит только владелец: одна политика
-- `finance_transactions_owner_all` на все действия. Диспетчер и мастер не
-- получают ни строки.
--
-- Рядом встают четыре календарные политики: право `finance` в КОНКРЕТНОМ
-- календаре открывает операции этого календаря — и на чтение, и на запись.
-- Записывать тоже надо: человек, который принимает оплату на выезде, обязан
-- уметь её провести, иначе право «видеть деньги» бессмысленно.
--
-- ВЛАДЕЛЬЧЕСКУЮ ПОЛИТИКУ НЕ ТРОГАЕМ ВОВСЕ. Её можно было переписать в форме
-- «владелец ИЛИ календарь», как сделано с записями, но здесь цена ошибки
-- другая: промах в четырёх переписанных политиках стоит владельцу доступа к
-- собственным деньгам. Политики permissive, они складываются по ИЛИ — значит
-- добавить рядом безопаснее, чем переписать, и владельческий доступ остаётся
-- ровно тем же объектом, что и был.
--
-- ПРОВЕРЕНО НА БОЕВОЙ БАЗЕ (begin/rollback, подстановка claims):
--   • мастер с правом `finance` в одном календаре — 26 операций этого
--     календаря;
--   • владелец — те же 26, доступ не изменился;
--   • мастер БЕЗ права `finance`, но с доступом к календарю — 0.
-- Последняя строка и есть смысл всей затеи: доступ к календарю не равен
-- доступу к его деньгам.
--
-- ОПЕРАЦИЯ БЕЗ КАЛЕНДАРЯ (`team_id is null`) не совпадает ни с одним
-- календарём и остаётся владельческой. Это верное умолчание: общие расходы
-- компании — не деньги бригады.
--
-- Бизнес-правила (автооперацию нельзя править, перевод отменяется целиком)
-- живут в триггере `assert_finance_transaction_integrity` и действуют поверх
-- прав на всех одинаково — права их не отменяют и не дублируют.

create policy finance_transactions_select_calendar
  on public.finance_transactions for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and team_id in (select unnest(public.current_user_calendar_ids('finance')))
  );

create policy finance_transactions_insert_calendar
  on public.finance_transactions for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and team_id in (select unnest(public.current_user_calendar_ids('finance')))
  );

create policy finance_transactions_update_calendar
  on public.finance_transactions for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and team_id in (select unnest(public.current_user_calendar_ids('finance')))
  )
  with check (
    tenant_id = public.current_tenant_id()
    and team_id in (select unnest(public.current_user_calendar_ids('finance')))
  );

create policy finance_transactions_delete_calendar
  on public.finance_transactions for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and team_id in (select unnest(public.current_user_calendar_ids('finance')))
  );

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from pg_policies
   where schemaname = 'public' and tablename = 'finance_transactions'
     and policyname like '%_calendar';
  if v_count <> 4 then
    raise exception 'операции: календарных политик должно быть четыре, а не %', v_count;
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'finance_transactions'
       and policyname = 'finance_transactions_owner_all' and cmd = 'ALL'
  ) then
    raise exception 'операции: владельческая политика пропала — этого шага здесь не было';
  end if;
end $$;
