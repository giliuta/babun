-- ДОХОД С ВОЗВРАТОМ ДЕРЖИТ СВОЙ СЧЁТ — НА СЕРВЕРЕ (аудит 2026-10-03).
--
-- Возврат лежит на счёте своего дохода. Сумму дохода ниже возвращённого
-- сервер уже не пускает (сторож целостности: «По этому доходу уже
-- возвращено …»), а СМЕНУ СЧЁТА у такого дохода — пускал: доход €100
-- «Наличные», возврат −€30 там же; доход переводят на «Карту» (со способом
-- оплаты по виду счёта) — касса −€30, «Карта» +€100, возврат остаётся на
-- чужом счёте и способе. Сверено прогоном в откате на боевой 03.10. Экран
-- это уже не предлагает (36df6d2a), но граница должна стоять у базы.
--
-- Отдельный маленький триггер, а не правка большого сторожа целостности:
-- чужие тела не переписываются. Прочие правки дохода он не трогает.

create or replace function public.guard_income_with_refunds()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if old.type is distinct from 'income'
     or new.account_id is not distinct from old.account_id then
    return new;
  end if;
  if exists (
    select 1
      from public.finance_transactions r
     where r.refund_of_id = old.id
       and r.tenant_id = old.tenant_id
  ) then
    raise exception 'По доходу есть возврат — счёт не сменить: сначала удалите возврат'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

revoke execute on function public.guard_income_with_refunds() from public, anon, authenticated;

drop trigger if exists trg_guard_income_with_refunds on public.finance_transactions;
create trigger trg_guard_income_with_refunds
  before update on public.finance_transactions
  for each row execute function public.guard_income_with_refunds();
