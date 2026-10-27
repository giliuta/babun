-- SMS «ПРИ ПЕРЕНОСЕ» ЖДЁТ МИНУТУ, А ОТКАТ ПЕРЕНОСА ЕГО СНИМАЕТ.
--
-- Перенос пальцем по сетке ставит шаблон команды «При переносе» в очередь сам
-- (триггер записи), и сервер отправки будился тут же: через секунду клиенту
-- уже уходило «ваша запись перенесена». Тост переноса живёт пять секунд и
-- несёт «Отменить» — откат возвращал время, а сообщение уже ушло, и второе
-- изменение времени ставило ВТОРОЕ «перенесена» (на прежнее время).
--
--   • «ПРИ ПЕРЕНОСЕ» ЖДЁТ МИНУТУ, как «При отмене» (`send_after`; `sms_claim`
--     раньше срока сообщение не берёт), и перенос сервер не будит: сообщение
--     заберёт тик расписания после этой минуты.
--   • У СООБЩЕНИЯ О ПЕРЕНОСЕ ЕСТЬ «ЧТО КЛИЕНТ ЗНАЛ» — `known_start`, начало
--     визита до переноса. Перенос обратно на это время, пока сообщение в
--     очереди, его снимает: «Отменить» в тосте останавливает и перенос, и SMS.
--     Перенос дальше (A → B → C) сообщение оставляет — текст собирается при
--     отправке и назовёт C.
--
-- Тела функций сняты с боевой 27.10 (md5 `prosrc` совпал с
-- `20261021113200_sms_cancel_undo.sql`: sms_enqueue 12c7a76f…,
-- appointments_sms_trigger a27a66c6…); правка — только два места выше.
-- НЕ НАКАЧЕНО: ждёт слова владельца.

alter table public.sms_messages
  add column if not exists known_start timestamptz;

comment on column public.sms_messages.known_start is
  'Перенос: начало визита, которое клиент знал до переноса. Откат на него, пока сообщение в очереди, снимает сообщение.';

