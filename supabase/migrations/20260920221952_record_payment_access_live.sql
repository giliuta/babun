-- STORY-084, ВОЛНА 1: «Оплата в записи» становится настоящим правом.
--
-- ЧТО БЫЛО. Блок `record.payment` лежал в реестре мёртвым, а деньги внутри
-- записи проверялись отдельной функцией `current_user_can_pay_appointment`,
-- которая уровней не читала вовсе: мастеру хватало того, что запись — его
-- («p_master_id = current_user_master_id()»), а диспетчеру — старого
-- календарного гранта. То есть владелец ставил «Финансы: Скрыт», а человек
-- продолжал принимать наличные и снимать оплату.
--
-- Хуже: `record_appointment_payment` и `cancel_appointment_payment` —
-- SECURITY DEFINER, они пишут в `finance_transactions` МИМО политик, которые
-- построила финансовая волна 15.09. Гарантия «деньги этого календаря закрыты»
-- была дырявой ровно здесь.
--
-- ЕЩЁ ТРИ ДВЕРИ К ТЕМ ЖЕ ДЕНЬГАМ проверяли только право ПРАВИТЬ ЗАПИСЬ:
-- `set_appointment_prepayment`, `reset_appointment_payment`,
-- `undo_appointment_payment`. Они двигают деньги, значит спрашивают и про
-- деньги.
--
-- РАДИУС ПОРАЖЕНИЯ — НОЛЬ, И ЭТО ПРОВЕРЕНО. Приложение и до этой волны гасило
-- плитки оплаты по старому календарному гранту `finance`, а у единственного
-- не-владельца в базе стоит `record.payment = write` (страница прав хранит
-- уровни и неживых блоков с 15.09). Значит «до = после» на экране держится
-- само; закрывается только сырой вызов RPC мимо интерфейса. Сторож в конце
-- проверяет это числом.

-- ─── Снимок политик: волна их не трогает, и сторож это докажет ──────────

create temp table _record_payment_policies_before as
  select schemaname, tablename, policyname, cmd, qual, with_check
    from pg_policies
   where schemaname = 'public';

-- ─── 1. Право на деньги записи ─────────────────────────────────────────

create or replace function public.current_user_can_pay_appointment(
  p_team_id text,
  p_master_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  role_name text := coalesce(public.current_user_role(), '');
begin
  if auth.uid() is null then
    return false;
  end if;
  if role_name = 'owner' then
    return true;
  end if;
  -- СВОЯ ЗАПИСЬ БОЛЬШЕ НЕ ДАЁТ ПРАВА НА ДЕНЬГИ. Прежняя ветка мастера
  -- («запись моя — значит оплата моя») и есть закрываемая дыра: мастер с
  -- «Оплата в записи: Скрыт» принимал наличные в любом своём выезде.
  -- Второй аргумент оставлен для совместимости подписи — её знают обе
  -- денежные RPC — и права не даёт.
  return p_team_id is not null
     and p_team_id = any(public.access_calendars('record.payment', 'write'));
end;
$function$;

comment on function public.current_user_can_pay_appointment(text, text) is
  'STORY-084 волна 1: деньги записи — по уровню блока record.payment в её календаре. Второй аргумент ничего не решает и оставлен ради подписи.';

-- ─── 2. Три двери к тем же деньгам ─────────────────────────────────────
--
-- Патч якорем по живому телу (`pg_get_functiondef`), а не переписыванием:
-- функции длинные, и переписать их целиком значило бы утащить в миграцию
-- копию, которая завтра разойдётся с базой. Якорь обязан встретиться ровно
-- один раз — иначе исключение.

do $patch$
declare
  target text;
  body text;
  anchor constant text :=
    E'  if not public.current_user_can_edit_work_appointment(appointment_row.team_id) then\n    raise exception ''Заявка не найдена'';\n  end if;\n';
  addition constant text :=
    E'  if not public.current_user_can_pay_appointment(appointment_row.team_id, appointment_row.master_id) then\n    raise exception ''Оплату этой записи менять нельзя'' using errcode = ''42501'', hint = ''block:record.payment'';\n  end if;\n';
begin
  foreach target in array array[
    'set_appointment_prepayment',
    'reset_appointment_payment',
    'undo_appointment_payment'
  ] loop
    select pg_get_functiondef(p.oid) into body
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = target;

    if body is null then
      raise exception 'STORY-084: функции public.% нет в базе', target;
    end if;
    if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
      raise exception 'STORY-084: якорь в public.% встретился не один раз — патч отменён', target;
    end if;
    if position('current_user_can_pay_appointment' in body) > 0 then
      raise exception 'STORY-084: public.% уже спрашивает про деньги — волна уже накатана?', target;
    end if;

    execute replace(body, anchor, anchor || addition);
  end loop;
end
$patch$;

-- ─── 3. Касса не предлагает того, на что сервер откажет ────────────────

create or replace function public.list_payment_accounts_safe(p_team_id text)
returns setof jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', a.id,
    'name', a.name,
    'kind', a.kind,
    'scope', a.scope,
    'icon', a.icon,
    'color', a.color,
    'position', a.position
  )
    from public.accounts a
   where p_team_id is not null
     and btrim(p_team_id) <> ''
     and a.tenant_id = public.current_tenant_id()
     and a.is_active = true
     and a.show_in_payments = true
     -- Пикер кассы держится того же права, что и сама оплата: «видно, но при
     -- нажатии ошибка» не бывает (AGENTS, правило 10). Остаток этой кассы
     -- по-прежнему закрыт блоком «Счета и остатки» — здесь только имя.
     and (select public.current_user_can_pay_appointment(p_team_id, null))
     and (
       (a.scope = 'team' and a.brigade_id = p_team_id)
       or (a.scope = 'company' and exists (
         select 1 from public.account_teams att
          where att.account_id = a.id and att.team_id = p_team_id
       ))
     )
   order by (a.scope = 'team') desc, a.is_primary desc, a.position, a.name, a.id
