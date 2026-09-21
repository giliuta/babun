-- STORY-084, ВОЛНА 3: «Клиент в записи» и «Объект в записи» — настоящие права.
--
-- СЛОВО ВЛАДЕЛЬЦА, 21.09: «клиент — видит он клиента или не видит; объект —
-- видит он объект или не видит; метка — видит, не видит или может
-- редактировать». Про эти два блока сказано ДВА положения, и в реестре их
-- становится два: третьего сервер не проверяет, а лишнее положение на
-- странице прав — обещание, которого никто не сдержит (STORY-083).
--
-- ЧТО БЫЛО. Окно чтения мастера (`list_master_appointments_safe`) отдавало
-- `client_id` и весь адрес выезда КАЖДОМУ, кто дотянулся до записи. Блоки
-- лежали в реестре мёртвыми, и владелец не мог ни скрыть клиента, ни скрыть
-- адрес: переключателя не было вовсе.
--
-- ПЕРЕНОС СЕГОДНЯШНЕЙ КАРТИНЫ. Умолчание блока — «Скрыт», поэтому каждому
-- прикреплённому проставляется «Смотрит»: сегодня мастер видит и клиента, и
-- адрес — завтра видит ровно то же, пока владелец сам не закроет.
--
-- СОБЫТИЯ НЕ ТРОГАЕМ. У события свой блок («События», ещё спит), и адрес
-- события — его собственный, а не объект выезда. Маска стоит только на
-- `kind = 'work'`; запись без календаря маскируется тоже (`team_id is null`
-- не попадёт ни в один список доступа) — это закрытая сторона.
--
-- ПОЧЕМУ ЭТО ОКНО И ХВАТИТ. Владелец читает записи таблицей, и он всё видит
-- по определению; приглашение с карточки заводит только `master`
-- (`invitation-contract.ts`: `p_role: "master"`), а мастер к таблице не
-- допущен политикой `appointments_select` — его единственная дорога к записям
-- эта функция. Диспетчеров в базе нет ни одного.
--
-- ЗАОДНО: блок-мешок `finance.settings` («Категории, шаблоны, НДС») снят.
-- Он никогда не был живым, а его смысл 21.09 разошёлся на три отдельных
-- переключателя. Уровень, который владелец уже успел поставить, переезжает
-- в каждый из трёх — право не пропадает вместе со строкой.

-- ─── 1. Положений два — как сказал владелец ────────────────────────────
--
-- Сначала сохранённые «Меняет» становятся «Смотрит», потом сужается список:
-- сторож таблицы (`member_access_validate`) проверяет положение по списку
-- блока, и строка с исчезнувшим положением застряла бы — ни поправить, ни
-- пересохранить. «Смотрит» — старшее из оставшихся, право не урезается.

update public.member_access
   set level = 'read'
 where block in ('record.client', 'record.object')
   and level = 'write';

update public.access_blocks
   set levels = array['off', 'read']
 where key in ('record.client', 'record.object');

-- ─── 2. Перенос сегодняшней картины ────────────────────────────────────

insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
select mc.tenant_id, mc.user_id, b.key, mc.team_id, 'read', mc.attached_by, now()
  from public.member_calendars mc
  cross join (values ('record.client'), ('record.object')) as b(key)
 where not exists (
   select 1 from public.member_access ma
    where ma.tenant_id = mc.tenant_id and ma.user_id = mc.user_id
      and ma.block = b.key and ma.team_id = mc.team_id)
on conflict do nothing;

