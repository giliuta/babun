-- АДРЕС НА ИНВОЙСЕ — ТОЛЬКО ИЗ БЛОКА «ТОЧНЫЙ АДРЕС».
--
-- Владелец 22.09: «хочу, чтобы адрес выставлялся в инвойс, когда мы пишем
-- именно в точный адрес; а обычный адрес не выставляется». Главная строка
-- объекта («Адрес или ссылка») хранится в `addressParts.street`, поэтому
-- правило «есть улица» из 20260922060000 печатало обычный адрес. Теперь
-- `address_parts` попадает в снимок, только когда заполнено хоть одно поле
-- блока «Точный адрес»: комплекс, подъезд, этаж, квартира, город, индекс.
-- Тогда на бумагу идёт и улица главной строки — без неё адрес неполный.

begin;

create or replace function public.invoice_object_snapshot(
  p_tenant_id uuid, p_client_id uuid, p_location_id text
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', entry.value ->> 'id',
    'label', nullif(btrim(entry.value ->> 'label'), ''),
    'address_parts', case
      when coalesce(
        nullif(btrim(entry.value -> 'addressParts' ->> 'complex'), ''),
        nullif(btrim(entry.value -> 'addressParts' ->> 'entrance'), ''),
        nullif(btrim(entry.value -> 'addressParts' ->> 'floor'), ''),
        nullif(btrim(entry.value -> 'addressParts' ->> 'apartment'), ''),
        nullif(btrim(entry.value -> 'addressParts' ->> 'city'), ''),
        nullif(btrim(entry.value -> 'addressParts' ->> 'zip'), '')
      ) is null then null
      else jsonb_strip_nulls(jsonb_build_object(
        'street', nullif(btrim(entry.value -> 'addressParts' ->> 'street'), ''),
        'complex', nullif(btrim(entry.value -> 'addressParts' ->> 'complex'), ''),
        'entrance', nullif(btrim(entry.value -> 'addressParts' ->> 'entrance'), ''),
        'floor', nullif(btrim(entry.value -> 'addressParts' ->> 'floor'), ''),
        'apartment', nullif(btrim(entry.value -> 'addressParts' ->> 'apartment'), ''),
        'city', nullif(btrim(entry.value -> 'addressParts' ->> 'city'), ''),
        'zip', nullif(btrim(entry.value -> 'addressParts' ->> 'zip'), '')
      ))
    end
  )
    from public.clients client
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(client.locations) = 'array' then client.locations else '[]'::jsonb end
    ) as entry(value)
   where client.id = p_client_id
     and client.tenant_id = p_tenant_id
     and p_location_id is not null
     and entry.value ->> 'id' = p_location_id
   limit 1;
$$;

revoke all on function public.invoice_object_snapshot(uuid, uuid, text) from public, anon;
grant execute on function public.invoice_object_snapshot(uuid, uuid, text) to authenticated;

-- Сторож: условие адреса называет поля «Точного адреса», а не улицу.
do $$
begin
  if not exists (
    select 1 from pg_proc
     where pronamespace = 'public'::regnamespace and proname = 'invoice_object_snapshot'
       and prosrc ~ 'when coalesce\(\s*nullif\(btrim\(entry\.value -> ''addressParts'' ->> ''complex'''
  ) then
    raise exception 'invoice_object_snapshot still prints the plain address';
  end if;
end
$$;

commit;
