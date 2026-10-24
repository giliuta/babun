-- ЧЛЕНСТВО: КТО ЕГО МЕНЯЕТ И ЧТО ОСТАЁТСЯ ПОСЛЕ УХОДА.
--
-- 1. Строка `tenant_members` — согласие человека на членство: её рождает
--    только приём приглашения. Политика владельца на UPDATE и колоночные
--    права на все столбцы позволяли переписать в строке `user_id` (или
--    `tenant_id`) — и записать в аккаунт, даже владельцем, человека, который
--    ни на что не соглашался. Личность строки (`user_id`, `tenant_id`,
--    `joined_at`, `invited_by_user_id`) с клиента больше не меняется: права
--    на эти столбцы сняты, а сторож отказывает даже при вернувшемся праве.
--    Обслуживание (service_role, postgres, функции SECURITY DEFINER,
--    каскады внешних ключей) идёт не под ролями клиента и не задевается.
--
-- 2. Директор («Партнёры: Управляет») ведёт только партнёров своих команд.
--    Удаление шло через `partners_manageable`, где команды не сверяются, — и
--    директор убирал из аккаунта партнёра чужой команды. Теперь каждая
--    команда партнёра должна быть и командой директора; партнёра без команд
--    убирает владелец.
--
-- 3. Партнёр, у которого удалили последнюю команду, оставался в аккаунте с
--    правами уровня компании и без единой команды. `delete_calendar` теперь
--    убирает таких так же, как `leave_calendar` убирает ушедшего из
--    последней команды: только тех, кто был в удалённой команде, и не
--    владельца. `set_member_calendars` с пустым списком НЕ трогаем: карточка
--    партнёра снимает последнюю команду с «Отменить», и отмена возвращает
--    набор тому же человеку — удаление членства сломало бы её.
--
-- 4. Приглашение принадлежит тому, кто его отправил. Директор, приглашая на
--    тот же адрес, молча стирал живое приглашение владельца (или другого
--    директора) и правил чужие приглашения. Теперь он заменяет и правит
--    только свои; владелец — любые.
--
-- 5. Приглашение директора живёт, пока он директор. Уволили или сняли право
--    «Партнёры: Управляет» — его открытые приглашения удаляются, а приём
--    приглашения (и по ссылке, и при регистрации) отказывает, если
--    пригласивший уже не владелец и не директор.
--
-- Тела функций правятся точечно по живой версии: якорь обязан встретиться
-- ровно один раз, иначе накат останавливается.

set local lock_timeout = '5s';

-- ─── 1. Личность строки членства ──────────────────────────────────────────

-- SECURITY INVOKER намеренно: `current_user` должен быть ролью клиента.
create or replace function public.tenant_members_identity_frozen()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if current_user in ('authenticated', 'anon')
     and (new.user_id is distinct from old.user_id
          or new.tenant_id is distinct from old.tenant_id
          or new.joined_at is distinct from old.joined_at
          or new.invited_by_user_id is distinct from old.invited_by_user_id) then
    raise exception 'Участника нельзя подменить — уберите его и пригласите заново'
      using errcode = '42501', hint = 'member:identity_frozen';
  end if;
  return new;
end;
$fn$;

revoke all on function public.tenant_members_identity_frozen() from public, anon, authenticated;

drop trigger if exists tenant_members_identity_frozen on public.tenant_members;
create trigger tenant_members_identity_frozen
  before update on public.tenant_members
  for each row execute function public.tenant_members_identity_frozen();

-- Право на UPDATE было выдано на всю таблицу: колоночный REVOKE его не
-- снимает. Снимаем табличное и возвращаем колонки, которые не являются
-- личностью строки. anon членом не бывает — ему правка не нужна вовсе.
revoke update on public.tenant_members from authenticated, anon;
grant update (role, master_id, metadata, access_version)
  on public.tenant_members to authenticated;

-- ─── 2. Директор убирает только партнёров своих команд ────────────────────

