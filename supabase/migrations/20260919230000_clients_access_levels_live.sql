-- ПРАВА ПО БЛОКАМ, ЭТАП 5: КЛИЕНТЫ СЛУШАЮТСЯ УРОВНЕЙ (STORY-082, сессия 011).
--
-- Владелец 19.09: «когда я перехожу в Команду 1 и открываю клиентов — оно
-- должно открывать клиентов Y&D; если человек, который поделился Командой 1,
-- одобряет, чтобы мы видели клиентов, — тогда видим ещё и клиентов Команды 1;
-- если не подтвердил — всё равно видим клиентов, просто не видим его».
-- «Одобряет» — это три блока страницы прав мастера, которые до сих пор только
-- хранились:
--   • «Клиенты» (`clients`: off · read · write);
--   • «Какие клиенты» (`clients.scope`: own — из его календарей · all — все);
--   • «Телефоны и контакты» (`clients.contacts`: off · read).
-- Клиентов сотруднику открывала старая галочка `clients` в `calendar_members`.
-- У живого сотрудника её нет (у airfix.cy в Giliuta только `view`), поэтому при
-- «Клиенты: Меняет» на его странице прав он видел ноль клиентов.
--
-- ЧТО ИЗМЕРЕНО НА БОЕВОЙ 19.09, ПЕРЕД НАКАТОМ: сотрудник в базе ОДИН
-- (airfix.cy, мастер в Giliuta), строк уровней клиентов две — «Клиенты:
-- Меняет» и «Телефоны: Смотрит», обе поставил владелец руками 15.09. Массового
-- умолчания у блоков клиентов нет: новый сотрудник получает «Скрыт», как и
-- обещает контракт v1.1.
--
-- СОТРУДНИК ЧИТАЕТ БАЗУ ТОЛЬКО ЧЕРЕЗ ОКНО `list_member_clients`, а не из
-- таблицы. Причина простая: правило таблицы отдаёт строку целиком, а в строке
-- клиента лежат и телефоны, и деньги (`balance`, `discount`). Спрятать колонку
-- правилом нельзя — значит, прямое чтение сотруднику закрыто вовсе, а окно
-- отдаёт ровно то, что ему открыли: контакты только при «Телефоны: Смотрит»,
-- деньги клиента — никогда (они живут в блоках финансов).
--
-- ЧТО ВИДИТ СОТРУДНИК В ОКНЕ (владелец — всё, как было):
--   • «Клиенты: Скрыт» — ни одного клиента компании;
--   • «Смотрит» или «Меняет» при «Все» — всех клиентов компании;
--   • … при «Из его календарей» — клиентов записей в календарях, где у него
--     «Календарь и записи» не ниже «Смотрит» (хранимое положение, та же
--     функция, что у денег 010: `access_records_level`), клиентов его
--     собственных записей (карточка мастера с его `user_id`) и клиентов,
--     которых он создал сам (новая колонка `clients.created_by`);
--   • клиенты в корзине и архиве — только владельцу.
--
-- ЧТО МЕНЯЕТ СОТРУДНИК при «Меняет»: создаёт и правит клиентов своего набора
-- через `create_client_with_tags` и `update_client_with_tags`. За владельцем
-- остаются корзина, деньги клиента (`balance`, `discount`), чёрный список,
-- закрепление и выбор любимого мастера — это общие для компании пометки.
-- Контакты при «Телефоны: Скрыт» не правятся: пустые поля его карточки
-- затёрли бы настоящие номера. Прямая запись в таблицы клиентов и меток —
-- только владелец: офлайн-очередь сотруднику не положена.
--
-- КАЛЕНДАРЬ НЕ МЕНЯЕТСЯ. Клиент своей записи виден мастеру по-прежнему через
-- `current_user_can_access_client` и `list_master_clients_safe`: это клиент
-- записи, а не клиентская база. Вложения клиента эта миграция не трогает.
--
-- ВЕТКИ РОЛИ «ДИСПЕТЧЕР» И ГАЛОЧКИ `clients` уходят из правил клиентов и меток.
-- Диспетчеров и строк `clients` у сотрудников в боевой базе нет (проверено
-- 19.09), права теперь задаются уровнями.
--
-- КОЛОНКА `created_by` ДОБАВЛЯЕТСЯ В ДВА ШАГА, И ЭТО НЕ ПРИДИРКА. `auth.uid()`
-- — функция STABLE, поэтому `add column … default auth.uid()` вычислит её ОДИН
-- раз и пропишет всем существующим строкам как «недостающее значение». В
-- сессии с токеном это поставило бы одного человека автором ВСЕХ клиентов всех
-- компаний, а правило «Из его календарей» показывает автору его клиентов —
-- то есть открыло бы ему всю базу. Сначала колонка без умолчания, потом
-- умолчание; сторож проверяет, что недостающего значения нет.
--
-- В ПОЛИТИКАХ функции стоят только подзапросом — `(select …)`: голый вызов
-- security definer считается на каждую строку (4778 мс против 87 на боевой).
--
-- ТЕЛА `create_client_with_tags` и `update_client_with_tags` РУКАМИ НЕ
-- ПЕРЕПИСЫВАЮТСЯ: правка вставляется в живое тело (`pg_get_functiondef`) по
-- якорям, и каждый якорь обязан встретиться ровно один раз. Белые списки
-- ключей не меняются — их сторожит `clients-rpc-contract.test.ts`.
--
-- ПОВЕДЕНИЕ ДОКАЗАНО ПРОГОНОМ В ОТКАТЕ на боевой (19.09): 80 отпечатков
-- «до/после» у всех девятнадцати владельцев и у сотрудника совпали, кроме
-- одного и ожидаемого — сотрудник стал видеть метки клиентов; сорок сценариев
-- уровней, отказов и границ зелёные. Текстовый сторож ниже — вторая линия, а
-- не единственная.
--
-- НАКАЧЕН текст этого же файла без внешних комментариев (комментарии внутри
-- тел функций сохранены байт в байт, тела сверены по md5 после наката):
-- `apply_migration` принимает один вызов, и лишние килобайты в него не нужны.
-- Канон — этот файл.

