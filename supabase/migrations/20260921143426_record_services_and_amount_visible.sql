-- STORY-084, ВОЛНА 4: «Услуги в записи» и «Сумма записи» — видны по уровню,
-- статус оплаты — по «Оплате в записи».
--
-- ЧТО БЫЛО. Окно мастера (`list_master_appointments_safe`) отдавало
-- `service_ids`, а строки услуг и все деньги обнуляло для ВСЕХ: мастер видел
-- названия работ из справочника, но ни одной цены и ни одной суммы, какие бы
-- права ни выставил владелец. Переключателей «Услуги» и «Сумма» на странице
-- прав не было вовсе.
--
-- ДВА ПОЛОЖЕНИЯ СЕЙЧАС, ТРЕТЬЕ — С ПРАВКОЙ. Владелец назвал для услуг и для
-- «Итого» три положения. «Меняет» появится в тот день, когда мастер сможет
-- править услуги и цены прямо в своей записи: у него нет двери для такой
-- правки, и «Меняет» сегодня было бы обещанием, которого сервер не сдержит
-- (STORY-083). Сохранённое «Меняет» становится «Смотрит» — старшим из
-- оставшихся; ждущие приглашения переписываются тем же правилом.
--
-- ПЕРЕНОС СЕГОДНЯШНЕЙ КАРТИНЫ. «Услуги» — всем прикреплённым «Смотрит»:
-- названия работ мастер видел и раньше. «Сумма» не досевается: денег мастер
-- не видел; уровень, который владелец уже поставил сам, применяется — так он
-- решил 15.09 («уровень хранится сейчас, применяется, когда блок оживёт»).
--
-- ЧТО ИМЕННО ВИДНО.
--   • «Услуги: Смотрит» — строки работ: имя, количество, единица,
--     длительность. Цены в строке — только при «Сумма: Смотрит»; без неё они
--     нули, а строка собирается по БЕЛОМУ списку ключей: новый денежный ключ
--     в строке завтра не утечёт сам.
--   • «Сумма: Смотрит» — итог записи, скидка, цены в строках.
--   • «Оплата: Смотрит» — оплачена ли запись; сколько внесено — только вместе
--     с «Суммой» (это деньги).
-- События (`kind <> 'work'`) не трогаем: у них своё право.

-- ─── 1. Два положения; «Меняет» → «Смотрит» ────────────────────────────

update public.member_access
   set level = 'read'
 where block in ('record.services', 'record.amount')
   and level = 'write';

update public.invitations i
   set access_changes = (
     select coalesce(jsonb_agg(
              case
                when x.change ->> 'block' in ('record.services', 'record.amount')
                 and x.change ->> 'level' = 'write'
                  then jsonb_set(x.change, '{level}', '"read"')
                else x.change
              end order by x.ord), '[]'::jsonb)
       from jsonb_array_elements(i.access_changes) with ordinality as x(change, ord)
   )
 where i.accepted_at is null
   and jsonb_typeof(i.access_changes) = 'array'
   and exists (
     select 1 from jsonb_array_elements(i.access_changes) c
      where c ->> 'block' in ('record.services', 'record.amount') and c ->> 'level' = 'write');

update public.access_blocks
   set levels = array['off', 'read']
 where key in ('record.services', 'record.amount');

-- ─── 2. Перенос сегодняшней картины: услуги видны ──────────────────────

insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
select mc.tenant_id, mc.user_id, 'record.services', mc.team_id, 'read', mc.attached_by, now()
  from public.member_calendars mc
 where not exists (
   select 1 from public.member_access ma
    where ma.tenant_id = mc.tenant_id and ma.user_id = mc.user_id
      and ma.block = 'record.services' and ma.team_id = mc.team_id)
on conflict do nothing;

-- ─── 3. Окно чтения ────────────────────────────────────────────────────

