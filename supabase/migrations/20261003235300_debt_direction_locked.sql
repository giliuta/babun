-- ДОЛГ С ПЛАТЕЖАМИ НЕ МЕНЯЕТ НАПРАВЛЕНИЕ (проверка системы 03.10).
--
-- Лист долга давал перевернуть «Мне должны» ↔ «Я должен» у долга, по
-- которому уже прошли платежи. Платежи — операции `finance_transactions`
-- с `debt_id`, и их знак остаётся прежним: приход по долгу клиента после
-- переворота засчитывался в погашение НАШЕГО долга, остаток и счета
-- расходились. Экран теперь гасит переключатель; здесь — та же граница на
-- сервере, для старых телефонов и прямых запросов.

set local lock_timeout = '5s';

create or replace function public.debts_direction_locked()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.direction is distinct from old.direction
     and exists (select 1 from public.finance_transactions f where f.debt_id = old.id) then
    raise exception 'По долгу уже есть платежи — направление не меняется'
      using errcode = '23514', hint = 'debt:direction_locked';
  end if;
  return new;
end;
$$;

revoke all on function public.debts_direction_locked() from public, anon;

drop trigger if exists debts_direction_locked on public.debts;
create trigger debts_direction_locked
  before update of direction on public.debts
  for each row execute function public.debts_direction_locked();
