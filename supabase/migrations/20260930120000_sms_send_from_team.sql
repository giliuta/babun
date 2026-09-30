-- SMS, ВОЛНА 12 (STORY-089): ОТПРАВКА ЧЕРЕЗ СЕРВИС ОТОВСЮДУ — ОТ ВЫБРАННОЙ КОМАНДЫ.
--
-- Владелец 30.09: «делай все три… имя команды в SMS — через какую команду
-- отправка, так и определяется». Подпись SMS — имя отправителя команды:
--   • у записи — команда записи (как было);
--   • из карточки клиента и из чата — команда, которую выбрали в листе;
--   • массовая рассылка — одна выбранная команда на всю рассылку.
-- Номер — тот, у которого нажали «SMS»: у клиента их бывает несколько
-- (`clients.phones`), и сообщение уходит ровно на выбранный. Сервер
-- проверяет, что номер принадлежит клиенту.

-- Повод рассылки в журнале.
alter table public.sms_messages drop constraint if exists sms_messages_trigger_type_check;
alter table public.sms_messages add constraint sms_messages_trigger_type_check
  check (trigger_type = any (array[
    'reminder_24h', 'reminder_2h', 'manual', 'test', 'new_appointment', 'reminder',
    'reminder_2', 'reschedule', 'cancellation', 'thank_you', 'repeat', 'bulk'
  ]));

/** Принадлежит ли номер клиенту: основной, E.164, WhatsApp или один из
 *  дополнительных (`phones[].number`). Сравнение по цифрам: у клиента номер
 *  бывает записан без кода страны, а отправляем в E.164. */
create or replace function public.sms_client_owns_phone(p_client uuid, p_phone text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  with c as (select * from public.clients where id = p_client),
  nums as (
    select regexp_replace(coalesce(n, ''), '\D', '', 'g') as d
      from c, lateral (
        select c.phone union all select c.phone_e164 union all select c.whatsapp_phone
        union all
        select x ->> 'number'
          from jsonb_array_elements(case when jsonb_typeof(c.phones) = 'array' then c.phones else '[]'::jsonb end) x
      ) s(n)
  ),
  want as (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d)
  select exists (
    select 1 from nums, want
     where length(nums.d) >= 6 and length(want.d) >= 6
       and (want.d = nums.d or want.d like '%' || nums.d or nums.d like '%' || want.d)
  )
$function$;

drop function if exists public.sms_send_manual(uuid, uuid, text, text);

/** Вручную через сервис. С записью — от команды записи, на номер клиента
 *  записи; без записи — от выбранной команды (`p_team_id`). `p_phone` —
 *  выбранный номер клиента в E.164; нет — основной номер. */
create or replace function public.sms_send_manual(
  p_appointment_id uuid,
  p_client_id uuid,
  p_body text,
  p_template_id text default null,
  p_team_id text default null,
  p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  is_owner boolean := public.current_user_role() = 'owner';
  a record;
  v_client uuid := p_client_id;
  v_team text := nullif(trim(coalesce(p_team_id, '')), '');
  c record;
  phone text;
  v_body text := trim(coalesce(p_body, ''));
  v_balance integer;
  v_id uuid;
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  if not public.sms_service_on() then
    raise exception 'sms:service_off' using errcode = 'P0001';
  end if;
  if length(v_body) = 0 or length(v_body) > 1000 then
    raise exception 'sms:body' using errcode = '22023';
  end if;

  if p_appointment_id is not null then
    select ap.client_id, ap.team_id into a
      from public.appointments ap
     where ap.id = p_appointment_id and ap.tenant_id = v_tenant;
    if not found or a.client_id is null then
      raise exception 'sms:appointment' using errcode = 'P0001';
    end if;
    v_client := a.client_id;
    v_team := a.team_id;
  end if;
  if v_team is null or v_client is null then
    raise exception 'sms:calendar' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.teams t where t.tenant_id = v_tenant and t.id = v_team) then
    raise exception 'sms:calendar' using errcode = 'P0001';
  end if;
  -- Команда, которую человек видит, — тем же правилом, что окно записей.
  if not is_owner and not public.sms_can_see_team(v_team) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  if public.sms_team_sender(v_tenant, v_team) is null then
    raise exception 'sms:sender' using errcode = 'P0001';
  end if;

  select cl.phone, cl.phone_e164, cl.sms_opt_out, cl.blacklisted, cl.deleted_at
    into c
    from public.clients cl
   where cl.id = v_client and cl.tenant_id = v_tenant;
  if not found or c.deleted_at is not null then
    raise exception 'sms:client' using errcode = 'P0001';
  end if;
  if c.sms_opt_out or coalesce(c.blacklisted, false) then
    raise exception 'sms:opt_out' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_phone, '')), '') is not null then
    if not public.sms_client_owns_phone(v_client, p_phone) then
      raise exception 'sms:phone' using errcode = 'P0001';
    end if;
    phone := trim(p_phone);
  else
    phone := coalesce(nullif(trim(c.phone_e164), ''), nullif(trim(c.phone), ''));
  end if;
  if phone is null then
    raise exception 'sms:phone' using errcode = 'P0001';
  end if;
  select balance_cents into v_balance from public.tenant_sms_config where tenant_id = v_tenant;
  if coalesce(v_balance, 0) < public.sms_price_cents() then
    raise exception 'sms:funds' using errcode = 'P0001';
  end if;

  insert into public.sms_messages (
    tenant_id, appointment_id, client_id, team_id, to_phone, message_body,
    trigger_type, template_id, status, mode, sent_by
  ) values (
    v_tenant, p_appointment_id, v_client, v_team, phone, v_body,
    'manual', nullif(p_template_id, ''), 'queued', 'platform', auth.uid()
  )
  returning sms_messages.id into v_id;

  perform public.sms_wake();
  return v_id;
