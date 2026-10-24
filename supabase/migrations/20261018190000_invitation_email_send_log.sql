-- ПИСЬМА-ПРИГЛАШЕНИЯ: ЛИМИТЫ ПО ЖУРНАЛУ, А НЕ ПО СТРОКАМ ПРИГЛАШЕНИЙ.
--
-- `claim_invitation_email` держал два лимита — «не чаще минуты» по строке
-- приглашения и «30 в час» по `invitations.email_sent_at` аккаунта. Обе меры
-- стояли на строках, которые сам звонящий стирает: `create_invitation` на тот
-- же адрес удаляет прежнее открытое приглашение и заводит новое со штампом
-- NULL, а владелец может удалить приглашение и прямо. Цикл «пригласить →
-- письмо → пригласить заново» слал письма с noreply@babun.app на любой адрес
-- без счёта; тему письма («<имя> приглашает вас в Babun») пишет звонящий своим
-- именем в профиле, название аккаунта и команд — тоже его текст. Отсюда
-- бомбардировка чужого ящика и фишинговый текст с нашего домена.
--
-- Теперь каждое отправленное письмо оставляет строку в журнале, который
-- приложению не виден и не стирается вместе с приглашением. Лимиты считаются
-- по нему:
--   • один адрес — не чаще раза в минуту и не больше 3 писем за сутки, от кого
--     угодно;
--   • один человек (auth.uid) — не больше 20 писем за сутки;
--   • один аккаунт — не больше 30 писем за час.
-- Имя приглашающего, название аккаунта и команд уходят в письмо одной строкой
-- и не длиннее 60 знаков.
--
-- Ответы edge-функции не меняются: отказы журнала идут теми же подсказками
-- `invite_email:too_soon` / `invite_email:tenant_limit` — приложение их и так
-- глушит (письмо лишь подсказка, приглашение ждёт во «Входящих»).

set local lock_timeout = '5s';

create table public.invitation_email_log (
  id bigserial primary key,
  tenant_id uuid not null,
  sender uuid not null,
  email_lower text not null,
  sent_at timestamptz not null default now()
);

comment on table public.invitation_email_log is
  'Отправленные письма-приглашения: по нему claim_invitation_email считает лимиты (адрес, отправитель, аккаунт). Строки не удаляются вместе с приглашением.';

create index invitation_email_log_email_idx on public.invitation_email_log (email_lower, sent_at);
create index invitation_email_log_sender_idx on public.invitation_email_log (sender, sent_at);
create index invitation_email_log_tenant_idx on public.invitation_email_log (tenant_id, sent_at);

alter table public.invitation_email_log enable row level security;
revoke all on table public.invitation_email_log from public, anon, authenticated;
revoke all on sequence public.invitation_email_log_id_seq from public, anon, authenticated;

