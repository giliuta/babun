-- SMS «ПРИ ОТМЕНЕ» ЖДЁТ МИНУТУ, А ВОЗВРАТ ВИЗИТА ВОЗВРАЩАЕТ ОЧЕРЕДЬ.
--
-- Отмена визита ставит шаблон «При отмене» команды в очередь сама — человек
-- ничего не отправляет. Но рядом с отменой в приложении живёт откат: тост
-- «Визит отменён · Отменить» (пять секунд) и «Восстановить» у отменённой
-- записи. Оба — обычное обновление статуса назад в план.
--
--   • «ОТМЕНЕНО» УХОДИЛО ДО ОТКАТА. Триггер ставил сообщение без срока и тут
--     же будил сервер отправки (`sms_wake`): через секунду оно уже было
--     «отправляется», и откат из тоста снимал из очереди пустоту. Клиент
--     получал «визит отменён», а за ним — «визит перенесён». Теперь у
--     «При отмене» срок — не раньше чем через минуту после отмены
--     (`send_after`; `sms_claim` раньше срока сообщение не берёт), и отмена
--     сервер не будит: сообщение заберёт тик расписания (раз в 5 минут) после
--     этой минуты. Сервер отправки не меняется — срок читает база.
--   • ОТКАТ СНИМАЕТ «ОТМЕНЕНО» ПРИ ЛЮБОМ НОВОМ СТАТУСЕ. Раньше — только при
--     возврате в план; откат отмены выполненной записи (статус «выполнена»)
--     оставлял «отменено» в очереди.
--   • ПОДТВЕРЖДЕНИЕ НЕ ПОВТОРЯЕТСЯ. Возврат ставил «После записи» заново,
--     если для текущего времени визита его ещё не было, — а у перенесённой
--     записи время другое, и клиент, уже получивший подтверждение и перенос,
--     получал второе «записали вас». Теперь подтверждение встаёт, только если
--     клиенту его ещё ни разу не отправляли по этой записи.
--   • НАПОМИНАНИЯ ВСТАЮТ СРАЗУ. Отмена снимает неотправленные «До визита» и
--     «Накануне»; вернуть их — дело расписания `sms_enqueue_due`, но оно ходит
--     раз в 5 минут, и напоминание, чей момент уже настал, ждало следующего
--     тика. Теперь возврат зовёт ту же функцию для одной записи
--     (`sms_enqueue_due(p_appointment)`) — правила те же, второй копии нет.

-- ── sms_enqueue: срок «При отмене» ─────────────────────────────────────────
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
  -- «При отмене» ждёт минуту: отмену откатывают тостом «Отменить» или
  -- «Восстановить», и возврат снимает сообщение, пока оно в очереди. Без
  -- срока сервер отправки забирал его через секунду — откат не успевал.
  if tpl.trigger = 'cancelled' then
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

-- ── sms_enqueue_due: та же проверка — для всех записей или для одной ───────
-- Новый необязательный аргумент меняет подпись, поэтому старая функция
-- удаляется: два варианта сделали бы вызов `sms_enqueue_due()` из `sms_tick`
-- неоднозначным.
drop function if exists public.sms_enqueue_due();

