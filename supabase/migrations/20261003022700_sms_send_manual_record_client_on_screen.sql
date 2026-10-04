-- SMS ИЗ ЗАПИСИ — КЛИЕНТУ НА ЭКРАНЕ, И ОНА ОСТАЁТСЯ SMS ЭТОЙ ЗАПИСИ
-- (STORY-089; владелец 03.10: «отправлял несколько раз SMS — в блоке SMS в
-- записи не отбивались… пришло три, значит три должно прописать»).
--
-- Что было. С записью сервер брал клиента из СОХРАНЁННОЙ записи. Клиента в
-- записи сменили и ещё не сохранили — номер нового клиента отбивался как
-- чужой («sms:phone»), а приложение в обход отправляло SMS без записи, и в
-- блоке SMS записи её не было.
--
-- Что теперь. С записью клиент — тот, что прислало приложение (на экране),
-- а нет — клиент записи; запись к SMS привязывается всегда. Кому можно —
-- решают прежние проверки ниже без изменений: сотруднику — только клиент его
-- команды (`member_client_in_team`), номер — только принадлежащий клиенту,
-- клиент — только этой компании. Запись без сохранённого клиента, но с
-- выбранным на экране, теперь тоже шлёт.
--
-- Тело — из `pg_proc.prosrc` 03.10, меняется только ветка записи; параметры и
-- умолчания те же (create or replace), права не трогаются.

create or replace function public.sms_send_manual(p_appointment_id uuid, p_client_id uuid, p_body text, p_template_id text default null::text, p_team_id text default null::text, p_phone text default null::text)
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
