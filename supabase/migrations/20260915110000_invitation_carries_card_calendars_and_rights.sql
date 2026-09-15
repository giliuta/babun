-- «ДОБАВИТЬ МАСТЕРА» — ПОЛНАЯ КАРТОЧКА ДО «ПРИГЛАСИТЬ»: КАЛЕНДАРИ, ДОЛЖНОСТЬ,
-- ЦВЕТ И ПРАВА ПО БЛОКАМ.
--
-- Владелец 15.09: «Добавить мастера» открывает полную карточку мастера — имя,
-- почта, телефон, должность, цвет, НЕСКОЛЬКО календарей и права по каждому
-- блоку («Скрыт / Смотрит / Меняет») — и всё это заполняется ДО «Пригласить».
-- Человек принимает приглашение — и всё применяется разом, без второго захода
-- владельца на экран прав. Пока человек не ответил, владелец может всё это
-- поправить в приглашении.
--
-- Раньше приглашение несло один календарь, а уровни не писало вовсе («новый
-- сотрудник — всё выключено», 14.09): владельцу приходилось ждать приёма и
-- потом отдельно открывать «Права». Теперь:
--
--   • `invitations.team_ids` — все календари приглашения; `team_id` остаётся
--     ДОМАШНИМ календарём и всегда равен первому из `team_ids`. Домашний нужен
--     прежним читателям (старые сборки берут `calendar` входящих), но отказ и
--     скрытие смотрят уже на ВСЕ календари: входы отказывают, а входящие прячут
--     приглашение, только когда в нём не осталось ни одного живого календаря.
--     Удалённый календарь снимается из `team_ids` триггером на `teams`, а не
--     уносит каскадом всё приглашение; уходит приглашение, только если этот
--     календарь был в нём единственным;
--   • `invitations.master_title`, `invitations.master_color` — должность и цвет
--     НОВОЙ карточки мастера; при приёме ложатся в `masters.title` и
--     `masters.color`. Приглашение по номеру существующей карточки их не
--     принимает: такую карточку правят в ней самой, а приём её не переписывает;
--   • `invitations.access_changes` — уровни ровно в форме `set_member_access`
--     (`[{block, team_id, level}]`), чтобы экран собирал одно и то же и для
--     приглашения, и для правки прав живого сотрудника;
--   • ДВА ВНУТРЕННИХ ПОМОЩНИКА, закрытых от клиента:
--     `access_validate_changes` — одна проверка изменений прав для
--     `set_member_access`, `create_invitation` и `update_invitation`. Архив
--     календаря она НЕ проверяет: живой сотрудник остаётся прикреплённым к
--     заархивированному календарю, и владелец обязан суметь снять уровень и там;
--     архивные календари приглашению отказывают сами функции приглашения;
--     `access_apply_changes` — единственный писатель `member_access`. Он же
--     работает без `auth.uid()`: приём по ссылке идёт из триггера регистрации,
--     где вошедшего ещё нет, а «кто выставил» — это пригласивший;
--   • НЕЖИВЫЕ БЛОКИ БОЛЬШЕ НЕ ОТКАЗЫВАЮТСЯ (решение владельца 15.09): уровни
--     сохраняются сейчас, а применяться начнут, когда блок оживёт. Иначе
--     карточка при «Пригласить» падала бы на первом же переключателе — живых
--     блоков пока нет ни одного. Карта самого сотрудника (`my_access_map`)
--     по-прежнему показывает только живые блоки — сохранённое не значит
--     применённое;
--   • `create_invitation` получает календари, должность, цвет и права;
--     форма из шести аргументов снесена — две функции с одним именем сделали бы
--     вызов неоднозначным, а старые сборки зовут по именам и попадают в новую;
--   • `update_invitation` — правка открытого приглашения тем же набором
--     проверок; токен не меняется, ссылка у человека остаётся рабочей. Календарь,
--     который уже был в приглашении и с тех пор ушёл в архив или удалён,
--     правка снимает молча, как и приём; отказ — только на архивный календарь,
--     который добавляют этой правкой;
--   • приём (`grant_invitation_calendar`, общий для обоих входов): сперва
--     прикрепление ко ВСЕМ ещё живым календарям, затем карточка мастера (её дом —
--     первый живой календарь), затем права календарей (`calendar_members`, ей
--     нужен номер карточки), затем уровни — только для прикреплённых календарей
--     и существующих блоков. Календарь, заархивированный или удалённый между
--     приглашением и приёмом, и блок, исчезнувший из реестра, пропускаются
--     молча: приём не ломается. ПЕРЕИМЕНОВАННЫЙ блок не теряется — триггер на
--     `access_blocks` переносит новый ключ в открытые приглашения, как внешний
--     ключ `member_access` переносит его каскадом;
--   • правка приглашения шлёт тот же сигнал `invitations_changed`, что приём и
--     отзыв: открытые входящие не должны показывать одни календари, пока
--     принимаются другие;
--   • входящие (`my_invitations`) дополнительно называют все календари.
--
-- Входы приглашения (`accept_invitation`, `handle_new_user`) переписаны ровно в
-- одном месте — отказе по архиву календаря; остальное тело перенесено из живой
-- базы как есть, а вызов помощника одной строкой сохранён буквально: его сверяет
-- контракт-тест.

-- ─── Приглашение несёт карточку ─────────────────────────────────────────

alter table public.invitations
  add column if not exists team_ids text[],
  add column if not exists master_title text,
  add column if not exists master_color text,
  add column if not exists access_changes jsonb not null default '[]'::jsonb;

-- Открытые и принятые приглашения до этой миграции звали ровно в один календарь.
update public.invitations
   set team_ids = array[team_id]
 where team_id is not null
   and team_ids is null;

-- Домашний календарь — первый из списка: так его читают входы и входящие.
-- `team_ids` может быть пустым только вместе с отсутствием календаря вовсе.
alter table public.invitations drop constraint if exists invitations_team_ids_home_first;
alter table public.invitations
  add constraint invitations_team_ids_home_first
  check (
    team_ids is null
    or (
      cardinality(team_ids) >= 1
      and array_position(team_ids, null) is null
      and coalesce(team_ids[1] = team_id, false)
    )
  );

alter table public.invitations drop constraint if exists invitations_master_title_length;
alter table public.invitations
  add constraint invitations_master_title_length
  check (master_title is null or char_length(master_title) between 1 and 120);

alter table public.invitations drop constraint if exists invitations_master_color_hex;
alter table public.invitations
  add constraint invitations_master_color_hex
  check (master_color is null or master_color ~ '^#[0-9A-Fa-f]{6}$');

-- Должность и цвет существующей карточки правятся в самой карточке: приём по
-- номеру карточки их не переносит, и сохранить их в приглашении значило бы
-- молча потерять то, что написал владелец.
alter table public.invitations drop constraint if exists invitations_card_fields_only_without_card;
alter table public.invitations
  add constraint invitations_card_fields_only_without_card
  check (master_id is null or (master_title is null and master_color is null));

alter table public.invitations drop constraint if exists invitations_access_changes_array;
alter table public.invitations
  add constraint invitations_access_changes_array
  check (jsonb_typeof(access_changes) = 'array');

-- ─── Переименование блока доезжает до приглашений ───────────────────────