-- ─── Снимок политик до правки ───────────────────────────────────────────
-- Сторож в конце сверяет с ним: всё, чего миграция не касается, обязано
-- остаться байт в байт. Файл накатывается одной транзакцией (`apply_migration`),
-- поэтому временная таблица живёт ровно до конца наката.

create temp table _clients_levels_policies_before as
select pp.tablename::text as tbl,
       pp.policyname::text as pol,
       pp.cmd::text as cmd,
       pp.permissive::text as permissive,
       pp.roles::text as roles,
       pp.qual,
       pp.with_check
  from pg_policies pp
 where pp.schemaname = 'public';

-- ─── Кто создал клиента ─────────────────────────────────────────────────
-- Нужен правилу «Из его календарей»: клиент без записей — нормальная вещь
-- (контактная база), и сотрудник не должен терять того, кого сам завёл.
-- Прошлым строкам автор неизвестен — `null`, их видно по записям.

alter table public.clients
  add column if not exists created_by uuid
  references auth.users (id) on delete set null;

alter table public.clients
  alter column created_by set default auth.uid();

comment on column public.clients.created_by is
  'Кто завёл клиента (auth.uid() на вставке). Правило «Из его календарей» '
  'показывает сотруднику созданных им клиентов даже без записей.';

create index if not exists clients_tenant_created_by_idx
  on public.clients (tenant_id, created_by)
  where created_by is not null;

-- ─── Положение блока компании словом ────────────────────────────────────
-- `access_company(блок, минимум)` отвечает «да/нет» и годится для «Клиентов»
-- и «Телефонов». У «Каких клиентов» положения свои — `own` и `all`, — и их
-- надо прочитать словом, не потеряв правил: неживой блок отдаёт умолчание,
-- владельцу — самое полное положение, чужому — ничего.