create or replace function public.partners_removable(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  active_tenant uuid := public.current_tenant_id();
begin
  if not public.partners_manageable(p_user) then
    return false;
  end if;
  if public.current_user_role() = 'owner' then
    return true;
  end if;
  -- Партнёр без команд ничьей командой не ведётся — его убирает владелец.
  return exists (
      select 1 from public.member_calendars t
       where t.tenant_id = active_tenant and t.user_id = p_user
    )
    and not exists (
      select 1 from public.member_calendars t
       where t.tenant_id = active_tenant
         and t.user_id = p_user
         and not exists (
           select 1 from public.member_calendars mine
            where mine.tenant_id = active_tenant
              and mine.user_id = auth.uid()
              and mine.team_id = t.team_id
         )
    );
end;
$fn$;

revoke all on function public.partners_removable(uuid) from public, anon;
grant execute on function public.partners_removable(uuid) to authenticated;

drop policy if exists tenant_members_delete_partners on public.tenant_members;
create policy tenant_members_delete_partners
  on public.tenant_members
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and public.partners_removable(user_id)
  );

-- ─── 3. Удалённая последняя команда уводит партнёра из аккаунта ───────────

do $patch$
declare
  fn constant regprocedure := 'public.delete_calendar(text)'::regprocedure;
  body text := pg_get_functiondef(fn);
  anchor_decl constant text := E'  n_debts integer := 0;\n';
  repl_decl constant text :=
       E'  n_debts integer := 0;\n'
    || E'  v_detached uuid[];\n';
  anchor_teams constant text :=
       E'  delete from public.teams\n'
    || E'   where id = p_team_id and tenant_id = v_tenant;\n';
  repl_teams constant text :=
       E'  -- Кто был в этой команде: после неё у партнёра может не остаться ни\n'
    || E'  -- одной, а без команд он сидел бы в аккаунте с правами компании.\n'
    || E'  select coalesce(array_agg(mc.user_id), ''{}'') into v_detached\n'
    || E'    from public.member_calendars mc\n'
    || E'   where mc.tenant_id = v_tenant and mc.team_id = p_team_id;\n'
    || E'\n'
    || E'  delete from public.teams\n'
    || E'   where id = p_team_id and tenant_id = v_tenant;\n'
    || E'\n'
    || E'  -- То же правило, что у leave_calendar: последняя команда ушла — ушло\n'
    || E'  -- и членство. Владелец не уходит никогда.\n'
    || E'  delete from public.tenant_members tm\n'
    || E'   where tm.tenant_id = v_tenant\n'
    || E'     and tm.role <> ''owner''\n'
    || E'     and tm.user_id = any (v_detached)\n'
    || E'     and not exists (\n'
    || E'       select 1 from public.member_calendars mc\n'
    || E'        where mc.tenant_id = v_tenant and mc.user_id = tm.user_id\n'
    || E'     );\n';
begin
  if (length(body) - length(replace(body, anchor_decl, ''))) / length(anchor_decl) <> 1 then
    raise exception 'delete_calendar: якорь объявлений не найден ровно один раз';
  end if;
  if (length(body) - length(replace(body, anchor_teams, ''))) / length(anchor_teams) <> 1 then
    raise exception 'delete_calendar: якорь удаления команды не найден ровно один раз';
  end if;
  body := replace(body, anchor_decl, repl_decl);
  body := replace(body, anchor_teams, repl_teams);
  execute body;
end
$patch$;

-- ─── 4. Приглашение принадлежит пригласившему ─────────────────────────────

do $patch$
declare
  fn constant regprocedure :=
    'public.create_invitation(text,text,text,text,text,text,text[],text,text,jsonb)'::regprocedure;
  body text := pg_get_functiondef(fn);
  anchor constant text :=
       E'  delete from public.invitations\n'
    || E'   where tenant_id = v_tenant_id\n'
    || E'     and lower(email) = v_email\n'
    || E'     and accepted_at is null;\n';
  replacement constant text :=
       E'  -- Директор заменяет только своё приглашение: живое приглашение\n'
    || E'  -- владельца или другого директора на этот адрес он не стирает.\n'
    || E'  if public.current_user_role() is distinct from ''owner'' and exists (\n'
    || E'    select 1 from public.invitations i\n'
    || E'     where i.tenant_id = v_tenant_id\n'
    || E'       and lower(i.email) = v_email\n'
    || E'       and i.accepted_at is null\n'
    || E'       and i.expires_at > now()\n'
    || E'       and i.invited_by_user_id is distinct from auth.uid()\n'
    || E'  ) then\n'
    || E'    raise exception ''На этот адрес уже есть приглашение от владельца или другого партнёра''\n'
    || E'      using errcode = ''42501'', hint = ''invite:owned_by_other'';\n'
    || E'  end if;\n'
    || E'\n'
    || anchor;