-- ── sms_enqueue: срок «При переносе» ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sms_enqueue(p_appointment uuid, p_template uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Календарь в архиве клиентам не пишет.
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
  -- Имя отправителя и есть выключатель команды.
  if public.sms_team_sender(a.tenant_id, a.team_id) is null then
    return false;
  end if;

  start_at := public.sms_appointment_start(a.id);
  if start_at is null then
    return false;
  end if;
  send_at := greatest(coalesce(p_at, now()), now());
  -- «При отмене» и «При переносе» ждут минуту: отмену откатывают тостом
  -- «Отменить» или «Восстановить», перенос пальцем — тостом «Отменить», и
  -- откат снимает сообщение, пока оно в очереди. Без срока сервер отправки
  -- забирал его через секунду — откат не успевал.
  if tpl.trigger in ('cancelled', 'rescheduled') then
    send_at := greatest(send_at, now() + interval '60 seconds');
  end if;
  -- Окно шаблона «с send_from до send_to»: вне окна — ждать его начала
  -- (`sms_quiet_shift` считает «нельзя» от конца окна до начала). «Накануне
  -- в ЧЧ:ММ» уходит ровно в своё время — окно у него не действует.
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

-- ── appointments_sms_trigger: перенос не будит, откат снимает ─────────────
CREATE OR REPLACE FUNCTION public.appointments_sms_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  queued boolean := false;
  t record;
  end_at timestamptz;
  pending record;
begin
  begin
    if tg_op = 'INSERT' then
      -- «Вернуть» из «Удалённых записей» — не новая запись.
      if new.kind = 'work' and new.status = 'scheduled'
         and coalesce(current_setting('babun.appointment_restore', true), '') <> 'on' then
        queued := public.sms_enqueue_trigger(new.id, 'created');
      end if;
    else
      -- Сменили клиента: неотправленное прежнему клиенту не уходит — те же
      -- шаблоны с тем же сроком встают новому (телефон, отказ и окно
      -- проверит `sms_enqueue`). Ручные сообщения написаны человеку — их не
      -- трогаем.
      if new.client_id is distinct from old.client_id then
        for pending in
          delete from public.sms_messages
           where appointment_id = new.id and status = 'queued'
             and trigger_type not in ('manual', 'bulk', 'test')
          returning template_id, send_after
        loop
          continue when coalesce(pending.template_id, '')
            !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
          if public.sms_enqueue(new.id, pending.template_id::uuid, pending.send_after) then
            queued := true;
          end if;
        end loop;
      end if;
      -- Отмену откатили — тостом «Отменить» или «Восстановить», в план или
      -- обратно в «выполнена»: «отменено» в очереди уже неправда. Оно ждёт
      -- минуту (`sms_enqueue`), поэтому быстрый откат успевает его снять.
      if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
        delete from public.sms_messages
         where appointment_id = new.id and status = 'queued' and trigger_type = 'cancellation';
      end if;
      if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
        -- Отмена: неотправленное «до визита» и «после визита» уже ни к чему.
        delete from public.sms_messages
         where appointment_id = new.id and status = 'queued'
           and trigger_type in ('new_appointment', 'reminder', 'reschedule', 'thank_you', 'repeat');
        -- «При отмене» встаёт со сроком через минуту — будить сервер отправки
        -- незачем: сообщение заберёт тик расписания, а откат за эту минуту
        -- снимет его из очереди.
        perform public.sms_enqueue_trigger(new.id, 'cancelled');
      elsif new.status = 'completed' and old.status is distinct from 'completed' then
        end_at := public.sms_appointment_end(new.id);
        for t in
          select tpl.id, tpl.hours
            from public.sms_team_templates tpl
           where tpl.tenant_id = new.tenant_id and tpl.team_id = new.team_id
             and tpl.enabled and tpl.trigger = 'after'
        loop
          -- Отметили выполненной через сутки после срока — «спасибо» уже не к месту.
          if end_at is not null and end_at + make_interval(hours => t.hours) > now() - interval '1 day' then
            if public.sms_enqueue(new.id, t.id, end_at + make_interval(hours => t.hours)) then
              queued := true;
            end if;
          end if;
        end loop;
      elsif new.status = 'scheduled' and old.status = 'cancelled' then
        -- Визит снова в силе — клиент должен знать ровно то, что знал бы без
        -- отмены, и не больше.
        --
        -- Подтверждение («После записи») встаёт, только если клиенту его по
        -- этой записи ещё ни разу не отправляли: отмена сняла неотправленное,
        -- или шаблон завели позже записи. Если оно уже ушло — повтор не
        -- нужен: у перенесённой записи время другое, и без этой проверки
        -- клиент получил бы второе «записали вас». Сообщение, которое не ушло
        -- («не доставлено», «заблокировано»), отправленным не считается.
        if not exists (
          select 1 from public.sms_messages m
           where m.appointment_id = new.id and m.trigger_type = 'new_appointment'
             and m.status in ('sending', 'sent', 'delivered')
        ) then
          if public.sms_enqueue_trigger(new.id, 'created') then
            queued := true;
          end if;
        end if;
        -- Клиент уже прочёл «отменено» (откат пришёл позже минуты) — ему
        -- нужно сообщение о переносе: визит снова в силе. Если в очереди уже
        -- стоит подтверждение или перенос — оно и скажет, второе не нужно.
        if exists (
          select 1 from public.sms_messages m
           where m.appointment_id = new.id and m.trigger_type = 'cancellation'
             and m.status in ('sending', 'sent', 'delivered')
        ) and not exists (
          select 1 from public.sms_messages m
           where m.appointment_id = new.id and m.status = 'queued'
             and m.trigger_type in ('new_appointment', 'reschedule')
        ) then
          if public.sms_enqueue_trigger(new.id, 'rescheduled') then
            queued := true;
          end if;
        end if;
        -- Напоминания, снятые отменой или пропущенные, пока запись была
        -- отменена, — по правилам расписания, как у записи без отмены:
        -- будущие поставит тик, а наставшие (не позже трёх часов) — эта
        -- проверка сейчас. Ушедшие подтверждение или перенос их закрывают.
        if public.sms_enqueue_due(new.id) > 0 then
          queued := true;
        end if;
      elsif new.status = 'scheduled'
        and (new.date is distinct from old.date or new.time_start is distinct from old.time_start) then
        -- Перенос: напоминания о прежнем времени не нужны, новые поставит
        -- расписание. Неотправленное подтверждение или перенос уйдут с новой
        -- датой сами (текст собирается при отправке) — второй не нужен.
        delete from public.sms_messages
         where appointment_id = new.id and status = 'queued' and trigger_type = 'reminder';
        -- Перенос вернули на время, которое клиент уже знает («Отменить» в
        -- тосте, перенос туда и обратно), пока сообщение ждёт в очереди: писать
        -- ему не о чем — сообщение снимается.
        delete from public.sms_messages
         where appointment_id = new.id and status = 'queued' and trigger_type = 'reschedule'
           and known_start = public.sms_appointment_start(new.id);
        if not found and not exists (
          select 1 from public.sms_messages m
           where m.appointment_id = new.id and m.status = 'queued'
             and m.trigger_type in ('new_appointment', 'reschedule')
        ) then
          -- Сообщение ждёт минуту (`sms_enqueue`), поэтому сервер отправки не
          -- будим. При нём — время, которое клиент знал до переноса: по нему
          -- откат узнаёт, что сообщение больше не нужно.
          if public.sms_enqueue_trigger(new.id, 'rescheduled') then
            update public.sms_messages
               set known_start = (old.date || ' ' || left(old.time_start, 5))::timestamp
                                 at time zone public.sms_appointment_tz(new.id)
             where appointment_id = new.id and status = 'queued'
               and trigger_type = 'reschedule' and known_start is null;
          end if;
        end if;
      end if;
    end if;
    if queued then
      perform public.sms_wake();
    end if;
  exception when others then
    -- SMS не имеет права уронить запись.
    raise warning 'appointments_sms_trigger: %', sqlerrm;
  end;
  return null;
end;
$function$;
