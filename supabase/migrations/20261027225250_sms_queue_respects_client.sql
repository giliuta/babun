-- SMS ИЗ ОЧЕРЕДИ — ТОЛЬКО ЖИВОМУ, ПОДПИСАННОМУ КЛИЕНТУ И ТОЛЬКО В РАЗРЕШЁННУЮ
-- СТРАНУ (аудит 035: dat/X-07, srv/S-09).
--
-- 1. `sms_claim` отдаёт серверу отправки всё, что в очереди дождалось срока.
--    Проверки клиента (удалён, отписался, в чёрном списке) стоят только при
--    постановке (`sms_enqueue`, `sms_send_manual`). SMS, отложенное окном
--    тишины или «накануне», уходило утром клиенту, которого вечером удалили
--    или который попросил больше не писать. Теперь перед выдачей такие
--    сообщения помечаются `blocked` («клиент недоступен»); вернули клиента
--    из корзины и сообщение вернули в очередь — уйдёт.
-- 2. `sms_phone_allowed` пропускал любой номер без «+»: фильтр стран
--    (`app_settings.sms_allowed_prefixes`, сейчас «+357») на нём не работал.
--    Теперь восемь цифр без кода — кипрский номер, как его набирают на Кипре
--    (такой в базе один); остальное без кода страны — отказ.

create or replace function public.sms_phone_allowed(p_phone text)
returns boolean
language plpgsql
stable security definer
set search_path = public
as $function$
declare
  n text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  prefixes text[];
begin
  if n like '00%' then
    n := '+' || substr(n, 3);
  end if;
  if n not like '+%' then
    if n ~ '^[0-9]{8}$' then
      n := '+357' || n;
    else
      return false;
    end if;
  end if;
  select coalesce(array_agg(trim(x)), '{}') into prefixes
    from unnest(string_to_array(coalesce(
      (select value from public.app_settings where key = 'sms_allowed_prefixes'), '+357'), ',')) x
   where trim(x) <> '';
  return exists (select 1 from unnest(prefixes) p where n like p || '%');
end;
$function$;

do $migration$
declare
  d text := pg_get_functiondef('public.sms_claim(integer)'::regprocedure);
  anchor constant text := E'  return query\n  with picked as (';
  block constant text := E'  -- Клиент удалён, отписался или в чёрном списке — SMS не уходит.\n'
    || E'  update public.sms_messages m\n'
    || E'     set status = ''blocked'',\n'
    || E'         error_code = ''client_unavailable'',\n'
    || E'         error_message = ''Клиент удалён, отписался от SMS или в чёрном списке''\n'
    || E'   where m.status = ''queued''\n'
    || E'     and (m.send_after is null or m.send_after <= now())\n'
    || E'     and m.trigger_type <> ''test''\n'
    || E'     and exists (\n'
    || E'       select 1 from public.clients c\n'
    || E'        where c.id = m.client_id\n'
    || E'          and (c.deleted_at is not null or c.sms_opt_out or coalesce(c.blacklisted, false))\n'
    || E'     );\n';
begin
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'sms_claim: якорь «return query / with picked» не найден ровно один раз';
  end if;
  execute replace(d, anchor, block || anchor);
end;
$migration$;
