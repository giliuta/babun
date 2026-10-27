-- Счёт без единой операции удаляется (и закрывается) при любом стартовом
-- остатке.
--
-- `account_trash_rules` пускал удаление, а `guard_account_financial_history` —
-- закрытие (удаление счёт тоже закрывает) только с нулём на счёте и считали в
-- нём стартовый остаток. Счёт, заведённый с ненулевым стартом и ни разу не
-- тронутый, не удалялся никак: правки стартового остатка в листе счёта нет, а
-- обнулить его можно только деньгами — приходом или переводом, то есть
-- выдуманными операциями. Стартовый остаток — настройка счёта, а не деньги:
-- без операций сторожу остатка охранять нечего.
--
-- Счёт с операциями — по-прежнему только с нулём (деньги не пропадают из
-- общего остатка молча). Срок в «Удалённых» не меняется: без истории — 30 дней
-- (`account_has_history`).
--
-- Правка — по якорю в ЖИВЫХ телах обеих триггерных функций: остальное тело
-- не переписывается руками. Нет якоря — отказ всей миграции.

do $migration$
declare
  definition text;
  old_check constant text := $old$    if ledger_balance <> 0 then
      raise exception 'Счёт с остатком % нельзя удалить; сначала обнулите его', ledger_balance$old$;
  new_check constant text := $new$    if ledger_balance <> 0
       and exists (select 1 from public.finance_transactions t where t.account_id = old.id) then
      raise exception 'Счёт с остатком % нельзя удалить; сначала обнулите его', ledger_balance$new$;
begin
  definition := pg_get_functiondef('public.account_trash_rules()'::regprocedure);
  if position(old_check in definition) = 0 then
    raise exception 'account_trash_rules: якорь проверки остатка не найден — тело изменилось, сверить вручную';
  end if;
  execute replace(definition, old_check, new_check);
  if position('and exists (select 1 from public.finance_transactions t where t.account_id = old.id)'
              in pg_get_functiondef('public.account_trash_rules()'::regprocedure)) = 0 then
    raise exception 'account_trash_rules: правка не легла';
  end if;
end;
$migration$;

do $migration$
declare
  definition text;
  old_check constant text := $old$    if ledger_balance <> 0 then
      raise exception 'Счёт с остатком % нельзя закрыть; сначала обнулите его', ledger_balance;$old$;
  new_check constant text := $new$    if ledger_balance <> 0
       and exists (select 1 from public.finance_transactions t where t.account_id = old.id) then
      raise exception 'Счёт с остатком % нельзя закрыть; сначала обнулите его', ledger_balance;$new$;
begin
  definition := pg_get_functiondef('public.guard_account_financial_history()'::regprocedure);
  if position(old_check in definition) = 0 then
    raise exception 'guard_account_financial_history: якорь проверки остатка не найден — тело изменилось, сверить вручную';
  end if;
  execute replace(definition, old_check, new_check);
  if position('and exists (select 1 from public.finance_transactions t where t.account_id = old.id)'
              in pg_get_functiondef('public.guard_account_financial_history()'::regprocedure)) = 0 then
    raise exception 'guard_account_financial_history: правка не легла';
  end if;
end;
$migration$;
