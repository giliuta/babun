-- МАСТЕР, ПРИНЯВШИЙ ПРИГЛАШЕНИЕ, ПОЛУЧАЕТ СВОЮ КАРТОЧКУ.
--
-- Владелец 15.09: «у нас есть Команда 1, я хочу туда добавить мастера:
-- добавляю — и в аккаунте мастера появляется полностью Команда 1… всё, что
-- нужно, чтобы присоединять сотрудников к моей команде».
--
-- Мастер без карточки (`20260914220000`) видел календарь, но работать в нём не
-- мог: назначить в запись можно только карточку (выбор мастера в записи берёт
-- `masters`), а статус, заметку и фото сервер пускает по карточке
-- (`update_master_appointment_safe`, `current_user_can_mutate_appointment_photo`:
-- `master_id` человека или календарь его карточки).
--
-- Теперь приём приглашения мастером в календарь заводит ему карточку в этой
-- компании — тем же помощником, что у обоих входов приглашения
-- (`grant_invitation_calendar`: приём вошедшим и регистрация по ссылке):
--   • имя и телефон — из аккаунта, календарь — из приглашения, `user_id` — чья
--     это карточка, `created_by` — кто позвал;
--   • карточка привязывается к членству (`tenant_members.master_id`);
--   • того же человека, позванного снова, ждёт ЕГО прежняя карточка (поиск по
--     `user_id`) с календарём нового приглашения: вторая не заводится, а старый
--     календарь по карточке не остаётся открытым (решение 14.09 — только явно
--     выданные календари);
--   • ушёл из компании (сняли или покинул сам) — карточка уходит в архив:
--     назначить работу ушедшему нельзя, визиты и статистика остаются.
-- Карточки без аккаунта это не заводит (решение 14.09); приглашение по уже
-- существующей карточке (`p_master_id`) и приглашение диспетчера не меняются.

alter table public.masters
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create unique index if not exists masters_tenant_user_key
  on public.masters (tenant_id, user_id)
  where user_id is not null;

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

  select coalesce(
           nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
           nullif(split_part(coalesce(u.email, ''), '@', 1), '')
         ),
         nullif(btrim(u.raw_user_meta_data ->> 'phone'), '')
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

    insert into public.masters (
      id, tenant_id, full_name, phone, team_id, account_status, user_id, created_by
    ) values (
      v_master_id,
      p_invitation.tenant_id,
      coalesce(v_name, 'Мастер'),
      v_phone,
      p_invitation.team_id,
      'active',
      p_user_id,
      p_invitation.invited_by_user_id
    );
  else
    update public.masters m
       set team_id = p_invitation.team_id,
           is_active = true,
           account_status = 'active'
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

create or replace function public.grant_invitation_calendar(p_invitation public.invitations, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_master_id text := p_invitation.master_id;
begin
  if p_invitation.team_id is null or p_user_id is null then
    return;
  end if;

  -- create_invitation refuses archived calendars, but the calendar can be
  -- archived between the invitation and its acceptance.
  if not exists (
    select 1 from public.teams t
     where t.tenant_id = p_invitation.tenant_id
       and t.id = p_invitation.team_id
       and t.is_active
  ) then
    return;
  end if;

  -- Мастер без карточки получает свою карточку в этом календаре (15.09): без
  -- неё его не назначить в запись, а статус и фото сервер пускает по карточке.
  if p_invitation.role = 'master' and p_invitation.master_id is null then
    v_master_id := public.attach_invited_master_card(p_invitation, p_user_id);
  end if;

  insert into public.calendar_members (tenant_id, team_id, user_id, master_id, grants)
  values (
    p_invitation.tenant_id,
    p_invitation.team_id,
    p_user_id,
    v_master_id,
    case p_invitation.role
      when 'dispatcher' then array['view','book','edit_all','clients','phones']::text[]
      else array['view']::text[]
    end
  )
  on conflict (tenant_id, team_id, user_id) do nothing;

  -- Прикрепление к календарю для прав по блокам (этап 1): без него владелец не
  -- видит приглашённого в людях календаря. Уровни не пишутся — новый сотрудник
  -- «всё выключено».
  insert into public.member_calendars (tenant_id, user_id, team_id, attached_by)
  values (p_invitation.tenant_id, p_user_id, p_invitation.team_id, p_invitation.invited_by_user_id)
  on conflict (tenant_id, user_id, team_id) do nothing;
end;
$function$;

revoke all on function public.grant_invitation_calendar(public.invitations, uuid) from public, anon, authenticated;

create or replace function public.tenant_members_removed_archive_card()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Ушёл из компании — его карточку в архив: работу ушедшему не назначить.
  -- По `master_id` — тоже: при удалении аккаунта `user_id` карточки
  -- обнуляется раньше, чем сработает этот триггер.
  update public.masters m
     set is_active = false,
         account_status = 'terminated'
   where m.tenant_id = old.tenant_id
     and m.is_active
     and (m.user_id = old.user_id or m.id = old.master_id);
  return null;
end;
$function$;

revoke all on function public.tenant_members_removed_archive_card() from public, anon, authenticated;

drop trigger if exists tenant_members_removed_archive_card on public.tenant_members;
create trigger tenant_members_removed_archive_card
  after delete on public.tenant_members
  for each row execute function public.tenant_members_removed_archive_card();

do $guard$
declare
  v_helper text := pg_get_functiondef('public.grant_invitation_calendar(public.invitations, uuid)'::regprocedure);
begin
  if position('public.attach_invited_master_card(p_invitation, p_user_id)' in v_helper) = 0 then
    raise exception 'миграция: помощник приглашения не заводит карточку мастеру';
  end if;
  if has_function_privilege('authenticated', 'public.attach_invited_master_card(public.invitations, uuid)', 'execute')
     or has_function_privilege('anon', 'public.attach_invited_master_card(public.invitations, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.grant_invitation_calendar(public.invitations, uuid)', 'execute') then
    raise exception 'миграция: карточку мастера можно завести мимо приглашения';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.tenant_members'::regclass
       and tgname = 'tenant_members_removed_archive_card'
  ) then
    raise exception 'миграция: уход из компании не отправляет карточку в архив';
  end if;
end
$guard$;
