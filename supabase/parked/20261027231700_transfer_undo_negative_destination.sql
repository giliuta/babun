-- Отмена перевода на счёт, который был в минусе (аудит 035, F-47).
--
-- `delete_account_transfer` пускал отмену, только если на счёте назначения
-- лежит не меньше суммы перевода. Счёт, бывший в минусе до перевода, этого
-- не проходит никогда: −50,25 + 260 = 209,75 < 260 — хотя из пришедших денег
-- не потрачено ни цента и отмена вернула бы счёт ровно туда, где он стоял.
--
-- Смысл сторожа — не дать отменить перевод, деньги которого уже потратили.
-- Поэтому порог теперь «ниже нуля и ниже остатка до перевода»: остаток до
-- перевода = начальный остаток + строки счёта, заведённые раньше перевода.
-- Счёт был в плюсе — порог 0, как раньше; был в минусе — отмена пускается,
-- пока после неё счёт не опускается ниже того минуса.
--
-- Правка — по якорю в ЖИВОМ теле функции: остальное тело (замки, права,
-- проверки целостности) не переписывается руками. Нет якоря — отказ всей
-- миграции. `create or replace` сохраняет права (authenticated, без anon).

do $migration$
declare
  definition text;
  old_check constant text := $old$  if destination_balance < request_row.amount then
    raise exception 'На счёте назначения уже недостаточно средств для отмены перевода';
  end if;$old$;
  new_check constant text := $new$  if destination_balance - request_row.amount < least(0, (
    select round(
      account.opening_balance + coalesce(sum(
        case
          when tx.type = 'expense' then -tx.amount
          when tx.type = 'refund' then -abs(tx.amount)
          else tx.amount
        end
      ) filter (where tx.created_at < request_row.created_at), 0),
      2
    )
    from public.accounts account
    left join public.finance_transactions tx on tx.account_id = account.id
    where account.id = request_row.to_account_id
    group by account.opening_balance
  )) then
    raise exception 'На счёте назначения уже недостаточно средств для отмены перевода';
  end if;$new$;
begin
  definition := pg_get_functiondef('public.delete_account_transfer(uuid)'::regprocedure);
  if position(old_check in definition) = 0 then
    raise exception 'delete_account_transfer: якорь проверки остатка не найден — тело изменилось, сверить вручную';
  end if;
  execute replace(definition, old_check, new_check);
  if position('filter (where tx.created_at < request_row.created_at)'
              in pg_get_functiondef('public.delete_account_transfer(uuid)'::regprocedure)) = 0 then
    raise exception 'delete_account_transfer: новая проверка не встала';
  end if;
  if has_function_privilege('anon', 'public.delete_account_transfer(uuid)', 'execute') then
    raise exception 'delete_account_transfer: открыта anon';
  end if;
end;
$migration$;
