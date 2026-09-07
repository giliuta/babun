-- Одна живая ссылка на клиента. Новая ссылка «Попросить адрес у клиента»
-- гасит прежние неиспользованные: в карточке иначе копились строки «Ждём
-- адрес» по одному клиенту, а диспетчер не понимал, какая из них у клиента.
-- «Поделиться ещё раз» новую ссылку не выписывает — тот же токен.
create or replace function public.location_request_create(p_client_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_token text;
begin
  if auth.uid() is null or v_tenant is null
     or public.current_user_role() not in ('owner', 'dispatcher') then
    raise exception 'Ссылку выписывает владелец или диспетчер'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.clients c where c.id = p_client_id and c.tenant_id = v_tenant
  ) then
    raise exception 'Клиент не найден' using errcode = '23503';
  end if;
  delete from public.location_requests
   where client_id = p_client_id and tenant_id = v_tenant and used_at is null;
  -- 24 байта → 32 символа base64url, без «=». pgcrypto живёт в схеме
  -- extensions, поэтому она в search_path выше.
  v_token := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.location_requests (tenant_id, client_id, token, created_by)
  values (v_tenant, p_client_id, v_token, auth.uid());
  return v_token;
end $$;
