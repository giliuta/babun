-- ПРИНЯТЬ ПРИГЛАШЕНИЕ — ТОЛЬКО С ПОДТВЕРЖДЁННОЙ ПОЧТОЙ (STORY-087, аудит 23.09).
--
-- Приглашение адресовано почте: `accept_invitation*` и `my_invitations`
-- сверяют адрес приглашения с почтой вошедшего. Подтверждена ли эта почта —
-- не спрашивал никто. Сейчас это держит настройка входа (без подтверждения
-- сессии нет, все 19 пользователей подтверждены), но настройка живёт вне
-- репозитория: выключи её однажды — и любой, кто зарегистрируется на адрес
-- сотрудника, войдёт в компанию его приглашением.
--
-- Страховка в самой базе: строка приглашения не может стать принятой
-- пользователем без подтверждённой почты. Триггер, а не правка трёх функций
-- принятия: правило одно на любой путь, которым приглашение принимают.

create or replace function public.invitation_accept_needs_confirmed_email()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.accepted_at is not null
     and old.accepted_at is null
     and new.accepted_by_user_id is not null
     and not exists (
       select 1 from auth.users u
        where u.id = new.accepted_by_user_id
          and u.email_confirmed_at is not null
     ) then
    raise exception 'invite:email_not_confirmed'
      using errcode = 'P0001',
            hint = 'Подтвердите почту, чтобы принять приглашение';
  end if;
  return new;
end;
$function$;

revoke all on function public.invitation_accept_needs_confirmed_email() from public, anon, authenticated;

drop trigger if exists invitations_accept_needs_confirmed_email on public.invitations;
create trigger invitations_accept_needs_confirmed_email
  before update of accepted_at on public.invitations
  for each row execute function public.invitation_accept_needs_confirmed_email();

-- ─── Сторож ──────────────────────────────────────────────────────────────
do $audit$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'invitations_accept_needs_confirmed_email'
       and tgrelid = 'public.invitations'::regclass
  ) then
    raise exception 'confirmed-email trigger is missing';
  end if;
  if has_function_privilege('authenticated', 'public.invitation_accept_needs_confirmed_email()', 'execute') then
    raise exception 'trigger function is callable directly';
  end if;
end
$audit$;
