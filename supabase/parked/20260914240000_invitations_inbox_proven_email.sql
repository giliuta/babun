-- ПРИГЛАШЕНИЕ ВНУТРИ ПРИЛОЖЕНИЯ: ВХОДЯЩИЕ, «ПРИНЯТЬ», «ОТКЛОНИТЬ».
--
-- Владелец 14.09, вечер: приглашение не письмом, а сразу в приложении — у
-- зарегистрированного человека над календарём карточка «Вас пригласили» с
-- «Принять / Отклонить». Письмо — позже, дублем уведомления. Кусок этапа Б.
--
-- ГЛАВНОЕ — ЧЬЯ ЭТО ПОЧТА. На 14.09 в Supabase Auth включено автоподтверждение:
-- 17 из 19 аккаунтов «подтвердили» почту в первые секунды без письма. Приём по
-- ссылке защищён вторым фактором — ссылку владелец отдаёт человеку сам. Во
-- входящих фактора нет, и одной совпадающей почты мало: посторонний может
-- ЗАРАНЕЕ завести аккаунт на адрес сотрудника (находка 007).
--
-- Поэтому входящие открыты только ДОКАЗАННОМУ адресу, и доказательство — это
-- СНИМОК адреса в момент доказательства (`proven_emails`), а не штамп в
-- auth.users: штамп переживает смену почты, снимок — нет.
--   • письмо подтверждения: `email_confirmed_at` из пустого стал заполненным ПОСЛЕ
--     `confirmation_sent_at` (автоподтверждение ставит отметку при создании и
--     сюда не попадает);
--   • вход через Google с `email_verified` и той же почтой, что у аккаунта.
-- Во входящие пускает только `lower(auth.users.email) = proven_emails.email`:
-- сменилась почта — адрес больше не доказан, какие бы штампы ни стояли.
-- Разовая починка переносит уже доказанных (на 14.09 — 2 из 19). Её граница:
-- для «письма подтверждения» она читает штампы и не знает, менялась ли почта
-- после; таких email-аккаунтов на 14.09 один — владелец.
-- Недоказанные принимают приглашение по ссылке, путь с токеном не менялся.
-- Сегодня адрес доказывается Google-входом; для новых аккаунтов — включённым
-- подтверждением почты (этап А, решение владельца).
--
-- Оракула «есть ли такой аккаунт» у владельца нет: `create_invitation` отвечает
-- одинаково, сигнал уходит только самому приглашённому.
--
--   • `my_invitations()` — открытые приглашения на доказанную почту вошедшего по
--     всем компаниям: компания, кто пригласил, роль, календарь (id, имя, цвет),
--     срок. Не показывает принятые, истёкшие, в архивный календарь и в компанию,
--     где человек уже состоит.
--   • `accept_invitation_by_id(id)` — находит токен и зовёт `accept_invitation`:
--     все проверки (почта, карточка, архив, права, прикрепление) — одно тело.
--   • `decline_invitation(id)` — удаляет открытое приглашение; пропадает у обоих.
--   • сигнал `invitations_changed` в `access:<user_id>` приглашённому (если адрес
--     доказан) и пригласившему при создании, принятии и удалении.
-- Чужое приглашение для всех трёх функций — «not found», без различия причин.

create table if not exists public.proven_emails (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  source text not null check (source in ('confirm_mail', 'google')),
  proven_at timestamptz not null default now()
);

alter table public.proven_emails enable row level security;
revoke all on table public.proven_emails from public, anon, authenticated;

