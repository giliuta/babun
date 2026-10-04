-- ССЫЛКА ИЗ SMS И SMS АРХИВНОГО КАЛЕНДАРЯ (04.10, сессия 017, аудит
-- публичных страниц и настроек календаря).
--
-- Ссылки «Подтвердить / Отменить» в SMS ещё не запущены (в базе 0 ссылок),
-- но их функции живые и открыты: выдать ссылку может сотрудник, ответить по
-- ней — кто угодно без входа. Закрываем то, что работает уже сейчас:
--
-- 1. `sms_appointment_link` выдавал ссылку сотруднику по праву «Клиент в
--    записи: Видит», а ссылка ОТМЕНЯЕТ запись без входа. Теперь сотруднику —
--    только с правом «Отменять и удалять записи» этого календаря (проверка
--    `is not true`: NULL прав не пропускает). Прежняя защита от утечки
--    клиента (30.09) — на месте.
-- 2. `appointment_link_answer`:
--    • запись С ДЕНЬГАМИ (предоплата, оплата, доход по записи) по ссылке не
--      отменяется: отмена с деньгами = возврат (правило 03.10), и сверка
--      записывала клиенту возврат всей предоплаты — касса уменьшалась в
--      учёте, хотя денег никто не отдавал. Ответ — словами «Запись с оплатой
--      отменяют по телефону», статус не трогается;
--    • пустой ответ (`p_answer = NULL`) больше не проходит проверку и не
--      затирает «Подтверждаю» клиента.
-- 3. Ссылка адресована КЛИЕНТУ записи: при смене клиента в записи прежние
--    ссылки удаляются (триггер). Раньше клиент А по своей старой ссылке видел
--    имя, адрес и время клиента Б и мог отменить его запись.
-- 4. SMS календаря в архиве не уходят: `sms_enqueue` (через него ставят и
--    напоминания `sms_enqueue_due`, и триггер записи) не ставит сообщение для
--    неживого календаря, а `sms_charge` (последняя проверка перед Twilio)
--    блокирует уже стоящие в очереди — статус `blocked`, причина
--    «Календарь в архиве», без денег. Раньше «за N часов», «накануне» и
--    «пора повторить» уходили клиентам архивного календаря за счёт владельца.
--
-- Тела функций — живые (`pg_get_functiondef` перед правкой), изменены только
-- названные куски; `create or replace` сохраняет права.