create or replace function public.access_company_level(p_block text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid;
  caller_role text;
  block_row public.access_blocks%rowtype;
  stored_level text;
begin
  if caller is null then
    return null;
  end if;

  select * into block_row
    from public.access_blocks b
   where b.key = p_block
     and b.scope = 'company';
  if not found then
    return null;
  end if;

  active_tenant := public.current_tenant_id();
  if active_tenant is null then
    return null;
  end if;

  select tm.role into caller_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant
     and tm.user_id = caller;
  if caller_role is null then
    return null;
  end if;

  -- Владелец права выдаёт, а не получает: у него самое полное положение.
  if caller_role = 'owner' then
    return block_row.levels[array_length(block_row.levels, 1)];
  end if;

  if not block_row.live or block_row.owner_only then
    return block_row.levels[1];
  end if;

  select ma.level into stored_level
    from public.member_access ma
   where ma.tenant_id = active_tenant
     and ma.user_id = caller
     and ma.block = block_row.key
     and ma.team_id is null;

  return coalesce(stored_level, block_row.levels[1]);
end;
$function$;

comment on function public.access_company_level(text) is
  'Положение блока компании СЛОВОМ у вошедшего: умолчание у неживого блока, '
  'самое полное у владельца, null — не член компании или блока нет.';

-- ─── Правило: какие клиенты видны сотруднику ────────────────────────────

create or replace function public.access_client_ids()
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid;
  caller_role text;
  scope_level text;
  calendars text[];
  own_masters text[];
begin
  if caller is null then
    return array[]::uuid[];
  end if;

  active_tenant := public.current_tenant_id();
  if active_tenant is null then
    return array[]::uuid[];
  end if;

  select tm.role into caller_role
    from public.tenant_members tm
   where tm.tenant_id = active_tenant
     and tm.user_id = caller;

  -- Владельца пускает своя ветка окна; набор — только для сотрудника.
  if caller_role is null or caller_role = 'owner' then
    return array[]::uuid[];
  end if;

  if not public.access_company('clients', 'read') then
    return array[]::uuid[];
  end if;

  scope_level := public.access_company_level('clients.scope');

  select coalesce(array_agg(mc.team_id order by mc.team_id), array[]::text[])
    into calendars
    from public.member_calendars mc
   where mc.tenant_id = active_tenant
     and mc.user_id = caller
     and array_position(
           array['read', 'write'],
           public.access_records_level(active_tenant, caller, mc.team_id)
         ) is not null;

  select coalesce(array_agg(m.id order by m.id), array[]::text[])
    into own_masters
    from public.masters m
   where m.tenant_id = active_tenant
     and m.user_id = caller;

  return coalesce((
    select array_agg(c.id order by c.id)
      from public.clients c
     where c.tenant_id = active_tenant
       and c.deleted_at is null
       and (
         scope_level = 'all'
         or c.created_by = caller
         or exists (
           select 1
             from public.appointments a
            where a.tenant_id = active_tenant
              and a.client_id = c.id
              and (a.team_id = any(calendars) or a.master_id = any(own_masters))
         )
       )
  ), array[]::uuid[]);
end;
$function$;

comment on function public.access_client_ids() is
  'Клиенты активной компании, которых видит СОТРУДНИК по блокам «Клиенты» и '
  '«Какие клиенты». Владельцу — пусто: его пускает своя ветка окна.';

-- Пустые контакты и пустые деньги в JSON клиента: одно место знает, что это
-- такое, и одно место их убирает.
create or replace function public.client_without_contacts(p_client jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $function$
  select p_client || jsonb_build_object(
    'phone', '',
    'whatsapp_phone', '',
    'email', '',
    'telegram_username', '',
    'instagram_username', '',
    'phones', '[]'::jsonb,
    'phone_e164', null
  )
$function$;

comment on function public.client_without_contacts(jsonb) is
  'Клиент без телефонов, почты и мессенджеров — для сотрудника при '
  '«Телефоны и контакты: Скрыт».';

create or replace function public.client_without_money(p_client jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $function$
  select p_client || jsonb_build_object('balance', 0, 'discount', 0)
$function$;

comment on function public.client_without_money(jsonb) is
  'Клиент без своих денег (баланс и скидка) — сотруднику они не приходят: '
  'деньги живут в блоках финансов, а не в блоке «Клиенты».';

-- Ответ функций записи — теми же глазами, что окно: сотруднику без «Телефонов»
-- контакты пустые, деньги клиента пустые всегда. Одно тело на оба ответа.
create or replace function public.client_seen_by_caller(p_client jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select case
    when public.current_user_role() = 'owner' then p_client
    when public.access_company('clients.contacts', 'read')
      then public.client_without_money(p_client)
    else public.client_without_money(public.client_without_contacts(p_client))
  end
$function$;

comment on function public.client_seen_by_caller(jsonb) is
  'Клиент глазами вошедшего: владельцу — как есть, сотруднику — без денег и '
  '(при «Телефоны: Скрыт») без контактов. Ответ функций записи.';

revoke all on function public.client_seen_by_caller(jsonb) from public, anon, authenticated, service_role;

-- ─── Окно: клиентская база глазами сотрудника ───────────────────────────
-- Клиент целиком (форма строки `clients` плюс `tag_ids`), без корзины и
-- архива. Контакты — только при «Телефоны и контакты: Смотрит», деньги
-- клиента — только владельцу.

create or replace function public.list_member_clients(p_client_id uuid default null)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  active_tenant uuid := public.current_tenant_id();
  caller_role text := public.current_user_role();
  visible uuid[] := array[]::uuid[];
  hide_contacts boolean;
  hide_money boolean;
begin
  if auth.uid() is null or active_tenant is null or caller_role is null then
    return;
  end if;

  hide_contacts := not public.access_company('clients.contacts', 'read');
  hide_money := caller_role <> 'owner';

  if caller_role <> 'owner' then
    visible := public.access_client_ids();
    if cardinality(visible) = 0 then
      return;
    end if;
  end if;

  return query
    select case when hide_money then public.client_without_money(shown.row_json) else shown.row_json end
      from (
        select case
                 when hide_contacts then public.client_without_contacts(r.row_json)
                 else r.row_json
               end as row_json,
               r.full_name,
               r.id
          from (
            select to_jsonb(c) || jsonb_build_object(
                     'tag_ids',
                     coalesce((
                       select jsonb_agg(ta.tag_id order by ta.tag_id)
                         from public.client_tag_assignments ta
                        where ta.tenant_id = c.tenant_id
                          and ta.client_id = c.id
                     ), '[]'::jsonb)
                   ) as row_json,
                   c.full_name,
                   c.id
              from public.clients c
             where c.tenant_id = active_tenant
               and c.deleted_at is null
               and (p_client_id is null or c.id = p_client_id)
               and (caller_role = 'owner' or c.id = any(visible))
          ) r
      ) shown
     order by shown.full_name, shown.id;
end;
$function$;

comment on function public.list_member_clients(uuid) is
  'Клиенты активной компании по уровням вошедшего: владельцу — все, '
  'сотруднику — его набор без денег; контакты — при «Телефоны: Смотрит».';

-- ─── Право править клиента ──────────────────────────────────────────────

create or replace function public.current_user_can_edit_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select case
    when auth.uid() is null then false
    when not exists (
      select 1
        from public.clients c
       where c.id = p_client_id
         and c.tenant_id = public.current_tenant_id()
    ) then false
    when public.current_user_role() = 'owner' then true
    else public.access_company('clients', 'write')
         and p_client_id = any(public.access_client_ids())
  end
$function$;

comment on function public.current_user_can_edit_client(uuid) is
  'Может ли человек править клиента АКТИВНОЙ компании: владелец — любого, '
  'сотрудник — при «Клиенты: Меняет» и только из своего набора.';

-- ─── Права вызова ───────────────────────────────────────────────────────
-- Окно и положение блока зовут вошедшие; набор клиентов и пустые поля —
-- внутренние тела, наружу не торчат.

revoke all on function public.access_client_ids() from public, anon, authenticated, service_role;

revoke all on function public.access_company_level(text) from public, anon, authenticated, service_role;
grant execute on function public.access_company_level(text) to authenticated;

revoke all on function public.list_member_clients(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_member_clients(uuid) to authenticated;

revoke all on function public.client_without_contacts(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.client_without_money(jsonb) from public, anon, authenticated, service_role;

-- ─── Создание и правка клиента слушают уровни ───────────────────────────

do $migration$
declare
  target record;
  source_text text;
  patched text;
  hits integer;
begin
  for target in
    select *
      from (values
        (
          'create_client_with_tags', 'role',
          E'     or active_role not in (''owner'', ''dispatcher'') then\n    raise exception ''only an owner or dispatcher can create a client''\n      using errcode = ''42501'';\n',
          E'     or not (active_role = ''owner'' or public.access_company(''clients'', ''write'')) then\n    raise exception ''only an owner or an employee who can change clients can create a client''\n      using errcode = ''42501'', hint = ''block:clients'';\n'
        ),
        (
          'create_client_with_tags', 'money',
          E'  input_row := jsonb_populate_record(null::public.clients, p_client);\n',
          E'  input_row := jsonb_populate_record(null::public.clients, p_client);\n\n  -- Деньги клиента, корзина и общие пометки — дело владельца.\n  if active_role <> ''owner'' then\n    input_row.balance := 0;\n    input_row.discount := 0;\n    input_row.deleted_at := null;\n    input_row.blacklisted := false;\n    input_row.pinned_at := null;\n    input_row.favorite_master_id := null;\n  end if;\n'
        ),
        (
          'create_client_with_tags', 'return',
          E'  return to_jsonb(saved_row)\n    || jsonb_build_object(''tag_ids'', to_jsonb(normalized_tag_ids));\n',
          E'  return public.client_seen_by_caller(to_jsonb(saved_row))\n    || jsonb_build_object(''tag_ids'', to_jsonb(normalized_tag_ids));\n'
        ),
        (
          'update_client_with_tags', 'role',
          E'     or active_role not in (''owner'', ''dispatcher'') then\n    raise exception ''only an owner or dispatcher can update a client''\n      using errcode = ''42501'';\n',
          E'     or not (active_role = ''owner'' or public.access_company(''clients'', ''write'')) then\n    raise exception ''only an owner or an employee who can change clients can update a client''\n      using errcode = ''42501'', hint = ''block:clients'';\n'
        ),
        (
          'update_client_with_tags', 'employee',
          E'  if not public.current_user_can_edit_client(p_client_id) then\n    raise exception ''client not found''\n      using errcode = ''P0002'';\n  end if;\n',
          E'  if not public.current_user_can_edit_client(p_client_id) then\n    raise exception ''client not found''\n      using errcode = ''P0002'';\n  end if;\n\n  if active_role <> ''owner'' then\n    -- Корзина, деньги клиента и общие пометки — дело владельца.\n    if p_patch ?| array[''deleted_at'', ''balance'', ''discount'', ''blacklisted'',\n                        ''pinned_at'', ''favorite_master_id''] then\n      raise exception ''only the owner archives a client, changes its money or company-wide marks''\n        using errcode = ''42501'', hint = ''block:clients'';\n    end if;\n    -- Контакты, которых сотрудник не видит, он и не правит: пустые поля его\n    -- карточки затёрли бы настоящие номера.\n    if not public.access_company(''clients.contacts'', ''read'')\n       and p_patch ?| array[''phone'', ''whatsapp_phone'', ''email'', ''telegram_username'',\n                            ''instagram_username'', ''phones'', ''phone_e164''] then\n      raise exception ''contacts are hidden for this employee''\n        using errcode = ''42501'', hint = ''block:clients.contacts'';\n    end if;\n  end if;\n'
        ),
        (
          'update_client_with_tags', 'return',
          E'  return to_jsonb(saved_row)\n    || jsonb_build_object(''tag_ids'', to_jsonb(result_tag_ids));\n',
          E'  return public.client_seen_by_caller(to_jsonb(saved_row))\n    || jsonb_build_object(''tag_ids'', to_jsonb(result_tag_ids));\n'
        )
      ) as t(fn, step, anchor, replacement)
  loop
    select pg_get_functiondef(p.oid)
      into source_text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = target.fn;

    if source_text is null then
      raise exception 'миграция: функции % нет', target.fn;
    end if;

    -- Повторный накат ничего не удваивает.
    if position(target.replacement in source_text) > 0 then
      continue;
    end if;

    hits := (length(source_text) - length(replace(source_text, target.anchor, '')))
            / length(target.anchor);
    if hits <> 1 then
      raise exception 'миграция: в % якорь «%» встретился % раз, ждали 1 — тело менялось, правка вручную',
        target.fn, target.step, hits;
    end if;

    patched := replace(source_text, target.anchor, target.replacement);
    execute patched;
  end loop;
end
$migration$;

-- ─── Политики клиентов и меток ──────────────────────────────────────────
-- Сотрудник таблицу клиентов не читает вовсе: строка несёт телефоны и деньги,
-- а колонку правилом не спрячешь. Его дорога — окно `list_member_clients`.

drop policy if exists clients_select_role_scoped on public.clients;
create policy clients_select_owner on public.clients
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'owner'
  );

drop policy if exists clients_update_owner_or_dispatcher on public.clients;
create policy clients_update_owner on public.clients
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'owner'
  );

drop policy if exists clients_insert_owner_or_dispatcher on public.clients;
create policy clients_insert_owner on public.clients
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'owner'
  );

-- Имена и цвета меток сотруднику нужны: они стоят на клиентах его набора.
drop policy if exists client_tags_select_role_scoped on public.client_tags;
create policy client_tags_select_access on public.client_tags
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or (select public.access_company('clients', 'read'))
    )
  );

drop policy if exists client_tags_modify_owner_or_dispatcher on public.client_tags;
create policy client_tags_modify_owner on public.client_tags
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'owner'
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'owner'
  );