create or replace function public.remember_proven_email(p_user_id uuid, p_email text, p_source text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if p_user_id is null or coalesce(btrim(p_email), '') = '' then
    return;
  end if;

  insert into public.proven_emails (user_id, email, source, proven_at)
  values (p_user_id, lower(btrim(p_email)), p_source, now())
  on conflict (user_id) do update
    set email = excluded.email,
        source = excluded.source,
        proven_at = excluded.proven_at;
end;
$function$;

revoke all on function public.remember_proven_email(uuid, text, text) from public, anon, authenticated;

create or replace function public.auth_user_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- Доказательство — ПЕРЕХОД: подтверждения не было, письмо уходило, и
  -- подтверждение пришло после письма.
  if old.email_confirmed_at is null
     and new.email_confirmed_at is not null
     and new.confirmation_sent_at is not null
     and new.email_confirmed_at >= new.confirmation_sent_at then
    begin
      perform public.remember_proven_email(new.id, new.email, 'confirm_mail');
    exception when others then
      -- Вход человека важнее снимка: не доказали сейчас — докажет Google или
      -- повторное подтверждение, а падение здесь сорвало бы подтверждение почты.
      raise warning 'proven_emails: confirm snapshot failed for %', new.id;
    end;
  end if;
  return null;
end;
$function$;

revoke all on function public.auth_user_email_confirmed() from public, anon, authenticated;

drop trigger if exists proven_email_on_confirm on auth.users;
create trigger proven_email_on_confirm
  after update of email_confirmed_at on auth.users
  for each row execute function public.auth_user_email_confirmed();

create or replace function public.auth_identity_google_verified()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.provider = 'google'
     and lower(coalesce(new.identity_data ->> 'email_verified', '')) = 'true'
     and exists (
       select 1 from auth.users u
        where u.id = new.user_id
          and lower(coalesce(u.email, '')) = lower(coalesce(new.identity_data ->> 'email', ''))
     ) then
    begin
      perform public.remember_proven_email(new.user_id, new.identity_data ->> 'email', 'google');
    exception when others then
      raise warning 'proven_emails: google snapshot failed for %', new.user_id;
    end;
  end if;
  return null;
end;
$function$;

revoke all on function public.auth_identity_google_verified() from public, anon, authenticated;

drop trigger if exists proven_email_on_google on auth.identities;
create trigger proven_email_on_google
  after insert or update of identity_data on auth.identities
  for each row execute function public.auth_identity_google_verified();

create or replace function public.current_user_proven_email()
returns text
language sql
stable
security definer
set search_path = public
as $function$
  select pe.email
    from public.proven_emails pe
    join auth.users u on u.id = pe.user_id
   where pe.user_id = auth.uid()
     and pe.email = lower(coalesce(u.email, ''))
$function$;

revoke all on function public.current_user_proven_email() from public, anon, authenticated;

create or replace function public.inbox_invitation_token(p_invitation_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_email text := public.current_user_proven_email();
  v_token text;
begin
  if v_email is null then
    return null;
  end if;

  select i.token
    into v_token
    from public.invitations i
   where i.id = p_invitation_id
     and lower(i.email) = v_email;
  return v_token;
end;
$function$;

revoke all on function public.inbox_invitation_token(uuid) from public, anon, authenticated;

create or replace function public.my_invitations()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to read invitations'
      using errcode = '42501', hint = 'invite:not_signed_in';
  end if;

  v_email := public.current_user_proven_email();
  if v_email is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'id', i.id,
               'tenant_id', i.tenant_id,
               'company', t.name,
               'inviter', coalesce(
                 nullif(btrim(iu.raw_user_meta_data ->> 'full_name'), ''),
                 nullif(btrim(iu.raw_user_meta_data ->> 'name'), ''),
                 split_part(iu.email, '@', 1)
               ),
               'role', i.role,
               'calendar', case
                 when tm.id is null then null
                 else jsonb_build_object('id', tm.id, 'name', tm.name, 'color', tm.color)
               end,
               'expires_at', i.expires_at,
               'created_at', i.created_at
             )
             order by i.created_at desc
           )
      from public.invitations i
      join public.tenants t
        on t.id = i.tenant_id and t.onboarded_at is not null
      left join public.teams tm
        on tm.tenant_id = i.tenant_id and tm.id = i.team_id
      left join auth.users iu
        on iu.id = i.invited_by_user_id
     where lower(i.email) = v_email
       and i.accepted_at is null
       and i.expires_at > now()
       and (i.team_id is null or tm.is_active)
       and not exists (
         select 1 from public.tenant_members m
          where m.tenant_id = i.tenant_id and m.user_id = auth.uid()
       )
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.my_invitations() from public, anon;
grant execute on function public.my_invitations() to authenticated;

