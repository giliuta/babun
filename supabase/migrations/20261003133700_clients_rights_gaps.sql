-- ПРАВА КЛИЕНТОВ: ДЫРЫ ПОСЛЕ АУДИТА 03.10.
--
-- Каждая функция ниже переписана с живого определения (`pg_get_functiondef`
-- перед правкой); изменены только помеченные «03.10» места.
--
--   1. «Создание клиента» без «Без ограничения»: партнёр заводил клиента и тут
--      же его терял — набор `access_client_ids_in` не знал «завёл сам», и
--      каждая правка отвечала «client not found». Теперь свой клиент команды
--      из набора виден всегда (как в `member_client_in_team`).
--   2. Документы записи: файл, приложенный на записи, лежит в
--      `client_attachments` (с `appointment_id`) и в корзине
--      `client-attachments`, а пускало к нему только «Файлы» клиента. Теперь —
--      и «Файлы» записи (`record.files`): видит по «Видит», добавляет по
--      «Видит и меняет», теми же помощниками, что фото записи.
--   3. «Реквизиты» с «Видит и меняет»: приложение шлёт юрлицо основного набора
--      вместе с `requisites`, а сторож `legal_name` отказывал любому мастеру.
--   4. Чеки клиента партнёру — по «Истории» клиента (она же теперь и деньги,
--      пункт 8), а не по блоку «Клиент».
--   5. Приглашение «диспетчера» больше не заводится: политики до сих пор
--      считают его всевидящим. Нынешних людей не трогаем.
--   6. Маска карточки с закрытым «Клиентом» прячет и фото, и имя для SMS (если
--      закрыт и блок «SMS»); партнёр ставит только теги команды клиента.
--   7. Владелец 03.10: «Метка и тег» — два права. `clients.labels` — «Метка»
--      (city, city_manual), новый `clients.tags` — «Тег» (tag_ids и
--      `p_tag_ids`). Каждому, у кого стоит «Метка», «Тег» ставится тем же
--      положением — никто молча не теряет видимого.
--   8. Владелец 03.10: права «Долг и деньги» (`clients.money`) больше нет —
--      деньги клиента идут за «Историей»: видит историю — видит суммы. У
--      «Истории» три положения: «Скрыта» · «Своя команда» (read — записи
--      только его команд с «Историей») · «Все команды» (write — все записи
--      клиента в компании, как было до сих пор). Кто видел историю («read»),
--      получает «Все команды» — никто молча не теряет видимого.

set local lock_timeout = '5s';

-- ─── 1. Свой клиент команды — в наборе ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.access_client_ids_in(p_teams text[])
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid := public.current_tenant_id();
  today date;
begin
  if caller is null or active_tenant is null or coalesce(cardinality(p_teams), 0) = 0 then
    return array[]::uuid[];
  end if;

  today := public.tenant_business_date(active_tenant);

  -- 02.10: «только база клиентов, которая закреплена за командой, к которой
  -- у него есть доступ» — клиент с командой из открытых ему. «Ограничения»:
  -- «Без ограничения» — все клиенты команды; остальные ступени — клиент
  -- команды с неотменённой записью этой команды в окне до и после сегодня;
  -- неизвестное — самое узкое, «Неделя».
  return coalesce((
    with lv as (
      select t.team_id,
             coalesce(public.access_team_level(active_tenant, caller, 'clients.scope', t.team_id), 'week') as level
        from unnest(p_teams) as t(team_id)
    ),
    win as (
      select lv.team_id,
             case lv.level
               when 'near' then interval '14 days'
               when 'month' then interval '1 month'
               when 'quarter' then interval '3 months'
               when 'half' then interval '6 months'
               else interval '7 days'
             end as span
        from lv
       where lv.level not in ('own', 'all')
    )
    select array_agg(c.id order by c.id)
      from public.clients c
     where c.tenant_id = active_tenant
       and c.deleted_at is null
       and (
         c.team_id in (select lv.team_id from lv where lv.level in ('own', 'all'))
         or exists (
           select 1
             from win w
             join public.appointments a
               on a.tenant_id = active_tenant
              and a.client_id = c.id
              and a.team_id = w.team_id
            where w.team_id = c.team_id
              and a.status is distinct from 'cancelled'
              and a.date between (today - w.span)::date::text and (today + w.span)::date::text
         )
         -- 03.10: клиент, которого он сам завёл в этой команде, виден ему
         -- всегда — иначе «Создание клиента» рождает клиента, которого тут же
         -- «нет» («client not found» на первой же правке). Только команды из
         -- набора: чужой команде «завёл сам» базу не открывает.
         or (c.created_by = caller and c.team_id in (select lv.team_id from lv))
       )
  ), array[]::uuid[]);
end;
$function$;

