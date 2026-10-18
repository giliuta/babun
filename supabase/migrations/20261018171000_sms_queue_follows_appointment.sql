-- ОЧЕРЕДЬ SMS СВЕРЯЕТСЯ С ЗАПИСЬЮ, КАКОЙ ОНА СТАЛА.
--
-- Сообщение ставится в очередь при событии записи, а уходит позже — через
-- часы («После визита» +N ч, сдвиг в окно отправки). Отказ клиента, архив
-- календаря и баланс `sms_charge` проверял при отправке, а саму запись — нет:
--
--   • СМЕНИЛИ КЛИЕНТА — сообщение в очереди уходило прежнему клиенту (его
--     номер и имя лежат в строке очереди), а дата, адрес и ссылка — нового
--     визита. Триггер записи смену клиента не слушал. Теперь неотправленные
--     автоматические сообщения записи ставятся заново — новому клиенту, с тем
--     же шаблоном и сроком (`sms_enqueue` сам проверит его телефон и отказ), а
--     `sms_charge` не отправляет сообщение, клиент которого уже не клиент
--     записи.
--   • ЗАПИСЬ УДАЛИЛИ — неотправленные «до визита» и «спасибо» уходили по
--     удалённой записи. Теперь удаление записи переводит её неотправленные
--     автоматические сообщения в «заблокировано: Запись удалена», а `sms_charge`
--     не отправляет автоматическое сообщение без записи. «Вернуть» из
--     «Удалённых» возвращает их в очередь, если они ещё к месту: «до визита» —
--     пока визит впереди, «спасибо» — не позже суток после срока.
--   • ВЕРНУЛИ ОТМЕНЁННУЮ — неотправленное «запись отменена» уходило, хотя
--     визит снова в силе, а подтверждения клиент не получал. Теперь
--     «отменено» снимается и ставится подтверждение; если «отменено» уже
--     ушло, а подтверждение было раньше, — сообщение о переносе.
--   • ОТМЕНИЛИ ВЫПОЛНЕННУЮ — «спасибо за визит» и «пора повторить» в очереди
--     уходили по отменённой записи. Отмена снимает и их.
--   • ИМЯ ИЗ ЭМОДЗИ — эмодзи сервер отправки вырезает из готового текста, и
--     «Здравствуйте, [Имя]!» уходило как «Здравствуйте, !». Теперь эмодзи
--     вырезаются из имени до подстановки: пустое имя — шаблон с [Имя] не
--     заполняется и не уходит, как и в приложении.