-- ─── 3. Окно чтения маскирует по уровню ────────────────────────────────
--
-- Оба списка календарей считаются ОДИН раз в `me` (materialized): правило
-- «SECURITY DEFINER в выражении считается на каждую строку» стоило нам
-- 4778 мс в сентябре, и повторять это на тысяче записей незачем.

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
    select public.current_user_role()                      as role,
           public.current_tenant_id()                      as tenant_id,
           public.current_user_master_id()                 as master_id,
           public.current_user_team_ids()                  as legacy_team_ids,
           public.current_user_calendar_ids('view')        as granted_team_ids,
           public.access_calendars('record.client', 'read') as client_teams,
           public.access_calendars('record.object', 'read') as object_teams
  )
  select jsonb_build_object(
    'id', a.id,
    'tenant_id', a.tenant_id,
    'client_id', case
      when a.kind <> 'work' or a.team_id = any(me.client_teams) then a.client_id
    end,
    'team_id', a.team_id,
    'master_id', a.master_id,
    'location_id', case
      when a.kind <> 'work' or a.team_id = any(me.object_teams) then a.location_id
    end,
    'date', a.date,
    'time_start', a.time_start,
    'time_end', a.time_end,
    'kind', a.kind,
    'status', a.status,
    'comment', a.comment,
    'address', case
      when a.kind <> 'work' or a.team_id = any(me.object_teams) then a.address
      else ''
    end,
    'address_note', case
      when a.kind <> 'work' or a.team_id = any(me.object_teams) then a.address_note
      else ''
    end,
    'address_lat', case
      when a.kind <> 'work' or a.team_id = any(me.object_teams) then a.address_lat
    end,
    'address_lng', case
      when a.kind <> 'work' or a.team_id = any(me.object_teams) then a.address_lng
    end,
    'cancel_reason', a.cancel_reason,
    'source', a.source,
    'is_online_booking', a.is_online_booking,
    'consent_given', a.consent_given,
    'color_override', a.color_override,
    'reminder_enabled', a.reminder_enabled,
    'reminder_offsets', a.reminder_offsets,
    'reminder_template', a.reminder_template,
    'service_ids', a.service_ids,
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
    'total_amount', 0,
    'custom_total', false,
    'discount_amount', 0,
    'prepaid_amount', 0,
    'paid_amount', 0,
    'payment_status', 'unpaid',
    'payment_method', null,
    'payments', '[]'::jsonb,
    'payment', null,
    'expenses', '[]'::jsonb,
    'services', '[]'::jsonb,
    'service_price_overrides', '{}'::jsonb,
    'global_discount', null
  )
    from public.appointments a
    cross join me
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

-- ─── 4. Реестр: блоки стали живыми ─────────────────────────────────────

update public.access_blocks
   set live = true,
       enforced_by = array['function:public.list_master_appointments_safe(integer, integer)']
 where key in ('record.client', 'record.object');

-- ─── 5. Мешок «Категории, шаблоны, НДС» разошёлся на три ───────────────

insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
select ma.tenant_id, ma.user_id, b.key, ma.team_id, ma.level, ma.set_by, now()
  from public.member_access ma
  cross join (values ('finance.categories'), ('finance.templates'), ('finance.vat')) as b(key)
 where ma.block = 'finance.settings'
   and not exists (
     select 1 from public.member_access x
      where x.tenant_id = ma.tenant_id and x.user_id = ma.user_id
        and x.block = b.key and x.team_id is not distinct from ma.team_id)
on conflict do nothing;

delete from public.member_access where block = 'finance.settings';

-- ─── 5а. Ждущие приглашения несут права внутри себя ────────────────────
--
-- Приём применяет их `access_apply_changes`, а та отказывает на неизвестном
-- блоке (`access:bad_block`), и сторож таблицы — на исчезнувшем положении
-- (`access:bad_level`). Не переписать их — значит оставить приглашение,
-- которое нельзя принять. Правило то же, что у живых строк: мешок отдаёт
-- уровень трём наследникам (если владелец их уже не назвал сам), «Меняет»
-- у клиента и объекта становится «Смотрит». Пуш «приглашение принято»
-- здесь не уйдёт: он только на переход к `accepted_at`.

update public.invitations i
   set access_changes = (
     select coalesce(jsonb_agg(s.change order by s.ord), '[]'::jsonb)
       from (
         select x.ord,
                case
                  when x.change ->> 'block' in ('record.client', 'record.object')
                   and x.change ->> 'level' = 'write'
                    then jsonb_set(x.change, '{level}', '"read"')
                  else x.change
                end as change
           from jsonb_array_elements(i.access_changes) with ordinality as x(change, ord)
          where x.change ->> 'block' is distinct from 'finance.settings'
         union all
         select 100000 + x.ord * 10 + heir.n,
                jsonb_build_object('block', heir.key, 'team_id', x.change -> 'team_id',
                                   'level', x.change -> 'level')
           from jsonb_array_elements(i.access_changes) with ordinality as x(change, ord)
           cross join (values (1, 'finance.categories'), (2, 'finance.templates'), (3, 'finance.vat'))
                   as heir(n, key)
          where x.change ->> 'block' = 'finance.settings'
            and not exists (
              select 1 from jsonb_array_elements(i.access_changes) named
               where named ->> 'block' = heir.key)
       ) s
   )
 where i.accepted_at is null
   and jsonb_typeof(i.access_changes) = 'array'
   and exists (
     select 1 from jsonb_array_elements(i.access_changes) c
      where c ->> 'block' = 'finance.settings'
         or (c ->> 'block' in ('record.client', 'record.object') and c ->> 'level' = 'write'));

delete from public.access_blocks where key = 'finance.settings';

-- ─── 6. Права меняются живьём ──────────────────────────────────────────

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
-- Сначала ПОВЕДЕНИЕ настоящего сотрудника, потом МУТАНТ: окно без маски
-- обязано провалить ту же проверку. Зелёный сторож без мутанта ничего не
-- охраняет (память проекта, 2026-09-10).

