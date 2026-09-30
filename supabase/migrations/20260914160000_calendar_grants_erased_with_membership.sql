-- ПРАВА НА КАЛЕНДАРИ СТИРАЮТСЯ ВМЕСТЕ С ЧЛЕНСТВОМ (этап 0(в) плана доступа).
--
-- Было: `calendar_members` ссылалась на компанию, календарь и аккаунт, но НЕ на
-- членство в компании. Увольнение (`delete from tenant_members`) права на
-- календари оставляло. Входы в компанию (`accept_invitation`, регистрация по
-- ссылке) пускают только того, кто ещё не член, поэтому «позван снова» всегда
-- идёт после увольнения — и выдача прав `grant_invitation_calendar` пишет
-- `on conflict do nothing`: старые строки других календарей просто оживали.
-- Человек, уволенный из «Команды 2» и позванный в «Команду 1», получал обе.
--
-- Лечит одно — стирание при увольнении (разбор сессии 007, 14.09): перезапись
-- в помощнике не помогла бы, у нового календаря с ключом (tenant, team, user)
-- конфликта нет. Помощник и его контракт-тест не меняются.
--
-- Новые таблицы этапа 1 (`member_calendars`, `member_access`) висят на
-- членстве каскадом с рождения. Эта миграция выравнивает старую.

-- Сироты: строки прав без членства. На боевой 14.09 — 0; чистим до ссылки,
-- иначе она не встанет.
delete from public.calendar_members cm
 where not exists (
   select 1 from public.tenant_members tm
    where tm.tenant_id = cm.tenant_id and tm.user_id = cm.user_id
 );

alter table public.calendar_members
  add constraint calendar_members_member_fkey
  foreign key (tenant_id, user_id)
  references public.tenant_members(tenant_id, user_id)
  on delete cascade;

do $guard$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.calendar_members'::regclass
       and conname = 'calendar_members_member_fkey'
       and confdeltype = 'c'
  ) then
    raise exception 'миграция: права на календари не привязаны к членству каскадом';
  end if;
end
$guard$;