begin
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'create_invitation: якорь замены приглашения не найден ровно один раз';
  end if;
  execute replace(body, anchor, replacement);
end
$patch$;

do $patch$
declare
  fn constant regprocedure :=
    'public.update_invitation(uuid,text,text,text[],text,text,jsonb)'::regprocedure;
  body text := pg_get_functiondef(fn);
  anchor constant text := E'  if v_invitation.accepted_at is not null then\n';
  replacement constant text :=
       E'  -- Директор правит только свои приглашения; владелец — любые.\n'
    || E'  if public.current_user_role() is distinct from ''owner''\n'
    || E'     and v_invitation.invited_by_user_id is distinct from auth.uid() then\n'
    || E'    raise exception ''Это приглашение меняет тот, кто его отправил''\n'
    || E'      using errcode = ''42501'', hint = ''invite:owned_by_other'';\n'
    || E'  end if;\n'
    || E'\n'
    || anchor;
begin
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'update_invitation: якорь проверки приёма не найден ровно один раз';
  end if;
  execute replace(body, anchor, replacement);
end
$patch$;

-- ─── 5. Приглашение живёт, пока пригласивший вправе приглашать ────────────

-- Та же лестница, что у access_company, но для любого человека, а не для
-- звонящего: приём идёт под приглашённым.
create or replace function public.invitation_inviter_live(p_tenant uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
      from public.tenant_members tm
     where tm.tenant_id = p_tenant
       and tm.user_id = p_user
       and (
         tm.role = 'owner'
         or exists (
           select 1
             from public.access_blocks b
            where b.key = 'company.partners'
              and b.scope = 'company'
              and b.live
              and not b.owner_only
              and coalesce(
                array_position(
                  array['off', 'read', 'write', 'full'],
                  coalesce(
                    (select ma.level
                       from public.member_access ma
                      where ma.tenant_id = p_tenant
                        and ma.user_id = p_user
                        and ma.block = b.key
                        and ma.team_id is null),
                    b.levels[1]
                  )
                ) >= 3,
                false
              )
         )
       )
  );
$fn$;

revoke all on function public.invitation_inviter_live(uuid, uuid) from public, anon, authenticated;

