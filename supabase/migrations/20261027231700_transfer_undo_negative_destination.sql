-- Отмена перевода не упирается в остаток получателя (аудит 035, F-47).
--
-- `delete_account_transfer` пускал отмену, только если на счёте назначения
-- лежит не меньше суммы перевода. Счёт, бывший в минусе до перевода, этого
-- не проходил никогда: −50,25 + 260 = 209,75 < 260 — перевод оставался навсегда.
--
-- Правило продукта: минус на счёте разрешён всем. Расход уводит счёт в минус
-- без отказа, а отмена перевода для счёта-получателя — то же самое, что ещё
-- один расход на эту сумму. Поэтому отказ снят целиком; уход в минус приложение
-- называет до подтверждения, теми же словами, что у расхода
-- (`account-alerts.ts`, `minusWarning`).
--
-- Правка — по якорю в ЖИВОМ теле функции: остальное тело (замки, права,
-- проверки целостности) не переписывается руками. Нет якоря — отказ всей
-- миграции. `create or replace` сохраняет права (authenticated, без anon).
-- Подсчёт `destination_balance` остаётся в теле: он больше ничего не решает,
-- а вырезать его по якорю — второй шанс промахнуться мимо живого текста.

do $migration$
declare
  definition text;
  old_check constant text := $old$  if destination_balance < request_row.amount then
    raise exception 'На счёте назначения уже недостаточно средств для отмены перевода';
  end if;
$old$;
begin
  definition := pg_get_functiondef('public.delete_account_transfer(uuid)'::regprocedure);
  if position(old_check in definition) = 0 then
    raise exception 'delete_account_transfer: якорь проверки остатка не найден — тело изменилось, сверить вручную';
  end if;
  execute replace(definition, old_check, '');
  if position('недостаточно средств для отмены перевода'
              in pg_get_functiondef('public.delete_account_transfer(uuid)'::regprocedure)) > 0 then
    raise exception 'delete_account_transfer: отказ по остатку остался';
  end if;
  if has_function_privilege('anon', 'public.delete_account_transfer(uuid)', 'execute') then
    raise exception 'delete_account_transfer: открыта anon';
  end if;
end;
$migration$;
