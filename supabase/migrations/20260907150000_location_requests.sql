-- Ссылка клиенту «отметьте адрес» (владелец 2026-09-07: «менеджеру сложно
-- постоянно запрашивать локацию у клиента — легче скопировать ссылку нашего
-- ПО, клиент сам заходит, выбирает чёткий адрес, вносит данные, куда приехать
-- мастеру»). Диспетчер выписывает ссылку, клиент открывает её на телефоне,
-- отмечает точку/адрес и подъезд-этаж-квартиру, объект появляется у клиента
-- в CRM. Один токен — одна отправка, срок 7 дней.
--
-- Наружу (anon) видны только две функции по токену: шапка страницы (кто
-- просит и для кого, без телефонов и других клиентов) и отправка адреса.
-- Списки, тенант и чужие клиенты по токену не читаются; сам токен — 192 бита
-- случайности, выписывается сервером.

create table if not exists public.location_requests (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  token       text not null unique,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '7 days'),
  used_at     timestamptz,
  location_id uuid,
  constraint location_requests_token_len check (length(token) between 32 and 128)
);

create index if not exists idx_location_requests_client
  on public.location_requests (client_id, created_at desc);

alter table public.location_requests enable row level security;

drop policy if exists location_requests_read on public.location_requests;
create policy location_requests_read on public.location_requests
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  );

drop policy if exists location_requests_delete on public.location_requests;
create policy location_requests_delete on public.location_requests
  for delete to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  );
-- Вставка и правка — только функциями ниже: токен рождается на сервере.

-- ─── Выписать ссылку ─────────────────────────────────────────────────────────
create or replace function public.location_request_create(p_client_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_token text;
begin
  if auth.uid() is null or v_tenant is null
     or public.current_user_role() not in ('owner', 'dispatcher') then
    raise exception 'Ссылку выписывает владелец или диспетчер'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.clients c where c.id = p_client_id and c.tenant_id = v_tenant
  ) then
    raise exception 'Клиент не найден' using errcode = '23503';
  end if;
  -- 24 байта → 32 символа base64url, без «=». pgcrypto живёт в схеме
  -- extensions, поэтому она в search_path выше.
  v_token := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.location_requests (tenant_id, client_id, token, created_by)
  values (v_tenant, p_client_id, v_token, auth.uid());
  return v_token;
end $$;

revoke all on function public.location_request_create(uuid) from public, anon;
grant execute on function public.location_request_create(uuid) to authenticated;

