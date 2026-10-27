-- ОНЛАЙН-ЗАЯВКА: БЕЗ АВТОМАТИЧЕСКИХ SMS И БЕЗ ЧУЖОЙ КАРТОЧКИ (аудит 035, S-01 и S-02).
--
-- Страница babun.app/b открыта всем, и номер заказчик не подтверждает.
--
--   • S-01. Запись `online_booking_create` — обычная work/scheduled, поэтому
--     общий триггер SMS ставил по ней «После записи», а тик — напоминания:
--     любой, кто видит ссылку, мог слать платные SMS владельца на любые номера
--     мира (до ~480 в сутки с календаря при пределах 3/номер и 20/час).
--     Теперь `sms_enqueue` — единая воронка автоматических SMS (триггер
--     записи, `sms_enqueue_due`, `sms_tick`) — по записи с `source = 'online'`
--     ничего не ставит. Ручное SMS из записи пишет сотрудник
--     (`sms_send_manual`) — оно остаётся. Подтверждение заявки мастером
--     (и SMS после него) — следующий шаг онлайн-записи.
--   • S-02. Заявка цеплялась к существующему клиенту по одному номеру и не
--     смотрела чёрный список. Теперь — только при совпадении первого слова
--     имени; иначе запись встаёт без клиента, а имя и номер заявителя — в
--     заметке записи (клиента выбирает сотрудник, принимая заявку). Клиенту
--     из чёрного списка — «Онлайн-запись недоступна — позвоните нам».
--
-- `sms_enqueue` правится вставкой по якорю в ЖИВОЕ тело (его переопределяли
-- не раз): сторож падает, если якорь не найден ровно один раз.

do $patch$
declare
  d text := pg_get_functiondef('public.sms_enqueue(uuid, uuid, timestamptz)'::regprocedure);
  a1 text := '  select ap.id, ap.tenant_id, ap.client_id, ap.team_id, ap.kind
    into a';
  b1 text := '  select ap.id, ap.tenant_id, ap.client_id, ap.team_id, ap.kind, ap.source
    into a';
  a2 text := '  if not found or a.kind <> ''work'' or a.client_id is null or a.team_id is null then
    return false;
  end if;
';
  b2 text := '  if not found or a.kind <> ''work'' or a.client_id is null or a.team_id is null then
    return false;
  end if;
  -- Онлайн-заявку оставил человек без входа, номер не подтверждён:
  -- автоматических SMS по ней нет, иначе страница записи — дверь слать
  -- платные SMS владельца на любой номер. Ручное SMS из записи пишет
  -- сотрудник — оно идёт мимо этой функции.
  if a.source is not distinct from ''online'' then
    return false;
  end if;
';
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1
     or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then
    raise exception 'sms_enqueue: якорь не найден ровно один раз';
  end if;
  execute replace(replace(d, a1, b1), a2, b2);
end;
$patch$;

/** Заявка заказчика: запись в календарь команды. Ответ — что записано. */
create or replace function public.online_booking_create(
  p_token text,
  p_service text,
  p_date text,
  p_time text,
  p_name text,
  p_phone text
)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
declare
  r record;
  s record;
  v_name text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 80);
  v_phone text := btrim(coalesce(p_phone, ''));
  v_date date;
  v_start integer;
  v_duration integer;
  v_end integer;
  v_today date;
  v_client uuid;
  v_match uuid;
  v_match_names text[];
  v_match_blocked boolean;
  v_comment text := 'Онлайн-запись';
  v_appointment uuid := gen_random_uuid();
