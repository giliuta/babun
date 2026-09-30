-- ПРИГЛАШЕНИЕ В КАЛЕНДАРЬ ПРИКРЕПЛЯЕТ ЧЕЛОВЕКА К НЕМУ (стык приглашений и прав по блокам).
--
-- `grant_invitation_calendar` (сессия 007, 14.09) выдаёт приглашённому права
-- старой схемы — строку `calendar_members`. Прикрепления этапа 1
-- (`member_calendars`) она не писала, и приглашённый в «Команду 1» не был
-- виден владельцу ни в людях календаря (`list_members(team)`), ни на экране
-- прав (`list_member_access`) — настроить его было нечем. Нашлось 14.09 перед
-- передачей «Команды 1» Giliuta → airfix.cy с нуля.
--
-- Уровни не пишутся: по решению владельца новый сотрудник — «всё выключено».
-- Только прикрепление к календарю из приглашения.
--
-- Тело — ПОЛНЫЙ `create or replace` (живое тело 14.09 + одна вставка), а не
-- вставка по якорю через `execute`: контракт-тест 007 читает тело помощника из
-- последней миграции с буквальным определением, и правка через `execute`
-- оставила бы тест сторожить старое тело (условие 007).
--
-- Что намеренно не меняется:
--   • приглашение без календаря («все календари») — помощник выходит раньше,
--     прикрепления нет; такой человек виден в `list_members()` без календаря;
--   • ранняя ветка `accept_invitation` («уже принято этим же человеком») ничего
--     не пишет — старая ссылка не вернёт календарь, откреплённый после приёма.

create or replace function public.grant_invitation_calendar(p_invitation public.invitations, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  insert into public.calendar_members (tenant_id, team_id, user_id, master_id, grants)
  values (
    p_invitation.tenant_id,
    p_invitation.team_id,
    p_user_id,
    p_invitation.master_id,
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

do $guard$
declare
  body text := pg_get_functiondef('public.grant_invitation_calendar(public.invitations, uuid)'::regprocedure);
begin
  if position('insert into public.member_calendars' in body) = 0 then
    raise exception 'миграция: приглашение не прикрепляет к календарю';
  end if;
  if position('on conflict (tenant_id, team_id, user_id) do nothing' in body) = 0 then
    raise exception 'миграция: пропала вставка прав старой схемы';
  end if;
  if position('insert into public.member_access' in body) > 0 then
    raise exception 'миграция: приглашение не должно выдавать уровни';
  end if;
end
$guard$;
