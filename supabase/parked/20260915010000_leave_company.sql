-- СОТРУДНИК САМ ПОКИДАЕТ КОМПАНИЮ; ВЛАДЕЛЕЦ — НЕТ.
--
-- «Мои компании» в Кабинете (просьба 007, владелец 15.09 требует полноценный
-- Кабинет): не-владелец выходит из чужой компании сам.
--
-- `leave_company(p_tenant_id)` удаляет СВОЮ строку `tenant_members`. Всё
-- остальное делает то, что уже стоит на удалении члена, — тем же путём, что
-- снятие владельцем:
--   • каскад по внешним ключам стирает calendar_members, member_calendars и
--     member_access;
--   • `tenant_members_removed_signal` шлёт `membership_removed` в
--     `access:<user_id>` — телефон стирает данные компании;
--   • `tenant_members_removed_sync_claims` пересчитывает компании в токене.
-- Подписки на пуши НЕ трогаются: send_push выбирает их по человеку, а не по
-- компании, и удаление выключило бы пуши всех компаний на устройстве.
-- Ответ: `{ tenant_id, next_tenant_id }` — куда переключиться (старейшее из
-- оставшихся членств или null). Отказы — hint `leave:not_signed_in`,
-- `leave:not_member`, `leave:owner`.
--
-- ПОЛИТИКИ. Отказ владельцу внутри функции был бы декорацией: на 14.09 две
-- политики пускали владельца удалить СВОЮ строку напрямую — `self_leave` любого
-- члена, `delete_owner` любую строку своей компании. Держала только защита
-- последнего владельца. Теперь `self_leave` — только не-владелец,
-- `delete_owner` — только чужие строки. Экрану это ничего не ломает: снятие
-- сотрудника уже отказывает «Свой доступ нельзя удалить», удаление аккаунта
-- идёт сервисным ключом мимо политик.

create or replace function public.leave_company(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_role text;
  v_next uuid;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to leave a company'
      using errcode = '42501', hint = 'leave:not_signed_in';
  end if;

  select tm.role
    into v_role
    from public.tenant_members tm
   where tm.tenant_id = p_tenant_id
     and tm.user_id = auth.uid()
   for update;

  if not found then
    raise exception 'not a member of this company'
      using errcode = 'P0002', hint = 'leave:not_member';
  end if;

  if v_role = 'owner' then
    raise exception 'an owner cannot leave their own company'
      using errcode = '42501', hint = 'leave:owner';
  end if;

  delete from public.tenant_members tm
   where tm.tenant_id = p_tenant_id
     and tm.user_id = auth.uid();

  select tm.tenant_id
    into v_next
    from public.tenant_members tm
   where tm.user_id = auth.uid()
   order by tm.joined_at asc, tm.tenant_id asc
   limit 1;

  return jsonb_build_object('tenant_id', p_tenant_id, 'next_tenant_id', v_next);
end;
$function$;

revoke all on function public.leave_company(uuid) from public, anon;
grant execute on function public.leave_company(uuid) to authenticated;

alter policy tenant_members_self_leave on public.tenant_members
  using ((user_id = (select auth.uid())) and (role <> 'owner'));

alter policy tenant_members_delete_owner on public.tenant_members
  using (
    (tenant_id = (select public.current_tenant_id()))
    and ((select public.current_user_role()) = 'owner')
    and (user_id <> (select auth.uid()))
  );

do $guard$
declare
  v_self text;
  v_owner text;
begin
  select qual into v_self from pg_policies
   where schemaname = 'public' and tablename = 'tenant_members' and policyname = 'tenant_members_self_leave';
  select qual into v_owner from pg_policies
   where schemaname = 'public' and tablename = 'tenant_members' and policyname = 'tenant_members_delete_owner';
  if position('<> ''owner''' in coalesce(v_self, '')) = 0 then
    raise exception 'миграция: владелец всё ещё может выйти сам';
  end if;
  if position('user_id <> ' in coalesce(v_owner, '')) = 0 then
    raise exception 'миграция: владелец всё ещё может удалить свою строку';
  end if;
  if has_function_privilege('anon', 'public.leave_company(uuid)', 'execute') then
    raise exception 'миграция: anon может звать leave_company';
  end if;
end
$guard$;