-- Какие метки у какого клиента, сотрудник получает вместе с клиентом из окна.
drop policy if exists client_tag_assignments_select_role_scoped on public.client_tag_assignments;
create policy client_tag_assignments_select_owner on public.client_tag_assignments
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'owner'
  );

drop policy if exists client_tag_assignments_modify_owner_or_dispatcher on public.client_tag_assignments;
create policy client_tag_assignments_modify_owner on public.client_tag_assignments
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'owner'
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = 'owner'
  );

-- ─── Живые блоки ────────────────────────────────────────────────────────
-- Места проверки названы так, чтобы их можно было найти в каталоге:
-- `policy:схема.таблица.политика` и `function:схема.функция(аргументы)`.

update public.access_blocks
   set live = true,
       enforced_by = array[
         'function:public.access_client_ids()',
         'function:public.list_member_clients(uuid)',
         'policy:public.client_tags.client_tags_select_access',
         'function:public.current_user_can_edit_client(uuid)',
         'function:public.create_client_with_tags(uuid, uuid, jsonb, uuid[])',
         'function:public.update_client_with_tags(uuid, uuid, jsonb, uuid[])'
       ]
 where key = 'clients';

update public.access_blocks
   set live = true,
       enforced_by = array[
         'function:public.access_client_ids()'
       ]
 where key = 'clients.scope';