-- member_access следует за ключом реестра каскадом внешнего ключа. Уровни
-- приглашения — jsonb, внешнего ключа у них нет; без этого триггера приём
-- после переименования молча пропустил бы блок (join по старому ключу пуст),
-- и человек получил бы умолчание вместо того, что выставил владелец.
create or replace function public.access_blocks_rename_in_invitations()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.invitations i
     set access_changes = (
       select coalesce(jsonb_agg(
                case when c.change ->> 'block' = old.key
                     then jsonb_set(c.change, '{block}', to_jsonb(new.key))
                     else c.change
                end
                order by c.ord), '[]'::jsonb)
         from jsonb_array_elements(i.access_changes) with ordinality as c(change, ord)
     )
   where i.accepted_at is null
     and i.access_changes @> jsonb_build_array(jsonb_build_object('block', old.key));
  return new;
end;
$function$;

revoke all on function public.access_blocks_rename_in_invitations() from public, anon, authenticated;

drop trigger if exists access_blocks_rename_in_invitations on public.access_blocks;
create trigger access_blocks_rename_in_invitations
  after update of key on public.access_blocks
  for each row
  when (old.key is distinct from new.key)
  execute function public.access_blocks_rename_in_invitations();

-- ─── Одна проверка изменений прав ───────────────────────────────────────

create or replace function public.access_validate_changes(p_tenant uuid, p_team_ids text[], p_changes jsonb)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  change jsonb;
  b public.access_blocks%rowtype;
  change_team text;
  change_level text;
  change_key text;
  seen text[] := array[]::text[];
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'изменения — массив' using errcode = '22023', hint = 'access:bad_changes';
  end if;

  for change in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(change) <> 'object' then
      raise exception 'изменение — объект {block, team_id, level}' using errcode = '22023', hint = 'access:bad_changes';
    end if;

    select * into b from public.access_blocks where key = change ->> 'block';
    if not found then
      raise exception 'неизвестный блок %', change ->> 'block' using errcode = '22023', hint = 'access:bad_block';
    end if;
    -- Код ошибки прежний, как у `set_member_access` и сторожа `member_access`:
    -- экран различает отказы по `hint`, а 42501 здесь честнее — это не опечатка,
    -- а право, которое сотруднику не выдаётся вообще.
    if b.owner_only then
      raise exception 'блок % выдаётся только владельцу', b.key using errcode = '42501', hint = 'access:owner_only';
    end if;
    -- Живость блока НЕ проверяется (владелец 15.09): уровень хранится сейчас,
    -- применяется, когда блок оживёт.

    change_team := nullif(change ->> 'team_id', '');
    change_level := change ->> 'level';

    if b.scope = 'calendar' then
      -- Архив здесь НЕ проверяется. Архив календаря никого от него не открепляет,
      -- и экран прав владельца по-прежнему показывает такой календарь: снять
      -- уровень до «Скрыт» или поменять его там обязано работать, иначе
      -- сохранённое «Меняет» переживёт архив и заработает, когда календарь
      -- вернут и блок оживёт. Прежний `set_member_access` архив тоже не
      -- проверял. Приглашению архивные календари отказывают `create_invitation`
      -- и `update_invitation` до этой проверки, а сверка с `p_team_ids` ниже
      -- пропускает только их календари.
      if change_team is null or not exists (
        select 1 from public.teams t
         where t.tenant_id = p_tenant
           and t.id = change_team
      ) then
        raise exception 'календарь не из этой компании' using errcode = '22023', hint = 'access:bad_team';
      end if;
      -- Уровень календарного блока бывает только у календаря человека:
      -- прикреплённого (права живого сотрудника) или названного в приглашении.
      if not coalesce(change_team = any(p_team_ids), false) then
        raise exception 'человек не прикреплён к календарю' using errcode = '22023', hint = 'access:not_attached';
      end if;
    elsif change_team is not null then
      raise exception 'блок % действует на всю компанию', b.key using errcode = '22023', hint = 'access:bad_team';
    end if;

    if change_level is null or not (change_level = any(b.levels)) then
      raise exception 'у блока % нет положения %', b.key, change_level using errcode = '22023', hint = 'access:bad_level';
    end if;

    -- Один блок в одном календаре дважды — это два разных ответа на один
    -- вопрос; какой из них «правильный», сервер не угадывает.
    change_key := b.key || '@' || coalesce(change_team, '');
    if change_key = any(seen) then
      raise exception 'блок % назван дважды', b.key using errcode = '22023', hint = 'access:bad_changes';
    end if;
    seen := seen || change_key;
  end loop;
end;
$function$;

revoke all on function public.access_validate_changes(uuid, text[], jsonb) from public, anon, authenticated;

-- ─── Единственный писатель уровней ──────────────────────────────────────