create or replace function public.list_master_appointments_safe(
  p_offset integer default 0,
  p_limit integer default 1000
)
returns setof jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with me as materialized (
    select public.current_user_role()                        as role,
           public.current_tenant_id()                        as tenant_id,
           public.current_user_master_id()                   as master_id,
           public.current_user_team_ids()                    as legacy_team_ids,
           public.current_user_calendar_ids('view')          as granted_team_ids,
           public.access_calendars('record.client', 'read')   as client_teams,
           public.access_calendars('record.object', 'read')   as object_teams,
           public.access_calendars('record.services', 'read') as services_teams,
           public.access_calendars('record.amount', 'read')   as amount_teams,
           public.access_calendars('record.payment', 'read')  as payment_teams
  )
  select jsonb_build_object(
    'id', a.id,
    'tenant_id', a.tenant_id,
    'client_id', case when v.see_client then a.client_id end,
    'team_id', a.team_id,
    'master_id', a.master_id,
    'location_id', case when v.see_object then a.location_id end,
    'date', a.date,
    'time_start', a.time_start,
    'time_end', a.time_end,
    'kind', a.kind,
    'status', a.status,
    'comment', a.comment,
    'address', case when v.see_object then a.address else '' end,
    'address_note', case when v.see_object then a.address_note else '' end,
    'address_lat', case when v.see_object then a.address_lat end,
    'address_lng', case when v.see_object then a.address_lng end,
    'cancel_reason', a.cancel_reason,
    'source', a.source,
    'is_online_booking', a.is_online_booking,
    'consent_given', a.consent_given,
    'color_override', a.color_override,
    'reminder_enabled', a.reminder_enabled,
    'reminder_offsets', a.reminder_offsets,
    'reminder_template', a.reminder_template,
    'service_ids', case
      when v.see_services then coalesce(a.service_ids, '[]'::jsonb)
      else '[]'::jsonb
    end,
    'total_duration', a.total_duration,
    'created_by', a.created_by,
    'created_at', a.created_at,
    'updated_at', a.updated_at,
    'event_all_day', a.event_all_day,
    'event_notes', a.event_notes,
    'event_url', a.event_url,
    'event_push_enabled', a.event_push_enabled,
    'event_push_offsets', a.event_push_offsets,
    'event_push_at', a.event_push_at,
    'event_repeat', a.event_repeat,
    'total_amount', case when v.see_amount then coalesce(a.total_amount, 0) else 0 end,
    'custom_total', case when v.see_amount then coalesce(a.custom_total, false) else false end,
    'discount_amount', case when v.see_amount then coalesce(a.discount_amount, 0) else 0 end,
    'prepaid_amount', 0,
    'paid_amount', case
      when v.see_payment and v.see_amount then coalesce(a.paid_amount, 0)
      else 0
    end,
    'payment_status', case
      when v.see_payment then coalesce(a.payment_status, 'unpaid')
      else 'unpaid'
    end,
    'payment_method', null,
    'payments', '[]'::jsonb,
    'payment', null,
    'expenses', '[]'::jsonb,
    'services', case
      when not v.see_services or jsonb_typeof(a.services) is distinct from 'array'
        then '[]'::jsonb
      when v.see_amount then a.services
      else (
        select coalesce(jsonb_agg(
                 jsonb_strip_nulls(jsonb_build_object(
                   'serviceId', line -> 'serviceId',
                   'serviceName', line -> 'serviceName',
                   'quantity', line -> 'quantity',
                   'unit', line -> 'unit',
                   'duration', line -> 'duration',
                   'variantId', line -> 'variantId'
                 )) || '{"pricePerUnit": 0, "originalPrice": 0, "totalPrice": 0}'::jsonb
                 order by ord), '[]'::jsonb)
          from jsonb_array_elements(a.services) with ordinality as l(line, ord)
      )
    end,
    'service_price_overrides', '{}'::jsonb,
    'global_discount', null
  )
    from public.appointments a
    cross join me
    cross join lateral (
      select
        coalesce(a.kind <> 'work' or a.team_id = any(me.client_teams), false)   as see_client,
        coalesce(a.kind <> 'work' or a.team_id = any(me.object_teams), false)   as see_object,
        coalesce(a.kind <> 'work' or a.team_id = any(me.services_teams), false) as see_services,
        coalesce(a.kind <> 'work' or a.team_id = any(me.amount_teams), false)   as see_amount,
        coalesce(a.kind <> 'work' or a.team_id = any(me.payment_teams), false)  as see_payment
    ) v
   where me.role = 'master'
     and a.tenant_id = me.tenant_id
     and (
       (
         a.kind = 'work'
         and (
           a.master_id = me.master_id
           or a.team_id = any(me.legacy_team_ids)
           or a.team_id = any(me.granted_team_ids)
         )
       )
       or (
         a.kind in ('event', 'personal')
         and a.team_id is not null
         and (
           a.team_id = any(me.legacy_team_ids)
           or a.team_id = any(me.granted_team_ids)
         )
       )
     )
   order by a.date, a.time_start, a.id
   offset greatest(coalesce(p_offset, 0), 0)
   limit greatest(1, least(coalesce(p_limit, 1000), 1000))