create or replace function public.accept_invitation_by_id(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to accept an invitation'
      using errcode = '42501';
  end if;

  v_token := public.inbox_invitation_token(p_invitation_id);
  if v_token is null then
    raise exception 'invitation not found'
      using errcode = 'P0002', hint = 'invite:not_found';
  end if;

  return public.accept_invitation(v_token);
end;
$function$;

revoke all on function public.accept_invitation_by_id(uuid) from public, anon;
grant execute on function public.accept_invitation_by_id(uuid) to authenticated;

create or replace function public.decline_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to decline an invitation'
      using errcode = '42501';
  end if;

  v_token := public.inbox_invitation_token(p_invitation_id);

  delete from public.invitations i
   where v_token is not null
     and i.token = v_token
     and i.accepted_at is null;

  if not found then
    raise exception 'invitation not found'
      using errcode = 'P0002', hint = 'invite:not_found';
  end if;
end;
$function$;

revoke all on function public.decline_invitation(uuid) from public, anon;
grant execute on function public.decline_invitation(uuid) to authenticated;

create or replace function public.invitations_changed_signal()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row public.invitations%rowtype;
  v_invitee uuid;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  if tg_op = 'UPDATE' and new.accepted_at is not distinct from old.accepted_at then
    return null;
  end if;

  -- Тот же круг, что у входящих: доказанный адрес, совпадающий с почтой аккаунта.
  select pe.user_id
    into v_invitee
    from public.proven_emails pe
    join auth.users u
      on u.id = pe.user_id and lower(coalesce(u.email, '')) = pe.email
   where pe.email = lower(v_row.email)
   limit 1;

  if v_invitee is not null then
    perform realtime.send(
      jsonb_build_object('tenant_id', v_row.tenant_id),
      'invitations_changed',
      'access:' || v_invitee::text,
      true
    );
  end if;

  if v_row.invited_by_user_id is not null
     and v_row.invited_by_user_id is distinct from v_invitee then
    perform realtime.send(
      jsonb_build_object('tenant_id', v_row.tenant_id),
      'invitations_changed',
      'access:' || v_row.invited_by_user_id::text,
      true
    );
  end if;

  return null;
end;
$function$;

revoke all on function public.invitations_changed_signal() from public, anon, authenticated;

drop trigger if exists invitations_changed_signal on public.invitations;
create trigger invitations_changed_signal
  after insert or delete or update of accepted_at on public.invitations
  for each row execute function public.invitations_changed_signal();

-- Разовый перенос уже доказанных адресов.
do $backfill$
declare
  r record;
begin
  for r in
    select u.id, u.email
      from auth.users u
     where u.confirmation_sent_at is not null
       and u.email_confirmed_at is not null
       and u.email_confirmed_at >= u.confirmation_sent_at
  loop
    perform public.remember_proven_email(r.id, r.email, 'confirm_mail');
  end loop;

  for r in
    select i.user_id, i.identity_data ->> 'email' as email
      from auth.identities i
      join auth.users u on u.id = i.user_id
     where i.provider = 'google'
       and lower(coalesce(i.identity_data ->> 'email_verified', '')) = 'true'
       and lower(coalesce(u.email, '')) = lower(coalesce(i.identity_data ->> 'email', ''))
  loop
    perform public.remember_proven_email(r.user_id, r.email, 'google');
  end loop;
end
$backfill$;

do $guard$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.invitations'::regclass and tgname = 'invitations_changed_signal')
     or not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'proven_email_on_confirm')
     or not exists (select 1 from pg_trigger where tgrelid = 'auth.identities'::regclass and tgname = 'proven_email_on_google') then
    raise exception 'миграция: нет триггера входящих или доказательства адреса';
  end if;
  if has_function_privilege('anon', 'public.my_invitations()', 'execute')
     or has_function_privilege('authenticated', 'public.inbox_invitation_token(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.current_user_proven_email()', 'execute')
     or has_table_privilege('authenticated', 'public.proven_emails', 'select')
     or has_table_privilege('anon', 'public.proven_emails', 'select') then
    raise exception 'миграция: права входящих шире задуманного';
  end if;
end
$guard$;