create or replace function public.access_apply_changes(p_tenant uuid, p_user uuid, p_changes jsonb, p_set_by uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  change jsonb;
  b public.access_blocks%rowtype;
  change_team text;
  change_level text;
begin
  if p_tenant is null or p_user is null
     or p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'изменения — массив для человека компании' using errcode = '22023', hint = 'access:bad_changes';
  end if;

  -- «Кто выставил» приходит аргументом, а не из текущего входа: при регистрации
  -- по ссылке вошедшего ещё нет, и уровни выставляет пригласивший.
  for change in select value from jsonb_array_elements(p_changes) loop
    select * into b from public.access_blocks where key = change ->> 'block';
    if not found then
      raise exception 'неизвестный блок %', change ->> 'block' using errcode = '22023', hint = 'access:bad_block';
    end if;

    change_team := nullif(change ->> 'team_id', '');
    change_level := change ->> 'level';

    -- Хранятся только значения не по умолчанию: «нет строки» и есть умолчание.
    if change_level = b.levels[1] then
      delete from public.member_access ma
       where ma.tenant_id = p_tenant
         and ma.user_id = p_user
         and ma.block = b.key
         and ma.team_id is not distinct from change_team;
    else
      insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
      values (p_tenant, p_user, b.key, change_team, change_level, p_set_by, now())
      on conflict (tenant_id, user_id, block, team_id)
      do update set level = excluded.level, set_by = excluded.set_by, set_at = excluded.set_at;
    end if;
  end loop;
end;
$function$;

revoke all on function public.access_apply_changes(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

-- ─── Правка прав живого сотрудника ──────────────────────────────────────

create or replace function public.set_member_access(p_user_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  active_tenant uuid := public.access_writer_target(p_user_id);
  attached text[];
begin
  -- Все прикреплённые календари, архивные тоже: экран прав их показывает, и
  -- уровень там должен сниматься.
  select coalesce(array_agg(mc.team_id), array[]::text[])
    into attached
    from public.member_calendars mc
   where mc.tenant_id = active_tenant and mc.user_id = p_user_id;

  -- Та же проверка и тот же писатель, что у приглашения: права, выставленные
  -- в карточке до «Пригласить», и права, поправленные потом, — одно и то же.
  -- Неживые блоки больше не отказываются (владелец 15.09).
  perform public.access_validate_changes(active_tenant, attached, p_changes);
  perform public.access_apply_changes(active_tenant, p_user_id, p_changes, auth.uid());

  -- Двойная запись в calendar_members (её читают сегодняшние политики) включается
  -- на этапе 2 вместе с первыми живыми блоками: пока уровни только хранятся.

  return public.access_map_for(active_tenant, p_user_id, true);
end;
$function$;

revoke all on function public.set_member_access(uuid, jsonb) from public, anon;

-- ─── Приглашение ────────────────────────────────────────────────────────

drop function if exists public.create_invitation(text, text, text, text, text, text);

create or replace function public.create_invitation(
  p_email text,
  p_role text,
  p_master_id text default null::text,
  p_team_id text default null::text,
  p_full_name text default null::text,
  p_phone text default null::text,
  p_team_ids text[] default null::text[],
  p_master_title text default null::text,
  p_master_color text default null::text,
  p_access jsonb default null::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_team_id text := nullif(btrim(coalesce(p_team_id, '')), '');
  v_master_id text := nullif(btrim(coalesce(p_master_id, '')), '');
  v_full_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_master_title text := nullif(btrim(coalesce(p_master_title, '')), '');
  v_master_color text := nullif(btrim(coalesce(p_master_color, '')), '');
  v_access jsonb := coalesce(p_access, '[]'::jsonb);
  v_team_ids text[];
  v_bad_team text;
  v_token text;
  v_invitation public.invitations%rowtype;
begin
  if auth.uid() is null
     or v_tenant_id is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'only an owner can create invitations'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.tenants t
     where t.id = v_tenant_id and t.onboarded_at is not null
  ) then
    raise exception 'finish company setup before inviting employees'
      using errcode = '55000';
  end if;

  if p_role not in ('dispatcher', 'master') then
    raise exception 'invitation role must be dispatcher or master'
      using errcode = '22023';
  end if;

  -- Календари приглашения (15.09): `p_team_id` старых сборок и `p_team_ids`
  -- карточки сливаются без повторов; домашний — `p_team_id`, если он назван,
  -- иначе первый из `p_team_ids`.
  select coalesce(array_agg(x.team_id order by x.first_ord), array[]::text[])
    into v_team_ids
    from (
      select s.team_id, min(s.ord) as first_ord
        from (
          select nullif(btrim(coalesce(src.team_id, '')), '') as team_id, src.ord
            from unnest(array[v_team_id] || coalesce(p_team_ids, array[]::text[]))
                 with ordinality as src(team_id, ord)
        ) s
       where s.team_id is not null
       group by s.team_id
    ) x;
  v_team_id := v_team_ids[1];

  select x.team_id
    into v_bad_team
    from unnest(v_team_ids) as x(team_id)
   where not exists (
     select 1 from public.teams t
      where t.tenant_id = v_tenant_id
        and t.id = x.team_id
        and t.is_active
   )
   limit 1;

  -- Текст отказа прежний — по нему приложение подбирает понятную фразу;
  -- какой именно календарь не подошёл, называет `detail`.
  if v_bad_team is not null then
    raise exception 'calendar not found or archived'
      using errcode = '22023', hint = 'invite:bad_calendar', detail = v_bad_team;
  end if;

  -- Мастер без карточки — только в календарь: иначе аккаунту нечего показать.
  if p_role = 'master' and v_master_id is null and v_team_id is null then
    raise exception 'master invitation requires a calendar or an employee card'
      using errcode = '22023', hint = 'invite:needs_calendar';
  end if;

  if p_role = 'dispatcher' and p_master_id is not null then
    raise exception 'dispatcher invitation cannot link an employee card'
      using errcode = '22023';
  end if;

  if p_role = 'master' and v_master_id is not null and not exists (
    select 1 from public.masters m
     where m.tenant_id = v_tenant_id and m.id = v_master_id and m.is_active
  ) then
    raise exception 'employee card not found or inactive'
      using errcode = '22023';
  end if;

  if p_role = 'master' and v_master_id is not null and exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = v_tenant_id and tm.master_id = v_master_id
  ) then
    raise exception 'employee card already linked to an account'
      using errcode = '23505';
  end if;

  if length(v_email) > 320
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid invitation email'
      using errcode = '22023';
  end if;

  -- Мини-карточка человека (15.09): имя и телефон необязательны.
  if v_full_name is not null and char_length(v_full_name) > 120 then
    raise exception 'invitation name is too long'
      using errcode = '22023';
  end if;

  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'invalid invitation phone'
      using errcode = '22023';
  end if;

  -- Должность и цвет карточки мастера (15.09): тоже необязательны.
  if v_master_title is not null and char_length(v_master_title) > 120 then
    raise exception 'invitation job title is too long'
      using errcode = '22023';
  end if;

  if v_master_color is not null and v_master_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'invalid invitation colour'
      using errcode = '22023';
  end if;

  -- Должность и цвет существующей карточки правятся в самой карточке: приём по
  -- номеру карточки их не переносит, и молча сохранить их значило бы потерять.
  if p_role = 'master' and v_master_id is not null
     and (v_master_title is not null or v_master_color is not null) then
    raise exception 'job title and colour belong to the linked employee card'
      using errcode = '22023', hint = 'invite:card_fields_on_card';
  end if;

  -- Права проверяются против календарей ЭТОГО приглашения: уровень в
  -- календаре, куда человека не зовут, при приёме было бы некуда положить.
  perform public.access_validate_changes(v_tenant_id, v_team_ids, v_access);

  if exists (
    select 1 from public.tenant_members tm
      join auth.users u on u.id = tm.user_id
     where tm.tenant_id = v_tenant_id
       and lower(coalesce(u.email, '')) = v_email
  ) then
    raise exception 'this account already has access to the tenant'
      using errcode = '23505';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_tenant_id::text || ':' || v_email, 0)
  );

  if exists (
    select 1 from public.tenant_members tm
      join auth.users u on u.id = tm.user_id
     where tm.tenant_id = v_tenant_id
       and lower(coalesce(u.email, '')) = v_email
  ) then
    raise exception 'this account already has access to the tenant'
      using errcode = '23505';
  end if;

  if p_role = 'master' and v_master_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(v_tenant_id::text || ':master:' || v_master_id, 1)
    );
    if exists (
      select 1 from public.tenant_members tm
       where tm.tenant_id = v_tenant_id and tm.master_id = v_master_id
    ) then
      raise exception 'employee card already linked to an account'
        using errcode = '23505';
    end if;
    if exists (
      select 1 from public.invitations i
       where i.tenant_id = v_tenant_id
         and i.master_id = v_master_id
         and i.accepted_at is null
         and i.expires_at > now()
         and lower(i.email) <> v_email
    ) then
      raise exception 'employee card already has a pending invitation'
        using errcode = '23505';
    end if;
  end if;

  delete from public.invitations
   where tenant_id = v_tenant_id
     and lower(email) = v_email
     and accepted_at is null;

  v_token := translate(
    encode(
      substring(
        sha256(
          convert_to(
            gen_random_uuid()::text || gen_random_uuid()::text ||
            gen_random_uuid()::text,
            'UTF8'
          )
        )
        from 1 for 24
      ),
      'base64'
    ),
    '+/',
    '-_'
  );

  insert into public.invitations (
    tenant_id, email, role, master_id, team_id, invited_by_user_id, token, expires_at,
    full_name, phone, team_ids, master_title, master_color, access_changes
  ) values (
    v_tenant_id,
    v_email,
    p_role,
    case when p_role = 'master' then v_master_id else null end,
    v_team_id,
    auth.uid(),
    v_token,
    now() + interval '7 days',
    v_full_name,
    v_phone,
    case when cardinality(v_team_ids) > 0 then v_team_ids else null end,
    -- Должность и цвет живут в карточке мастера; у диспетчера карточки нет.
    case when p_role = 'master' then v_master_title else null end,
    case when p_role = 'master' then v_master_color else null end,
    v_access
  )
  returning * into v_invitation;

  return jsonb_build_object(
    'id', v_invitation.id,
    'tenant_id', v_invitation.tenant_id,
    'email', v_invitation.email,
    'role', v_invitation.role,
    'master_id', v_invitation.master_id,
    'team_id', v_invitation.team_id,
    'team_ids', coalesce(v_invitation.team_ids, array[]::text[]),
    'full_name', v_invitation.full_name,
    'phone', v_invitation.phone,
    'master_title', v_invitation.master_title,
    'master_color', v_invitation.master_color,
    'access_changes', v_invitation.access_changes,
    'token', v_invitation.token,
    'expires_at', v_invitation.expires_at,
    'created_at', v_invitation.created_at
  );
