-- STORY-084, ВОЛНА 2б: «Фото и файлы записи» — одно правило для строк и для
-- хранилища, мастер снова видит фото, владелец не ограничивается ничем.
--
-- НАЙДЕНО ТРИ ОШИБКИ ВОЛНЫ 2 И ОДНА ВОЛНЫ 0.
--
-- 1. МАСТЕР НЕ ВИДЕЛ ФОТО СВОИХ ЗАПИСЕЙ ВОВСЕ. Политика строк
--    `appointment_photos_select_visible` проверяла календарь подзапросом к
--    `appointments`, а подзапрос в политике выполняется под RLS самого
--    вызывающего. Мастеру читать `appointments` напрямую нельзя
--    (`appointments_select` — только владелец и диспетчер; его дорога —
--    `list_master_appointments_safe`), поэтому подзапрос не находил ничего, и
--    фото пропадали при ЛЮБОМ уровне. Загрузить мастер мог, увидеть — нет.
--    Фото на записях мастеров сейчас ноль, вреда не случилось. Сторож волны 2
--    проверял функцию с правами определителя, а не политику от лица мастера,
--    и поэтому молчал. Теперь проверка живёт в SECURITY DEFINER помощнике, а
--    сторож ниже смотрит строки через RLS настоящего мастера.
--
-- 2. ХРАНИЛИЩЕ ОТДАВАЛО ФАЙЛЫ МИМО УРОВНЯ. `storage_appointment_photos_select`
--    спрашивает `current_user_can_see_appointment_blob`, а та проверяла только
--    «доступна ли запись». При «Фото и файлы: Скрыт» мастер мог попросить
--    список папки записи (`list` читает той же политикой) и скачать каждый
--    файл. Переключатель врал на шаг глубже экрана.
--
-- 3. ВЛАДЕЛЕЦ ТЕРЯЛ ФОТО ЗАПИСЕЙ ИЗ УДАЛЁННЫХ КАЛЕНДАРЕЙ. `access_calendars`
--    отдаёт владельцу существующие календари, а у записи может остаться
--    календарь, которого уже нет (таких рабочих записей шесть). Владелец не
--    должен зависеть от того, жив ли календарь: у него явная ветка.
--
-- 4. ДОСЕВ ИЗ ВОЛНЫ 0 ВЫЗЫВАЛСЯ БЕЗ ВХОДА. `seed_records_level` — SECURITY
--    DEFINER и ПИШЕТ строки прав, а право исполнения на неё осталось у всех,
--    включая `anon`. Прав сверх прикрепления она не даёт, но писать в права,
--    дёргать версию доступа и сигналы чужих людей не должен никто снаружи.
--    Её зовут только функции-определители — снаружи она не нужна вовсе.
--
-- Правило для всех, кроме владельца, — прежнее: запись в календаре, где
-- «Фото и файлы» хотя бы «Смотрит»; события (`team_id is null`) — как были.
-- Ветка «файл без записи» остаётся за владельцем и диспетчером. Документы
-- записи живут в `client_attachments` и мастеру не отдаются вовсе.
--
-- ЗАОДНО: блок `finance.vat` назывался «НДС», а с 20.09 налог в интерфейсе
-- пишется VAT (слово владельца). Блок ещё спит, но строка на странице прав
-- появится в день его волны — пусть сразу правильная.

-- ─── 1. Одно правило «видит файлы записи» ──────────────────────────────

