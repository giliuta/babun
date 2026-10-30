-- СОБЫТИЕ БЕСПЛАТНОГО КАЛЕНДАРЯ — БЕЗ КЛИЕНТА И ОБЪЕКТА КЛИЕНТА.
--
-- Владелец: человек без тарифа клиентов не записывает — чтобы записать
-- клиента, календарь нужно оплатить. Событие при этом работает целиком, и
-- объект САМОГО события (адрес, точка, заметка — `address`,
-- `address_lat/lng`, `address_note` при `location_id = null`) остаётся: он
-- живёт только в событии и клиентской функцией не является.
--
-- Сторожа тарифа (`enforce_plan_limits` на вставке,
-- `tenant_free_readonly_guard` на правке) режут только `kind = 'work'`:
-- событие бесплатного календаря принимало `client_id` и `location_id`
-- (объект клиента). Приложение гасит клиента, но засовом должна быть база.
--
-- Отдельный узкий сторож, а не правка двух живых тел: тариф — того аккаунта,
-- чей календарь (`tenant_effective_plan(new.tenant_id)`). Новое событие не
-- принимает клиента и объект клиента; правка не может их поставить или
-- сменить, а уже стоящее у старых событий не трогается и может быть снято.
-- Внутренние ходы без пользователя (cron, сервис) мимо, как у соседей.

create or replace function public.free_event_without_client_refs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null
     or new.kind is distinct from 'event'
     or public.tenant_effective_plan(new.tenant_id) is distinct from 'free' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.client_id is not null or new.location_id is not null then
      raise exception 'Клиент в событии — после оплаты календаря'
        using errcode = 'P0001', hint = 'plan:book-clients';
    end if;
    return new;
  end if;

  if (new.client_id is not null and new.client_id is distinct from old.client_id)
     or (new.location_id is not null and new.location_id is distinct from old.location_id) then
    raise exception 'Клиент в событии — после оплаты календаря'
      using errcode = 'P0001', hint = 'plan:book-clients';
  end if;
  return new;
end;
$function$;

-- Функция сторожа: звать её напрямую некому.
revoke all on function public.free_event_without_client_refs() from public, anon, authenticated;

drop trigger if exists appointments_free_event_refs on public.appointments;
create trigger appointments_free_event_refs
  before insert or update on public.appointments
  for each row execute function public.free_event_without_client_refs();