-- ─── 2. Документы записи — по «Файлам» записи ───────────────────────────
--
-- Путь файла в корзине — `<компания>/<клиент>/<id строки>.<расширение>`
-- (card-attachments.ts). Строка с `appointment_id` пускает по «Файлам» этой
-- записи; к хранилищу — только строка канонического пути (id строки в имени),
-- а новую строку нельзя навести на уже лежащий объект: иначе «Файлы» записи
-- читали бы любой файл клиента, подставив его путь. Удаляют, как и фото
-- записи, владелец и «Файлы» клиента.

create or replace function public.current_user_can_add_record_attachment(
  p_id uuid,
  p_client_id uuid,
  p_appointment_id uuid,
  p_storage_path text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce((
    select p_id is not null
       and p_client_id is not null
       and p_storage_path ~ ('^' || a.tenant_id::text || '/' || p_client_id::text || '/' || p_id::text || '\.[^/]+$')
       and public.current_user_can_mutate_appointment_photo(a.id)
       and not exists (
         select 1
           from storage.objects o
          where o.bucket_id = 'client-attachments'
            and o.name = p_storage_path
       )
      from public.appointments a
     where a.id = p_appointment_id
       and a.tenant_id = public.current_tenant_id()
       and a.kind = 'work'
       and a.client_id = p_client_id
  ), false)
$function$;

revoke all on function public.current_user_can_add_record_attachment(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.current_user_can_add_record_attachment(uuid, uuid, uuid, text) to authenticated;

create or replace function public.current_user_can_reach_record_attachment_object(
  p_name text,
  p_write boolean
)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce((
    select bool_or(
             case
               when p_write is true then
                 exists (
                   select 1
                     from public.appointments a
                    where a.id = ca.appointment_id
                      and a.tenant_id = ca.tenant_id
                      and a.kind = 'work'
                      and a.client_id = ca.client_id
                 )
                 and public.current_user_can_mutate_appointment_photo(ca.appointment_id)
               else
                 public.current_user_can_access_appointment(ca.appointment_id)
                 and public.current_user_can_see_appointment_files(ca.appointment_id)
             end
           )
      from public.client_attachments ca
     where ca.tenant_id = public.current_tenant_id()
       and ca.client_id = public.try_uuid((storage.foldername(p_name))[2])
       and ca.storage_path = p_name
       and ca.appointment_id is not null
       and p_name ~ ('^' || ca.tenant_id::text || '/' || ca.client_id::text || '/' || ca.id::text || '\.[^/]+$')
  ), false)
$function$;

revoke all on function public.current_user_can_reach_record_attachment_object(text, boolean) from public, anon;
grant execute on function public.current_user_can_reach_record_attachment_object(text, boolean) to authenticated;

drop policy if exists client_attachments_select_record on public.client_attachments;
create policy client_attachments_select_record
  on public.client_attachments
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and appointment_id is not null
    and public.current_user_can_access_appointment(appointment_id)
    and public.current_user_can_see_appointment_files(appointment_id)
  );

drop policy if exists client_attachments_insert_record on public.client_attachments;
create policy client_attachments_insert_record
  on public.client_attachments
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (created_by is null or created_by = auth.uid())
    and public.current_user_can_add_record_attachment(id, client_id, appointment_id, storage_path)
  );

drop policy if exists storage_client_attachments_select_record on storage.objects;
create policy storage_client_attachments_select_record
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'client-attachments'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and public.current_user_can_reach_record_attachment_object(name, false)
  );

drop policy if exists storage_client_attachments_insert_record on storage.objects;
create policy storage_client_attachments_insert_record
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'client-attachments'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and public.current_user_can_reach_record_attachment_object(name, true)
  );

update public.access_blocks
   set enforced_by = coalesce(enforced_by, array[]::text[]) || array[
         'function:public.current_user_can_add_record_attachment(uuid, uuid, uuid, text)',
         'function:public.current_user_can_reach_record_attachment_object(text, boolean)',
         'policy:public.client_attachments.client_attachments_select_record',
         'policy:public.client_attachments.client_attachments_insert_record',
         'policy:storage.objects.storage_client_attachments_select_record',
         'policy:storage.objects.storage_client_attachments_insert_record'
       ]
 where key = 'record.files'
   and not ('policy:public.client_attachments.client_attachments_select_record' = any(coalesce(enforced_by, array[]::text[])));

-- ─── 3. «Реквизиты» с «Видит и меняет» правят юрлицо ────────────────────

CREATE OR REPLACE FUNCTION public.clients_member_legal_name_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() is distinct from 'master' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.legal_name := null;
  elsif new.legal_name is distinct from old.legal_name
        -- 03.10: «Реквизиты» с «Видит и меняет» правят и юрлицо основного
        -- набора — приложение шлёт его вместе с `requisites`.
        and (old.id = any(public.access_block_client_ids('clients.requisites', 'write'))) is not true then
    raise exception 'access:field:legal_name' using errcode = '42501';
  end if;
  return new;
end;
$function$;

