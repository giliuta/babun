-- ВЫЙТИ ИЗ КОМАНДЫ САМОМУ (владелец 09.10: «меня добавили в команду — внизу
-- должно быть не „удалить команду", а „выйти из неё"… добавить добавили, а
-- выйти я уже не могу, если меня не удалят»).
--
-- Партнёр снимает себя с одной команды чужого аккаунта: уходят его привязка
-- к календарю (`member_calendars`), права по этой команде (`member_access`
-- с её `team_id`) и его уведомления по ней. Если команд у этого владельца у
-- него больше не осталось — он выходит из аккаунта целиком (`tenant_members`;
-- триггеры архивируют его карточку, шлют сигнал и сверяют claim'ы — тот же
-- путь, что у удаления партнёра владельцем).
--
-- Владелец из СВОЕЙ команды не выходит: её он удаляет (архив).

create or replace function public.leave_calendar(p_tenant_id uuid, p_team_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
  my_role text;
  left_account boolean := false;
begin
  if uid is null then
    raise exception 'нужен вход' using errcode = '42501', hint = 'leave:anon';
  end if;

  select tm.role into my_role
    from public.tenant_members tm
   where tm.tenant_id = p_tenant_id and tm.user_id = uid;
  if my_role is null then
    raise exception 'вы не состоите в этом аккаунте' using errcode = '42501', hint = 'leave:not_member';
  end if;
  if my_role = 'owner' then
    raise exception 'из своей команды не выходят — её можно удалить' using errcode = '42501', hint = 'leave:owner';
  end if;

  delete from public.member_calendars mc
   where mc.tenant_id = p_tenant_id and mc.user_id = uid and mc.team_id = p_team_id;
  if not found then
    raise exception 'вас нет в этой команде' using errcode = '22023', hint = 'leave:not_attached';
  end if;

  delete from public.member_access ma
   where ma.tenant_id = p_tenant_id and ma.user_id = uid and ma.team_id = p_team_id;
  delete from public.team_notification_prefs np
   where np.tenant_id = p_tenant_id and np.user_id = uid and np.team_id = p_team_id;

  if not exists (
    select 1 from public.member_calendars mc
     where mc.tenant_id = p_tenant_id and mc.user_id = uid
  ) then
    delete from public.tenant_members tm
     where tm.tenant_id = p_tenant_id and tm.user_id = uid;
    left_account := true;
  end if;

  return jsonb_build_object('left_account', left_account);
end;
$$;

-- Новая функция по умолчанию исполнима для PUBLIC и anon — закрываем.
revoke all on function public.leave_calendar(uuid, text) from public, anon;
grant execute on function public.leave_calendar(uuid, text) to authenticated;