-- Эмодзи — то же правило, что `stripEmoji` приложения и сервера отправки:
-- символы вне основной плоскости (UTF-16 — суррогатные пары), U+2600–U+27BF,
-- селектор VS16 и склейка ZWJ; пробелы схлопываются.
create or replace function public.sms_strip_emoji(p_text text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select btrim(regexp_replace(
    regexp_replace(coalesce(p_text, ''), '[\U00010000-\U0010FFFF\u2600-\u27BF\uFE0F\u200D]', '', 'g'),
    '\s+', ' ', 'g'
  ))
$function$;
revoke all on function public.sms_strip_emoji(text) from public, anon, authenticated;

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
      -- «Вернуть» из «Удалённых записей» — не новая запись (16.10).
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
      if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
        -- Отмена: неотправленное «до визита» и «после визита» уже ни к чему.
        delete from public.sms_messages
         where appointment_id = new.id and status = 'queued'
           and trigger_type in ('new_appointment', 'reminder', 'reschedule', 'thank_you', 'repeat');
        if public.sms_enqueue_trigger(new.id, 'cancelled') then
          queued := true;
        end if;
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
        -- Отмену вернули: «отменено» в очереди — уже неправда. Подтверждение
        -- встаёт, если его ещё нет (снятое отменой или не заведённое); а
        -- если оно было, но клиент уже прочёл «отменено», — сообщение о
        -- переносе: визит снова в силе.
        delete from public.sms_messages
         where appointment_id = new.id and status = 'queued' and trigger_type = 'cancellation';
        if public.sms_enqueue_trigger(new.id, 'created') then
          queued := true;
        elsif exists (
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

-- Смена клиента — тоже событие для SMS.
drop trigger if exists appointments_sms on public.appointments;
create trigger appointments_sms
  after insert or update of status, date, time_start, client_id on public.appointments
  for each row execute function public.appointments_sms_trigger();

-- Удаление записи. Связь очереди с записью — `on delete set null`: без этого
-- неотправленное ушло бы по записи, которой нет. Сообщения не стираются, а
-- блокируются — их видно в истории, и «Вернуть» из «Удалённых» возвращает их
-- в очередь (`sms_messages_revive_on_restore`). Имя `zz_` — последним из
-- триггеров «до удаления»: сторож, отменивший удаление, до этого не допустит.
create or replace function public.appointments_sms_deleted()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update public.sms_messages
     set status = 'blocked', error_code = 'appointment_deleted', error_message = 'Запись удалена'
   where appointment_id = old.id and status = 'queued'
     and trigger_type not in ('manual', 'bulk', 'test');
  return old;
exception when others then
  -- SMS не имеет права помешать удалению.
  raise warning 'appointments_sms_deleted: %', sqlerrm;
  return old;
end;
$function$;
revoke all on function public.appointments_sms_deleted() from public, anon, authenticated;

drop trigger if exists zz_appointments_sms_deleted on public.appointments;
create trigger zz_appointments_sms_deleted
  before delete on public.appointments
  for each row execute function public.appointments_sms_deleted();

-- «Вернуть» из «Удалённых» привязывает сообщения обратно к записи
-- (`deleted_appointment_bring_back`). Заблокированное удалением снова встаёт
-- в очередь, если ещё к месту; текст соберётся заново при отправке.
create or replace function public.sms_messages_revive_on_restore()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if (new.trigger_type in ('new_appointment', 'reschedule', 'cancellation')
        and new.for_start > now())
     or (new.trigger_type = 'reminder'
        and new.for_start > now()
        and coalesce(new.send_after, new.created_at) > now() - interval '3 hours')
     or (new.trigger_type in ('thank_you', 'repeat')
        and coalesce(new.send_after, new.created_at) > now() - interval '1 day') then
    new.status := 'queued';
    new.error_code := null;
    new.error_message := null;
    new.message_body := null;
    new.segments := null;
    new.claimed_at := null;
  end if;
  return new;
end;
$function$;
revoke all on function public.sms_messages_revive_on_restore() from public, anon, authenticated;

drop trigger if exists sms_messages_revive_on_restore on public.sms_messages;
create trigger sms_messages_revive_on_restore
  before update of appointment_id on public.sms_messages
  for each row
  when (old.appointment_id is null and new.appointment_id is not null
        and old.status = 'blocked' and old.error_code = 'appointment_deleted')
  execute function public.sms_messages_revive_on_restore();

CREATE OR REPLACE FUNCTION public.sms_charge(p_id uuid, p_body text, p_segments integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- АВТОМАТИЧЕСКОЕ СООБЩЕНИЕ — О ЗАПИСИ, КАКОЙ ОНА СТАЛА. Запись удалили
  -- (связь с ней обнулилась) или сменили клиента, пока сообщение ждало
  -- очереди: ни SMS, ни денег. Ручное сообщение написано человеку — уходит.
  if m.trigger_type not in ('manual', 'bulk', 'test') then
    if m.appointment_id is null then
      update public.sms_messages
         set status = 'blocked', message_body = p_body, segments = segs,
             error_code = 'appointment_deleted', error_message = 'Запись удалена'
       where id = p_id;
      return 'no_funds';
    end if;
    if exists (
      select 1 from public.appointments a
       where a.id = m.appointment_id and a.client_id is distinct from m.client_id
    ) then
      update public.sms_messages
         set status = 'blocked', message_body = p_body, segments = segs,
             error_code = 'client_changed', error_message = 'У записи другой клиент'
       where id = p_id;
      return 'no_funds';
    end if;
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

CREATE OR REPLACE FUNCTION public.sms_claim(p_limit integer DEFAULT 20)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cap_platform integer := coalesce(
    (select nullif(value, '')::integer from public.app_settings where key = 'sms_hourly_cap'), 2000);
  cap_tenant integer := coalesce(
    (select nullif(value, '')::integer from public.app_settings where key = 'sms_tenant_hourly_cap'), 1000);
begin
  if (select count(*) from public.sms_ledger
       where kind = 'send' and created_at > now() - interval '1 hour') >= cap_platform then
    perform public.sms_alert(null, 'platform_cap',
      format('За час ушло %s SMS — отправка всей платформы на паузе', cap_platform));
    return;
  end if;
  update public.sms_alerts set resolved_at = now()
   where tenant_id is null and kind = 'platform_cap' and resolved_at is null;
  return query
  with picked as (
    select m.id
      from public.sms_messages m
     where m.status = 'queued'
       and (m.send_after is null or m.send_after <= now())
       and not exists (
         select 1 from public.tenant_sms_config f
          where f.tenant_id = m.tenant_id and f.frozen_at is not null
       )
       and (
         select count(*) from public.sms_ledger l
          where l.tenant_id = m.tenant_id and l.kind = 'send'
            and l.created_at > now() - interval '1 hour'
       ) < cap_tenant
     order by coalesce(m.send_after, m.created_at)
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 20), 100))
  ), claimed as (
    update public.sms_messages m
       set status = 'sending', claimed_at = now()
      from picked
     where m.id = picked.id
    returning m.*
  ), texts as (
    select c.*,
           coalesce(c.template_body, (
             select tpl ->> 'body'
               from public.tenant_state ts,
                    jsonb_array_elements(coalesce(ts.prototype_state -> 'smsTemplates', '[]'::jsonb)) tpl
              where ts.tenant_id = c.tenant_id and tpl ->> 'id' = c.template_id
              limit 1
           )) as tpl_text
      from claimed c
  )
  select jsonb_build_object(
    'id', c.id,
    'tenant_id', c.tenant_id,
    'to_phone', c.to_phone,
    'body', c.message_body,
    'trigger_type', c.trigger_type,
    'template_body', c.tpl_text,
    'sender', public.sms_team_sender(c.tenant_id, coalesce(a.team_id, c.team_id)),
    'vars', jsonb_build_object(
      -- Имя — без эмодзи (их режет сервер отправки из готового текста):
      -- имя из одних эмодзи пусто, и шаблон с [Имя] не заполняется.
      'name', coalesce(
        nullif(public.sms_strip_emoji(cl.sms_name), ''),
        split_part(public.sms_strip_emoji(cl.full_name), ' ', 1)
      ),
      'date', a.date,
      'time', a.time_start,
      'calendar', t.name,
      'services', coalesce((
        select jsonb_agg(line ->> 'serviceName')
          from jsonb_array_elements(case when jsonb_typeof(a.services) = 'array' then a.services else '[]'::jsonb end) line
      ), '[]'::jsonb),
      'address', a.address,
      'total', a.total_amount,
      'company', tn.name,
      'currency', tn.currency,
      'link', case
        when c.appointment_id is not null and coalesce(c.tpl_text, '') ~ '\[(Ссылка|Link)\]'
          then public.appointment_link_url(c.appointment_id)
      end
    )
  )
    from texts c
    left join public.appointments a on a.id = c.appointment_id
    left join public.clients cl on cl.id = c.client_id
    left join public.teams t on t.tenant_id = c.tenant_id and t.id = coalesce(a.team_id, c.team_id)
    left join public.tenants tn on tn.id = c.tenant_id;
end;
$function$;
