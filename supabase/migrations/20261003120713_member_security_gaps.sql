-- ДЫРЫ ПРАВ СОТРУДНИКА — АУДИТ БЕЗОПАСНОСТИ 2026-10-03.
--
-- Тела функций взяты из БОЕВОЙ базы (pg_get_functiondef) на 03.10 и изменены
-- только в отмеченных местах: всё остальное — как было, чтобы не откатить
-- чужие правки. Подписи и умолчания прежние (create or replace без новых
-- параметров — второй перегрузки не будет).
--
-- 1. sms_send_manual: с 03.10 у SMS из записи получатель берётся из
--    p_client_id («клиент на экране»), а право «SMS: Меняет» проверялось
--    только у SMS без записи. По любой записи команды сотрудник мог отправить
--    SMS ЛЮБОМУ клиенту её базы — за деньги владельца. Теперь получатель,
--    отличный от клиента записи, требует то же право, что с карточки.
--
-- 2. update_master_appointment_safe (старая дверь мастера): заметку записи
--    (comment) пускала по праву «Статус: Меняет». С 30.09 у заметки своё
--    право record.note — партнёр со скрытой заметкой мог её переписать или
--    стереть, не видя. Теперь comment требует record.note write.
--
-- 3. tenant_effective_plan(t_id): definer с компанией из аргумента был открыт
--    любому вошедшему — тариф, пробный период и lifetime ЧУЖОГО аккаунта по
--    его id. Все, кто её зовёт, — definer-функции, приложение её напрямую не
--    зовёт: отзываем у authenticated.

-- ── 1 ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sms_send_manual(p_appointment_id uuid, p_client_id uuid, p_body text, p_template_id text DEFAULT NULL::text, p_team_id text DEFAULT NULL::text, p_phone text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  cap_member integer := coalesce(
    (select nullif(value, '')::integer from public.app_settings where key = 'sms_member_daily_cap'), 100);
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  if not public.sms_service_on() then
    raise exception 'sms:service_off' using errcode = 'P0001';
  end if;
  if public.sms_frozen(v_tenant) then
    raise exception 'sms:frozen' using errcode = 'P0001';
  end if;
  if length(v_body) = 0 or length(v_body) > 1000 then
    raise exception 'sms:body' using errcode = '22023';
  end if;
  if p_appointment_id is not null then
    select ap.client_id, ap.team_id into a
      from public.appointments ap
     where ap.id = p_appointment_id and ap.tenant_id = v_tenant;
    if not found then
      raise exception 'sms:appointment' using errcode = 'P0001';
    end if;
    -- Клиент на экране (сменили и не сохранили) — ему; нет — клиент записи.
    -- SMS всё равно о записи (03.10). Право на клиента — проверками ниже.
    v_client := coalesce(p_client_id, a.client_id);
    if v_client is null then
      raise exception 'sms:appointment' using errcode = 'P0001';
    end if;
    v_team := a.team_id;
  end if;
  if v_team is null or v_client is null then
    raise exception 'sms:calendar' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.teams t where t.tenant_id = v_tenant and t.id = v_team) then
    raise exception 'sms:calendar' using errcode = 'P0001';
  end if;
  if not is_owner and not public.sms_can_see_team(v_team) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  -- Клиент — только тот, кого сотрудник видит в этой команде (защита базы
  -- 30.09): иначе SMS уходило бы любому клиенту компании по его uuid.
  if not is_owner and not public.member_client_in_team(v_client, v_team) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  -- С карточки клиента (без записи) — по блоку «SMS: Меняет» (02.10). SMS
  -- из записи держит своё право календаря.
  if not is_owner
     and p_appointment_id is null
     and not (v_client = any(public.access_block_client_ids('clients.sms', 'write'))) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  -- ПОЛУЧАТЕЛЬ — НЕ КЛИЕНТ ЗАПИСИ (аудит 03.10): это SMS другому клиенту, и
  -- право то же, что с карточки, — «SMS: Меняет». Без этого по любой записи
  -- команды SMS уходило любому клиенту её базы.
  if not is_owner and p_appointment_id is not null then
    if v_client is distinct from a.client_id
       and not (v_client = any(public.access_block_client_ids('clients.sms', 'write'))) then
      raise exception 'sms:rights' using errcode = '42501';
    end if;
  end if;
  if not is_owner and (
    select count(*) from public.sms_messages
     where sent_by = auth.uid() and created_at > now() - interval '1 day'
  ) >= cap_member then
    raise exception 'sms:limit' using errcode = 'P0001';
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
    -- Выбрать номер может только тот, кому номер открыт (30.09): иначе дверь
    -- служила бы проверкой угаданного номера.
    if not is_owner
       and not (v_client = any(public.access_contact_client_ids())
                or v_client = any(public.access_day_contact_client_ids())) then
      raise exception 'sms:phone' using errcode = 'P0001';
    end if;
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
  if not public.sms_phone_allowed(phone) then
    raise exception 'sms:country' using errcode = 'P0001';
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

