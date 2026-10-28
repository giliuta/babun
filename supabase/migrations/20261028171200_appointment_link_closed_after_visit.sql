-- ССЫЛКА /r/<токен> ПОСЛЕ ВИЗИТА МОЛЧИТ (пачка 6, С2).
--
-- Ссылка из SMS бессрочная, а `appointment_link_lookup` отдавал по ней адрес,
-- имя клиента, услуги, дату и время и через год после визита, и после отмены:
-- кто угодно с пересланной SMS видел, где и когда человек бывает дома. Теперь
-- адрес и имя нужны ссылке только до визита: у прошедшей и отменённой записи
-- ответ — состояние и шапка компании (её имя и знак страница рисует сверху, и
-- о человеке они ничего не говорят). Подтверждённая запись после визита тоже
-- «прошла»: раньше она отвечала «подтверждена» со всеми полями навсегда.
-- `appointment_link_answer` возвращает этот же ответ — после отмены по ссылке
-- клиент видит «Запись отменена» без деталей.

create or replace function public.appointment_link_lookup(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  r record;
  start_at timestamptz;
  v_state text;
begin
  if p_token is null or length(p_token) not between 10 and 64 then
    return jsonb_build_object('state', 'missing');
  end if;
  select l.appointment_id, l.answer, l.answered_at,
         a.status, a.date, a.time_start, a.address, a.services,
         tn.name as business_name, tn.logo_url,
         coalesce(nullif(trim(cl.sms_name), ''), split_part(trim(coalesce(cl.full_name, '')), ' ', 1)) as first_name
    into r
    from public.appointment_links l
    join public.appointments a on a.id = l.appointment_id
    join public.tenants tn on tn.id = l.tenant_id
    left join public.clients cl on cl.id = a.client_id
   where l.token = p_token;
  if not found then
    return jsonb_build_object('state', 'missing');
  end if;
  start_at := public.sms_appointment_start(r.appointment_id);
  v_state := case
    when r.status = 'cancelled' then 'cancelled'
    when start_at is null or start_at <= now() or r.status <> 'scheduled' then 'past'
    when r.answer = 'confirmed' then 'confirmed'
    else 'pending' end;
  if v_state in ('cancelled', 'past') then
    return jsonb_build_object(
      'state', v_state,
      'business_name', r.business_name,
      'logo_url', r.logo_url
    );
  end if;
  return jsonb_build_object(
    'state', v_state,
    'business_name', r.business_name,
    'logo_url', r.logo_url,
    'client_first_name', r.first_name,
    'date', r.date,
    'time', left(r.time_start, 5),
    'address', r.address,
    'services', coalesce((
      select jsonb_agg(line ->> 'serviceName')
        from jsonb_array_elements(case when jsonb_typeof(r.services) = 'array' then r.services else '[]'::jsonb end) line
       where coalesce(line ->> 'serviceName', '') <> ''
    ), '[]'::jsonb),
    'answered_at', r.answered_at
  );
end;
$function$;

do $guard$
begin
  if position('if v_state in (''cancelled'', ''past'') then' in
       pg_get_functiondef('public.appointment_link_lookup(text)'::regprocedure)) = 0 then
    raise exception 'appointment_link_lookup снова отдаёт детали прошедшей записи';
  end if;
end;
$guard$;
