-- ПРИГЛАШЕНИЕ ВНУТРИ ПРИЛОЖЕНИЯ: ВХОДЯЩИЕ, «ПРИНЯТЬ», «ОТКЛОНИТЬ».
--
-- Владелец 14.09, вечер: приглашение не письмом, а сразу в приложении — у
-- зарегистрированного человека появляется блок «Принять приглашение», у
-- владельца после «Пригласить» — «Приглашение отправлено». Письмо — позже,
-- дублем уведомления. Минимальный кусок этапа Б.
--
-- ГЛАВНОЕ ОГРАНИЧЕНИЕ — ЧЬЯ ЭТО ПОЧТА. На 14.09 в Supabase Auth включено
-- автоподтверждение: 17 из 19 аккаунтов «подтвердили» почту в первые секунды
-- после регистрации без письма. Флаг подтверждения ничего не доказывает, и
-- входящие по одной почте отдали бы чужое приглашение тому, кто первым заведёт
-- аккаунт на этот адрес. Поэтому во входящих видно только приглашение, СОЗДАННОЕ
-- ПОСЛЕ регистрации аккаунта: такой аккаунт уже был у человека, когда владелец
-- его звал, а адрес в auth.users уникален. Кто зарегистрировался позже —
-- владелец отправляет приглашение ещё раз (или человек идёт по ссылке, путь
-- с токеном не менялся). Настоящая защита — включённое подтверждение почты
-- (этап А); тогда это условие можно ослабить.
--
-- РЕШЕНИЕ ВЛАДЕЛЬЦА 14.09 (через сессию 008): приглашения — блоком в Кабинете,
-- без почты и без доказательства адреса. Риск «посторонний заранее заводит
-- аккаунт на адрес сотрудника» (находка 007) принят осознанно. Вариант с
-- доказанным адресом (`proven_emails`, прогон 12/12) лежит в
-- `supabase/parked/20260914240000_invitations_inbox_proven_email.sql`.
--
-- Оракула «есть ли такой аккаунт» у владельца нет: `create_invitation` отвечает
-- одинаково, сигнал уходит только самому приглашённому.
--
--   • `my_invitations()` — открытые приглашения на почту вошедшего по всем
--     компаниям: компания, кто пригласил, роль, календарь (id, имя, цвет), срок.
--     Не показывает принятые, истёкшие, в архивный календарь и в компанию, где
--     человек уже состоит.
--   • `accept_invitation_by_id(id)` — находит токен и зовёт `accept_invitation`:
--     все проверки (почта, карточка, архив, права, прикрепление) — одно тело.
--   • `decline_invitation(id)` — удаляет открытое приглашение; пропадает у обоих.
--   • сигнал `invitations_changed` в `access:<user_id>` приглашённому и
--     пригласившему при создании, принятии и удалении — экран перечитывает
--     список без перезапуска.
-- Чужое приглашение для всех трёх функций — «not found», без различия причин.

create or replace function public.inbox_invitation_token(p_invitation_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_token text;
begin
  select i.token
    into v_token
    from public.invitations i
    join auth.users u on u.id = auth.uid()
   where i.id = p_invitation_id
     and lower(i.email) = lower(coalesce(u.email, ''))
     and i.created_at > u.created_at;
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
  v_account_created timestamptz;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to read invitations'
      using errcode = '42501', hint = 'invite:not_signed_in';
  end if;

  select lower(coalesce(u.email, '')), u.created_at
    into v_email, v_account_created
    from auth.users u
   where u.id = auth.uid();

  if coalesce(v_email, '') = '' then
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
       and i.created_at > v_account_created
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

  -- Тот же круг, что у входящих: аккаунт, существовавший до приглашения.
  select u.id
    into v_invitee
    from auth.users u
   where lower(coalesce(u.email, '')) = lower(v_row.email)
     and u.created_at < v_row.created_at
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

do $guard$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.invitations'::regclass
       and tgname = 'invitations_changed_signal'
  ) then
    raise exception 'миграция: нет сигнала входящих';
  end if;
  if has_function_privilege('anon', 'public.my_invitations()', 'execute')
     or has_function_privilege('authenticated', 'public.inbox_invitation_token(uuid)', 'execute') then
    raise exception 'миграция: права входящих шире задуманного';
  end if;
end
$guard$;
