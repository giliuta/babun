-- ПИСЬМО-ПРИГЛАШЕНИЕ ПАРТНЁРУ С АДРЕСА BABUN (владелец 04.10: «выполняй всё»).
--
-- Партнёра зовут в приложении (`create_invitation`), и ему уходит письмо
-- «… приглашает вас в команду …» со ссылкой https://babun.app/invite/<токен>.
-- Письмо шлёт edge-функция `invite-email`, но решать «можно ли» ей не
-- доверено: она зовёт эту функцию КЛЮЧОМ ЗВОНЯЩЕГО.
--
-- Отложенная заготовка 14.09 (supabase/parked) переписана под порядок 04.10:
--   • звать может владелец аккаунта ИЛИ партнёр с правом «Партнёры»
--     (`company.partners`, директор) — тот же вход, что у `create_invitation`;
--   • приглашение зовёт в несколько команд (`team_ids`): письмо называет
--     живые, а без единой живой команды не уходит;
--   • не чаще раза в минуту на приглашение и не больше 30 писем в час на
--     аккаунт (отправка чужому адресу с адреса Babun — то, чем злоупотребляют);
--   • ставит `invitations.email_sent_at` и отдаёт ровно то, что нужно письму.
-- Токен звонящий и так получает из `create_invitation` — новой утечки нет.
-- Коды отказов — `hint` вида `invite_email:<причина>`; функция переводит их в
-- ответ приложению.

alter table public.invitations
  add column if not exists email_sent_at timestamptz;

create or replace function public.claim_invitation_email(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  active_tenant uuid := public.current_tenant_id();
  v_invitation public.invitations%rowtype;
  v_account text;
  v_inviter text;
  v_teams text[];
  v_sent_last_hour integer;
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

  select coalesce(array_agg(t.name order by x.ord), array[]::text[])
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

  if v_invitation.email_sent_at is not null
     and v_invitation.email_sent_at > now() - interval '60 seconds' then
    raise exception 'письмо уже отправлено, повторить можно через минуту'
      using errcode = '55000', hint = 'invite_email:too_soon';
  end if;

  select count(*) into v_sent_last_hour
    from public.invitations i
   where i.tenant_id = active_tenant
     and i.email_sent_at > now() - interval '1 hour';

  if v_sent_last_hour >= 30 then
    raise exception 'слишком много писем за час'
      using errcode = '55000', hint = 'invite_email:tenant_limit';
  end if;

  update public.invitations
     set email_sent_at = now()
   where id = v_invitation.id
  returning email_sent_at into v_invitation.email_sent_at;

  select t.name into v_account from public.tenants t where t.id = active_tenant;

  -- Зовёт тот, кто нажал: директор от своего имени, а не от владельца.
  select coalesce(
           nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
           split_part(u.email, '@', 1)
         )
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
