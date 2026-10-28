-- ПИН ОТ КЛИЕНТА — ТОЛЬКО ССЫЛКА НА КАРТУ (пачка 6, С6).
--
-- `location_request_submit` (страница «Пришлите адрес», роль anon) брал как
-- пин любую http(s)-ссылку, а мастер открывает пин из «Маршрута» одним
-- тапом: под видом карты в карточку клиента вставала любая страница. Теперь
-- пин — только с карт: Google (google.<страна>/maps, maps.google.*,
-- maps.app.goo.gl, goo.gl/maps), Apple, Waze, OpenStreetMap, Яндекс (…/maps,
-- maps.yandex.*), 2ГИС. Чужая ссылка отбрасывается, как раньше отбрасывалась
-- ссылка не http(s): адрес и точка GPS из формы остаются. Ссылка без схемы
-- (`maps.app.goo.gl/…`, так её отдаёт форма) дополняется `https://` — раньше
-- такую молча теряли.
--
-- Тот же список — в `isTrustedMapUrl` (packages/shared, map-links.ts):
-- маршрут не открывает чужую ссылку и из уже сохранённых объектов.
--
-- Тело правится по якорю в живом определении.

create or replace function public.is_map_url(p_url text)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  u text := lower(btrim(coalesce(p_url, '')));
  authority text := substring(u from '^https?://([^/?#]*)');
  host text;
  path text;
begin
  -- `user@host` — браузер откроет host после «@», а не то, что видно первым.
  if authority is null or authority = '' or position('@' in authority) > 0 then
    return false;
  end if;
  host := regexp_replace(authority, ':[0-9]*$', '');
  path := coalesce(substring(u from '^https?://[^/?#]*(/[^?#]*)'), '');
  return (host ~ '^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$' and path ~ '^/maps(/|$)')
      or host ~ '^maps\.google\.[a-z]{2,3}(\.[a-z]{2})?$'
      or host = 'maps.app.goo.gl'
      or (host = 'goo.gl' and path ~ '^/maps(/|$)')
      or host in ('maps.apple.com', 'maps.apple')
      or host ~ '^(www\.|ul\.)?waze\.com$'
      or host ~ '^(www\.)?(openstreetmap|osm)\.org$'
      or (host ~ '^(www\.)?yandex\.(ru|com|by|kz|uz|com\.tr)$' and path ~ '^/maps(/|$)')
      or host ~ '^maps\.yandex\.(ru|com)$'
      or host ~ '^(www\.)?2gis\.(ru|com|kz|ae)$';
end;
$function$;

revoke execute on function public.is_map_url(text) from public, anon, authenticated;

do $migration$
declare
  d text := pg_get_functiondef('public.location_request_submit(text, jsonb)'::regprocedure);
  anchor constant text := E'  if v_map <> '''' and v_map !~* ''^https?://'' then\n'
    || E'    v_map := '''';\n'
    || E'  end if;\n';
  replacement constant text := E'  -- Пин мастер откроет из «Маршрута» — принимаем только ссылки карт.\n'
    || E'  if v_map <> '''' and v_map !~* ''^https?://'' then\n'
    || E'    v_map := ''https://'' || v_map;\n'
    || E'  end if;\n'
    || E'  if v_map <> '''' and not public.is_map_url(v_map) then\n'
    || E'    v_map := '''';\n'
    || E'  end if;\n';
begin
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'location_request_submit: якорь проверки ссылки не найден ровно один раз';
  end if;
  execute replace(d, anchor, replacement);
end;
$migration$;

do $guard$
declare
  ok text[] := array[
    'https://maps.app.goo.gl/JhNhFkSbDNRy',
    'https://goo.gl/maps/abc',
    'https://www.google.com/maps/place/x/@34.7,33.0,17z',
    'https://www.google.com.cy/maps?q=34.7,33.0',
    'https://maps.google.com/?q=Limassol',
    'https://maps.apple.com/place?ll=34.7,33.0',
    'https://waze.com/ul?ll=34.7,33.0',
    'https://www.openstreetmap.org/#map=17/34.7/33.0',
    'https://yandex.ru/maps/-/CDaBc',
    'https://2gis.ru/limassol'
  ];
  bad text[] := array[
    'https://evil.com/maps',
    'https://google.com.evil.com/maps',
    'https://maps.google.com@evil.com/',
    'https://www.google.com/search?q=maps',
    'https://goo.gl/abc',
    'javascript:alert(1)',
    'http://maps.apple.com.evil.com/',
    'https://evil.com\maps.apple.com'
  ];
  x text;
begin
  foreach x in array ok loop
    if not public.is_map_url(x) then
      raise exception 'is_map_url отбил ссылку карты: %', x;
    end if;
  end loop;
  foreach x in array bad loop
    if public.is_map_url(x) then
      raise exception 'is_map_url принял чужую ссылку: %', x;
    end if;
  end loop;
  if position('not public.is_map_url(v_map)' in
       pg_get_functiondef('public.location_request_submit(text, jsonb)'::regprocedure)) = 0 then
    raise exception 'location_request_submit: проверка карты не записана';
  end if;
end;
$guard$;