create or replace function public.invitations_drop_by_inviter(p_tenant uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_tenant is null or p_user is null
     or public.invitation_inviter_live(p_tenant, p_user) then
    return;
  end if;
  delete from public.invitations i
   where i.tenant_id = p_tenant
     and i.invited_by_user_id = p_user
     and i.accepted_at is null;
end;
$fn$;

revoke all on function public.invitations_drop_by_inviter(uuid, uuid) from public, anon, authenticated;

create or replace function public.tenant_members_removed_drop_invitations()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.invitations_drop_by_inviter(old.tenant_id, old.user_id);
  return null;
end;
$fn$;

revoke all on function public.tenant_members_removed_drop_invitations() from public, anon, authenticated;

drop trigger if exists tenant_members_removed_drop_invitations on public.tenant_members;
create trigger tenant_members_removed_drop_invitations
  after delete on public.tenant_members
  for each row execute function public.tenant_members_removed_drop_invitations();

-- Право «Партнёры» сняли или понизили — открытые приглашения директора
-- уходят сразу, а не висят во входящих до отказа при приёме.
create or replace function public.member_access_partners_lost_drop_invitations()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.invitations_drop_by_inviter(old.tenant_id, old.user_id);
  return null;
end;
$fn$;

revoke all on function public.member_access_partners_lost_drop_invitations() from public, anon, authenticated;

drop trigger if exists member_access_partners_lost_drop_invitations on public.member_access;
create trigger member_access_partners_lost_drop_invitations
  after update or delete on public.member_access
  for each row
  when (old.block = 'company.partners' and old.team_id is null)
  execute function public.member_access_partners_lost_drop_invitations();

-- Сторож приёма — на самой отметке «принято»: её ставят и accept_invitation,
-- и регистрация по ссылке (handle_new_user), поэтому одна проверка держит
-- оба пути.
create or replace function public.invitation_accept_needs_live_inviter()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.accepted_at is not null
     and old.accepted_at is null
     and not public.invitation_inviter_live(new.tenant_id, new.invited_by_user_id) then
    raise exception 'Приглашение больше не действует — попросите новое'
      using errcode = '42501', hint = 'invite:inviter_revoked';
  end if;
  return new;
end;
$fn$;

revoke all on function public.invitation_accept_needs_live_inviter() from public, anon, authenticated;

drop trigger if exists invitations_accept_needs_live_inviter on public.invitations;
create trigger invitations_accept_needs_live_inviter
  before update of accepted_at on public.invitations
  for each row execute function public.invitation_accept_needs_live_inviter();

-- ─── Сторож ───────────────────────────────────────────────────────────────

do $guard$
declare
  src text;
begin
  -- 1
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.tenant_members'::regclass
       and tgname = 'tenant_members_identity_frozen'
       and tgenabled = 'O'
  ) then
    raise exception 'сторож: нет сторожа личности строки tenant_members';
  end if;
  if exists (select 1 from pg_proc where oid = 'public.tenant_members_identity_frozen()'::regprocedure and prosecdef) then
    raise exception 'сторож: tenant_members_identity_frozen обязан быть SECURITY INVOKER';
  end if;
  if has_column_privilege('authenticated', 'public.tenant_members', 'user_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.tenant_members', 'tenant_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.tenant_members', 'joined_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.tenant_members', 'invited_by_user_id', 'UPDATE')
     or has_column_privilege('anon', 'public.tenant_members', 'user_id', 'UPDATE') then
    raise exception 'сторож: клиент всё ещё может переписать личность строки tenant_members';
  end if;

  -- 2
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'tenant_members'
       and policyname = 'tenant_members_delete_partners'
       and qual like '%partners_removable(user_id)%'
  ) then
    raise exception 'сторож: tenant_members_delete_partners не сверяет команды директора';
  end if;
  if has_function_privilege('anon', 'public.partners_removable(uuid)', 'execute') then
    raise exception 'сторож: partners_removable открыта anon';
  end if;

  -- 3
  select prosrc into src from pg_proc where oid = 'public.delete_calendar(text)'::regprocedure;
  if src not like '%delete from public.tenant_members tm%tm.user_id = any (v_detached)%' then
    raise exception 'сторож: delete_calendar не убирает партнёров без команд';
  end if;

  -- 4
  select prosrc into src from pg_proc
   where oid = 'public.create_invitation(text,text,text,text,text,text,text[],text,text,jsonb)'::regprocedure;
  if src not like '%invite:owned_by_other%delete from public.invitations%' then
    raise exception 'сторож: create_invitation стирает чужие приглашения';
  end if;
  select prosrc into src from pg_proc
   where oid = 'public.update_invitation(uuid,text,text,text[],text,text,jsonb)'::regprocedure;
  if src not like '%invite:owned_by_other%' then
    raise exception 'сторож: update_invitation правит чужие приглашения';
  end if;

  -- 5
  if (select count(*) from pg_trigger
       where not tgisinternal and tgenabled = 'O'
         and ((tgrelid = 'public.tenant_members'::regclass and tgname = 'tenant_members_removed_drop_invitations')
           or (tgrelid = 'public.member_access'::regclass and tgname = 'member_access_partners_lost_drop_invitations')
           or (tgrelid = 'public.invitations'::regclass and tgname = 'invitations_accept_needs_live_inviter'))) <> 3 then
    raise exception 'сторож: приглашения ушедшего директора не убираются';
  end if;
  if has_function_privilege('anon', 'public.invitation_inviter_live(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.invitation_inviter_live(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.invitations_drop_by_inviter(uuid,uuid)', 'execute') then
    raise exception 'сторож: служебные функции приглашений открыты клиенту';
  end if;
end
$guard$;
