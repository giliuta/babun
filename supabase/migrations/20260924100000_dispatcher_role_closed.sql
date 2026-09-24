-- РОЛЬ «ДИСПЕТЧЕР» ЗАКРЫТА (STORY-087, аудит 23.09).
--
-- С 14.09 права ставятся каждому сотруднику по блокам (`member_access`), и
-- приложение зовёт людей только ролью «мастер» — уровни решают, что он видит
-- и меняет. Старая роль «диспетчер» осталась только в сервере и обходила
-- уровни целиком: диспетчеру политики открывают всю компанию (без календарей —
-- все записи, чеки, файлы клиентов), и ни один блок прав его не сдерживает.
-- Приложение такого человека завести не может, но прямой вызов
-- `create_invitation(p_role => 'dispatcher')` — может.
--
-- В базе на 24.09 нет ни одного диспетчера и ни одного приглашения с этой
-- ролью: закрываем роль ограничением, а не переписываем десятки политик.
-- Новый «диспетчер» — это сотрудник с уровнями «Меняет».

alter table public.invitations drop constraint invitations_role_check;
alter table public.invitations
  add constraint invitations_role_check check (role = 'master');

alter table public.tenant_members drop constraint tenant_members_role_check;
alter table public.tenant_members
  add constraint tenant_members_role_check check (role = any (array['owner'::text, 'master'::text]));

-- ─── Сторож ──────────────────────────────────────────────────────────────
do $audit$
begin
  if exists (select 1 from public.tenant_members where role = 'dispatcher')
     or exists (select 1 from public.invitations where role = 'dispatcher') then
    raise exception 'dispatcher rows still exist';
  end if;
end
$audit$;