$function$;

-- ─── 4. Реестр ─────────────────────────────────────────────────────────

update public.access_blocks
   set live = true,
       enforced_by = array['function:public.list_master_appointments_safe(integer, integer)']
 where key in ('record.services', 'record.amount');

update public.access_blocks
   set enforced_by = array(select distinct e from unnest(enforced_by || array[
         'function:public.list_master_appointments_safe(integer, integer)'
       ]) as e)
 where key = 'record.payment';

-- ─── 5. Права меняются живьём ──────────────────────────────────────────

do $signal$
declare
  person record;
begin
  for person in
    update public.tenant_members tm
       set access_version = tm.access_version + 1
     where tm.role <> 'owner'
    returning tm.tenant_id, tm.user_id, tm.access_version
  loop
    perform realtime.send(
      jsonb_build_object('tenant_id', person.tenant_id, 'version', person.access_version),
      'access_changed',
      'access:' || person.user_id::text,
      true
    );
  end loop;
end
$signal$;

-- ─── Сторож ────────────────────────────────────────────────────────────
--
-- Поведение настоящего мастера при каждом сочетании, потом мутант: окно
-- без маски обязано провалить проверку «сумма скрыта». Уровни правятся
-- update'ом и возвращаются как были — «кто и когда выставил» не теряется.

do $guard$
declare
  emp record;
  saved_services text;
  saved_amount text;
  saved_payment text;
  real_def text;
  n_lines integer;
  n_total integer;
  n_priced integer;
  n_paid_status integer;
  n_paid_money integer;