update public.access_blocks
   set live = true,
       enforced_by = array[
         'function:public.list_member_clients(uuid)',
         'function:public.client_seen_by_caller(jsonb)',
         'function:public.update_client_with_tags(uuid, uuid, jsonb, uuid[])'
       ]
 where key = 'clients.contacts';

-- ─── Живое время ────────────────────────────────────────────────────────
-- Живые блоки меняют карту каждого сотрудника, хотя его уровни не менялись.
-- Тот же сигнал, что даёт правка прав: версия растёт, телефон перечитывает
-- карту и сразу открывает или прячет клиентов.

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

-- ─── Сторож ─────────────────────────────────────────────────────────────

do $guard$
declare
  v_dropped constant text[] := array[
    'clients.clients_select_role_scoped',
    'clients.clients_update_owner_or_dispatcher',
    'clients.clients_insert_owner_or_dispatcher',
    'client_tags.client_tags_select_role_scoped',
    'client_tags.client_tags_modify_owner_or_dispatcher',
    'client_tag_assignments.client_tag_assignments_select_role_scoped',
    'client_tag_assignments.client_tag_assignments_modify_owner_or_dispatcher'
  ];
  v_created constant text[] := array[
    'clients.clients_select_owner',
    'clients.clients_update_owner',
    'clients.clients_insert_owner',
    'client_tags.client_tags_select_access',
    'client_tags.client_tags_modify_owner',
    'client_tag_assignments.client_tag_assignments_select_owner',
    'client_tag_assignments.client_tag_assignments_modify_owner'
  ];
  v_bad text;
  v_text text;
  v_block record;
  v_place text;
  v_def text;
  v_acl text;
