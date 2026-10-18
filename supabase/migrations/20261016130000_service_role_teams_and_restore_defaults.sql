-- 1. Сервисная роль читает календари (`teams`).
--
-- В этом проекте у service_role нет прав на таблицы по умолчанию: каждая
-- таблица, которую читают edge-функции, получает явный grant. У `teams` его
-- не было, поэтому `tariff-checkout` и `stripe-webhook` получали отказ при
-- подсчёте живых календарей и ставили в подписку Stripe ровно один календарь
-- при любом их числе.
grant select on public.teams to service_role;

-- 2. «Вернуть» из «Удалённых операций» не падает на старых снимках.
--
-- Снимок — `to_jsonb` строки на момент удаления. Колонка, добавленная позже
-- (например `from_calendar not null default false`), в старом снимке
-- отсутствует, а `jsonb_populate_record(null::…)` ставит ей явный NULL, и
-- вставка падает на NOT NULL, хотя 30 дней не прошли. Недостающие ключи
-- берут значение по умолчанию; ключи снимка всегда побеждают.
create or replace function public.deleted_operation_ready(p_operation jsonb)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  ready jsonb := jsonb_build_object('from_calendar', false) || p_operation;
  account uuid := nullif(p_operation->>'account_id', '')::uuid;
begin
  if account is not null and not exists (
    select 1 from public.accounts a where a.id = account and a.deleted_at is null
  ) then
    raise exception 'Счёт этой операции удалён — сначала верните его из «Удалённых счетов»'
      using errcode = '23503', hint = 'operation:account_deleted';
  end if;
  if ready->>'category_id' is not null and not exists (
    select 1 from public.finance_categories c where c.id = (ready->>'category_id')::uuid
  ) then
    ready := jsonb_set(ready, '{category_id}', 'null');
  end if;
  if ready->>'client_id' is not null and not exists (
    select 1 from public.clients c where c.id = (ready->>'client_id')::uuid
  ) then
    ready := jsonb_set(ready, '{client_id}', 'null');
  end if;
  if ready->>'appointment_id' is not null and not exists (
    select 1 from public.appointments a where a.id = (ready->>'appointment_id')::uuid
  ) then
    ready := jsonb_set(ready, '{appointment_id}', 'null');
  end if;
  if ready->>'debt_id' is not null and not exists (
    select 1 from public.debts d where d.id = (ready->>'debt_id')::uuid
  ) then
    ready := jsonb_set(ready, '{debt_id}', 'null');
  end if;
  -- Налога в снимке не было — и не будет: иначе триггер VAT навесил бы его
  -- по сегодняшним настройкам счёта, команды и компании.
  if ready->>'vat_amount' is null then
    ready := jsonb_set(ready, '{vat_mode}', '"none"');
  end if;
  return ready;
end;
$function$;
