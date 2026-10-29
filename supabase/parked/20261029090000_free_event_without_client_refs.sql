-- СОБЫТИЕ БЕСПЛАТНОГО КАЛЕНДАРЯ — БЕЗ КЛИЕНТА И ОБЪЕКТА.
--
-- Владелец: человек без тарифа клиента и объект не записывает — чтобы
-- записать клиента и объект, календарь нужно оплатить. Сторожа тарифа
-- (`enforce_plan_limits` на вставке, `tenant_free_readonly_guard` на правке)
-- режут только `kind = 'work'`: событие бесплатного календаря принимало
-- `client_id`, `location_id` и объект события (точку на карте, заметку
-- объекта). Приложение гасит эти блоки, но засовом должна быть база.
--
-- Отдельный узкий сторож, а не правка двух живых тел: тариф — того аккаунта,
-- чей календарь (`tenant_effective_plan(new.tenant_id)`). Новое событие не
-- принимает ни одной из ссылок; правка не может их поставить или сменить, а
-- уже стоящее (старые события) не трогается и может быть снято. Текст
-- адреса события не судим: вольный адрес жил у событий и без тарифа.
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
    if new.client_id is not null
       or new.location_id is not null
       or new.address_lat is not null
       or new.address_lng is not null
       or coalesce(new.address_note, '') <> '' then
      raise exception 'Клиент и объект в событии — после оплаты календаря'
        using errcode = 'P0001', hint = 'plan:book-clients';
    end if;
    return new;
  end if;

  if (new.client_id is not null and new.client_id is distinct from old.client_id)
     or (new.location_id is not null and new.location_id is distinct from old.location_id)
     or ((new.address_lat is not null or new.address_lng is not null)
         and (new.address_lat, new.address_lng) is distinct from (old.address_lat, old.address_lng))
     or (coalesce(new.address_note, '') <> ''
         and coalesce(new.address_note, '') is distinct from coalesce(old.address_note, '')) then
    raise exception 'Клиент и объект в событии — после оплаты календаря'
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