begin
  -- Всё, чего миграция не касается, — байт в байт.
  select string_agg(b.tbl || '.' || b.pol, ', ')
    into v_bad
    from _clients_levels_policies_before b
    left join pg_policies pp
      on pp.schemaname = 'public'
     and pp.tablename = b.tbl
     and pp.policyname = b.pol
   where not ((b.tbl || '.' || b.pol) = any(v_dropped))
     and (
       pp.policyname is null
       or pp.cmd::text is distinct from b.cmd
       or pp.permissive::text is distinct from b.permissive
       or pp.roles::text is distinct from b.roles
       or pp.qual is distinct from b.qual
       or pp.with_check is distinct from b.with_check
     );
  if v_bad is not null then
    raise exception 'миграция: изменились чужие политики: %', v_bad;
  end if;

  select string_agg(pp.tablename || '.' || pp.policyname, ', ')
    into v_bad
    from pg_policies pp
   where pp.schemaname = 'public'
     and not exists (
       select 1 from _clients_levels_policies_before b
        where b.tbl = pp.tablename and b.pol = pp.policyname
     )
     and not ((pp.tablename || '.' || pp.policyname) = any(v_created));
  if v_bad is not null then
    raise exception 'миграция: появились необъявленные политики: %', v_bad;
  end if;

  select string_agg(x, ', ')
    into v_bad
    from unnest(v_dropped) x
   where exists (
     select 1 from pg_policies pp
      where pp.schemaname = 'public'
        and pp.tablename || '.' || pp.policyname = x
   );
  if v_bad is not null then
    raise exception 'миграция: старые политики на месте: %', v_bad;
  end if;

  -- Колонка автора не прошита существующим строкам.
  if exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.clients'::regclass
       and a.attname = 'created_by'
       and a.atthasmissing
  ) then
    raise exception 'миграция: `created_by` прописан существующим строкам — умолчание вычислилось на накате';
  end if;

  -- Новые правила: без роли «диспетчер», без старых галочек, без набора
  -- клиентов (сотрудник ходит окном) и только подзапросами. Разобранный текст
  -- политики пишет вызов без схемы: `( SELECT current_tenant_id() AS …)`.
  for v_text in
    select pp.tablename || '.' || pp.policyname || ': ' || coalesce(pp.qual, '') || ' ' || coalesce(pp.with_check, '')
      from pg_policies pp
     where pp.schemaname = 'public'
       and (pp.tablename || '.' || pp.policyname) = any(v_created)
  loop
    if v_text ~ 'dispatcher|current_user_calendar_ids|current_user_has_calendar_grants' then
      raise exception 'миграция: новое правило держит старую ветку: %', v_text;
    end if;
    if v_text ~ 'access_client_ids' then
      raise exception 'миграция: правило таблицы пускает сотрудника мимо окна: %', v_text;
    end if;
    v_def := regexp_replace(
      v_text,
      'SELECT (public\.)?(access_company|current_tenant_id|current_user_role)\(',
      'SELECT allowed(',
      'g'
    );
    if v_def ~ '(access_company|current_tenant_id|current_user_role)\(' then
      raise exception 'миграция: функция в правиле без подзапроса: %', v_text;
    end if;
  end loop;
  if (select count(*) from pg_policies pp
       where pp.schemaname = 'public'
         and (pp.tablename || '.' || pp.policyname) = any(v_created)) <> cardinality(v_created) then
    raise exception 'миграция: создались не все объявленные политики';
  end if;

  -- Создание и правка клиента слушают уровни, а не роль.
  foreach v_place in array array[
    'public.create_client_with_tags(uuid, uuid, jsonb, uuid[])',
    'public.update_client_with_tags(uuid, uuid, jsonb, uuid[])'
  ] loop
    v_def := pg_get_functiondef(v_place::regprocedure);
    if position('public.access_company(''clients'', ''write'')' in v_def) = 0
       or position('hint = ''block:clients''' in v_def) = 0
       or position('public.client_seen_by_caller(to_jsonb(saved_row))' in v_def) = 0
       or v_def ~ '''dispatcher''' then
      raise exception 'миграция: % пишет клиента мимо уровней', v_place;
    end if;
  end loop;
  v_def := pg_get_functiondef('public.create_client_with_tags(uuid, uuid, jsonb, uuid[])'::regprocedure);
  if position('input_row.balance := 0;' in v_def) = 0
     or position('input_row.deleted_at := null;' in v_def) = 0
     or position('input_row.blacklisted := false;' in v_def) = 0 then
    raise exception 'миграция: сотрудник задаёт деньги, корзину или пометки нового клиента';
  end if;
  v_def := pg_get_functiondef('public.update_client_with_tags(uuid, uuid, jsonb, uuid[])'::regprocedure);
  if position('''blacklisted'',' in v_def) = 0
     or position('''pinned_at'', ''favorite_master_id''' in v_def) = 0
     or position('hint = ''block:clients.contacts''' in v_def) = 0
     or position('if not public.current_user_can_edit_client(p_client_id) then' in v_def) = 0 then
    raise exception 'миграция: сотрудник правит корзину, деньги, пометки или скрытые контакты';
  end if;
  v_def := pg_get_functiondef('public.current_user_can_edit_client(uuid)'::regprocedure);
  if position('public.access_company(''clients'', ''write'')' in v_def) = 0
     or position('public.access_client_ids()' in v_def) = 0
     or position('c.tenant_id = public.current_tenant_id()' in v_def) = 0
     or v_def ~ 'dispatcher|current_user_calendar_ids' then
    raise exception 'миграция: право править клиента живёт по старой галочке или без компании';
  end if;
  v_def := pg_get_functiondef('public.list_member_clients(uuid)'::regprocedure);
  if position('public.client_without_money(shown.row_json)' in v_def) = 0
     or position('public.client_without_contacts(r.row_json)' in v_def) = 0
     or position('c.deleted_at is null' in v_def) = 0 then
    raise exception 'миграция: окно отдаёт сотруднику деньги, скрытые контакты или корзину';
  end if;

  -- Живы три блока клиентов, у каждого названные места существуют и
  -- спрашивают именно его.
  if (select count(*) from public.access_blocks b
       where b.key in ('clients', 'clients.scope', 'clients.contacts') and b.live) <> 3 then
    raise exception 'миграция: блоки клиентов не живые';
  end if;
  for v_block in
    select b.key, b.enforced_by
      from public.access_blocks b
     where b.key in ('clients', 'clients.scope', 'clients.contacts')
  loop
    if cardinality(v_block.enforced_by) = 0 then
      raise exception 'миграция: у живого блока % не названы места проверки', v_block.key;
    end if;
    foreach v_place in array v_block.enforced_by loop
      v_text := null;
      if v_place like 'policy:public.%' then
        select coalesce(pp.qual, '') || ' ' || coalesce(pp.with_check, '')
          into v_text
          from pg_policies pp
         where pp.schemaname = 'public'
           and pp.tablename = split_part(substr(v_place, 15), '.', 1)
           and pp.policyname = split_part(substr(v_place, 15), '.', 2);
      elsif v_place like 'function:public.%' and to_regprocedure(substr(v_place, 10)) is not null then
        v_text := pg_get_functiondef(to_regprocedure(substr(v_place, 10)));
      end if;
      if v_text is null then
        raise exception 'миграция: место проверки % блока % не найдено', v_place, v_block.key;
      end if;
      -- Окно спрашивает «Клиентов» не своим текстом, а набором:
      -- `access_client_ids` внутри себя проверяет и блок, и охват.
      if position('''' || v_block.key || '''' in v_text) = 0
         and not (v_block.key = 'clients' and position('access_client_ids()' in v_text) > 0) then
        raise exception 'миграция: % не проверяет блок %', v_place, v_block.key;
      end if;
    end loop;
  end loop;

  -- Права вызова: окно и положение блока — вошедшим, внутренние тела — никому.
  -- Пустой `proacl` значит права ПО УМОЛЧАНИЮ, то есть execute у PUBLIC, —
  -- это тоже провал. PUBLIC в тексте прав — запись без имени: `=X/postgres`.
  foreach v_place in array array[
    'public.list_member_clients(uuid)',
    'public.access_company_level(text)'
  ] loop
    select p.proacl::text into v_acl from pg_proc p where p.oid = v_place::regprocedure;
    if v_acl is null or v_acl ~ '(^|[{,])=X' or v_acl ~ 'anon=' or position('authenticated=X' in v_acl) = 0 then
      raise exception 'миграция: права вызова %: %', v_place, coalesce(v_acl, 'по умолчанию');
    end if;
  end loop;
  foreach v_place in array array[
    'public.access_client_ids()',
    'public.client_without_contacts(jsonb)',
    'public.client_without_money(jsonb)',
    'public.client_seen_by_caller(jsonb)'
  ] loop
    select p.proacl::text into v_acl from pg_proc p where p.oid = v_place::regprocedure;
    if v_acl is null or v_acl ~ '(^|[{,])=X|anon=|authenticated=|service_role=' then
      raise exception 'миграция: внутреннее тело % торчит наружу: %', v_place, coalesce(v_acl, 'по умолчанию');
    end if;
  end loop;
end
$guard$;

drop table _clients_levels_policies_before;