-- ── 2 ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_master_appointment_safe(p_appointment_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
  v_current_status text;
  v_team text;
begin
  if auth.uid() is null
     or public.current_user_role() is distinct from 'master' then
    raise exception 'only a master can use this appointment update'
      using errcode = '42501';
  end if;

  if p_patch is null
     or jsonb_typeof(p_patch) <> 'object'
     or p_patch = '{}'::jsonb then
    raise exception 'appointment patch must be a non-empty object'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_object_keys(p_patch) key
     where key not in ('status', 'comment')
  ) then
    raise exception 'master can update only status and comment'
      using errcode = '42501';
  end if;

  if p_patch ? 'status'
     and (
       jsonb_typeof(p_patch -> 'status') <> 'string'
       or (p_patch ->> 'status') not in (
         'scheduled',
         'in_progress',
         'completed'
       )
     ) then
    raise exception 'unsupported master appointment status'
      using errcode = '22023';
  end if;

  if p_patch ? 'comment'
     and jsonb_typeof(p_patch -> 'comment') <> 'string' then
    raise exception 'appointment comment must be text'
      using errcode = '22023';
  end if;

  if length(coalesce(p_patch ->> 'comment', '')) > 10000 then
    raise exception 'appointment comment is too long'
      using errcode = '22023';
  end if;

  select a.status, a.team_id
    into v_current_status, v_team
    from public.appointments a
   where a.id = p_appointment_id
     and a.tenant_id = public.current_tenant_id()
     and a.kind = 'work'
     and a.team_id in (select unnest(public.access_calendars('record.status', 'write')))
   for update;

  if not found then
    raise exception 'work appointment not found or no longer assigned'
      using errcode = 'P0002';
  end if;

  -- ЗАМЕТКА — СВОЁ ПРАВО (record.note, с 30.09), а не «Статус: Меняет»
  -- (аудит 03.10): партнёр со скрытой заметкой переписывал её этой дверью.
  if p_patch ? 'comment'
     and (v_team = any(public.access_calendars('record.note', 'write'))) is not true then
    raise exception 'master cannot change the appointment note'
      using errcode = '42501';
  end if;

  if p_patch ? 'status'
     and not (
       (p_patch ->> 'status') = v_current_status
       or (
         v_current_status = 'scheduled'
         and (p_patch ->> 'status') = 'in_progress'
       )
       or (
         v_current_status = 'in_progress'
         and (p_patch ->> 'status') = 'completed'
       )
     ) then
    raise exception 'master appointment status transition is not allowed'
      using errcode = '23514';
  end if;

  update public.appointments a
     set status = case
           when p_patch ? 'status' then p_patch ->> 'status'
           else a.status
         end,
         comment = case
           when p_patch ? 'comment' then p_patch ->> 'comment'
           else a.comment
         end
   where a.id = p_appointment_id
     and a.tenant_id = public.current_tenant_id()
  returning jsonb_build_object(
    'id', a.id,
    'status', a.status,
    'comment', a.comment,
    'updated_at', a.updated_at
  ) into v_result;

  return v_result;
end;
$function$;

-- ── 3 ─────────────────────────────────────────────────────────────────────
revoke execute on function public.tenant_effective_plan(uuid) from authenticated;