-- Прошлые штампы — в журнал, чтобы лимит начал считать с текущего часа, а не
-- с нуля.
insert into public.invitation_email_log (tenant_id, sender, email_lower, sent_at)
select i.tenant_id, coalesce(i.invited_by_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
       lower(btrim(i.email)), i.email_sent_at
  from public.invitations i
 where i.email_sent_at > now() - interval '1 day';

create or replace function public.claim_invitation_email(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  active_tenant uuid := public.current_tenant_id();
  v_invitation public.invitations%rowtype;
  v_email text;
  v_account text;
  v_inviter text;
  v_teams text[];
begin
  if auth.uid() is null
     or active_tenant is null
     or not (
       public.current_user_role() = 'owner'
       or public.access_company('company.partners', 'write')
     ) then
    raise exception 'письмо приглашения отправляет владелец или директор'
      using errcode = '42501', hint = 'invite_email:not_owner';
  end if;

  select * into v_invitation
    from public.invitations i
   where i.id = p_invitation_id
     and i.tenant_id = active_tenant
   for update;

  if not found then
    raise exception 'приглашение не найдено'
      using errcode = 'P0002', hint = 'invite_email:not_found';
  end if;

  if v_invitation.accepted_at is not null or v_invitation.expires_at <= now() then
    raise exception 'приглашение уже принято или истекло'
      using errcode = '55000', hint = 'invite_email:closed';
  end if;

  select coalesce(array_agg(left(regexp_replace(btrim(t.name), '\s+', ' ', 'g'), 60) order by x.ord), array[]::text[])
    into v_teams
    from unnest(
           coalesce(v_invitation.team_ids, array[v_invitation.team_id])
         ) with ordinality as x(team_id, ord)
    join public.teams t
      on t.tenant_id = active_tenant
     and t.id = x.team_id
     and t.is_active;

  if v_invitation.team_id is not null and cardinality(v_teams) = 0 then
    raise exception 'команды приглашения в архиве'
      using errcode = '55000', hint = 'invite_email:calendar_archived';
  end if;

  v_email := lower(btrim(v_invitation.email));

  -- Счёт по журналу под замком адреса: два параллельных вызова не проскочат
  -- лимит вдвоём.
  perform pg_advisory_xact_lock(hashtext('invitation_email:' || v_email));

  if exists (
    select 1 from public.invitation_email_log l
     where l.email_lower = v_email
       and l.sent_at > now() - interval '60 seconds'
  ) then
    raise exception 'письмо уже отправлено, повторить можно через минуту'
      using errcode = '55000', hint = 'invite_email:too_soon';
  end if;

  if (select count(*) from public.invitation_email_log l
       where l.email_lower = v_email and l.sent_at > now() - interval '1 day') >= 3
     or (select count(*) from public.invitation_email_log l
       where l.sender = auth.uid() and l.sent_at > now() - interval '1 day') >= 20
     or (select count(*) from public.invitation_email_log l
       where l.tenant_id = active_tenant and l.sent_at > now() - interval '1 hour') >= 30 then
    raise exception 'слишком много писем-приглашений'
      using errcode = '55000', hint = 'invite_email:tenant_limit';
  end if;

  insert into public.invitation_email_log (tenant_id, sender, email_lower)
  values (active_tenant, auth.uid(), v_email);

  update public.invitations
     set email_sent_at = now()
   where id = v_invitation.id
  returning email_sent_at into v_invitation.email_sent_at;

  select left(regexp_replace(btrim(t.name), '\s+', ' ', 'g'), 60)
    into v_account
    from public.tenants t where t.id = active_tenant;

  -- Зовёт тот, кто нажал: директор от своего имени, а не от владельца.
  select left(regexp_replace(coalesce(
           nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
           split_part(u.email, '@', 1)
         ), '\s+', ' ', 'g'), 60)
    into v_inviter
    from auth.users u
   where u.id = auth.uid();

  return jsonb_build_object(
    'email', v_invitation.email,
    'token', v_invitation.token,
    'account', v_account,
    'inviter', v_inviter,
    'teams', to_jsonb(v_teams),
    'expires_at', v_invitation.expires_at,
    'claimed_at', v_invitation.email_sent_at
  );
end;
$function$;

revoke all on function public.claim_invitation_email(uuid) from public, anon;
grant execute on function public.claim_invitation_email(uuid) to authenticated;

do $guard$
begin
  if has_table_privilege('authenticated', 'public.invitation_email_log', 'select')
     or has_table_privilege('authenticated', 'public.invitation_email_log', 'delete')
     or has_table_privilege('anon', 'public.invitation_email_log', 'select') then
    raise exception 'сторож: журнал писем-приглашений открыт наружу';
  end if;
  if has_function_privilege('anon', 'public.claim_invitation_email(uuid)', 'execute') then
    raise exception 'сторож: claim_invitation_email исполнима без входа';
  end if;
  if position('invitation_email_log' in (select prosrc from pg_proc where oid = 'public.claim_invitation_email(uuid)'::regprocedure)) = 0 then
    raise exception 'сторож: лимиты писем не на журнале';
  end if;
end
$guard$;