begin
  select * into r from public.online_booking_resolve(p_token);
  if not found then
    raise exception 'Ссылка не найдена' using errcode = 'P0001', hint = 'online:missing';
  end if;
  if r.state <> 'open' then
    raise exception 'Онлайн-запись сейчас закрыта' using errcode = 'P0001', hint = 'online:closed';
  end if;
  if length(v_name) < 2 then
    raise exception 'Напишите, как вас зовут' using errcode = '22023', hint = 'online:name';
  end if;
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Проверьте номер телефона' using errcode = '22023', hint = 'online:phone';
  end if;
  select sv.id, sv.name, sv.price, greatest(coalesce(sv.duration_minutes, 0), 0) as duration, sv.unit
    into s
    from public.services sv
   where sv.tenant_id = r.tenant_id and sv.team_id = r.team_id and sv.id = p_service
     and sv.is_active and sv.online_enabled;
  if not found then
    raise exception 'Эта услуга больше не записывается онлайн' using errcode = 'P0001', hint = 'online:service';
  end if;
  if coalesce(p_date, '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_time, '') !~ '^\d{2}:\d{2}$' then
    raise exception 'Выберите время' using errcode = '22023', hint = 'online:slot';
  end if;
  v_date := p_date::date;
  v_today := timezone(r.tz, now())::date;
  if v_date < v_today or v_date > v_today + 13 then
    raise exception 'Выберите время' using errcode = '22023', hint = 'online:slot';
  end if;

  -- Один календарь — одна очередь: второй заказчик на то же время ждёт
  -- первого и видит, что окно уже занято.
  perform pg_advisory_xact_lock(hashtextextended('online-booking:' || r.tenant_id::text || ':' || r.team_id, 0));

  if (select count(*) from public.online_booking_requests q
       where q.team_id = r.team_id and q.phone_e164 = v_phone
         and q.created_at > now() - interval '1 day') >= 3 then
    raise exception 'С этого номера уже есть заявки — позвоните нам' using errcode = 'P0001', hint = 'online:rate';
  end if;
  if (select count(*) from public.online_booking_requests q
       where q.team_id = r.team_id and q.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Слишком много заявок — попробуйте позже' using errcode = 'P0001', hint = 'online:rate';
  end if;

  v_duration := s.duration;
  if not (p_time = any(public.online_booking_day_slots(r.tenant_id, r.team_id, v_date, v_duration))) then
    raise exception 'Это время уже заняли — выберите другое' using errcode = 'P0001', hint = 'online:taken';
  end if;
  v_start := public.online_booking_hm(p_time);
  -- Услуга без длительности занимает шаг сетки — тот же, что проверен выше.
  v_end := least(v_start + greatest(v_duration, (
    select coalesce(t.default_slot_minutes, 30) from public.teams t
     where t.tenant_id = r.tenant_id and t.id = r.team_id
  )), 23 * 60 + 59);

  insert into public.online_booking_requests (team_id, tenant_id, phone_e164)
  values (r.team_id, r.tenant_id, v_phone);

  -- Клиент — по номеру в контактной базе компании, но номер заказчик не
  -- подтверждал: к карточке заявка встаёт, только если совпало и первое
  -- слово имени (полное имя или имя для SMS). Иначе это может быть чужой
  -- человек с чужим номером: запись встаёт БЕЗ клиента, а имя и номер
  -- заявителя — в заметке записи; клиента выбирает сотрудник, принимая
  -- заявку. Второго клиента с тем же номером не заводим: без phone_e164 он
  -- выпал бы из дедупа, поиска по номеру и уникального ключа. Клиенту из
  -- чёрного списка онлайн-запись закрыта.
  select c.id,
         array[lower(split_part(btrim(coalesce(c.full_name, '')), ' ', 1)),
               lower(split_part(btrim(coalesce(c.sms_name, '')), ' ', 1))],
         coalesce(c.blacklisted, false)
    into v_match, v_match_names, v_match_blocked
    from public.clients c
   where c.tenant_id = r.tenant_id and c.phone_e164 = v_phone and c.deleted_at is null
   limit 1;
  if v_match is not null then
    if v_match_blocked then
      raise exception 'Онлайн-запись недоступна — позвоните нам' using errcode = 'P0001', hint = 'online:refused';
    end if;
    if lower(split_part(v_name, ' ', 1)) = any(v_match_names) then
      v_client := v_match;
    else
      v_comment := 'Онлайн-запись · ' || v_name || ' · ' || v_phone;
    end if;
  else
    insert into public.clients (tenant_id, full_name, phone, phone_e164, team_id)
    values (r.tenant_id, v_name, v_phone, v_phone, r.team_id)
    returning id into v_client;
  end if;

  insert into public.appointments (
    id, tenant_id, client_id, team_id, date, time_start, time_end, kind, status,
    total_amount, comment, source, is_online_booking, service_ids, services, total_duration
  ) values (
    v_appointment, r.tenant_id, v_client, r.team_id, p_date, p_time,
    lpad((v_end / 60)::text, 2, '0') || ':' || lpad((v_end % 60)::text, 2, '0'),
    'work', 'scheduled', coalesce(s.price, 0), v_comment, 'online', true,
    jsonb_build_array(s.id),
    jsonb_build_array(jsonb_build_object(
      'serviceId', s.id,
      'serviceName', s.name,
      'quantity', 1,
      'duration', v_duration,
      'unit', s.unit,
      'pricePerUnit', coalesce(s.price, 0),
      'originalPrice', coalesce(s.price, 0),
      'totalPrice', coalesce(s.price, 0)
    )),
    v_duration
  );

  return jsonb_build_object(
    'state', 'booked',
    'business_name', r.business_name,
    'service', s.name,
    'date', p_date,
    'time', p_time
  );
end;
$function$;

-- СТОРОЖ: проверка онлайн-заявки стоит в воронке, права не съехали.
do $guard$
begin
  if position('a.source is not distinct from ''online''' in pg_get_functiondef('public.sms_enqueue(uuid, uuid, timestamptz)'::regprocedure)) = 0 then
    raise exception 'sms_enqueue: проверка онлайн-заявки не встала';
  end if;
  if has_function_privilege('anon', 'public.sms_enqueue(uuid, uuid, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.sms_enqueue(uuid, uuid, timestamptz)', 'execute') then
    raise exception 'sms_enqueue: открыта не тем ролям';
  end if;
  if not has_function_privilege('anon', 'public.online_booking_create(text, text, text, text, text, text)', 'execute') then
    raise exception 'online_booking_create: anon потерял дверь';
  end if;
end;
$guard$;