-- 1 ────────────────────────────────────────────────────────────────────────
create or replace function public.sms_appointment_link(p_appointment_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_team text;
begin
  if auth.uid() is null or v_tenant is null or public.current_user_role() is null then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  select team_id into v_team from public.appointments
   where id = p_appointment_id and tenant_id = v_tenant and kind = 'work';
  if not found or not public.sms_can_see_team(v_team) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  -- Ссылка открывает без входа имя, адрес и услуги записи — сотруднику только
  -- там, где он сам видит клиента записи (защита базы 30.09).
  if public.current_user_role() is distinct from 'owner'
     and (v_team = any(public.access_calendars('record.client', 'read'))) is not true then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  -- Ссылка ещё и ОТМЕНЯЕТ запись без входа — сотруднику только с правом
  -- «Отменять и удалять записи» этого календаря (аудит 04.10).
  if public.current_user_role() is distinct from 'owner'
     and public.member_can('calendar.cancel', 'write', v_team) is not true then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  return public.appointment_link_url(p_appointment_id);
end;
$function$;

-- 2 ────────────────────────────────────────────────────────────────────────
create or replace function public.appointment_link_answer(p_token text, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  l public.appointment_links%rowtype;
  a record;
  start_at timestamptz;
begin
  if p_answer is null or p_answer not in ('confirmed', 'cancelled') then
    raise exception 'link: bad answer' using errcode = '22023';
  end if;
  select * into l from public.appointment_links where token = p_token for update;
  if not found then
    return jsonb_build_object('state', 'missing');
  end if;
  select ap.id, ap.status, ap.prepaid_amount, ap.paid_amount, ap.payment_status
    into a
    from public.appointments ap
   where ap.id = l.appointment_id
   for update;
  start_at := public.sms_appointment_start(l.appointment_id);
  if a.status = 'cancelled' then
    return public.appointment_link_lookup(p_token);
  end if;
  if a.status <> 'scheduled' or start_at is null or start_at <= now() then
    return public.appointment_link_lookup(p_token);
  end if;

  -- ЗАПИСЬ С ДЕНЬГАМИ ПО ССЫЛКЕ НЕ ОТМЕНЯЕТСЯ (аудит 04.10): отмена с
  -- деньгами = возврат, и сверка записала бы клиенту возврат, которого никто
  -- не делал. Такую запись клиент отменяет звонком.
  if p_answer = 'cancelled' and (
       coalesce(a.prepaid_amount, 0) > 0
       or coalesce(a.paid_amount, 0) > 0
       or a.payment_status in ('paid', 'partial')
       or exists (
         select 1 from public.finance_transactions f
          where f.appointment_id = a.id and f.type = 'income'
       )
     ) then
    raise exception 'Запись с оплатой отменяют по телефону'
      using errcode = 'P0001', hint = 'link:paid';
  end if;

  update public.appointment_links
     set answer = p_answer, answered_at = now()
   where appointment_id = l.appointment_id;
  if p_answer = 'cancelled' then
    update public.appointments
       set status = 'cancelled',
           cancel_reason = coalesce(nullif(cancel_reason, ''), 'Клиент отменил по ссылке из SMS')
     where id = l.appointment_id;
  end if;
  return public.appointment_link_lookup(p_token);
end;
$function$;

-- 3 ────────────────────────────────────────────────────────────────────────
create or replace function public.appointment_links_forget_on_client_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Ссылка из SMS адресована клиенту записи: сменили клиента — прежние
  -- ссылки больше не открывают запись.
  delete from public.appointment_links where appointment_id = new.id;
  return null;
end;
$function$;

revoke all on function public.appointment_links_forget_on_client_change() from public, anon, authenticated;

drop trigger if exists appointments_forget_links_on_client_change on public.appointments;
create trigger appointments_forget_links_on_client_change
  after update of client_id on public.appointments
  for each row
  when (old.client_id is distinct from new.client_id)
  execute function public.appointment_links_forget_on_client_change();

-- 4 ────────────────────────────────────────────────────────────────────────
create or replace function public.sms_enqueue(p_appointment uuid, p_template uuid, p_at timestamp with time zone default null::timestamp with time zone)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  tpl public.sms_team_templates%rowtype;
  c record;
  phone text;
  start_at timestamptz;
  send_at timestamptz;
  inserted uuid;
begin
  if not public.sms_service_on() then
    return false;
  end if;
  select ap.id, ap.tenant_id, ap.client_id, ap.team_id, ap.kind
    into a
    from public.appointments ap
   where ap.id = p_appointment;
  if not found or a.kind <> 'work' or a.client_id is null or a.team_id is null then
    return false;
  end if;
  -- Календарь в архиве клиентам не пишет (аудит 04.10).
  if not exists (
    select 1 from public.teams t
     where t.id = a.team_id and t.tenant_id = a.tenant_id and t.is_active
  ) then
    return false;
  end if;
  select * into tpl from public.sms_team_templates
   where id = p_template and tenant_id = a.tenant_id and team_id = a.team_id and enabled;
  if not found or tpl.trigger = 'manual' then
    return false;
  end if;
  -- Имя отправителя и есть выключатель команды (волна 11).
  if public.sms_team_sender(a.tenant_id, a.team_id) is null then
    return false;
  end if;

  start_at := public.sms_appointment_start(a.id);
  if start_at is null then
    return false;
  end if;
  -- Окно шаблона «с send_from до send_to»: вне окна — ждать его начала
  -- (`sms_quiet_shift` считает «нельзя» от конца окна до начала). «Накануне
  -- в ЧЧ:ММ» уходит ровно в своё время — окно у него не действует.
  send_at := greatest(coalesce(p_at, now()), now());
  if tpl.trigger <> 'day_before' then
    send_at := public.sms_quiet_shift(send_at, public.sms_appointment_tz(a.id), tpl.send_to, tpl.send_from);
  end if;
  -- До визита — только пока визит впереди: запись задним числом и отмена
  -- вчерашней — не повод писать клиенту, как и сообщение, которое окно
  -- отодвинуло за начало.
  if tpl.trigger in ('created', 'before', 'day_before', 'rescheduled', 'cancelled') and send_at >= start_at then
    return false;
  end if;

  select cl.phone, cl.phone_e164, cl.sms_opt_out, cl.blacklisted, cl.deleted_at
    into c
    from public.clients cl
   where cl.id = a.client_id and cl.tenant_id = a.tenant_id;
  if not found or c.deleted_at is not null or c.sms_opt_out or coalesce(c.blacklisted, false) then
    return false;
  end if;
  phone := coalesce(nullif(trim(c.phone_e164), ''), nullif(trim(c.phone), ''));
  if phone is null then
    return false;
  end if;

  insert into public.sms_messages (
    tenant_id, appointment_id, client_id, team_id, to_phone,
    trigger_type, template_id, template_body, for_start, send_after, status, mode
  ) values (
    a.tenant_id, a.id, a.client_id, a.team_id, phone,
    public.sms_trigger_kind(tpl.trigger), tpl.id::text, tpl.body, start_at,
    case when send_at > now() then send_at end,
    'queued', 'platform'
  )
  on conflict (appointment_id, template_id, for_start)
    where appointment_id is not null and template_id is not null
      and trigger_type not in ('manual', 'reschedule')
    do nothing
  returning id into inserted;
  return inserted is not null;
end;
$function$;

create or replace function public.sms_charge(p_id uuid, p_body text, p_segments integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m public.sms_messages%rowtype;
  cfg public.tenant_sms_config%rowtype;
  segs integer := greatest(1, coalesce(p_segments, 1));
  cost integer;
  v_after integer;
  v_opt_out boolean;
  v_black boolean;
  v_deleted boolean;
begin
  select * into m from public.sms_messages where id = p_id for update;
  if not found or m.status <> 'sending' then
    return 'gone';
  end if;

  -- КАЛЕНДАРЬ В АРХИВЕ (04.10): сообщения, поставленные до архива, не уходят
  -- — ни SMS, ни денег. Тот же канал «заблокировано», что ниже.
  if m.team_id is not null and not exists (
    select 1 from public.teams t
     where t.id = m.team_id and t.tenant_id = m.tenant_id and t.is_active
  ) then
    update public.sms_messages
       set status = 'blocked', message_body = p_body, segments = segs,
           error_code = 'team_archived', error_message = 'Календарь в архиве'
     where id = p_id;
    return 'no_funds';
  end if;

  -- КЛИЕНТ ОТКАЗАЛСЯ, ПОКА СООБЩЕНИЕ ЖДАЛО ОЧЕРЕДИ (03.10). Отказ от SMS,
  -- чёрный список и удаление `sms_enqueue` проверяет только при постановке, а
  -- отложенное сообщение («После визита» +N ч, сдвиг в окно 8–21) лежит в
  -- очереди часами. Решение — здесь, под замком строки, перед списанием и
  -- отправкой: ни денег, ни SMS. Без клиента (проверка своего номера) — мимо.
  select c.sms_opt_out, c.blacklisted, c.deleted_at is not null
    into v_opt_out, v_black, v_deleted
    from public.clients c
   where c.id = coalesce(
           m.client_id,
           (select a.client_id from public.appointments a where a.id = m.appointment_id)
         );
  if coalesce(v_opt_out, false) or coalesce(v_black, false) or coalesce(v_deleted, false) then
    update public.sms_messages
       set status = 'blocked', message_body = p_body,
           segments = segs,
           error_code = 'opt_out',
           error_message = case
             when v_deleted then 'Клиент удалён'
             when v_black then 'Клиент в чёрном списке'
             else 'Клиент просил не писать'
           end
     where id = p_id;
    return 'no_funds';
  end if;
  select * into cfg from public.tenant_sms_config where tenant_id = m.tenant_id for update;
  if not found then
    update public.sms_messages
       set status = 'blocked', message_body = p_body, segments = segs,
           error_code = 'no_config', error_message = 'SMS у компании не настроены'
     where id = p_id;
    return 'no_funds';
  end if;
  if cfg.frozen_at is not null then
    update public.sms_messages
       set status = 'blocked', message_body = p_body, segments = segs,
           error_code = 'frozen', error_message = 'Отправка SMS остановлена — проверяем баланс'
     where id = p_id;
    return 'no_funds';
  end if;
  if not public.sms_phone_allowed(m.to_phone) then
    update public.sms_messages
       set status = 'blocked', message_body = p_body, segments = segs,
           error_code = 'country', error_message = 'Страна номера не разрешена для SMS'
     where id = p_id;
    return 'no_funds';
  end if;
  segs := greatest(segs, public.sms_min_segments(p_body));
  cost := segs * public.sms_price_cents();
  if cfg.balance_cents < cost then
    update public.sms_messages
       set status = 'blocked', message_body = p_body, segments = segs,
           error_code = 'no_funds', error_message = 'Не хватило баланса'
     where id = p_id;
    return 'no_funds';
  end if;
  v_after := public.sms_ledger_post(m.tenant_id, 'send', -cost, m.id::text, null);
  if v_after is null then
    return 'gone';
  end if;
  update public.sms_messages
     set message_body = p_body, segments = segs, cost_cents = cost, was_free = false
   where id = p_id;
  update public.tenant_sms_config
     set total_sent_count = total_sent_count + 1
   where tenant_id = m.tenant_id;
  perform public.sms_autotopup_poke(m.tenant_id, v_after);
  return 'paid';
end;
$function$;

do $guard$
declare
  v_link text := pg_get_functiondef('public.sms_appointment_link(uuid)'::regprocedure);
  v_answer text := pg_get_functiondef('public.appointment_link_answer(text,text)'::regprocedure);
  v_enqueue text := pg_get_functiondef('public.sms_enqueue(uuid,uuid,timestamp with time zone)'::regprocedure);
  v_charge text := pg_get_functiondef('public.sms_charge(uuid,text,integer)'::regprocedure);
begin
  if position('calendar.cancel' in v_link) = 0
     or position('record.client' in v_link) = 0 then
    raise exception 'sms links: выдача ссылки без права отмены или без защиты клиента';
  end if;
  if position('p_answer is null' in v_answer) = 0
     or position('link:paid' in v_answer) = 0 then
    raise exception 'sms links: ответ по ссылке снова отменяет запись с деньгами или пропускает пустой ответ';
  end if;
  if position('t.is_active' in v_enqueue) = 0
     or position('team_archived' in v_charge) = 0 then
    raise exception 'sms: календарь в архиве снова пишет клиентам';
  end if;
  if position('sms_opt_out' in v_charge) = 0
     or position('sms_opt_out' in v_charge) > position('sms_ledger_post' in v_charge) then
    raise exception 'sms: проверка отказа клиента потеряна или стоит после списания';
  end if;
  if has_function_privilege('anon', 'public.sms_appointment_link(uuid)', 'execute') then
    raise exception 'sms links: выдача ссылки открыта anon';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgname = 'appointments_forget_links_on_client_change'
       and tgrelid = 'public.appointments'::regclass
  ) then
    raise exception 'sms links: смена клиента не гасит прежние ссылки';
  end if;
end;
$guard$;
