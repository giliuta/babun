-- STORY-086: ЛЮДИ КАРТОЧКИ ЧИТАЮТСЯ ОДНОЙ ДВЕРЬЮ, А СВЯЗЬ — ЭТО КОНТАКТ.
--
-- Связь живёт у ЧЛЕНА (`clients.memberships`, миграция 20260921200000), и
-- «люди карточки X» — это клиенты, у которых в memberships стоит X. Читать их
-- перебором всего справочника на устройстве нельзя: `listClients` тянет базу
-- страницами по 1000, а ответ нужен на каждой карточке. Поэтому здесь —
-- указатель по связям и ОДНА definer-функция, которая отдаёт людей карточки
-- глазами вызывающего.
--
-- 1. НОВОЕ ИМЯ, А НЕ ПАРАМЕТР У СТАРОЙ. `list_member_clients(uuid)` — окно
--    базы; добавить ей второй параметр значило бы молча завести вторую
--    перегрузку (снять `default` у параметра нельзя — 42P13).
--
-- 2. НАБОР УРЕЗАН — БЛОКА НЕТ. Функция отдаёт строки владельцу или сотруднику
--    с «Какие клиенты: Все» И «Телефоны и контакты: Смотрит»; иначе ноль строк,
--    и клиент гасит весь блок. Третьего состояния «видно, но не всё» не
--    остаётся: строка «жилец · (никого)» — это ошибка, а не вид.
--
-- 3. СВЯЗЬ — СВЕДЕНИЯ ТОГО ЖЕ ПОРЯДКА, ЧТО ТЕЛЕФОН. Роль («жена», «жилец»)
--    рассказывает о человеке ровно столько же, поэтому маска
--    `client_without_contacts` гасит и `memberships`, а правка `memberships`
--    запрещена сотруднику без «Телефонов»: иначе урезанный маской массив
--    можно было бы записать обратно и молча стереть настоящие связи.

begin;

set local lock_timeout = '5s';

-- ─── Указатель по связям ────────────────────────────────────────────────
-- Вопрос всегда один: «у кого в memberships стоит эта карточка» — это
-- containment (`@>`), и под него берётся jsonb_path_ops: он вдвое меньше
-- обычного GIN и умеет ровно `@>`, другого нам и не нужно.
create index if not exists clients_memberships_gin
  on public.clients using gin (memberships jsonb_path_ops);

-- ─── Маска сотрудника гасит и связи ─────────────────────────────────────
create or replace function public.client_without_contacts(p_client jsonb)
 returns jsonb
 language sql
 immutable
 set search_path to 'public'
as $function$
  select p_client || jsonb_build_object(
    'phone', '',
    'whatsapp_phone', '',
    'email', '',
    'telegram_username', '',
    'instagram_username', '',
    'phones', '[]'::jsonb,
    'phone_e164', null,
    'memberships', '[]'::jsonb
  )
$function$;

comment on function public.client_without_contacts(jsonb) is
  'Клиент без телефонов, почты, мессенджеров И СВЯЗЕЙ — для сотрудника при '
  '«Телефоны и контакты: Скрыт»: роль в связи рассказывает о человеке столько '
  'же, сколько номер.';

-- ─── Люди карточки ──────────────────────────────────────────────────────
create or replace function public.list_client_members(p_group_id uuid)
 returns setof jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  active_tenant uuid := public.current_tenant_id();
  caller_role text := public.current_user_role();
  visible uuid[] := array[]::uuid[];
begin
  if auth.uid() is null or active_tenant is null or caller_role is null
     or p_group_id is null then
    return;
  end if;

  if caller_role <> 'owner' then
    -- Набор урезан — блока нет (см. заголовок, пункт 2).
    if not public.access_company('clients', 'read')
       or not public.access_company('clients.contacts', 'read')
       or public.access_company_level('clients.scope') is distinct from 'all' then
      return;
    end if;
    -- И сама карточка-группа обязана быть в наборе: люди читаются у того, кого
    -- сотруднику вообще показывают.
    visible := public.access_client_ids();
    if not (p_group_id = any(visible)) then
      return;
    end if;
  end if;

  return query
    select public.client_seen_by_caller(
             to_jsonb(c) || jsonb_build_object(
               'tag_ids',
               coalesce((
                 select jsonb_agg(ta.tag_id order by ta.tag_id)
                   from public.client_tag_assignments ta
                  where ta.tenant_id = c.tenant_id
                    and ta.client_id = c.id
               ), '[]'::jsonb)
             )
           )
      from public.clients c
     where c.tenant_id = active_tenant
       and c.deleted_at is null
       and c.memberships @> jsonb_build_array(
             jsonb_build_object('group_id', p_group_id::text))
       and (caller_role = 'owner' or c.id = any(visible))
     order by c.full_name, c.id;