end;
$function$;

/** Массовая рассылка через сервис — только владелец. Одна команда на всю
 *  рассылку (её имя — подпись), у каждого получателя свой готовый текст
 *  (приложение уже подставило [Имя]). Клиент без номера, отказавшийся от
 *  SMS или удалённый — пропускается. Баланс проверяется на всю рассылку
 *  по одной части на SMS; точное списание — при отправке. */
create or replace function public.sms_send_bulk(p_team_id text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_team text := nullif(trim(coalesce(p_team_id, '')), '');
  it jsonb;
  c record;
  phone text;
  v_body text;
  v_balance integer;
  n_items integer;
  queued integer := 0;
  skipped integer := 0;
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  if not public.sms_service_on() then
    raise exception 'sms:service_off' using errcode = 'P0001';
  end if;
  if v_team is null or not exists (select 1 from public.teams t where t.tenant_id = v_tenant and t.id = v_team) then
    raise exception 'sms:calendar' using errcode = 'P0001';
  end if;
  if public.sms_team_sender(v_tenant, v_team) is null then
    raise exception 'sms:sender' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'sms:body' using errcode = '22023';
  end if;
  n_items := jsonb_array_length(p_items);
  if n_items = 0 or n_items > 500 then
    raise exception 'sms:body' using errcode = '22023';
  end if;
  select balance_cents into v_balance from public.tenant_sms_config where tenant_id = v_tenant;
  if coalesce(v_balance, 0) < public.sms_price_cents() * n_items then
    raise exception 'sms:funds' using errcode = 'P0001';
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_body := trim(coalesce(it ->> 'body', ''));
    select cl.id, cl.phone, cl.phone_e164, cl.sms_opt_out, cl.blacklisted, cl.deleted_at
      into c
      from public.clients cl
     where cl.id = nullif(it ->> 'client_id', '')::uuid and cl.tenant_id = v_tenant;
    phone := case when found then coalesce(nullif(trim(c.phone_e164), ''), nullif(trim(c.phone), '')) end;
    if phone is null or c.deleted_at is not null or c.sms_opt_out or coalesce(c.blacklisted, false)
       or length(v_body) = 0 or length(v_body) > 1000 then
      skipped := skipped + 1;
      continue;
    end if;
    insert into public.sms_messages (
      tenant_id, client_id, team_id, to_phone, message_body, trigger_type, status, mode, sent_by
    ) values (
      v_tenant, c.id, v_team, phone, v_body, 'bulk', 'queued', 'platform', auth.uid()
    );
    queued := queued + 1;
  end loop;

  if queued > 0 then
    perform public.sms_wake();
  end if;
  return jsonb_build_object('queued', queued, 'skipped', skipped);
end;
$function$;

revoke all on function public.sms_client_owns_phone(uuid, text) from public, anon, authenticated;
revoke all on function public.sms_send_manual(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.sms_send_manual(uuid, uuid, text, text, text, text) to authenticated;
revoke all on function public.sms_send_bulk(text, jsonb) from public, anon;
grant execute on function public.sms_send_bulk(text, jsonb) to authenticated;

do $audit$
begin
  if (select count(*) from pg_proc where proname = 'sms_send_manual' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'sms_send_manual left a second overload';
  end if;
  if has_function_privilege('anon', 'public.sms_send_bulk(text, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.sms_send_manual(uuid, uuid, text, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.sms_client_owns_phone(uuid, text)', 'execute') then
    raise exception 'sms send functions: wrong grants';
  end if;
end
$audit$;
