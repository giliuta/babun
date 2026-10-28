-- ОНЛАЙН-ЗАПИСЬ: ЛИМИТ ПО АДРЕСУ И ЧЁРНЫЙ СПИСОК БЕЗ ПОДСКАЗКИ (пачка 6, С1 и С4).
--
-- С1. `online_booking_create` держал два лимита: 3 заявки с номера в сутки и
-- 20 на календарь в час. Номер заказчик не подтверждает, поэтому лимит по
-- номеру обходится перебором номеров: 20 в час — это ~480 записей в сутки на
-- 14 дней вперёд и столько же мусорных клиентов. Теперь у заявки есть отпечаток
-- адреса заказчика (`cf-connecting-ip` — его ставит Cloudflare и заказчик
-- подделать не может; без него — первый адрес `x-forwarded-for`), и сверху:
-- с одного адреса не больше 5 заявок в час и 10 в сутки на календарь, у
-- календаря — не больше 50 в сутки. Без адреса в заголовках лимит по адресу
-- молчит: иначе все такие заказчики делили бы одни 10 заявок. Заявки старше
-- двух суток ни одному лимиту не нужны — их снимает следующая заявка
-- календаря.
--
-- С4. Клиенту из чёрного списка запись по-прежнему не встаёт, но ответ —
-- такой же, как у обычной брони: отказ `online:refused` подсказывал любому,
-- что номер в чёрном списке. Записи и клиента нет, заявка посчитана в лимитах.
--
-- Тело правится по якорям в живом определении.

alter table public.online_booking_requests add column ip_hash text;

create index online_booking_requests_ip_time_idx
  on public.online_booking_requests (team_id, ip_hash, created_at)
  where ip_hash is not null;

create or replace function public.online_booking_client_ip()
returns text
language sql
stable
set search_path to 'public'
as $function$
  select nullif(btrim(coalesce(
           h ->> 'cf-connecting-ip',
           split_part(h ->> 'x-forwarded-for', ',', 1)
         )), '')
    from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json as h) x
$function$;

revoke execute on function public.online_booking_client_ip() from public, anon, authenticated;

do $migration$
declare
  d text := pg_get_functiondef('public.online_booking_create(text, text, text, text, text, text)'::regprocedure);
  a1 constant text := E'  v_appointment uuid := gen_random_uuid();\n';
  r1 constant text := E'  v_appointment uuid := gen_random_uuid();\n'
    || E'  v_ip_hash text := md5(''online-booking:'' || public.online_booking_client_ip());\n';
  a2 constant text := E'  perform pg_advisory_xact_lock(hashtextextended(''online-booking:'' || r.tenant_id::text || '':'' || r.team_id, 0));\n';
  r2 constant text := a2
    || E'  delete from public.online_booking_requests q\n'
    || E'   where q.team_id = r.team_id and q.created_at < now() - interval ''2 days'';\n';
  a3 constant text := E'       where q.team_id = r.team_id and q.created_at > now() - interval ''1 hour'') >= 20 then\n'
    || E'    raise exception ''Слишком много заявок — попробуйте позже'' using errcode = ''P0001'', hint = ''online:rate'';\n'
    || E'  end if;\n';
  r3 constant text := a3
    || E'  -- Номер не подтверждается — держит адрес заказчика и потолок календаря.\n'
    || E'  if v_ip_hash is not null and (\n'
    || E'       (select count(*) from public.online_booking_requests q\n'
    || E'         where q.team_id = r.team_id and q.ip_hash = v_ip_hash\n'
    || E'           and q.created_at > now() - interval ''1 hour'') >= 5\n'
    || E'       or (select count(*) from public.online_booking_requests q\n'
    || E'            where q.team_id = r.team_id and q.ip_hash = v_ip_hash\n'
    || E'              and q.created_at > now() - interval ''1 day'') >= 10\n'
    || E'     ) then\n'
    || E'    raise exception ''Слишком много заявок — попробуйте позже'' using errcode = ''P0001'', hint = ''online:rate'';\n'
    || E'  end if;\n'
    || E'  if (select count(*) from public.online_booking_requests q\n'
    || E'       where q.team_id = r.team_id and q.created_at > now() - interval ''1 day'') >= 50 then\n'
    || E'    raise exception ''Слишком много заявок — попробуйте позже'' using errcode = ''P0001'', hint = ''online:rate'';\n'
    || E'  end if;\n';
  a4 constant text := E'  insert into public.online_booking_requests (team_id, tenant_id, phone_e164)\n'
    || E'  values (r.team_id, r.tenant_id, v_phone);\n';
  r4 constant text := E'  insert into public.online_booking_requests (team_id, tenant_id, phone_e164, ip_hash)\n'
    || E'  values (r.team_id, r.tenant_id, v_phone, v_ip_hash);\n';
  a5 constant text := E'    if v_match_blocked then\n'
    || E'      raise exception ''Онлайн-запись недоступна — позвоните нам'' using errcode = ''P0001'', hint = ''online:refused'';\n'
    || E'    end if;\n';
  r5 constant text := E'    -- Ответ — как у обычной брони, чтобы страница не выдавала чёрный список.\n'
    || E'    if v_match_blocked then\n'
    || E'      return jsonb_build_object(\n'
    || E'        ''state'', ''booked'',\n'
    || E'        ''business_name'', r.business_name,\n'
    || E'        ''service'', s.name,\n'
    || E'        ''date'', p_date,\n'
    || E'        ''time'', p_time\n'
    || E'      );\n'
    || E'    end if;\n';
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1
     or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1
     or (length(d) - length(replace(d, a3, ''))) / length(a3) <> 1
     or (length(d) - length(replace(d, a4, ''))) / length(a4) <> 1
     or (length(d) - length(replace(d, a5, ''))) / length(a5) <> 1 then
    raise exception 'online_booking_create: якоря лимитов и чёрного списка не найдены ровно один раз';
  end if;
  execute replace(replace(replace(replace(replace(d, a1, r1), a2, r2), a3, r3), a4, r4), a5, r5);
end;
$migration$;

do $guard$
declare
  src text := pg_get_functiondef('public.online_booking_create(text, text, text, text, text, text)'::regprocedure);
begin
  if position('online:refused' in src) > 0 then
    raise exception 'online_booking_create снова выдаёт чёрный список';
  end if;
  if position('q.ip_hash = v_ip_hash' in src) = 0 or position('interval ''1 day'') >= 50' in src) = 0 then
    raise exception 'online_booking_create: лимиты по адресу не записаны';
  end if;
  if has_function_privilege('anon', 'public.online_booking_client_ip()', 'execute')
     or has_function_privilege('authenticated', 'public.online_booking_client_ip()', 'execute') then
    raise exception 'online_booking_client_ip исполним снаружи';
  end if;
end;
$guard$;