end;
$function$;

revoke all on function public.create_invitation(text, text, text, text, text, text, text[], text, text, jsonb) from public, anon;
grant execute on function public.create_invitation(text, text, text, text, text, text, text[], text, text, jsonb) to authenticated;

-- ─── Правка открытого приглашения ───────────────────────────────────────

create or replace function public.update_invitation(
  p_invitation_id uuid,
  p_full_name text,
  p_phone text,
  p_team_ids text[],
  p_master_title text,
  p_master_color text,
  p_access jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_full_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_master_title text := nullif(btrim(coalesce(p_master_title, '')), '');
  v_master_color text := nullif(btrim(coalesce(p_master_color, '')), '');
  v_access jsonb := coalesce(p_access, '[]'::jsonb);
  v_team_ids text[];
  v_stored text[];
  v_gone text[];
  v_bad_team text;
  v_invitation public.invitations%rowtype;
begin
  if auth.uid() is null
     or v_tenant_id is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'only an owner can update invitations'
      using errcode = '42501';
  end if;

  -- Чужая компания и отсутствие приглашения неразличимы: оракула нет.
  select * into v_invitation
    from public.invitations i
   where i.id = p_invitation_id
     and i.tenant_id = v_tenant_id;
  if not found then
    raise exception 'invitation not found'
      using errcode = 'P0002', hint = 'invite:not_found';
  end if;

  -- Порядок замков тот же, что у создания и приёма (почта → строка): правка не
  -- разойдётся с одновременным приёмом и не оживит уже удалённое повторным
  -- приглашением.
  perform pg_advisory_xact_lock(
    hashtextextended(v_invitation.tenant_id::text || ':' || lower(v_invitation.email), 0)
  );

  select * into v_invitation
    from public.invitations i
   where i.id = p_invitation_id
     and i.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception 'invitation not found'
      using errcode = 'P0002', hint = 'invite:not_found';
  end if;

  -- Принятое приглашение уже стало сотрудником: его правят в «Правах», а не
  -- здесь. Истёкшее не примут — править в нём нечего, его отправляют заново.
  if v_invitation.accepted_at is not null then
    raise exception 'invitation already accepted'
      using errcode = '42501', hint = 'invite:not_pending';
  end if;

  if v_invitation.expires_at <= now() then
    raise exception 'invitation expired'
      using errcode = '42501', hint = 'invite:not_pending';
  end if;

  -- Календари приглашения ДО этой правки.
  v_stored := array_remove(coalesce(v_invitation.team_ids, array[v_invitation.team_id]), null);

  select coalesce(array_agg(x.team_id order by x.first_ord), array[]::text[])
    into v_team_ids
    from (
      select s.team_id, min(s.ord) as first_ord
        from (
          select nullif(btrim(coalesce(src.team_id, '')), '') as team_id, src.ord
            from unnest(coalesce(p_team_ids, array[]::text[]))
                 with ordinality as src(team_id, ord)
        ) s
       where s.team_id is not null
       group by s.team_id
    ) x;

  -- Календарь, уже бывший в приглашении и с тех пор ушедший в архив или
  -- удалённый, снимается молча — ровно как при приёме (grant_invitation_calendar);
  -- иначе приглашение нельзя сохранить в том виде, в каком его вернул сервер, и
  -- владелец не поправит даже имя, не угадав, какой календарь пропал. Отказ —
  -- только на календарь, который добавляют этой правкой.
  select coalesce(array_agg(x.team_id), array[]::text[])
    into v_gone
    from unnest(v_team_ids) as x(team_id)
   where coalesce(x.team_id = any(v_stored), false)
     and not exists (
       select 1 from public.teams t
        where t.tenant_id = v_tenant_id
          and t.id = x.team_id
          and t.is_active
     );

  select x.team_id
    into v_bad_team
    from unnest(v_team_ids) as x(team_id)
   where not exists (
     select 1 from public.teams t
      where t.tenant_id = v_tenant_id
        and t.id = x.team_id
        and t.is_active
   )
     and not coalesce(x.team_id = any(v_stored), false)
   limit 1;

  if v_bad_team is not null then
    raise exception 'calendar not found or archived'
      using errcode = '22023', hint = 'invite:bad_calendar', detail = v_bad_team;
  end if;

  if cardinality(v_gone) > 0 then
    select coalesce(array_agg(x.team_id order by x.ord), array[]::text[])
      into v_team_ids
      from unnest(v_team_ids) with ordinality as x(team_id, ord)
     where not (x.team_id = any(v_gone));

    -- Уровни снятого календаря уходят вместе с ним. Не массив проходит как есть:
    -- его отказом `access:bad_changes` назовёт общая проверка.
    if jsonb_typeof(v_access) = 'array' then
      select coalesce(jsonb_agg(c.change order by c.ord), '[]'::jsonb)
        into v_access
        from jsonb_array_elements(v_access) with ordinality as c(change, ord)
       where not (jsonb_typeof(c.change) = 'object'
                  and coalesce(nullif(c.change ->> 'team_id', '') = any(v_gone), false));
    end if;
  end if;

  if v_invitation.role = 'master'
     and v_invitation.master_id is null
     and cardinality(v_team_ids) = 0 then
    raise exception 'master invitation requires a calendar or an employee card'
      using errcode = '22023', hint = 'invite:needs_calendar';
  end if;

  if v_full_name is not null and char_length(v_full_name) > 120 then
    raise exception 'invitation name is too long'
      using errcode = '22023';
  end if;

  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'invalid invitation phone'
      using errcode = '22023';
  end if;

  if v_master_title is not null and char_length(v_master_title) > 120 then
    raise exception 'invitation job title is too long'
      using errcode = '22023';
  end if;

  if v_master_color is not null and v_master_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'invalid invitation colour'
      using errcode = '22023';
  end if;

  -- Та же граница, что у создания: у существующей карточки должность и цвет
  -- правятся в ней самой.
  if v_invitation.master_id is not null
     and (v_master_title is not null or v_master_color is not null) then
    raise exception 'job title and colour belong to the linked employee card'
      using errcode = '22023', hint = 'invite:card_fields_on_card';
  end if;

  perform public.access_validate_changes(v_tenant_id, v_team_ids, v_access);

  -- Токен и срок не трогаются: ссылка, которую человек уже получил, остаётся
  -- той же, а правка карточки не продлевает приглашение. Ушедший домашний
  -- календарь уступает дом следующему живому.
  update public.invitations i
     set team_id = v_team_ids[1],
         team_ids = case when cardinality(v_team_ids) > 0 then v_team_ids else null end,
         full_name = v_full_name,
         phone = v_phone,
         master_title = case when i.role = 'master' then v_master_title else null end,
         master_color = case when i.role = 'master' then v_master_color else null end,
         access_changes = v_access
   where i.id = v_invitation.id
  returning * into v_invitation;

  return jsonb_build_object(
    'id', v_invitation.id,
    'tenant_id', v_invitation.tenant_id,
    'email', v_invitation.email,
    'role', v_invitation.role,
    'master_id', v_invitation.master_id,
    'team_id', v_invitation.team_id,
    'team_ids', coalesce(v_invitation.team_ids, array[]::text[]),
    'full_name', v_invitation.full_name,
    'phone', v_invitation.phone,
    'master_title', v_invitation.master_title,
    'master_color', v_invitation.master_color,
    'access_changes', v_invitation.access_changes,
    'token', v_invitation.token,
    'expires_at', v_invitation.expires_at,
    'created_at', v_invitation.created_at
  );
end;
$function$;

revoke all on function public.update_invitation(uuid, text, text, text[], text, text, jsonb) from public, anon;
grant execute on function public.update_invitation(uuid, text, text, text[], text, text, jsonb) to authenticated;

-- ─── Удалённый календарь уходит из приглашений ──────────────────────────

-- `team_ids` — массив без внешнего ключа, а внешний ключ домашнего `team_id`
-- удалял каскадом всё приглашение: вместе с остальными календарями, карточкой и
-- правами. «Домашний» — всего лишь первый календарь, который отметил владелец,
-- а свежий календарь без истории удалить можно. Поэтому до каскада календарь
-- снимается из открытых приглашений, дом переходит к следующему, уровни этого
-- календаря уходят с ним. Каскад остаётся страховкой для принятых строк.
create or replace function public.invitations_forget_deleted_calendar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Компанию удаляют целиком: приглашения уйдут её каскадом.
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;

  -- Удалённым был единственный календарь: приглашение уходит, как при
  -- прежнем каскаде. Диспетчер без календарей видел бы всю компанию.
  delete from public.invitations i
   where i.tenant_id = old.tenant_id
     and i.accepted_at is null
     and old.id = any(coalesce(i.team_ids, array[i.team_id]))
     and cardinality(array_remove(coalesce(i.team_ids, array[i.team_id]), old.id)) = 0;

  -- SET видит прежнюю строку, поэтому `team_ids[1] = team_id` держится.
  -- Если сторож истории откажет удалению, откатится и эта правка.
  update public.invitations i
     set team_ids = array_remove(i.team_ids, old.id),
         team_id = (array_remove(i.team_ids, old.id))[1],
         access_changes = coalesce((
           select jsonb_agg(c.v order by c.ord)
             from jsonb_array_elements(i.access_changes) with ordinality as c(v, ord)
            where c.v ->> 'team_id' is distinct from old.id
         ), '[]'::jsonb)
   where i.tenant_id = old.tenant_id
     and i.accepted_at is null
     and old.id = any(i.team_ids);

  return old;
end;
$function$;

revoke all on function public.invitations_forget_deleted_calendar() from public, anon, authenticated;

drop trigger if exists trg_invitations_forget_deleted_calendar on public.teams;
create trigger trg_invitations_forget_deleted_calendar
  before delete on public.teams
  for each row
  execute function public.invitations_forget_deleted_calendar();

-- ─── Приём: карточка мастера ────────────────────────────────────────────

create or replace function public.attach_invited_master_card(p_invitation public.invitations, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_master_id text;
  v_name text;
  v_phone text;
  v_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_stamp text := '';
begin
  if p_invitation.role is distinct from 'master'
     or p_invitation.master_id is not null
     or p_invitation.team_id is null
     or p_user_id is null then
    return p_invitation.master_id;
  end if;

  -- Имя и телефон, которые написал владелец в приглашении (15.09), сильнее
  -- того, что человек написал о себе при регистрации.
  select coalesce(
           nullif(btrim(p_invitation.full_name), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
           nullif(split_part(coalesce(u.email, ''), '@', 1), '')
         ),
         coalesce(
           nullif(btrim(p_invitation.phone), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'phone'), '')
         )
    into v_name, v_phone
    from auth.users u
   where u.id = p_user_id;

  select m.id
    into v_master_id
    from public.masters m
   where m.tenant_id = p_invitation.tenant_id
     and m.user_id = p_user_id
   for update;

  if v_master_id is null then
    -- Тот же вид номера, что у карточек из приложения: `generateId("master")`.
    while v_ms > 0 loop
      v_stamp := substr('0123456789abcdefghijklmnopqrstuvwxyz', (v_ms % 36)::int + 1, 1) || v_stamp;
      v_ms := v_ms / 36;
    end loop;
    v_master_id := 'master-' || v_stamp || '-' || substr(md5(gen_random_uuid()::text), 1, 5);

    -- Должность и цвет — из карточки, которую владелец заполнил до «Пригласить».
    insert into public.masters (
      id, tenant_id, full_name, phone, title, color, team_id, account_status, user_id, created_by
    ) values (
      v_master_id,
      p_invitation.tenant_id,
      coalesce(v_name, 'Мастер'),
      v_phone,
      nullif(btrim(p_invitation.master_title), ''),
      p_invitation.master_color,
      p_invitation.team_id,
      'active',
      p_user_id,
      p_invitation.invited_by_user_id
    );
  else
    -- Позвали снова: прежняя карточка берёт новое, но пустое в приглашении не
    -- стирает того, что уже было в карточке.
    update public.masters m
       set team_id = p_invitation.team_id,
           is_active = true,
           account_status = 'active',
           full_name = coalesce(nullif(btrim(p_invitation.full_name), ''), m.full_name),
           phone = coalesce(nullif(btrim(p_invitation.phone), ''), m.phone),
           title = coalesce(nullif(btrim(p_invitation.master_title), ''), m.title),
           color = coalesce(p_invitation.master_color, m.color)
     where m.tenant_id = p_invitation.tenant_id
       and m.id = v_master_id;
  end if;

  update public.tenant_members tm
     set master_id = v_master_id
   where tm.tenant_id = p_invitation.tenant_id
     and tm.user_id = p_user_id
     and tm.master_id is null;

  return v_master_id;
end;
$function$;

revoke all on function public.attach_invited_master_card(public.invitations, uuid) from public, anon, authenticated;

-- ─── Приём: календари, карточка, уровни ─────────────────────────────────

create or replace function public.grant_invitation_calendar(p_invitation public.invitations, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_master_id text := p_invitation.master_id;
  v_team_ids text[];
  v_changes jsonb;
begin
  if p_user_id is null then
    return;
  end if;

  -- create_invitation отказывает архивным календарям, но календарь могут
  -- заархивировать или удалить между приглашением и приёмом: такой календарь
  -- пропускается, остальное приглашение применяется.
  select coalesce(array_agg(x.team_id order by x.ord), array[]::text[])
    into v_team_ids
    from unnest(coalesce(p_invitation.team_ids, array[p_invitation.team_id]))
         with ordinality as x(team_id, ord)
   where x.team_id is not null
     and exists (
       select 1 from public.teams t
        where t.tenant_id = p_invitation.tenant_id
          and t.id = x.team_id
          and t.is_active
     );

  if cardinality(v_team_ids) > 0 then
    -- Домашний календарь могли заархивировать: карточка мастера получает
    -- первый ЖИВОЙ календарь приглашения, а не архивный.
    p_invitation.team_id := v_team_ids[1];

    -- 1. Прикрепление ко ВСЕМ календарям приглашения (права по блокам): без
    --    него владелец не видит человека в людях календаря, а уровни
    --    календарных блоков некуда положить.
    insert into public.member_calendars (tenant_id, user_id, team_id, attached_by)
    select p_invitation.tenant_id, p_user_id, x.team_id, p_invitation.invited_by_user_id
      from unnest(v_team_ids) as x(team_id)
    on conflict (tenant_id, user_id, team_id) do nothing;

    -- 2. Мастер без карточки получает свою карточку (15.09): без неё его не
    --    назначить в запись, а статус и фото сервер пускает по карточке.
    if p_invitation.role = 'master' and p_invitation.master_id is null then
      v_master_id := public.attach_invited_master_card(p_invitation, p_user_id);
    end if;

    -- 3. Сегодняшние права календаря — после карточки: строка несёт её номер.
    insert into public.calendar_members (tenant_id, team_id, user_id, master_id, grants)
    select p_invitation.tenant_id,
           x.team_id,
           p_user_id,
           v_master_id,
           case p_invitation.role
             when 'dispatcher' then array['view','book','edit_all','clients','phones']::text[]
             else array['view']::text[]
           end
      from unnest(v_team_ids) as x(team_id)
    on conflict (tenant_id, team_id, user_id) do nothing;
  end if;

  -- 4. Уровни, выставленные владельцем до «Пригласить» (15.09), — тем же
  --    писателем, что у экрана прав. Только для прикреплённых календарей и
  --    блоков, которые ещё есть в реестре: исчезнувшее пропускается, приём
  --    не ломается.
  select coalesce(jsonb_agg(c.change order by c.ord), '[]'::jsonb)
    into v_changes
    from jsonb_array_elements(
           case when jsonb_typeof(p_invitation.access_changes) = 'array'
                then p_invitation.access_changes
                else '[]'::jsonb
           end
         ) with ordinality as c(change, ord)
    join public.access_blocks b
      on b.key = c.change ->> 'block'
     and not b.owner_only
   where jsonb_typeof(c.change) = 'object'
     and coalesce((c.change ->> 'level') = any(b.levels), false)
     and case b.scope
           when 'calendar' then coalesce(nullif(c.change ->> 'team_id', '') = any(v_team_ids), false)
           else nullif(c.change ->> 'team_id', '') is null
         end;

  if jsonb_array_length(v_changes) > 0 then
    perform public.access_apply_changes(
      p_invitation.tenant_id, p_user_id, v_changes, p_invitation.invited_by_user_id
    );
  end if;
end;
$function$;

revoke all on function public.grant_invitation_calendar(public.invitations, uuid) from public, anon, authenticated;

-- ─── Входы приглашения: отказ, только когда живых календарей нет ────────

-- Тело перенесено из живой базы; изменён только отказ по архиву календаря.
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_invitation public.invitations%rowtype;
  v_caller_email text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to accept an invitation'
      using errcode = '42501';
  end if;

  select lower(coalesce(u.email, '')) into v_caller_email
    from auth.users u where u.id = auth.uid();

  if coalesce(v_caller_email, '') = '' then
    raise exception 'signed-in account has no email' using errcode = '42501';
  end if;

  select * into v_invitation from public.invitations where token = p_token;
  if not found then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_invitation.tenant_id::text || ':' || lower(v_invitation.email), 0)
  );
  if v_invitation.master_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(v_invitation.tenant_id::text || ':master:' || v_invitation.master_id, 1)
    );
  end if;

  select * into v_invitation from public.invitations where token = p_token for update;
  if not found then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;

  if v_invitation.accepted_at is not null then
    -- Already accepted by this very person (signup through the link did it):
    -- return without granting again — the owner may have narrowed the rights
    -- since.
    if v_invitation.accepted_by_user_id = auth.uid()
       and exists (
         select 1 from public.tenant_members tm
          where tm.tenant_id = v_invitation.tenant_id and tm.user_id = auth.uid()
       ) then
      return v_invitation.tenant_id;
    end if;
    raise exception 'invitation already accepted' using errcode = '42501';
  end if;

  if v_invitation.expires_at <= now() then
    raise exception 'invitation expired' using errcode = '42501';
  end if;

  if v_invitation.role not in ('dispatcher', 'master') then
    raise exception 'unsupported invitation role' using errcode = '42501';
  end if;

  if lower(v_invitation.email) <> v_caller_email then
    raise exception 'invitation email does not match the signed-in account'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.tenants t
     where t.id = v_invitation.tenant_id and t.onboarded_at is not null
  ) then
    raise exception 'finish company setup before inviting employees'
      using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_invitation.tenant_id::text || ':user:' || auth.uid()::text, 2)
  );

  if exists (
    select 1 from public.tenant_members tm
     where tm.tenant_id = v_invitation.tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'this account already has access to the tenant'
      using errcode = '23505';
  end if;

  -- Приглашение зовёт в несколько календарей (15.09): отказ — только когда
  -- живых среди них не осталось ни одного. Иначе архив одного «домашнего»
  -- ломал весь приём, хотя помощник пропустил бы его и выдал остальные.
  -- Без живых календарей отказ остаётся: диспетчер без строк прав видел бы
  -- всю компанию, а мастер без карточки — ничего.
  if v_invitation.team_id is not null and not exists (
    select 1
      from unnest(coalesce(v_invitation.team_ids, array[v_invitation.team_id])) as x(team_id)
      join public.teams t
        on t.tenant_id = v_invitation.tenant_id
       and t.id = x.team_id
       and t.is_active
  ) then
    raise exception 'invitation calendar is archived'
      using errcode = '42501';
  end if;

  -- Мастер без карточки — только в календарь (create_invitation держит то же).
  if v_invitation.role = 'master'
     and v_invitation.master_id is null
     and v_invitation.team_id is null then
    raise exception 'master invitation requires a calendar or an employee card'
      using errcode = '22023';
  end if;

  if v_invitation.role = 'master'
     and v_invitation.master_id is not null
     and (
       not exists (
         select 1 from public.masters m
          where m.tenant_id = v_invitation.tenant_id
            and m.id = v_invitation.master_id
            and m.is_active
       )
       or exists (
         select 1 from public.tenant_members tm
          where tm.tenant_id = v_invitation.tenant_id
            and tm.master_id = v_invitation.master_id
       )
     ) then
    raise exception 'employee card is unavailable' using errcode = '23505';
  end if;

  insert into public.tenant_members (
    tenant_id, user_id, role, invited_by_user_id, master_id
  ) values (
    v_invitation.tenant_id, auth.uid(), v_invitation.role,
    v_invitation.invited_by_user_id, v_invitation.master_id
  );

  perform public.grant_invitation_calendar(v_invitation, auth.uid());

  update public.invitations
     set accepted_at = now(), accepted_by_user_id = auth.uid()
   where id = v_invitation.id;

  update auth.users u
     set raw_app_meta_data =
       coalesce(u.raw_app_meta_data, '{}'::jsonb)
       || jsonb_build_object(
         'available_tenants',
         coalesce(
           (
             select jsonb_agg(x.tenant_id order by x.joined_at, x.tenant_id)
               from (
                 select tm.tenant_id::text as tenant_id, min(tm.joined_at) as joined_at
                   from public.tenant_members tm
                  where tm.user_id = auth.uid()
                  group by tm.tenant_id
               ) x
           ),
           '[]'::jsonb
         )
       )
   where u.id = auth.uid();

  return v_invitation.tenant_id;
end;
$function$;

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- Тело перенесено из живой базы; изменён только отказ по архиву календаря.
-- `create or replace` сохраняет триггер `on_auth_user_created`.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id uuid;
  v_invitation public.invitations%rowtype;
  v_invite_token text := coalesce(
    new.raw_user_meta_data ->> 'pending_invitation_token',
    ''
  );
begin
  -- A signup that explicitly carries an invitation token must either consume
  -- that invitation or fail atomically. Falling through to ordinary signup on
  -- an expired/mismatched/raced token created an unrelated owner tenant.
  if v_invite_token <> '' then
    if v_invite_token !~ '^[A-Za-z0-9_-]{32,128}$' then
      raise exception 'invalid invitation token'
        using errcode = '22023';
    end if;

    -- Identity read only; advisory locks must precede FOR UPDATE to keep the
    -- same email→master→row order as create_invitation/accept_invitation.
    select *
      into v_invitation
      from public.invitations i
     where i.token = v_invite_token;

    if not found then
      raise exception 'invitation not found'
        using errcode = 'P0002';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(
        v_invitation.tenant_id::text || ':' || lower(v_invitation.email),
        0
      )
    );
    if v_invitation.master_id is not null then
      perform pg_advisory_xact_lock(
        hashtextextended(
          v_invitation.tenant_id::text || ':master:' || v_invitation.master_id,
          1
        )
      );
    end if;

    select *
      into v_invitation
      from public.invitations i
     where i.token = v_invite_token
       and i.accepted_at is null
       and i.expires_at > now()
       and i.role in ('dispatcher', 'master')
       and lower(i.email) = lower(coalesce(new.email, ''))
     for update;

    if not found then
      raise exception 'invitation is expired, consumed, or belongs to another email'
        using errcode = '42501';
    end if;

    if not exists (
      select 1
        from public.tenants t
       where t.id = v_invitation.tenant_id
         and t.onboarded_at is not null
    ) then
      raise exception 'finish company setup before inviting employees'
        using errcode = '55000';
    end if;

    if exists (
      select 1
        from public.tenant_members tm
        join auth.users u on u.id = tm.user_id
       where tm.tenant_id = v_invitation.tenant_id
         and lower(coalesce(u.email, '')) = lower(v_invitation.email)
    ) then
      raise exception 'this account already has access to the tenant'
        using errcode = '23505';
    end if;

    -- Приглашение зовёт в несколько календарей (15.09): отказ — только когда
    -- живых среди них не осталось ни одного. Иначе архив одного «домашнего»
    -- ронял всю регистрацию по ссылке, хотя помощник пропустил бы его и выдал
    -- остальные. Без живых календарей отказ остаётся: диспетчер без строк прав
    -- видел бы всю компанию, а мастер без карточки — ничего.
    if v_invitation.team_id is not null and not exists (
      select 1
        from unnest(coalesce(v_invitation.team_ids, array[v_invitation.team_id])) as x(team_id)
        join public.teams t
          on t.tenant_id = v_invitation.tenant_id
         and t.id = x.team_id
         and t.is_active
    ) then
      raise exception 'invitation calendar is archived'
        using errcode = '42501';
    end if;

    -- Мастер без карточки — только в календарь (create_invitation держит то же).
    if v_invitation.role = 'master'
       and v_invitation.master_id is null
       and v_invitation.team_id is null then
      raise exception 'master invitation requires a calendar or an employee card'
        using errcode = '22023';
    end if;

    if v_invitation.role = 'master'
       and v_invitation.master_id is not null
       and (
         not exists (
           select 1 from public.masters m
            where m.tenant_id = v_invitation.tenant_id
              and m.id = v_invitation.master_id
              and m.is_active
         )
         or exists (
           select 1 from public.tenant_members tm
            where tm.tenant_id = v_invitation.tenant_id
              and tm.master_id = v_invitation.master_id
         )
       ) then
      raise exception 'employee card is unavailable'
        using errcode = '23505';
    end if;

    insert into public.tenant_members (
      tenant_id,
      user_id,
      role,
      invited_by_user_id,
      master_id,
      joined_at
    ) values (
      v_invitation.tenant_id,
      new.id,
      v_invitation.role,
      v_invitation.invited_by_user_id,
      v_invitation.master_id,
      now()
    );

    -- The invitation names a calendar: grant it here exactly as
    -- accept_invitation does, or the new account works by role and sees the
    -- whole company.
    perform public.grant_invitation_calendar(v_invitation, new.id);

    update public.invitations
       set accepted_at = now(),
           accepted_by_user_id = new.id
     where id = v_invitation.id;

    update auth.users u
       set raw_app_meta_data =
             coalesce(u.raw_app_meta_data, '{}'::jsonb)
             || jsonb_build_object(
               'tenant_id', v_invitation.tenant_id::text,
               'tenant_role', v_invitation.role,
               'available_tenants',
                 jsonb_build_array(v_invitation.tenant_id::text)
             ),
           raw_user_meta_data =
             coalesce(u.raw_user_meta_data, '{}'::jsonb)
             - 'pending_invitation_token'
     where u.id = new.id;

    return new;
  end if;

  -- Ordinary signup: preserve the existing first-owner workflow.
  insert into public.tenants (id, name, vertical)
  values (
    gen_random_uuid(),
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'business_name'), ''),
      new.email,
      'Компания'
    ),
    'other'
  )
  returning id into v_tenant_id;

  insert into public.tenant_members (
    tenant_id,
    user_id,
    role,
    joined_at
  ) values (
    v_tenant_id,
    new.id,
    'owner',
    now()
  );

  insert into public.client_tags (id, tenant_id, name, color) values
    (gen_random_uuid(), v_tenant_id, 'VIP',         '#f59e0b'),
    (gen_random_uuid(), v_tenant_id, 'Новый',       '#3b82f6'),
    (gen_random_uuid(), v_tenant_id, 'Постоянный',  '#10b981'),
    (gen_random_uuid(), v_tenant_id, 'Проблемный',  '#ef4444');

  insert into public.calendar_settings (tenant_id)
  values (v_tenant_id)
  on conflict (tenant_id) do nothing;

  update auth.users u
     set raw_app_meta_data =
           coalesce(u.raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object(
             'tenant_id', v_tenant_id::text,
             'tenant_role', 'owner',
             'available_tenants', jsonb_build_array(v_tenant_id::text)
           ),
         raw_user_meta_data =
           coalesce(u.raw_user_meta_data, '{}'::jsonb)
           - 'pending_invitation_token'
   where u.id = new.id;

  return new;
end;
$function$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ─── Правка приглашения сигналит входящим ───────────────────────────────

create or replace function public.invitations_changed_signal()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.invitations%rowtype;
  v_invitee uuid;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  -- Правка открытого приглашения (15.09) меняет то, что входящие показывают до
  -- «Принять», и то, что приём применит. Без сигнала открытые входящие
  -- показывают одни календари, а принимаются другие. Молчим, только когда не
  -- изменилось ничего из этого: update_invitation пишет все поля даже без правки.
  if tg_op = 'UPDATE'
     and (new.accepted_at, new.team_id, new.team_ids, new.access_changes,
          new.master_title, new.master_color, new.full_name, new.phone)
         is not distinct from
         (old.accepted_at, old.team_id, old.team_ids, old.access_changes,
          old.master_title, old.master_color, old.full_name, old.phone) then
    return null;
  end if;

  -- Тот же круг, что у входящих: аккаунт, существовавший до приглашения.
  select u.id
    into v_invitee
    from auth.users u
   where lower(coalesce(u.email, '')) = lower(v_row.email)
     and u.created_at < v_row.created_at
   limit 1;

  if v_invitee is not null then
    perform realtime.send(
      jsonb_build_object('tenant_id', v_row.tenant_id),
      'invitations_changed',
      'access:' || v_invitee::text,
      true
    );
  end if;

  if v_row.invited_by_user_id is not null
     and v_row.invited_by_user_id is distinct from v_invitee then
    perform realtime.send(
      jsonb_build_object('tenant_id', v_row.tenant_id),
      'invitations_changed',
      'access:' || v_row.invited_by_user_id::text,
      true
    );
  end if;

  return null;
end;
$function$;

revoke all on function public.invitations_changed_signal() from public, anon, authenticated;

drop trigger if exists invitations_changed_signal on public.invitations;
create trigger invitations_changed_signal
  after insert or delete
     or update of accepted_at, team_id, team_ids, access_changes,
                  master_title, master_color, full_name, phone
  on public.invitations
  for each row execute function public.invitations_changed_signal();

-- ─── Входящие называют все календари ────────────────────────────────────

create or replace function public.my_invitations()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_email text;
  v_account_created timestamptz;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to read invitations'
      using errcode = '42501', hint = 'invite:not_signed_in';
  end if;

  select lower(coalesce(u.email, '')), u.created_at
    into v_email, v_account_created
    from auth.users u
   where u.id = auth.uid();

  if coalesce(v_email, '') = '' then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'id', i.id,
               'tenant_id', i.tenant_id,
               'company', t.name,
               'inviter', coalesce(
                 nullif(btrim(iu.raw_user_meta_data ->> 'full_name'), ''),
                 nullif(btrim(iu.raw_user_meta_data ->> 'name'), ''),
                 split_part(iu.email, '@', 1)
               ),
               'role', i.role,
               -- Старые сборки читают один календарь: теперь это первый живой.
               'calendar', case
                 when tm.id is null then null
                 else jsonb_build_object('id', tm.id, 'name', tm.name, 'color', tm.color)
               end,
               -- Все живые календари приглашения (15.09), домашний первым:
               -- человек видит, куда именно его зовут, до «Принять».
               'calendars', coalesce((
                 select jsonb_agg(
                          jsonb_build_object('id', ct.id, 'name', ct.name, 'color', ct.color)
                          order by x.ord
                        )
                   from unnest(coalesce(i.team_ids, array[i.team_id]))
                        with ordinality as x(team_id, ord)
                   join public.teams ct
                     on ct.tenant_id = i.tenant_id
                    and ct.id = x.team_id
                    and ct.is_active
               ), '[]'::jsonb),
               'expires_at', i.expires_at,
               'created_at', i.created_at
             )
             order by i.created_at desc
           )
      from public.invitations i
      join public.tenants t
        on t.id = i.tenant_id and t.onboarded_at is not null
      -- Первый живой календарь приглашения: архив домашнего больше не прячет
      -- приглашение, в котором остались другие живые календари.
      left join lateral (
        select ct.id, ct.name, ct.color
          from unnest(coalesce(i.team_ids, array[i.team_id])) with ordinality as x(team_id, ord)
          join public.teams ct
            on ct.tenant_id = i.tenant_id and ct.id = x.team_id and ct.is_active
         order by x.ord
         limit 1
      ) tm on true
      left join auth.users iu
        on iu.id = i.invited_by_user_id
     where lower(i.email) = v_email
       and i.accepted_at is null
       and i.expires_at > now()
       and i.created_at > v_account_created
       and (i.team_id is null or tm.id is not null)
       and not exists (
         select 1 from public.tenant_members m
          where m.tenant_id = i.tenant_id and m.user_id = auth.uid()
       )
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.my_invitations() from public, anon;
grant execute on function public.my_invitations() to authenticated;