do $guard$
declare
  emp record;
  real_def text;
  with_client integer;
  with_address integer;
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

    -- (а) При «Смотрит» клиент и адрес приходят.
    select count(*) filter (where nullif(r ->> 'client_id', '') is not null),
           count(*) filter (where nullif(r ->> 'address', '') is not null)
      into with_client, with_address
      from public.list_master_appointments_safe(0, 1000) r;
    if with_client = 0 then
      raise exception 'STORY-084 сторож: при «Смотрит» клиент записи не приходит';
    end if;
    if with_address = 0 then
      raise exception 'STORY-084 сторож: при «Смотрит» адрес выезда не приходит';
    end if;

    -- (б) При «Скрыт» не приходят.
    update public.member_access set level = 'off'
     where tenant_id = emp.tenant_id and user_id = emp.user_id
       and block in ('record.client', 'record.object') and team_id = emp.team_id;

    select count(*) filter (where nullif(r ->> 'client_id', '') is not null),
           count(*) filter (where nullif(r ->> 'address', '') is not null)
      into with_client, with_address
      from public.list_master_appointments_safe(0, 1000) r
     where (r ->> 'kind') = 'work';
    if with_client > 0 then
      raise exception 'STORY-084 сторож: клиент уходит мимо record.client (% строк)', with_client;
    end if;
    if with_address > 0 then
      raise exception 'STORY-084 сторож: адрес уходит мимо record.object (% строк)', with_address;
    end if;

    -- (в) Мутант: окно без маски обязано провалить проверку (б).
    select pg_get_functiondef(p.oid) into real_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'list_master_appointments_safe';

    execute $mutant$
      create or replace function public.list_master_appointments_safe(
        p_offset integer default 0, p_limit integer default 1000
      ) returns setof jsonb language sql stable security definer set search_path to 'public'
      as $body$
        select jsonb_build_object('kind', a.kind, 'client_id', a.client_id, 'address', a.address)
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

    select count(*) filter (where nullif(r ->> 'client_id', '') is not null)
      into with_client
      from public.list_master_appointments_safe(0, 1000) r
     where (r ->> 'kind') = 'work';
    if with_client = 0 then
      raise exception 'STORY-084 сторож: мутант не потёк — проверка (б) ничего не доказывает';
    end if;

    execute real_def;

    -- (г) Настоящее окно снова молчит, и уровень возвращается на место.
    select count(*) filter (where nullif(r ->> 'client_id', '') is not null)
      into with_client
      from public.list_master_appointments_safe(0, 1000) r
     where (r ->> 'kind') = 'work';
    if with_client > 0 then
      raise exception 'STORY-084 сторож: настоящее окно не вернулось';
    end if;

    update public.member_access set level = 'read'
     where tenant_id = emp.tenant_id and user_id = emp.user_id
       and block in ('record.client', 'record.object') and team_id = emp.team_id;

    perform set_config('request.jwt.claims', null, true);
    perform set_config('request.headers', null, true);
  end if;

  -- (д) Реестр: два положения, оба блока живые, мешка больше нет.
  if exists (
    select 1 from public.access_blocks
     where key in ('record.client', 'record.object')
       and (not live or levels <> array['off', 'read'])
  ) then
    raise exception 'STORY-084 сторож: блоки записи не получили ровно два живых положения';
  end if;
  if exists (select 1 from public.access_blocks where key = 'finance.settings') then
    raise exception 'STORY-084 сторож: блок-мешок finance.settings остался в реестре';
  end if;

  -- (е) Ни одна строка прав и ни одно ждущее приглашение не держат
  -- положения, которого у блока больше нет: иначе их не пересохранить и
  -- не принять.
  if exists (
    select 1 from public.member_access ma
      join public.access_blocks b on b.key = ma.block
     where not (ma.level = any(b.levels))
  ) then
    raise exception 'STORY-084 сторож: в правах осталось исчезнувшее положение';
  end if;
  if exists (
    select 1 from public.invitations i
     cross join lateral jsonb_array_elements(
       case when jsonb_typeof(i.access_changes) = 'array' then i.access_changes else '[]'::jsonb end
     ) c
      left join public.access_blocks b on b.key = c ->> 'block'
     where i.accepted_at is null
       and (b.key is null or not ((c ->> 'level') = any(b.levels)))
  ) then
    raise exception 'STORY-084 сторож: ждущее приглашение нельзя будет принять';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'list_master_appointments_safe'
       and p.prosrc like '%access_calendars(''record.client''%'
       and p.prosrc like '%access_calendars(''record.object''%'
  ) then
    raise exception 'STORY-084 сторож: окно чтения не спрашивает уровни';
  end if;
end
$guard$;
