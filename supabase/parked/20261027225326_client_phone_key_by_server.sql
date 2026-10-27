-- КЛЮЧ НОМЕРА КЛИЕНТА СЧИТАЕТ СЕРВЕР (аудит 035, cli/QA2-01; решение 035).
--
-- `clients.phone_e164` — ключ, по которому работают уникальность номера в
-- компании (`UNIQUE (tenant_id, phone_e164)`), поиск клиента по номеру и
-- онлайн-запись. Считал его только телефон (`ClientHeader.tsx`,
-- `useClientDraft.ts`); дороги мимо них оставили у живых клиентов ключ
-- пустым — второй клиент с тем же номером проходил, поиск их не видел.
--
-- Теперь триггер на INSERT и на смену `phone` сам выводит ключ там, где это
-- однозначно: номер с «+» или «00» — как есть, только цифры; восемь цифр без
-- кода у компании на Кипре (`tenants.country = 'CY'`) — кипрский. Где сервер
-- однозначно не знает (местный номер другой страны), остаётся ключ,
-- присланный телефоном. Разовым пересчётом заполняются строки без ключа.
--
-- Ключ, уже занятый другим клиентом той же компании, не ставится ни
-- триггером, ни пересчётом — строка остаётся без ключа до слияния дублей
-- («Объединить с дублем», `merge_clients`). На 27.10 такая строка одна:
-- Giliuta, «Артем» `5755ed12…` (+357 97469998) — дубль «Артема» `c4cb733f…`.

create or replace function public.phone_to_e164(p_phone text, p_country text)
returns text
language plpgsql
immutable
set search_path = public
as $function$
declare
  n text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
begin
  if n = '' then
    return null;
  end if;
  if n like '00%' then
    n := '+' || substr(n, 3);
  end if;
  if n like '+%' then
    return case when n ~ '^\+[1-9][0-9]{6,14}$' then n end;
  end if;
  if coalesce(p_country, 'CY') = 'CY' and n ~ '^[0-9]{8}$' then
    return '+357' || n;
  end if;
  return null;
end;
$function$;

comment on function public.phone_to_e164(text, text) is
  'Ключ номера E.164 там, где он однозначен: «+»/«00» — цифрами, восемь цифр на Кипре — +357; иначе NULL.';

revoke all on function public.phone_to_e164(text, text) from public, anon;
grant execute on function public.phone_to_e164(text, text) to authenticated;

create or replace function public.clients_phone_key()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  computed text;
begin
  if tg_op = 'UPDATE' and new.phone is not distinct from old.phone and new.phone_e164 is not null then
    return new;
  end if;
  computed := public.phone_to_e164(
    new.phone,
    (select t.country from public.tenants t where t.id = new.tenant_id)
  );
  -- Ключ, уже занятый другим клиентом той же компании, не ставится: это
  -- дубль, его сливают «Объединить с дублем». Иначе любая правка такого
  -- клиента падала бы на уникальности ключа.
  if computed is not null and not exists (
    select 1 from public.clients o
     where o.tenant_id = new.tenant_id and o.phone_e164 = computed and o.id <> new.id
  ) then
    new.phone_e164 := computed;
  end if;
  return new;
end;
$function$;

revoke all on function public.clients_phone_key() from public, anon, authenticated;

drop trigger if exists clients_phone_key on public.clients;
create trigger clients_phone_key
  before insert or update of phone, phone_e164 on public.clients
  for each row execute function public.clients_phone_key();

-- Разовый пересчёт: строки с номером, но без ключа. Ключ, который уже занят
-- другим клиентом той же компании, не ставится — такой дубль разбирается
-- руками («Объединить с дублем»), а не падением миграции.
update public.clients c
   set phone_e164 = k.key
  from (
    select c2.id, public.phone_to_e164(c2.phone, t.country) as key, c2.tenant_id
      from public.clients c2
      join public.tenants t on t.id = c2.tenant_id
     where coalesce(c2.phone, '') <> '' and c2.phone_e164 is null
  ) k
 where c.id = k.id
   and k.key is not null
   and not exists (
     select 1 from public.clients o
      where o.tenant_id = k.tenant_id and o.phone_e164 = k.key and o.id <> k.id
   );