CREATE OR REPLACE FUNCTION public.sms_enqueue_due(p_appointment uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  start_at timestamptz;
  moment timestamptz;
  tz text;
  n integer := 0;
begin
  if not public.sms_service_on() then
    return 0;
  end if;

  -- `p_appointment` — одна запись: её возвращают из отмены, и напоминание,
  -- чей момент уже настал, должно встать сразу, а не через тик. Без него —
  -- все записи (тик расписания).

  -- «ЗА N ЧАСОВ» и «НАКАНУНЕ В ЧЧ:ММ». Момент отправки: начало минус N
  -- часов / накануне в ЧЧ:ММ по времени календаря. Запись (или перенос)
  -- должна быть заведена ДО момента — иначе её закрывает подтверждение.
  -- Проспали момент больше чем на 3 часа (сервис был выключен, шаблон
  -- завели поздно) — не шлём: «напоминание» в полночь хуже, чем никакого.
  -- Команды — только с именем отправителя.
  for r in
    select a.id, a.created_at, a.date, tpl.id as tpl_id, tpl.trigger, tpl.hours, tpl.at_time
      from public.sms_team_senders snd
      join public.sms_team_templates tpl
        on tpl.tenant_id = snd.tenant_id and tpl.team_id = snd.team_id and tpl.enabled
       and tpl.trigger in ('before', 'day_before')
      join public.appointments a
        on a.tenant_id = snd.tenant_id
       and a.team_id = snd.team_id
       and a.kind = 'work'
       and a.status = 'scheduled'
       and a.client_id is not null
       and a.date between to_char(now() - interval '1 day', 'YYYY-MM-DD')
                      and to_char(now() + interval '8 days', 'YYYY-MM-DD')
     where p_appointment is null or a.id = p_appointment
  loop
    start_at := public.sms_appointment_start(r.id);
    continue when start_at is null or start_at <= now();
    if r.trigger = 'before' then
      moment := start_at - make_interval(hours => r.hours);
    else
      tz := public.sms_appointment_tz(r.id);
      begin
        moment := ((r.date::date - 1)::text || ' ' || r.at_time)::timestamp at time zone tz;
      exception when others then
        continue;
      end;
    end if;
    continue when now() < moment
      or now() > moment + interval '3 hours'
      or r.created_at > moment;
    continue when exists (
      select 1 from public.sms_messages m
       where m.appointment_id = r.id
         and (
           (m.template_id = r.tpl_id::text and m.for_start = start_at)
           or (m.trigger_type in ('new_appointment', 'reschedule') and m.created_at > moment)
         )
    );
    if public.sms_enqueue(r.id, r.tpl_id) then
      n := n + 1;
    end if;
  end loop;

  -- «ПОРА ПОВТОРИТЬ»: последний выполненный визит клиента был N месяцев
  -- назад (окно — неделя, чтобы старая история не ушла разом), будущей
  -- записи нет.
  for r in
    select a.id, a.date, tpl.id as tpl_id, tpl.months
      from public.sms_team_senders snd
      join public.sms_team_templates tpl
        on tpl.tenant_id = snd.tenant_id and tpl.team_id = snd.team_id and tpl.enabled and tpl.trigger = 'repeat'
      join public.appointments a
        on a.tenant_id = snd.tenant_id
       and a.team_id = snd.team_id
       and a.kind = 'work'
       and a.status = 'completed'
       and a.client_id is not null
       and a.date between to_char(now() - interval '25 months', 'YYYY-MM-DD')
                      and to_char(now() - interval '1 month', 'YYYY-MM-DD')
     where (p_appointment is null or a.id = p_appointment)
       and not exists (
         select 1 from public.sms_messages m
          where m.appointment_id = a.id and m.template_id = tpl.id::text
       )
       and not exists (
         select 1 from public.appointments later
          where later.tenant_id = a.tenant_id and later.client_id = a.client_id
            and later.kind = 'work' and later.id <> a.id
            and (
              (later.status = 'completed' and later.date > a.date)
              or (later.status in ('scheduled', 'in_progress') and later.date >= to_char(now(), 'YYYY-MM-DD'))
            )
       )
  loop
    continue when not (
      r.date::date + make_interval(months => r.months) <= current_date
      and r.date::date + make_interval(months => r.months) > current_date - 7
    );
    if public.sms_enqueue(r.id, r.tpl_id) then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$function$;
-- Зовут её только расписание (`sms_tick`) и триггер записи — оба под ролью
-- `postgres`; клиентам приложения она не нужна.
revoke all on function public.sms_enqueue_due(uuid) from public, anon, authenticated, service_role;

-- ── appointments_sms_trigger: отмена не будит, возврат возвращает ─────────
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
        if not exists (
          select 1 from public.sms_messages m
           where m.appointment_id = new.id and m.status = 'queued'
             and m.trigger_type in ('new_appointment', 'reschedule')
        ) then
          if public.sms_enqueue_trigger(new.id, 'rescheduled') then
            queued := true;
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
