-- ПИСЬМО-ПРИГЛАШЕНИЕ: ДАННЫЕ ДЛЯ ПИСЬМА ОТДАЁТ СЕРВЕР, ОН ЖЕ ДЕРЖИТ ЛИМИТЫ.
--
-- Решение владельца 14.09: приглашение уходит письмом с адреса Babun, а не
-- только ссылкой «Поделиться». Письмо шлёт edge-функция `invite-email`, но
-- решать «можно ли» ей не доверено: она зовёт эту функцию ключом звонящего.
--
-- `claim_invitation_email(p_invitation_id)`:
--   • только владелец активной компании и только приглашение этой компании;
--   • только открытое приглашение: не принято, не истекло, календарь не в архиве;
--   • не чаще раза в минуту на приглашение и не больше 30 писем в час на компанию
--     (отправка чужому адресу с адреса Babun — это то, что злоупотребляют);
--   • ставит `invitations.email_sent_at` и отдаёт ровно то, что нужно письму.
-- Токен владелец и так получает из `create_invitation`, новой утечки нет.
--
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
  v_company text;
  v_inviter text;
  v_calendar text;
  v_sent_last_hour integer;
begin
  if auth.uid() is null
     or active_tenant is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'письмо приглашения отправляет владелец'
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

  if v_invitation.team_id is not null and not exists (
    select 1 from public.teams t
     where t.tenant_id = active_tenant
       and t.id = v_invitation.team_id
       and t.is_active
  ) then
    raise exception 'календарь приглашения в архиве'
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

  select t.name into v_company from public.tenants t where t.id = active_tenant;

  select coalesce(
           nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
           split_part(u.email, '@', 1)
         )
    into v_inviter
    from auth.users u
   where u.id = coalesce(v_invitation.invited_by_user_id, auth.uid());

  select t.name into v_calendar
    from public.teams t
   where t.tenant_id = active_tenant and t.id = v_invitation.team_id;

  return jsonb_build_object(
    'email', v_invitation.email,
    'token', v_invitation.token,
    'company', v_company,
    'inviter', v_inviter,
    'role', v_invitation.role,
    'calendar', v_calendar,
    'expires_at', v_invitation.expires_at,
    'claimed_at', v_invitation.email_sent_at
  );
end;
$function$;

revoke all on function public.claim_invitation_email(uuid) from public, anon;
grant execute on function public.claim_invitation_email(uuid) to authenticated;