$function$;

-- ─── 4. Реестр: блок стал живым ────────────────────────────────────────

update public.access_blocks
   set live = true,
       enforced_by = array[
         'function:public.current_user_can_pay_appointment(text, text)',
         'function:public.record_appointment_payment',
         'function:public.cancel_appointment_payment',
         'function:public.set_appointment_prepayment',
         'function:public.reset_appointment_payment',
         'function:public.undo_appointment_payment',
         'function:public.list_payment_accounts_safe(text)'
       ]
 where key = 'record.payment';

-- ─── 5. Права меняются живьём, без перезапуска приложения ──────────────

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
-- Первая линия — ПОВЕДЕНИЕ, а не текст: правило проверяется вызовом от имени
-- настоящего сотрудника, а не чтением исходника. Вторая — мутант: временно
-- возвращаем старое правило и убеждаемся, что проверка упала. Зелёный сторож
-- без мутанта ничего не охраняет (память проекта, 2026-09-10).

do $guard$
declare
  victim record;
  saved_level text;
  before_count integer;
  after_count integer;
begin
  -- (а) Поведение: сотрудник без уровня деньги не берёт, с уровнем — берёт.
  select tm.tenant_id, tm.user_id, mc.team_id
    into victim
    from public.tenant_members tm
    join public.member_calendars mc
      on mc.tenant_id = tm.tenant_id and mc.user_id = tm.user_id
   where tm.role <> 'owner'
   limit 1;

  if victim.user_id is null then
    raise notice 'STORY-084: сотрудников в базе нет — поведенческий сторож пропущен';
  else
    perform set_config(
      'request.jwt.claims',
      json_build_object(
        'sub', victim.user_id,
        'role', 'authenticated',
        'app_metadata', json_build_object('tenant_id', victim.tenant_id)
      )::text,
      true
    );
    perform set_config(
      'request.headers',
      json_build_object('x-babun-tenant', victim.tenant_id)::text,
      true
    );

    select ma.level into saved_level
      from public.member_access ma
     where ma.tenant_id = victim.tenant_id
       and ma.user_id = victim.user_id
       and ma.block = 'record.payment'
       and ma.team_id = victim.team_id;

    -- «Скрыт» — отказ.
    delete from public.member_access
     where tenant_id = victim.tenant_id and user_id = victim.user_id
       and block = 'record.payment' and team_id = victim.team_id;
    if public.current_user_can_pay_appointment(victim.team_id, null) then
      raise exception 'STORY-084 сторож: без уровня деньги записи всё ещё разрешены';
    end if;

    -- «Меняет» — разрешение.
    insert into public.member_access (tenant_id, user_id, block, team_id, level)
    values (victim.tenant_id, victim.user_id, 'record.payment', victim.team_id, 'write');
    if not public.current_user_can_pay_appointment(victim.team_id, null) then
      raise exception 'STORY-084 сторож: с уровнем «Меняет» деньги записи запрещены';
    end if;

    -- (б) Мутант: старое правило обязано провалить проверку (а).
    execute $mutant$
      create or replace function public.current_user_can_pay_appointment(p_team_id text, p_master_id text)
      returns boolean language sql stable security definer set search_path to 'public'
      as 'select true'
    $mutant$;
    delete from public.member_access
     where tenant_id = victim.tenant_id and user_id = victim.user_id
       and block = 'record.payment' and team_id = victim.team_id;
    if not public.current_user_can_pay_appointment(victim.team_id, null) then
      raise exception 'STORY-084 сторож: мутант не сработал — проверка (а) ничего не доказывает';
    end if;

    -- Возвращаем настоящее правило.
    execute $real$
      create or replace function public.current_user_can_pay_appointment(p_team_id text, p_master_id text)
      returns boolean language plpgsql stable security definer set search_path to 'public'
      as $body$
      declare
        role_name text := coalesce(public.current_user_role(), '');
      begin
        if auth.uid() is null then
          return false;
        end if;
        if role_name = 'owner' then
          return true;
        end if;
        return p_team_id is not null
           and p_team_id = any(public.access_calendars('record.payment', 'write'));
      end;
      $body$
    $real$;

    -- Возвращаем уровень, который стоял до сторожа.
    delete from public.member_access
     where tenant_id = victim.tenant_id and user_id = victim.user_id
       and block = 'record.payment' and team_id = victim.team_id;
    if saved_level is not null then
      insert into public.member_access (tenant_id, user_id, block, team_id, level)
      values (victim.tenant_id, victim.user_id, 'record.payment', victim.team_id, saved_level);
    end if;

    perform set_config('request.jwt.claims', null, true);
    perform set_config('request.headers', null, true);
  end if;

  -- (в) Текст: старых веток в правиле не осталось.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'current_user_can_pay_appointment'
       and p.prosrc like '%access_calendars(''record.payment''%'
  ) then
    raise exception 'STORY-084 сторож: правило не спрашивает уровень record.payment';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'current_user_can_pay_appointment'
       and (p.prosrc like '%current_user_master_id%'
         or p.prosrc like '%current_user_team_ids%'
         or p.prosrc like '%current_user_calendar_ids%')
  ) then
    raise exception 'STORY-084 сторож: в правиле осталась старая ветка';
  end if;

  -- (г) Три двери спрашивают про деньги.
  if exists (
    select 1 from unnest(array[
      'set_appointment_prepayment','reset_appointment_payment','undo_appointment_payment'
    ]) as want(name)
    where not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = want.name
         and p.prosrc like '%current_user_can_pay_appointment%'
    )
  ) then
    raise exception 'STORY-084 сторож: не все денежные двери спрашивают про оплату';
  end if;

  -- (д) Реестр: блок живой, и каждый названный адрес существует.
  if not exists (
    select 1 from public.access_blocks
     where key = 'record.payment' and live = true and array_length(enforced_by, 1) >= 7
  ) then
    raise exception 'STORY-084 сторож: блок record.payment не стал живым';
  end if;

  -- (е) Чужие политики не поехали.
  select count(*) into before_count from _record_payment_policies_before;
  select count(*) into after_count from pg_policies where schemaname = 'public';
  if before_count <> after_count then
    raise exception 'STORY-084 сторож: число политик изменилось (% → %)', before_count, after_count;
  end if;
end
$guard$;

drop table _record_payment_policies_before;