create or replace function public.current_user_can_see_appointment_files(p_appointment_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.current_user_role() = 'owner'
      or exists (
        select 1 from public.appointments a
         where a.id = p_appointment_id
           and (a.team_id is null
                or a.team_id = any(public.access_calendars('record.files', 'read')))
      )
$function$;

comment on function public.current_user_can_see_appointment_files(uuid) is
  'STORY-084: «Фото и файлы записи» хотя бы «Смотрит» в календаре записи; владелец — всегда. SECURITY DEFINER нарочно: в политике подзапрос к appointments шёл бы под RLS мастера и не находил ничего.';

revoke all on function public.current_user_can_see_appointment_files(uuid) from public, anon;
grant execute on function public.current_user_can_see_appointment_files(uuid) to authenticated;

-- ─── 2. Хранилище спрашивает то же правило ─────────────────────────────

create or replace function public.current_user_can_see_appointment_blob(p_appointment_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select (
           public.current_user_can_access_appointment(p_appointment_id)
           and public.current_user_can_see_appointment_files(p_appointment_id)
         )
      or (
        public.current_user_role() in ('owner', 'dispatcher')
        and p_appointment_id is not null
        and not exists (
          select 1 from public.appointments a where a.id = p_appointment_id
        )
      )
$function$;

revoke all on function public.current_user_can_see_appointment_blob(uuid) from public, anon;
grant execute on function public.current_user_can_see_appointment_blob(uuid) to authenticated;

-- ─── 3. Строки фото — тем же правилом, без подзапроса под RLS ──────────

drop policy if exists appointment_photos_select_visible on public.appointment_photos;
create policy appointment_photos_select_visible on public.appointment_photos
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and public.current_user_can_access_appointment(appointment_id)
    and public.current_user_can_see_appointment_files(appointment_id)
  );

-- ─── 4. Досев — только изнутри ─────────────────────────────────────────

revoke all on function public.seed_records_level(uuid, uuid, uuid) from public, anon, authenticated;

-- ─── 5. Реестр ─────────────────────────────────────────────────────────

update public.access_blocks
   set enforced_by = array(select distinct e from unnest(enforced_by || array[
         'function:public.current_user_can_see_appointment_files(uuid)',
         'function:public.current_user_can_see_appointment_blob(uuid)',
         'policy:storage.objects.storage_appointment_photos_select'
       ]) as e)
 where key = 'record.files';

update public.access_blocks
   set title_ru = 'VAT'
 where key = 'finance.vat';

-- ─── Сторож ────────────────────────────────────────────────────────────
--
-- Строки фото проверяются ЧЕРЕЗ RLS настоящего мастера: копия настоящей строки
-- кладётся на его запись и убирается в этой же транзакции (снаружи её никто
-- не увидит; таблица не транслируется в реальное время, триггер удаления у
-- неё отсутствует, файл в хранилище не трогается). Мутант — политика волны 2:
-- на ней проверка «при „Смотрит“ видит» обязана упасть.

do $guard$
declare
  emp record;
  own_tenant uuid;
  own_user uuid;
  appt uuid;
  orphan uuid;
  saved text;
  real_def text;
  clone uuid := gen_random_uuid();
  seen integer;
begin
  -- (0) Владелец видит файлы записи из удалённого календаря.
  select a.id, a.tenant_id into orphan, own_tenant
    from public.appointments a
   where a.kind = 'work' and a.team_id is not null
     and not exists (select 1 from public.teams t where t.id = a.team_id and t.tenant_id = a.tenant_id)
   limit 1;
  if orphan is not null then
    select tm.user_id into own_user
      from public.tenant_members tm where tm.tenant_id = own_tenant and tm.role = 'owner' limit 1;
  end if;
  if orphan is null or own_user is null then
    raise notice 'STORY-084: записей в удалённых календарях нет — проверка владельца пропущена';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', own_user, 'role', 'authenticated',
        'app_metadata', json_build_object('tenant_id', own_tenant))::text, true);
    perform set_config('request.headers',
      json_build_object('x-babun-tenant', own_tenant)::text, true);
    if not public.current_user_can_see_appointment_blob(orphan) then
      raise exception 'STORY-084 сторож: владелец не видит файлы записи из удалённого календаря';
    end if;
    perform set_config('request.jwt.claims', null, true);
    perform set_config('request.headers', null, true);
  end if;

  select tm.tenant_id, tm.user_id, mc.team_id into emp
    from public.tenant_members tm
    join public.member_calendars mc
      on mc.tenant_id = tm.tenant_id and mc.user_id = tm.user_id
   where tm.role = 'master' limit 1;

  select a.id into appt
    from public.appointments a
   where a.tenant_id = emp.tenant_id and a.team_id = emp.team_id and a.kind = 'work'
     and (select count(*) from public.appointment_photos ph where ph.appointment_id = a.id) < 20
   limit 1;

  if appt is null or not exists (select 1 from public.appointment_photos) then
    raise notice 'STORY-084: нет записи мастера или образца фото — поведенческий сторож пропущен';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', emp.user_id, 'role', 'authenticated',
        'app_metadata', json_build_object('tenant_id', emp.tenant_id))::text, true);
    perform set_config('request.headers',
      json_build_object('x-babun-tenant', emp.tenant_id)::text, true);

    select ma.level into saved from public.member_access ma
     where ma.tenant_id = emp.tenant_id and ma.user_id = emp.user_id
       and ma.block = 'record.files' and ma.team_id = emp.team_id;

    insert into public.appointment_photos
    select (jsonb_populate_record(p, jsonb_build_object(
              'id', clone, 'appointment_id', appt, 'tenant_id', emp.tenant_id))).*
      from public.appointment_photos p limit 1;

    -- (а) «Смотрит» — строка видна через RLS и файл отдаётся. Строку прав
    -- правим, а не пересоздаём: «кто и когда выставил» не должно пропасть.
    if saved is null then
      insert into public.member_access (tenant_id, user_id, block, team_id, level)
      values (emp.tenant_id, emp.user_id, 'record.files', emp.team_id, 'read');
    else
      update public.member_access set level = 'read'
       where tenant_id = emp.tenant_id and user_id = emp.user_id
         and block = 'record.files' and team_id = emp.team_id;
    end if;
    execute 'set local role authenticated';
    select count(*) into seen from public.appointment_photos where id = clone;
    execute 'reset role';
    if seen <> 1 then
      raise exception 'STORY-084 сторож: при «Смотрит» мастер не видит фото своей записи';
    end if;
    if not public.current_user_can_see_appointment_blob(appt) then
      raise exception 'STORY-084 сторож: при «Смотрит» хранилище не отдаёт файл записи';
    end if;

    -- (б) Мутант строк: политика волны 2 (подзапрос под RLS) на той же
    -- проверке обязана потерять фото — иначе (а) ничего не доказывает.
    drop policy appointment_photos_select_visible on public.appointment_photos;
    create policy appointment_photos_select_visible on public.appointment_photos
      for select to authenticated
      using (
        tenant_id = (select public.current_tenant_id())
        and public.current_user_can_access_appointment(appointment_id)
        and exists (
          select 1 from public.appointments a
           where a.id = appointment_photos.appointment_id
             and (a.team_id is null
                  or a.team_id in (select unnest(public.access_calendars('record.files', 'read'))))
        )
      );
    execute 'set local role authenticated';
    select count(*) into seen from public.appointment_photos where id = clone;
    execute 'reset role';
    if seen <> 0 then
      raise exception 'STORY-084 сторож: мутант строк не потерял фото — проверка (а) ничего не доказывает';
    end if;
    drop policy appointment_photos_select_visible on public.appointment_photos;
    create policy appointment_photos_select_visible on public.appointment_photos
      for select to authenticated
      using (
        tenant_id = (select public.current_tenant_id())
        and public.current_user_can_access_appointment(appointment_id)
        and public.current_user_can_see_appointment_files(appointment_id)
      );

    -- (в) «Скрыт» — ни строки, ни файла.
    update public.member_access set level = 'off'
     where tenant_id = emp.tenant_id and user_id = emp.user_id
       and block = 'record.files' and team_id = emp.team_id;
    execute 'set local role authenticated';
    select count(*) into seen from public.appointment_photos where id = clone;
    execute 'reset role';
    if seen <> 0 then
      raise exception 'STORY-084 сторож: при «Скрыт» мастер видит фото записи';
    end if;
    if public.current_user_can_see_appointment_blob(appt) then
      raise exception 'STORY-084 сторож: при «Скрыт» хранилище всё ещё отдаёт файлы записи';
    end if;

    -- (г) Мутант хранилища: прежнее правило при «Скрыт» отдаёт.
    select pg_get_functiondef('public.current_user_can_see_appointment_blob(uuid)'::regprocedure)
      into real_def;
    execute $mutant$
      create or replace function public.current_user_can_see_appointment_blob(p_appointment_id uuid)
      returns boolean language sql stable security definer set search_path to 'public'
      as $body$ select public.current_user_can_access_appointment(p_appointment_id) $body$
    $mutant$;
    if not public.current_user_can_see_appointment_blob(appt) then
      raise exception 'STORY-084 сторож: мутант хранилища не потёк — проверка (в) ничего не доказывает';
    end if;
    execute real_def;
    if public.current_user_can_see_appointment_blob(appt) then
      raise exception 'STORY-084 сторож: настоящее правило хранилища не вернулось';
    end if;

    -- Уборка: копия уходит, уровень — какой был.
    delete from public.appointment_photos where id = clone;
    if saved is null then
      delete from public.member_access
       where tenant_id = emp.tenant_id and user_id = emp.user_id
         and block = 'record.files' and team_id = emp.team_id;
    else
      update public.member_access set level = saved
       where tenant_id = emp.tenant_id and user_id = emp.user_id
         and block = 'record.files' and team_id = emp.team_id;
    end if;

    perform set_config('request.jwt.claims', null, true);
    perform set_config('request.headers', null, true);
  end if;

  -- (д) Строение: в политике строк фото нет подзапроса к записям — он шёл бы
  -- под RLS вызывающего; досев снаружи не вызывается; название VAT.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'appointment_photos'
       and policyname = 'appointment_photos_select_visible'
       and (qual ilike '%from appointments%' or qual not like '%current_user_can_see_appointment_files%')
  ) then
    raise exception 'STORY-084 сторож: политика строк фото снова читает записи под RLS';
  end if;
  if exists (select 1 from public.appointment_photos where id = clone) then
    raise exception 'STORY-084 сторож: копия фото не убрана';
  end if;
  if has_function_privilege('anon', 'public.seed_records_level(uuid, uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.seed_records_level(uuid, uuid, uuid)', 'execute') then
    raise exception 'STORY-084 сторож: досев всё ещё вызывается снаружи';
  end if;
  if not exists (select 1 from public.access_blocks where key = 'finance.vat' and title_ru = 'VAT') then
    raise exception 'STORY-084 сторож: блок налога не называется VAT';
  end if;
end
$guard$;