-- ─── Сторож ─────────────────────────────────────────────────────────────

do $guard$
declare
  v_helper text := pg_get_functiondef('public.grant_invitation_calendar(public.invitations, uuid)'::regprocedure);
  v_setter text := pg_get_functiondef('public.set_member_access(uuid, jsonb)'::regprocedure);
  v_validator text := pg_get_functiondef('public.access_validate_changes(uuid, text[], jsonb)'::regprocedure);
  v_accept text := pg_get_functiondef('public.accept_invitation(text)'::regprocedure);
  v_signup text := pg_get_functiondef('public.handle_new_user()'::regprocedure);
  v_signal text := pg_get_functiondef('public.invitations_changed_signal()'::regprocedure);
  v_internal text;
begin
  if to_regprocedure('public.create_invitation(text, text, text, text, text, text)') is not null
     or (
       select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'create_invitation'
     ) <> 1 then
    raise exception 'миграция: осталась прежняя форма create_invitation';
  end if;

  foreach v_internal in array array[
    'public.access_validate_changes(uuid, text[], jsonb)',
    'public.access_apply_changes(uuid, uuid, jsonb, uuid)',
    'public.invitations_forget_deleted_calendar()',
    'public.access_blocks_rename_in_invitations()',
    'public.invitations_changed_signal()'
  ] loop
    if has_function_privilege('anon', v_internal, 'execute')
       or has_function_privilege('authenticated', v_internal, 'execute') then
      raise exception 'миграция: внутренняя функция % открыта клиенту', v_internal;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.create_invitation(text, text, text, text, text, text, text[], text, text, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.update_invitation(uuid, text, text, text[], text, text, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.create_invitation(text, text, text, text, text, text, text[], text, text, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.update_invitation(uuid, text, text, text[], text, text, jsonb)', 'execute') then
    raise exception 'миграция: права на приглашение шире или уже задуманного';
  end if;

  if position('access:not_live' in v_setter) > 0
     or position('public.access_apply_changes(' in v_setter) = 0 then
    raise exception 'миграция: set_member_access пишет мимо общего писателя или отказывает неживым блокам';
  end if;

  if position('t.is_active' in v_validator) > 0 then
    raise exception 'миграция: права нельзя снять в архивном календаре';
  end if;

  if position('public.access_apply_changes(' in v_helper) = 0
     or position('p_invitation.team_ids' in v_helper) = 0 then
    raise exception 'миграция: приём не выдаёт все календари и права приглашения';
  end if;

  if position('coalesce(v_invitation.team_ids, array[v_invitation.team_id])' in v_accept) = 0
     or position('perform public.grant_invitation_calendar(v_invitation, auth.uid());' in v_accept) = 0
     or position('coalesce(v_invitation.team_ids, array[v_invitation.team_id])' in v_signup) = 0
     or position('perform public.grant_invitation_calendar(v_invitation, new.id);' in v_signup) = 0 then
    raise exception 'миграция: вход приглашения отказывает по архиву домашнего календаря или зовёт помощника иначе';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.teams'::regclass
       and tgname = 'trg_invitations_forget_deleted_calendar'
       and not tgisinternal
  ) then
    raise exception 'миграция: удаление календаря уносит приглашение целиком';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.access_blocks'::regclass
       and tgname = 'access_blocks_rename_in_invitations'
       and not tgisinternal
  ) then
    raise exception 'миграция: переименование блока не доезжает до приглашений';
  end if;

  if position('team_ids' in v_signal) = 0
     or not exists (
       select 1 from pg_trigger t
        where t.tgrelid = 'public.invitations'::regclass
          and t.tgname = 'invitations_changed_signal'
          and pg_get_triggerdef(t.oid) like '%team_ids%'
          and pg_get_triggerdef(t.oid) like '%access_changes%'
     ) then
    raise exception 'миграция: правка приглашения не сигналит входящим и пригласившему';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.invitations'::regclass
       and conname = 'invitations_card_fields_only_without_card'
  ) then
    raise exception 'миграция: должность и цвет можно сохранить в приглашении по существующей карточке';
  end if;

  if exists (
    select 1 from public.invitations i
     where i.team_id is not null and i.team_ids is null
  ) then
    raise exception 'миграция: у приглашений с календарём нет списка календарей';
  end if;
end
$guard$;