-- ─── Шапка публичной страницы ────────────────────────────────────────────────
create or replace function public.location_request_lookup(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_labels jsonb;
begin
  if p_token is null or length(p_token) not between 32 and 128 then
    return jsonb_build_object('state', 'missing');
  end if;
  select lr.tenant_id, lr.used_at, lr.expires_at,
         t.name as business_name, t.logo_url,
         split_part(coalesce(c.full_name, ''), ' ', 1) as first_name
    into r
    from public.location_requests lr
    join public.tenants t on t.id = lr.tenant_id
    join public.clients c on c.id = lr.client_id
   where lr.token = p_token;
  if not found then
    return jsonb_build_object('state', 'missing');
  end if;
  select coalesce(jsonb_agg(l.name order by l.position), '[]'::jsonb)
    into v_labels
    from public.location_labels l
   where l.tenant_id = r.tenant_id and l.is_active;
  return jsonb_build_object(
    'state', case
      when r.used_at is not null then 'used'
      when r.expires_at < now() then 'expired'
      else 'pending' end,
    'business_name', r.business_name,
    'logo_url', r.logo_url,
    'client_first_name', r.first_name,
    'labels', v_labels,
    'expires_at', r.expires_at
  );
end $$;

revoke all on function public.location_request_lookup(text) from public;
grant execute on function public.location_request_lookup(text) to anon, authenticated;

-- Координата без хвоста нулей: «34.7071», а не «34.707100» — строка идёт в
-- список объектов и в SMS как есть.
create or replace function public.location_request_coord(p numeric)
returns text
language sql
immutable
as $$
  select rtrim(rtrim(to_char(round(p, 6), 'FM999990.999999'), '0'), '.');
$$;

revoke all on function public.location_request_coord(numeric) from public;
grant execute on function public.location_request_coord(numeric) to anon, authenticated;

-- ─── Отправка адреса клиентом ────────────────────────────────────────────────
-- Строка `address` собирается тем же правилом, что composeAddress в приложении:
-- улица, комплекс, «подъезд N», «эт. N», «кв. N», «город индекс». Точка без
-- адреса даёт строку координат — как объект, заведённый пином в приложении.
create or replace function public.location_request_submit(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.location_requests%rowtype;
  v_street    text := left(btrim(coalesce(p_payload->>'street', '')), 200);
  v_complex   text := left(btrim(coalesce(p_payload->>'complex', '')), 120);
  v_entrance  text := left(btrim(coalesce(p_payload->>'entrance', '')), 20);
  v_floor     text := left(btrim(coalesce(p_payload->>'floor', '')), 20);
  v_apartment text := left(btrim(coalesce(p_payload->>'apartment', '')), 20);
  v_city      text := left(btrim(coalesce(p_payload->>'city', '')), 80);
  v_zip       text := left(btrim(coalesce(p_payload->>'zip', '')), 16);
  v_note      text := left(btrim(coalesce(p_payload->>'note', '')), 500);
  v_label     text := left(btrim(coalesce(p_payload->>'label', '')), 40);
  v_map       text := left(btrim(coalesce(p_payload->>'map_url', '')), 600);
  v_lat numeric;
  v_lng numeric;
  v_parts jsonb;
  v_addr text;
  v_loc jsonb;
  v_id uuid := gen_random_uuid();
  v_first boolean;
begin
  if p_token is null or length(p_token) not between 32 and 128 then
    return jsonb_build_object('ok', false, 'state', 'missing');
  end if;
  select * into r from public.location_requests where token = p_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'state', 'missing');
  end if;
  if r.used_at is not null then
    return jsonb_build_object('ok', false, 'state', 'used');
  end if;
  if r.expires_at < now() then
    return jsonb_build_object('ok', false, 'state', 'expired');
  end if;

  begin
    v_lat := nullif(p_payload->>'lat', '')::numeric;
    v_lng := nullif(p_payload->>'lng', '')::numeric;
  exception when others then
    v_lat := null;
    v_lng := null;
  end;
  if v_lat is null or v_lng is null
     or v_lat < -90 or v_lat > 90 or v_lng < -180 or v_lng > 180
     or (v_lat = 0 and v_lng = 0) then
    v_lat := null;
    v_lng := null;
  end if;
  if v_map <> '' and v_map !~* '^https?://' then
    v_map := '';
  end if;
  if v_map = '' and v_lat is not null then
    v_map := format('https://www.google.com/maps/search/?api=1&query=%s,%s',
                    public.location_request_coord(v_lat), public.location_request_coord(v_lng));
  end if;
  if v_label = '' then
    v_label := 'Дом';
  end if;

  v_parts := jsonb_strip_nulls(jsonb_build_object(
    'street', nullif(v_street, ''),
    'complex', nullif(v_complex, ''),
    'entrance', nullif(v_entrance, ''),
    'floor', nullif(v_floor, ''),
    'apartment', nullif(v_apartment, ''),
    'city', nullif(v_city, ''),
    'zip', nullif(v_zip, '')
  ));
  if v_street <> '' or v_complex <> '' or v_city <> '' then
    v_addr := array_to_string(array_remove(array[
      nullif(v_street, ''),
      nullif(v_complex, ''),
      case when v_entrance <> '' then 'подъезд ' || v_entrance end,
      case when v_floor <> '' then 'эт. ' || v_floor end,
      case when v_apartment <> '' then 'кв. ' || v_apartment end,
      nullif(btrim(concat_ws(' ', nullif(v_city, ''), nullif(v_zip, ''))), '')
    ], null), ', ');
  elsif v_lat is not null then
    v_addr := format('%s, %s', public.location_request_coord(v_lat), public.location_request_coord(v_lng));
  else
    v_addr := '';
  end if;
  if v_addr = '' and v_map = '' then
    raise exception 'Нужен адрес, точка на карте или ссылка'
      using errcode = '22023';
  end if;

  select coalesce(jsonb_array_length(coalesce(c.locations, '[]'::jsonb)) = 0, true)
    into v_first
    from public.clients c
   where c.id = r.client_id;

  v_loc := jsonb_strip_nulls(jsonb_build_object(
    'id', v_id,
    'label', v_label,
    'address', v_addr,
    'mapUrl', nullif(v_map, ''),
    'addressParts', case when v_parts = '{}'::jsonb then null else v_parts end,
    'note', nullif(v_note, ''),
    'isPrimary', coalesce(v_first, true),
    'source', 'client_link'
  ));

  update public.clients
     set locations = coalesce(locations, '[]'::jsonb) || jsonb_build_array(v_loc)
   where id = r.client_id and tenant_id = r.tenant_id;
  update public.location_requests
     set used_at = now(), location_id = v_id
   where id = r.id;

  return jsonb_build_object('ok', true, 'address', coalesce(nullif(v_addr, ''), v_map));
end $$;

revoke all on function public.location_request_submit(text, jsonb) from public;
grant execute on function public.location_request_submit(text, jsonb) to anon, authenticated;
