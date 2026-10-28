-- ОНЛАЙН-ЗАПИСЬ: НОВАЯ ССЫЛКА (пачка 6, С5).
--
-- Токен страницы /b/<токен> выдавался один раз и навсегда: попавшую в спам
-- или к недобросовестному человеку ссылку нельзя было отозвать, только
-- выключить запись целиком. `online_booking_new_link` — владельцу календаря:
-- новый токен, старая ссылка сразу отвечает «не найдена». Ответ — свежие
-- настройки, как у `online_booking_set`. Страницы ещё нет — выпускать нечего,
-- ответ прежний.

create or replace function public.online_booking_new_link(p_team text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant uuid := public.online_booking_owner_tenant(p_team);
begin
  if v_tenant is null then
    raise exception 'Онлайн-запись настраивает владелец' using errcode = '42501', hint = 'access:owner';
  end if;
  update public.online_booking_pages
     set token = public.appointment_link_token(), updated_at = now()
   where team_id = p_team and tenant_id = v_tenant;
  return public.online_booking_settings(p_team);
end;
$function$;

revoke execute on function public.online_booking_new_link(text) from public, anon;
grant execute on function public.online_booking_new_link(text) to authenticated;

do $guard$
begin
  if has_function_privilege('anon', 'public.online_booking_new_link(text)', 'execute') then
    raise exception 'online_booking_new_link исполним для anon';
  end if;
  if not has_function_privilege('authenticated', 'public.online_booking_new_link(text)', 'execute') then
    raise exception 'online_booking_new_link закрыт для владельца';
  end if;
end;
$guard$;