update public.access_blocks
   set enforced_by = coalesce(enforced_by, array[]::text[]) || array['function:public.clients_member_legal_name_guard()']
 where key = 'clients.requisites'
   and not ('function:public.clients_member_legal_name_guard()' = any(coalesce(enforced_by, array[]::text[])));

-- ─── 4. Чеки клиента — по «Истории» (она же деньги) ─────────────────────

alter policy receipts_read_own_money
  on public.receipts
  using (
    tenant_id = (select public.current_tenant_id())
    and transaction_id in (
      select ft.id
        from public.finance_transactions ft
       where ft.tenant_id = (select public.current_tenant_id())
    )
    and (
      client_id is null
      or client_id in (select unnest(public.access_block_client_ids('clients.history', 'read')))
    )
  );

-- ─── 5. Приглашают только партнёра ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_invitation(p_email text, p_role text, p_master_id text DEFAULT NULL::text, p_team_id text DEFAULT NULL::text, p_full_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_team_ids text[] DEFAULT NULL::text[], p_master_title text DEFAULT NULL::text, p_master_color text DEFAULT NULL::text, p_access jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- 03.10: приглашают только партнёра (`master`). «Диспетчер» — наследие:
  -- политики до сих пор считают его всевидящим, а приложение зовёт только
  -- мастера. Прежняя проверка выше остаётся ради её текста отказа.
  if p_role is distinct from 'master' then
    raise exception 'invitation role must be master'
      using errcode = '22023', hint = 'invite:role_master';
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

-- ─── 6. Маска «Клиента» и теги чужой команды ────────────────────────────

CREATE OR REPLACE FUNCTION public.client_masked_for_member(p_client jsonb, p_blocks jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  with b as (
    select coalesce(p_blocks, '{}'::jsonb) as v
  )
  -- 03.10: блок «Клиент» с «Видит» — номер и мессенджеры целиком; «Скрыт» —
  -- без контактов (точек и двери больше нет).
  select case
           when coalesce(b.v ->> 'clients.client', 'off') = 'off'
             then public.client_without_contacts(p_client)
                  -- 03.10: фото — тоже блок «Клиент»; имя для SMS остаётся,
                  -- только когда открыт блок «SMS» (он его показывает и правит).
                  || jsonb_build_object('avatar_url', null)
                  || case when coalesce(b.v ->> 'clients.sms', 'off') = 'off'
                       then jsonb_build_object('sms_name', '') else '{}'::jsonb end
           else p_client
         end
    || case when coalesce(b.v ->> 'clients.note', 'off') = 'off'
         then jsonb_build_object('comment', '', 'notes', '[]'::jsonb) else '{}'::jsonb end
    -- Связи — блок «Люди»: закрыт — связей нет, открыт — связи строки.
    || case when coalesce(b.v ->> 'clients.people', 'off') = 'off'
         then jsonb_build_object('memberships', '[]'::jsonb)
         else jsonb_build_object('memberships', coalesce(p_client -> 'memberships', '[]'::jsonb)) end
    || case when coalesce(b.v ->> 'clients.objects', 'off') = 'off'
         then jsonb_build_object('locations', '[]'::jsonb, 'equipment', '[]'::jsonb,
                                 'address', '', 'property_type', '')
         else '{}'::jsonb end
    || case when coalesce(b.v ->> 'clients.labels', 'off') = 'off'
         then jsonb_build_object('city', '', 'city_manual', false)
         else '{}'::jsonb end
    -- 03.10: тег — своё право «Тег» (`clients.tags`), метка — «Метка».
    || case when coalesce(b.v ->> 'clients.tags', 'off') = 'off'
         then jsonb_build_object('tag_ids', '[]'::jsonb)
         else '{}'::jsonb end
    || case when coalesce(b.v ->> 'clients.personal', 'off') = 'off'
         then jsonb_build_object('birthday', '', 'language', null, 'acquisition_source', 'unknown',
                                 'referred_by_client_id', null, 'first_contact_date', null)
         else '{}'::jsonb end
    || case when coalesce(b.v ->> 'clients.requisites', 'off') = 'off'
         then jsonb_build_object('legal_name', null, 'vat_number', null, 'reg_number', null,
                                 'billing_address', null, 'requisites', '[]'::jsonb)
         else '{}'::jsonb end
    -- 03.10: «Долг и деньги» ушли в «Историю»: видит историю — видит деньги.
    || case when coalesce(b.v ->> 'clients.history', 'off') = 'off'
         then jsonb_build_object('balance', 0, 'discount', 0)
         else '{}'::jsonb end
    || jsonb_build_object('blocks', b.v)
  from b
$function$;

CREATE OR REPLACE FUNCTION public.update_client_with_tags(p_tenant_id uuid, p_client_id uuid, p_patch jsonb, p_tag_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant_id uuid := public.current_tenant_id();
  active_role text := public.current_user_role();
  current_row public.clients%rowtype;
  next_row public.clients%rowtype;
  saved_row public.clients%rowtype;
  result_tag_ids uuid[];
  card_blocks jsonb;
  denied_block text;
begin
  -- 02.10: сотрудник с «Только видит» у базы правит блоки карточки, где у
  -- него «Меняет», поэтому вход — по «Видит», а поля — ниже, по блокам.
  if auth.uid() is null
     or active_tenant_id is null
     or active_role is null
     or not (active_role = 'owner' or public.access_company('clients', 'read')) then
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
       'memberships',
       'requisites'
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
  -- Сотрудник правит только клиента, которого видит (02.10: по «Видит», а не
  -- по «Меняет» базы — «Меняет» у неё больше нет).
  if active_role <> 'owner'
     and (p_client_id = any(public.access_client_ids_in(public.access_calendars('clients', 'read')))) is not true then
    raise exception 'client not found'
      using errcode = 'P0002';
  end if;

  next_row := jsonb_populate_record(current_row, p_patch);

  if active_role <> 'owner' then
    -- Корзина и деньги клиента — дело владельца. Реквизиты с 30.09 — свой
    -- блок карточки (ниже). Удаляет партнёр с «Удаление клиента: Может» своей
    -- дверью (`member_trash_client`); чёрный список с 03.10 — «Меню клиента»
    -- (ниже).
    if p_patch ?| array['deleted_at', 'balance', 'discount',
                        'favorite_master_id'] then
      raise exception 'only the owner archives a client, changes its money or company-wide marks'
        using errcode = '42501', hint = 'block:clients';
    end if;
    -- БЛОКИ КАРТОЧКИ (30.09): каждое поле — под своим блоком; «Меняет» блока —
    -- по командам, через которые клиент виден (`access_client_blocks`). Связи
    -- с 30.09 — блок «Люди»: он же их и показывает, маска контактов тут ни при
    -- чём.
    card_blocks := coalesce((
      select b.blocks
        from public.access_client_blocks() b
       where b.client_id = p_client_id
    ), '{}'::jsonb);
    -- БЛОК «КЛИЕНТ» (02.10): имя, номера и мессенджеры, фото — по его
    -- «Меняет». Напоминание и чёрный список — «Меню клиента» (ниже). Судим по значению, а не по ключу: карточка, которая
    -- пронесла то же имя рядом с заметкой, ничего в блоке не меняет. Имя для
    -- SMS — блок «SMS» (ниже).
    if coalesce(card_blocks ->> 'clients.client', 'off') <> 'write'
       and exists (
         select 1
           from unnest(array['full_name', 'phone', 'whatsapp_phone', 'email',
                             'telegram_username', 'instagram_username', 'phones',
                             'phone_e164', 'avatar_url']) as f(field)
          where (to_jsonb(next_row) -> f.field) is distinct from (to_jsonb(current_row) -> f.field)
       ) then
      raise exception 'this block of the client card is closed for this employee'
        using errcode = '42501', hint = 'block:clients.client';
    end if;
    -- 03.10: номера больше не приходят пустыми — блок «Клиент» с «Видит»
    -- отдаёт их целиком (владелец: «видит клиента — видит номер и звонит»).
    -- Проверка «сначала открой номер дверью» снята: менять номер может тот,
    -- у кого блок «Клиент» с «Меняет», а он номер уже видит.
    select g.block_key into denied_block
      from (values
        ('clients.note', array['comment', 'notes']),
        ('clients.people', array['memberships']),
        ('clients.objects', array['locations', 'equipment', 'address', 'property_type']),
        ('clients.labels', array['city', 'city_manual']),
        ('clients.personal', array['birthday', 'language', 'acquisition_source',
                                   'referred_by_client_id', 'first_contact_date']),
        ('clients.requisites', array['legal_name', 'vat_number', 'reg_number',
                                     'billing_address', 'requisites']),
        ('clients.sms', array['sms_name']),
        ('clients.menu', array['reminder_at', 'pinned_at', 'blacklisted'])
      ) as g(block_key, fields)
     where p_patch ?| g.fields
       and coalesce(card_blocks ->> g.block_key, 'off') <> 'write'
     limit 1;
    -- 03.10: теги — своё право «Тег» (`clients.tags`); «Метка» — город.
    if denied_block is null
       and p_tag_ids is not null
       and coalesce(card_blocks ->> 'clients.tags', 'off') <> 'write' then
      denied_block := 'clients.tags';
    end if;
    if denied_block is not null then
      raise exception 'this block of the client card is closed for this employee'
        using errcode = '42501', hint = 'block:' || denied_block;
    end if;
  end if;

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
    -- 03.10: сотрудник ставит только теги команды клиента. Тег другой
    -- команды, который уже стоит на клиенте (ставил владелец), остаётся.
    if active_role <> 'owner' and exists (
      select 1
        from unnest(result_tag_ids) supplied(tag_id)
        join public.client_tags tag
          on tag.tenant_id = active_tenant_id
         and tag.id = supplied.tag_id
       where tag.team_id is not null
         and tag.team_id is distinct from current_row.team_id
         and not exists (
           select 1
             from public.client_tag_assignments assignment
            where assignment.tenant_id = active_tenant_id
              and assignment.client_id = p_client_id
              and assignment.tag_id = supplied.tag_id
         )
    ) then
      raise exception 'client tag belongs to another team'
        using errcode = '23503', hint = 'client:tag_other_team';
    end if;
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
         memberships = coalesce(next_row.memberships, '[]'::jsonb),
         requisites = coalesce(next_row.requisites, '[]'::jsonb)
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

  -- Теги — внутрь маски: закрытые «Метка и тег» сотруднику не вернутся.
  return public.client_seen_by_caller(
    to_jsonb(saved_row) || jsonb_build_object('tag_ids', to_jsonb(result_tag_ids))
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_client_with_tags(p_tenant_id uuid, p_client_id uuid, p_client jsonb, p_tag_ids uuid[] DEFAULT ARRAY[]::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant_id uuid := public.current_tenant_id();
  active_role text := public.current_user_role();
  input_row public.clients%rowtype;
  saved_row public.clients%rowtype;
  normalized_tag_ids uuid[];
  effective_client_id uuid := coalesce(p_client_id, gen_random_uuid());
  labels_open boolean := true;
begin
  if auth.uid() is null
     or active_tenant_id is null
     or active_role is null
     or not (active_role = 'owner'
             or cardinality(public.access_calendars('clients.create', 'write')) > 0) then
    -- 02.10: заводит клиентов право «Создание клиента», а не «База».
    raise exception 'only an owner or an employee who can create clients can create a client'
      using errcode = '42501', hint = 'block:clients.create';
  end if;

  if p_tenant_id is null
     or p_tenant_id is distinct from active_tenant_id then
    raise exception 'client tenant does not match the active tenant'
      using errcode = '42501';
  end if;

  if p_client is null or jsonb_typeof(p_client) <> 'object' then
    raise exception 'client payload must be an object'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_object_keys(p_client) key
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
       'created_at',
       'legal_name',
       'vat_number',
       'reg_number',
       'billing_address',
       'memberships',
       'requisites',
       'team_id'
     )
  ) then
    raise exception 'client payload contains a protected or unknown field'
      using errcode = '22023';
  end if;

  input_row := jsonb_populate_record(null::public.clients, p_client);

  -- Деньги клиента, корзина и общие пометки — дело владельца.
  if active_role <> 'owner' then
    input_row.balance := 0;
    input_row.discount := 0;
    input_row.deleted_at := null;
    input_row.blacklisted := false;
    input_row.pinned_at := null;
    input_row.favorite_master_id := null;
  end if;

  if nullif(btrim(input_row.full_name), '') is null then
    raise exception 'client name is required'
      using errcode = '23514';
  end if;

  if jsonb_typeof(coalesce(input_row.phones, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(input_row.locations, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(input_row.notes, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(input_row.equipment, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(input_row.memberships, '[]'::jsonb)) <> 'array' then
    raise exception 'client nested collections must be arrays'
      using errcode = '22023';
  end if;

  if input_row.referred_by_client_id = effective_client_id then
    raise exception 'client cannot refer itself'
      using errcode = '23514';
  end if;

  if input_row.referred_by_client_id is not null
     and not exists (
       select 1
         from public.clients referrer
        where referrer.tenant_id = active_tenant_id
          and referrer.id = input_row.referred_by_client_id
     ) then
    raise exception 'referring client does not belong to the active tenant'
      using errcode = '23503';
  end if;

  if input_row.favorite_master_id is not null
     and not exists (
       select 1
         from public.masters master
        where master.tenant_id = active_tenant_id
          and master.id = input_row.favorite_master_id
     ) then
    raise exception 'favorite master does not belong to the active tenant'
      using errcode = '23503';
  end if;

  -- КОМАНДА КЛИЕНТА (30.09). Чужая компании команда — ошибка; команда, где
  -- сотруднику нельзя заводить клиентов («Создание клиента», 02.10), —
  -- заменяется его первой; пусто — первая живая команда, доступная создающему.
  if input_row.team_id is not null
     and not exists (
       select 1
         from public.teams team
        where team.tenant_id = active_tenant_id
          and team.id = input_row.team_id
     ) then
    raise exception 'client team does not belong to the active tenant'
      using errcode = '23503';
  end if;
  if active_role <> 'owner'
     and input_row.team_id is not null
     and (input_row.team_id = any(public.access_calendars('clients.create', 'write'))) is not true then
    input_row.team_id := null;
  end if;
  if input_row.team_id is null then
    input_row.team_id := (
      select team.id
        from public.teams team
       where team.tenant_id = active_tenant_id
         and team.is_active
         and (active_role = 'owner'
              or team.id = any(public.access_calendars('clients.create', 'write')))
       order by team.position, team.created_at
       limit 1
    );
  end if;

  -- БЛОКИ КАРТОЧКИ (30.09): сотрудник заводит только то, что в команде
  -- клиента может менять; поля остальных блоков ложатся пустыми, без отказа —
  -- экран этих блоков ему не показывает.
  if active_role <> 'owner' then
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.note', input_row.team_id) is distinct from 'write' then
      input_row.comment := '';
      input_row.notes := '[]'::jsonb;
    end if;
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.people', input_row.team_id) is distinct from 'write' then
      input_row.memberships := '[]'::jsonb;
    end if;
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.objects', input_row.team_id) is distinct from 'write' then
      input_row.locations := '[]'::jsonb;
      input_row.equipment := '[]'::jsonb;
      input_row.address := '';
      input_row.property_type := '';
    end if;
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.labels', input_row.team_id) is distinct from 'write' then
      input_row.city := '';
      input_row.city_manual := false;
    end if;
    -- 03.10: теги — своё право «Тег» (`clients.tags`), отдельно от «Метки».
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.tags', input_row.team_id) is distinct from 'write' then
      labels_open := false;
    end if;
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.personal', input_row.team_id) is distinct from 'write' then
      input_row.birthday := '';
      input_row.language := null;
      input_row.acquisition_source := 'unknown';
      input_row.referred_by_client_id := null;
      input_row.first_contact_date := null;
    end if;
    if public.access_team_level(active_tenant_id, auth.uid(), 'clients.requisites', input_row.team_id) is distinct from 'write' then
      input_row.legal_name := null;
      input_row.vat_number := null;
      input_row.reg_number := null;
      input_row.billing_address := null;
      input_row.requisites := '[]'::jsonb;
    end if;
  end if;

  normalized_tag_ids := public.normalize_client_tag_ids(
    active_tenant_id,
    case when labels_open then p_tag_ids else array[]::uuid[] end
  );

  -- 03.10: сотрудник ставит новому клиенту только теги его команды.
  if active_role <> 'owner' and exists (
    select 1
      from unnest(normalized_tag_ids) supplied(tag_id)
      join public.client_tags tag
        on tag.tenant_id = active_tenant_id
       and tag.id = supplied.tag_id
     where tag.team_id is not null
       and tag.team_id is distinct from input_row.team_id
  ) then
    raise exception 'client tag belongs to another team'
      using errcode = '23503', hint = 'client:tag_other_team';
  end if;

  insert into public.clients (
    id,
    tenant_id,
    full_name,
    phone,
    whatsapp_phone,
    email,
    sms_name,
    telegram_username,
    instagram_username,
    balance,
    discount,
    comment,
    acquisition_source,
    referred_by_client_id,
    first_contact_date,
    address,
    city,
    city_manual,
    property_type,
    language,
    birthday,
    blacklisted,
    pinned_at,
    reminder_at,
    phones,
    locations,
    notes,
    equipment,
    phone_e164,
    avatar_url,
    deleted_at,
    favorite_master_id,
    created_at,
    legal_name,
    vat_number,
    reg_number,
    billing_address,
    memberships,
    requisites,
    team_id
  ) values (
    effective_client_id,
    active_tenant_id,
    input_row.full_name,
    coalesce(input_row.phone, ''),
    coalesce(input_row.whatsapp_phone, ''),
    coalesce(input_row.email, ''),
    coalesce(input_row.sms_name, ''),
    coalesce(input_row.telegram_username, ''),
    coalesce(input_row.instagram_username, ''),
    coalesce(input_row.balance, 0),
    coalesce(input_row.discount, 0),
    coalesce(input_row.comment, ''),
    coalesce(input_row.acquisition_source, 'unknown'),
    input_row.referred_by_client_id,
    input_row.first_contact_date,
    coalesce(input_row.address, ''),
    coalesce(input_row.city, ''),
    coalesce(input_row.city_manual, false),
    coalesce(input_row.property_type, ''),
    input_row.language,
    coalesce(input_row.birthday, ''),
    coalesce(input_row.blacklisted, false),
    input_row.pinned_at,
    input_row.reminder_at,
    coalesce(input_row.phones, '[]'::jsonb),
    coalesce(input_row.locations, '[]'::jsonb),
    coalesce(input_row.notes, '[]'::jsonb),
    coalesce(input_row.equipment, '[]'::jsonb),
    input_row.phone_e164,
    input_row.avatar_url,
    input_row.deleted_at,
    input_row.favorite_master_id,
    coalesce(input_row.created_at, now()),
    nullif(btrim(input_row.legal_name), ''),
    nullif(btrim(input_row.vat_number), ''),
    nullif(btrim(input_row.reg_number), ''),
    nullif(btrim(input_row.billing_address), ''),
    coalesce(input_row.memberships, '[]'::jsonb),
    coalesce(input_row.requisites, '[]'::jsonb),
    input_row.team_id
  )
  returning * into saved_row;

  insert into public.client_tag_assignments (
    tenant_id,
    client_id,
    tag_id
  )
  select active_tenant_id, saved_row.id, supplied.tag_id
    from unnest(normalized_tag_ids) supplied(tag_id);

  -- Теги — внутрь маски: закрытые «Метка и тег» сотруднику не вернутся.
  return public.client_seen_by_caller(
    to_jsonb(saved_row) || jsonb_build_object('tag_ids', to_jsonb(normalized_tag_ids))
  );
end;
$function$;

-- ─── 7. «Метка» и «Тег» — два права ─────────────────────────────────────
--
-- Позиция 235 занята неживым «Фильтры клиентов» (`clients.filters`), свободной
-- между «Меткой» (234) и «Личным» (236) нет — «Тег» встаёт рядом, на 235.

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
select 'clients.tags', 'clients', 'calendar', array['off', 'read', 'write'], 'Тег', false, true,
       labels.enforced_by, 235
  from public.access_blocks labels
 where labels.key = 'clients.labels'
on conflict (key) do nothing;

update public.access_blocks
   set title_ru = 'Метка'
 where key = 'clients.labels';

insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
select ma.tenant_id, ma.user_id, 'clients.tags', ma.team_id, ma.level, ma.set_by, ma.set_at
  from public.member_access ma
 where ma.block = 'clients.labels'
on conflict (tenant_id, user_id, block, team_id) do nothing;

CREATE OR REPLACE FUNCTION public.access_client_blocks()
 RETURNS TABLE(client_id uuid, blocks jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller uuid := auth.uid();
  active_tenant uuid := public.current_tenant_id();
  -- 02.10: «Клиент», «История» и «SMS» — свои права, как остальные блоки;
  -- «Меню клиента» (напомнить, чёрный список) и «Удаление клиента» (03.10) —
  -- тоже по клиенту.
  block_keys constant text[] := array[
    'clients.client', 'clients.note', 'clients.people', 'clients.history',
    'clients.objects', 'clients.files', 'clients.requisites', 'clients.labels',
    'clients.personal', 'clients.sms', 'clients.menu',
    'clients.delete',
    -- 03.10: «Тег» — своё право, отдельно от «Метки»; «Долг и деньги» ушли
    -- в «Историю» — ключа `clients.money` больше нет.
    'clients.tags'
  ];
begin
  if caller is null or active_tenant is null
     or public.current_user_role() is not distinct from 'owner' then
    return;
  end if;

  return query
    with teams as (
      select t.team_id,
             public.access_team_level(active_tenant, caller, 'clients', t.team_id) as card_level,
             public.access_client_ids_in(array[t.team_id]) as ids
        from unnest(public.access_calendars('clients', 'read')) as t(team_id)
    ),
    levels as (
      -- База — своим ключом: с 02.10 только «Видит» (создание и меню — свои права).
      select tm.team_id, 'clients'::text as block_key,
             case when tm.card_level = 'write' then 2 else 1 end as rank
        from teams tm
      union all
      -- Блок «Меняет» — своим правом (02.10), без «Меняет» у базы. Страницу
      -- клиента открывает каждый, кому клиент виден (02.10: «Открывает
      -- карточку» убрано) — блоки страницы больше не гаснут.
      select tm.team_id, k.block_key,
             case
               when l.level = 'write' then 2
               when l.level in ('read', 'write') then 1
               else 0
             end
        from teams tm
       cross join unnest(block_keys) as k(block_key)
       cross join lateral (
         select public.access_team_level(active_tenant, caller, k.block_key, tm.team_id) as level
       ) l
    ),
    per_client as (
      select cid as client_id, lv.block_key, max(lv.rank) as rank
        from teams tm
        join levels lv on lv.team_id = tm.team_id
       cross join unnest(tm.ids) as cid
       group by cid, lv.block_key
    )
    select pc.client_id,
           jsonb_object_agg(
             pc.block_key,
             case pc.rank when 2 then 'write' when 1 then 'read' else 'off' end
           )
      from per_client pc
     group by pc.client_id;
end;
$function$;

-- ─── 8. «Долг и деньги» — в «Историю»; у «Истории» три положения ─────────
--
-- `member_access.block` ссылается на реестр без каскада удаления: сначала
-- уходят уровни, потом строка реестра. Приложение ключ `clients.money` уже
-- не шлёт; открытых приглашений с ним нет.

delete from public.member_access where block = 'clients.money';
delete from public.access_blocks where key = 'clients.money';

update public.access_blocks
   set levels = array['off', 'read', 'write'],
       enforced_by = coalesce(enforced_by, array[]::text[])
         || array(
              select x
                from unnest(array[
                  'function:public.client_masked_for_member(jsonb, jsonb)',
                  'policy:public.receipts.receipts_read_own_money'
                ]) as x
               where not (x = any(coalesce(enforced_by, array[]::text[])))
            )
 where key = 'clients.history';

-- До сих пор «Видит» историю значило «все записи клиента» — это теперь «Все
-- команды». Сторож `member_access_validate` пускает «write» только после
-- новых положений выше.
update public.member_access
   set level = 'write'
 where block = 'clients.history'
   and level = 'read';

CREATE OR REPLACE FUNCTION public.member_client_history(p_client uuid DEFAULT NULL::uuid)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  active_tenant uuid := public.current_tenant_id();
begin
  if auth.uid() is null or active_tenant is null
     or public.current_user_role() is distinct from 'master' then
    return;
  end if;

  return query
    with open_history as (
      select cb.client_id,
             -- 03.10: «Долг и деньги» ушли в «Историю»: видит историю — видит суммы.
             cb.blocks ->> 'clients.history' in ('read', 'write') as see_money,
             cb.blocks ->> 'clients.objects' in ('read', 'write') as see_object,
             -- 03.10: «История» — «Все команды» (write): записи всех команд
             -- компании; «Своя команда» (read): только записи его команд, где
             -- у него есть «История».
             cb.blocks ->> 'clients.history' = 'write' as all_teams
        from public.access_client_blocks() cb
       where cb.blocks ->> 'clients.history' in ('read', 'write')
         and (p_client is null or cb.client_id = p_client)
    ),
    history_teams as (
      select public.access_calendars('clients.history', 'read') as ids
    )
    select jsonb_build_object(
      'id', a.id,
      'tenant_id', a.tenant_id,
      'client_id', a.client_id,
      'team_id', a.team_id,
      'master_id', a.master_id,
      'location_id', case when h.see_object then a.location_id end,
      'date', a.date,
      'time_start', a.time_start,
      'time_end', a.time_end,
      'kind', a.kind,
      'status', a.status,
      'comment', '',
      'address', '',
      'address_note', '',
      'address_lat', null,
      'address_lng', null,
      'cancel_reason', null,
      'source', a.source,
      'is_online_booking', a.is_online_booking,
      'consent_given', a.consent_given,
      'color_override', null,
      'city', null,
      'reminder_enabled', false,
      'reminder_offsets', '[]'::jsonb,
      'reminder_template', null,
      'service_ids', coalesce(a.service_ids, '[]'::jsonb),
      'total_duration', a.total_duration,
      'created_by', a.created_by,
      'created_at', a.created_at,
      'updated_at', a.updated_at,
      'event_all_day', false,
      'event_notes', '',
      'event_url', '',
      'event_push_enabled', false,
      'event_push_offsets', '[]'::jsonb,
      'event_push_at', null,
      'event_repeat', null,
      'total_amount', case when h.see_money then coalesce(a.total_amount, 0) else 0 end,
      'custom_total', case when h.see_money then coalesce(a.custom_total, false) else false end,
      'discount_amount', case when h.see_money then coalesce(a.discount_amount, 0) else 0 end,
      'prepaid_amount', 0,
      'paid_amount', case when h.see_money then coalesce(a.paid_amount, 0) else 0 end,
      'payment_status', case when h.see_money then coalesce(a.payment_status, 'unpaid') else 'unpaid' end,
      'payment_method', null,
      'payments', '[]'::jsonb,
      'payment', null,
      'expenses', '[]'::jsonb,
      'services', case
        when jsonb_typeof(a.services) is distinct from 'array' then '[]'::jsonb
        else (
          select coalesce(jsonb_agg(
                   jsonb_strip_nulls(jsonb_build_object(
                     'serviceId', line -> 'serviceId',
                     'serviceName', line -> 'serviceName',
                     'quantity', line -> 'quantity',
                     'unit', line -> 'unit',
                     'duration', line -> 'duration',
                     'variantId', line -> 'variantId'
                   )) || case
                     when h.see_money then jsonb_strip_nulls(jsonb_build_object(
                       'pricePerUnit', line -> 'pricePerUnit',
                       'originalPrice', line -> 'originalPrice',
                       'totalPrice', line -> 'totalPrice'
                     ))
                     else '{"pricePerUnit": 0, "originalPrice": 0, "totalPrice": 0}'::jsonb
                   end
                   order by ord), '[]'::jsonb)
            from jsonb_array_elements(a.services) with ordinality as l(line, ord)
        )
      end,
      'service_price_overrides', '{}'::jsonb,
      'global_discount', null
    )
      from public.appointments a
      join open_history h on h.client_id = a.client_id
     cross join history_teams ht
     where a.tenant_id = active_tenant
       and a.kind = 'work'
       and (h.all_teams or a.team_id = any(ht.ids))
     order by a.date, a.time_start, a.id;
end;
$function$;