end;
$function$;

comment on function public.list_client_members(uuid) is
  'Люди карточки: клиенты, у которых в memberships стоит p_group_id — глазами '
  'вызывающего. Владельцу все, сотруднику только при «Какие клиенты: Все» и '
  '«Телефоны: Смотрит» и только из его набора; иначе ноль строк.';

-- ─── Правка клиента: связи — те же контакты ─────────────────────────────
-- Тело взято целиком из 20260921200000 (эта миграция идёт следом, и другого
-- определения между ними нет) и отличается ровно одним списком ключей.
create or replace function public.update_client_with_tags(p_tenant_id uuid, p_client_id uuid, p_patch jsonb, p_tag_ids uuid[] default null::uuid[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  active_tenant_id uuid := public.current_tenant_id();
  active_role text := public.current_user_role();
  current_row public.clients%rowtype;
  next_row public.clients%rowtype;
  saved_row public.clients%rowtype;
  result_tag_ids uuid[];
begin
  if auth.uid() is null
     or active_tenant_id is null
     or active_role is null
     or not (active_role = 'owner' or public.access_company('clients', 'write')) then
    raise exception 'only an owner or an employee who can change clients can update a client'
      using errcode = '42501', hint = 'block:clients';
  end if;

  if p_tenant_id is null
     or p_tenant_id is distinct from active_tenant_id then
    raise exception 'client tenant does not match the active tenant'
      using errcode = '42501';
  end if;

  if p_client_id is null then
    raise exception 'client id is required'
      using errcode = '22023';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'client patch must be an object'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_object_keys(p_patch) key
     where key not in (
       'full_name',
       'phone',
       'whatsapp_phone',
       'email',
       'sms_name',
       'telegram_username',
       'instagram_username',
       'balance',
       'discount',
       'comment',
       'acquisition_source',
       'referred_by_client_id',
       'first_contact_date',
       'address',
       'city',
       'city_manual',
       'property_type',
       'language',
       'birthday',
       'blacklisted',
       'pinned_at',
       'reminder_at',
       'phones',
       'locations',
       'notes',
       'equipment',
       'phone_e164',
       'avatar_url',
       'deleted_at',
       'favorite_master_id',
       'legal_name',
       'vat_number',
       'reg_number',
       'billing_address',
       'memberships'
     )
  ) then
    raise exception 'client patch contains a protected or unknown field'
      using errcode = '22023';
  end if;

  select client.*
    into current_row
    from public.clients client
   where client.id = p_client_id
     and client.tenant_id = active_tenant_id
   for update;

  if not found then
    raise exception 'client not found'
      using errcode = 'P0002';
  end if;
  if not public.current_user_can_edit_client(p_client_id) then
    raise exception 'client not found'
      using errcode = 'P0002';
  end if;

  if active_role <> 'owner' then
    -- Корзина, деньги клиента и общие пометки — дело владельца.
    -- 085: реквизиты компании — туда же, их сотрудник и не видит.
    if p_patch ?| array['deleted_at', 'balance', 'discount', 'blacklisted',
                        'pinned_at', 'favorite_master_id',
                        'vat_number', 'reg_number', 'billing_address'] then
      raise exception 'only the owner archives a client, changes its money or company-wide marks'
        using errcode = '42501', hint = 'block:clients';
    end if;
    -- Контакты, которых сотрудник не видит, он и не правит: пустые поля его
    -- карточки затёрли бы настоящие номера.
    --
    -- 086: `memberships` — в том же списке. Маска гасит связи до `[]`, и без
    -- этого запрета урезанный маской массив можно было бы записать обратно и
    -- молча стереть настоящие связи. Роль («жена», «жилец») — сведения того же
    -- порядка, что телефон.
    if not public.access_company('clients.contacts', 'read')
       and p_patch ?| array['phone', 'whatsapp_phone', 'email', 'telegram_username',
                            'instagram_username', 'phones', 'phone_e164',
                            'memberships'] then
      raise exception 'contacts are hidden for this employee'
        using errcode = '42501', hint = 'block:clients.contacts';
    end if;
  end if;

  next_row := jsonb_populate_record(current_row, p_patch);

  if nullif(btrim(next_row.full_name), '') is null then
    raise exception 'client name is required'
      using errcode = '23514';
  end if;

  if jsonb_typeof(coalesce(next_row.phones, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(next_row.locations, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(next_row.notes, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(next_row.equipment, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(next_row.memberships, '[]'::jsonb)) <> 'array' then
    raise exception 'client nested collections must be arrays'
      using errcode = '22023';
  end if;

  if p_patch ? 'referred_by_client_id'
     and next_row.referred_by_client_id = p_client_id then
    raise exception 'client cannot refer itself'
      using errcode = '23514';
  end if;

  if p_patch ? 'referred_by_client_id'
     and next_row.referred_by_client_id is not null
     and not exists (
       select 1
         from public.clients referrer
        where referrer.tenant_id = active_tenant_id
          and referrer.id = next_row.referred_by_client_id
     ) then
    raise exception 'referring client does not belong to the active tenant'
      using errcode = '23503';
  end if;

  if p_patch ? 'favorite_master_id'
     and next_row.favorite_master_id is not null
     and not exists (
       select 1
         from public.masters master
        where master.tenant_id = active_tenant_id
          and master.id = next_row.favorite_master_id
     ) then
    raise exception 'favorite master does not belong to the active tenant'
      using errcode = '23503';
  end if;

  if p_tag_ids is not null then
    result_tag_ids := public.normalize_client_tag_ids(
      active_tenant_id,
      p_tag_ids
    );
  end if;

  update public.clients client
     set full_name = next_row.full_name,
         phone = next_row.phone,
         whatsapp_phone = next_row.whatsapp_phone,
         email = next_row.email,
         sms_name = next_row.sms_name,
         telegram_username = next_row.telegram_username,
         instagram_username = next_row.instagram_username,
         balance = next_row.balance,
         discount = next_row.discount,
         comment = next_row.comment,
         acquisition_source = next_row.acquisition_source,
         referred_by_client_id = next_row.referred_by_client_id,
         first_contact_date = next_row.first_contact_date,
         address = next_row.address,
         city = next_row.city,
         city_manual = next_row.city_manual,
         property_type = next_row.property_type,
         language = next_row.language,
         birthday = next_row.birthday,
         blacklisted = next_row.blacklisted,
         pinned_at = next_row.pinned_at,
         reminder_at = next_row.reminder_at,
         phones = next_row.phones,
         locations = next_row.locations,
         notes = next_row.notes,
         equipment = next_row.equipment,
         phone_e164 = next_row.phone_e164,
         avatar_url = next_row.avatar_url,
         deleted_at = next_row.deleted_at,
         favorite_master_id = next_row.favorite_master_id,
         legal_name = nullif(btrim(next_row.legal_name), ''),
         vat_number = nullif(btrim(next_row.vat_number), ''),
         reg_number = nullif(btrim(next_row.reg_number), ''),
         billing_address = nullif(btrim(next_row.billing_address), ''),
         memberships = coalesce(next_row.memberships, '[]'::jsonb)
   where client.id = p_client_id
     and client.tenant_id = active_tenant_id
  returning client.* into saved_row;

  if p_tag_ids is not null then
    delete from public.client_tag_assignments assignment
     where assignment.tenant_id = active_tenant_id
       and assignment.client_id = p_client_id;

    insert into public.client_tag_assignments (
      tenant_id,
      client_id,
      tag_id
    )
    select active_tenant_id, p_client_id, supplied.tag_id
      from unnest(result_tag_ids) supplied(tag_id);
  else
    select coalesce(
             array_agg(assignment.tag_id order by assignment.tag_id),
             array[]::uuid[]
           )
      into result_tag_ids
      from public.client_tag_assignments assignment
     where assignment.tenant_id = active_tenant_id
       and assignment.client_id = p_client_id;
  end if;

  return public.client_seen_by_caller(to_jsonb(saved_row))
    || jsonb_build_object('tag_ids', to_jsonb(result_tag_ids));
end;
$function$;

-- ─── Права вызова ───────────────────────────────────────────────────────
-- Новая функция по умолчанию исполнима для PUBLIC, то есть и для `anon`:
-- дверь к людям карточки открывалась бы без входа. Отзываем в той же
-- миграции, в которой заводим.
revoke all on function public.list_client_members(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_client_members(uuid) to authenticated;

revoke all on function public.client_without_contacts(jsonb) from public, anon, authenticated, service_role;

-- ─── Сторож самой миграции ──────────────────────────────────────────────
do $audit$
declare
  v_def text;
begin
  -- Указатель есть и он по связям: без него «люди карточки» — перебор базы.
  if not exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and tablename = 'clients'
       and indexname = 'clients_memberships_gin'
       and indexdef ilike '%using gin%'
       and indexdef ilike '%memberships%'
  ) then
    raise exception 'STORY-086 members: нет GIN-указателя по связям';
  end if;

  -- Дверь закрыта для незашедшего и открыта вошедшему.
  if has_function_privilege('anon', 'public.list_client_members(uuid)', 'execute') then
    raise exception 'STORY-086 members: людей карточки может звать anon';
  end if;
  if not has_function_privilege('authenticated', 'public.list_client_members(uuid)', 'execute') then
    raise exception 'STORY-086 members: вошедший не может звать список людей';
  end if;

  -- Набор урезан — блока нет: все три условия стоят в теле.
  v_def := pg_get_functiondef('public.list_client_members(uuid)'::regprocedure);
  if position('public.access_company_level(''clients.scope'') is distinct from ''all''' in v_def) = 0 then
    raise exception 'STORY-086 members: список людей отдаётся при урезанном наборе';
  end if;
  if position('not public.access_company(''clients.contacts'', ''read'')' in v_def) = 0 then
    raise exception 'STORY-086 members: список людей отдаётся без права на контакты';
  end if;
  if position('public.access_client_ids()' in v_def) = 0
     or position('p_group_id = any(visible)' in v_def) = 0 then
    raise exception 'STORY-086 members: карточка-группа не сверяется с набором';
  end if;
  if position('public.client_seen_by_caller(' in v_def) = 0 then
    raise exception 'STORY-086 members: люди приходят мимо глаз вызывающего';
  end if;
  if position('c.deleted_at is null' in v_def) = 0 then
    raise exception 'STORY-086 members: в людях карточки архив и корзина';
  end if;

  -- Маска гасит связи.
  v_def := pg_get_functiondef('public.client_without_contacts(jsonb)'::regprocedure);
  if position('''memberships'', ''[]''::jsonb' in v_def) = 0 then
    raise exception 'STORY-086 members: маска сотрудника не гасит связи';
  end if;

  -- И урезанный маской массив нельзя записать обратно.
  -- Проверяется ИМЕННО список контактов, а не «где-нибудь в теле»: перенеси
  -- ключ в соседний массив — и сторож обязан упасть. Пробелы схлопнуты, чтобы
  -- перенос строки в теле не решал за правило.
  v_def := regexp_replace(
    pg_get_functiondef('public.update_client_with_tags(uuid, uuid, jsonb, uuid[])'::regprocedure),
    '\s+', ' ', 'g');
  if position(
       'access_company(''clients.contacts'', ''read'') and p_patch ?| array[''phone'', ''whatsapp_phone'', ''email'', ''telegram_username'', ''instagram_username'', ''phones'', ''phone_e164'', ''memberships''] then'
       in v_def) = 0 then
    raise exception 'STORY-086 members: скрытые связи снова можно затереть';
  end if;
end;
$audit$;

commit;