begin
  select tm.tenant_id, tm.user_id, mc.team_id into emp
    from public.tenant_members tm
    join public.member_calendars mc
      on mc.tenant_id = tm.tenant_id and mc.user_id = tm.user_id
   where tm.role = 'master' limit 1;

  if emp.user_id is null then
    raise notice 'STORY-084: мастеров в базе нет — поведенческий сторож пропущен';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', emp.user_id, 'role', 'authenticated',
        'app_metadata', json_build_object('tenant_id', emp.tenant_id))::text, true);
    perform set_config('request.headers',
      json_build_object('x-babun-tenant', emp.tenant_id)::text, true);

    select max(level) filter (where block = 'record.services'),
           max(level) filter (where block = 'record.amount'),
           max(level) filter (where block = 'record.payment')
      into saved_services, saved_amount, saved_payment
      from public.member_access
     where tenant_id = emp.tenant_id and user_id = emp.user_id and team_id = emp.team_id
       and block in ('record.services', 'record.amount', 'record.payment');

    -- Строки нужны всем трём блокам: сторож кладёт недостающие и уберёт их.
    insert into public.member_access (tenant_id, user_id, block, team_id, level)
    select emp.tenant_id, emp.user_id, b, emp.team_id, 'read'
      from unnest(array['record.services', 'record.amount', 'record.payment']) b
     where not exists (
       select 1 from public.member_access ma
        where ma.tenant_id = emp.tenant_id and ma.user_id = emp.user_id
          and ma.block = b and ma.team_id = emp.team_id);

    -- (а) Всё «Смотрит»: строки с ценами, итог и оплата приходят.
    update public.member_access set level = 'read'
     where tenant_id = emp.tenant_id and user_id = emp.user_id and team_id = emp.team_id
       and block in ('record.services', 'record.amount', 'record.payment');
    select count(*) filter (where jsonb_array_length(r -> 'services') > 0),
           count(*) filter (where (r ->> 'total_amount')::numeric > 0),
           count(*) filter (where exists (
             select 1 from jsonb_array_elements(r -> 'services') l
              where (l ->> 'totalPrice')::numeric > 0)),
           count(*) filter (where r ->> 'payment_status' <> 'unpaid'),
           count(*) filter (where (r ->> 'paid_amount')::numeric > 0)
      into n_lines, n_total, n_priced, n_paid_status, n_paid_money
      from public.list_master_appointments_safe(0, 1000) r
     where r ->> 'kind' = 'work';
    if n_lines = 0 or n_total = 0 or n_priced = 0 or n_paid_status = 0 then
      raise exception 'STORY-084 сторож: при «Смотрит» не пришло (строки %, итог %, цены %, оплата %)',
        n_lines, n_total, n_priced, n_paid_status;
    end if;

    -- (б) «Сумма: Скрыт»: строки есть, денег нет — ни итога, ни цен, ни внесённого.
    update public.member_access set level = 'off'
     where tenant_id = emp.tenant_id and user_id = emp.user_id and team_id = emp.team_id
       and block = 'record.amount';
    select count(*) filter (where jsonb_array_length(r -> 'services') > 0),
           count(*) filter (where (r ->> 'total_amount')::numeric > 0),
           count(*) filter (where exists (
             select 1 from jsonb_array_elements(r -> 'services') l
              where coalesce((l ->> 'totalPrice')::numeric, 0) > 0
                 or coalesce((l ->> 'pricePerUnit')::numeric, 0) > 0
                 or coalesce((l ->> 'originalPrice')::numeric, 0) > 0
                 or l ? 'discount')),
           count(*) filter (where r ->> 'payment_status' <> 'unpaid'),
           count(*) filter (where (r ->> 'paid_amount')::numeric > 0)
      into n_lines, n_total, n_priced, n_paid_status, n_paid_money
      from public.list_master_appointments_safe(0, 1000) r
     where r ->> 'kind' = 'work';
    if n_lines = 0 then
      raise exception 'STORY-084 сторож: без «Суммы» пропали сами работы';
    end if;
    if n_total > 0 or n_priced > 0 or n_paid_money > 0 then
      raise exception 'STORY-084 сторож: деньги уходят мимо record.amount (итог %, цены %, внесено %)',
        n_total, n_priced, n_paid_money;
    end if;
    if n_paid_status = 0 then
      raise exception 'STORY-084 сторож: без «Суммы» пропал статус оплаты';
    end if;

    -- (в) «Оплата: Скрыт»: статуса оплаты нет.
    update public.member_access set level = 'off'
     where tenant_id = emp.tenant_id and user_id = emp.user_id and team_id = emp.team_id
       and block = 'record.payment';
    select count(*) filter (where r ->> 'payment_status' <> 'unpaid')
      into n_paid_status
      from public.list_master_appointments_safe(0, 1000) r
     where r ->> 'kind' = 'work';
    if n_paid_status > 0 then
      raise exception 'STORY-084 сторож: статус оплаты уходит мимо record.payment (% строк)', n_paid_status;
    end if;

    -- (г) «Услуги: Скрыт»: ни строк, ни идентификаторов.
    update public.member_access set level = 'off'
     where tenant_id = emp.tenant_id and user_id = emp.user_id and team_id = emp.team_id
       and block = 'record.services';
    select count(*) filter (where jsonb_array_length(r -> 'services') > 0
                               or jsonb_array_length(r -> 'service_ids') > 0)
      into n_lines
      from public.list_master_appointments_safe(0, 1000) r
     where r ->> 'kind' = 'work';
    if n_lines > 0 then
      raise exception 'STORY-084 сторож: услуги уходят мимо record.services (% строк)', n_lines;
    end if;

    -- (д) Мутант: окно без маски при «Сумма: Скрыт» обязано показать деньги.
    select pg_get_functiondef(p.oid) into real_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'list_master_appointments_safe';
    execute $mutant$
      create or replace function public.list_master_appointments_safe(
        p_offset integer default 0, p_limit integer default 1000
      ) returns setof jsonb language sql stable security definer set search_path to 'public'
      as $body$
        select jsonb_build_object('kind', a.kind, 'total_amount', a.total_amount)
          from public.appointments a
         where a.tenant_id = public.current_tenant_id()
           and a.kind = 'work'
           and (
             a.master_id = public.current_user_master_id()
             or a.team_id = any(public.current_user_team_ids())
             or a.team_id = any(public.current_user_calendar_ids('view'))
           )
         offset greatest(coalesce(p_offset, 0), 0)
         limit greatest(1, least(coalesce(p_limit, 1000), 1000))
      $body$
    $mutant$;
    select count(*) filter (where (r ->> 'total_amount')::numeric > 0)
      into n_total
      from public.list_master_appointments_safe(0, 1000) r
     where r ->> 'kind' = 'work';
    if n_total = 0 then
      raise exception 'STORY-084 сторож: мутант не потёк — проверка (б) ничего не доказывает';
    end if;
    execute real_def;

    -- Уровни — как были до сторожа.
    delete from public.member_access
     where tenant_id = emp.tenant_id and user_id = emp.user_id and team_id = emp.team_id
       and ((block = 'record.services' and saved_services is null)
         or (block = 'record.amount' and saved_amount is null)
         or (block = 'record.payment' and saved_payment is null));
    update public.member_access set level = saved_services
     where tenant_id = emp.tenant_id and user_id = emp.user_id and team_id = emp.team_id
       and block = 'record.services' and saved_services is not null;
    update public.member_access set level = saved_amount
     where tenant_id = emp.tenant_id and user_id = emp.user_id and team_id = emp.team_id
       and block = 'record.amount' and saved_amount is not null;
    update public.member_access set level = saved_payment
     where tenant_id = emp.tenant_id and user_id = emp.user_id and team_id = emp.team_id
       and block = 'record.payment' and saved_payment is not null;

    perform set_config('request.jwt.claims', null, true);
    perform set_config('request.headers', null, true);
  end if;

  if exists (
    select 1 from public.access_blocks
     where key in ('record.services', 'record.amount')
       and (not live or levels <> array['off', 'read'])
  ) then
    raise exception 'STORY-084 сторож: услуги и сумма не получили два живых положения';
  end if;
  if exists (
    select 1 from public.member_access ma join public.access_blocks b on b.key = ma.block
     where not (ma.level = any(b.levels))
  ) then
    raise exception 'STORY-084 сторож: в правах осталось исчезнувшее положение';
  end if;
  if exists (
    select 1 from public.invitations i
     cross join lateral jsonb_array_elements(
       case when jsonb_typeof(i.access_changes) = 'array' then i.access_changes else '[]'::jsonb end) c
      left join public.access_blocks b on b.key = c ->> 'block'
     where i.accepted_at is null and (b.key is null or not ((c ->> 'level') = any(b.levels)))
  ) then
    raise exception 'STORY-084 сторож: ждущее приглашение нельзя будет принять';
  end if;
  if exists (
    select 1 from public.member_calendars mc
     where not exists (
       select 1 from public.member_access ma
        where ma.tenant_id = mc.tenant_id and ma.user_id = mc.user_id
          and ma.block = 'record.services' and ma.team_id = mc.team_id)
  ) then
    raise exception 'STORY-084 сторож: прикреплённый остался без «Услуг» — он потерял бы названия работ';
  end if;
end
$guard$;
