-- ПОИСК КЛИЕНТА ПО НОМЕРУ — НЕ БОЛЬШЕ 100 НОМЕРОВ В СУТКИ НА ЧЕЛОВЕКА
-- (аудит 035, srv/S-08; предел — решение 035 по смете).
--
-- `member_find_client_by_phone` отдаёт партнёру с правом «Создание записи»
-- имя клиента ВСЕЙ компании по полному номеру — так партнёр записывает
-- клиента любой команды (решение владельца, его не трогаем). Но вызовы не
-- считались: скрипт перебором кипрских мобильных за сутки-двое снял бы всю
-- базу «номер → имя».
--
-- Теперь сервер помнит, какие номера человек искал за последние сутки
-- (`client_phone_lookups`: только отпечаток номера, не сам номер), и сотый
-- разный номер — последний: дальше отказ «попробуйте завтра». Повтор того же
-- номера предел не тратит. Владельцу компании предела нет. Функция
-- становится VOLATILE — она теперь пишет журнал.
--
-- Тело правится по якорям в живом определении: волатильность и вставка
-- перед поиском клиента.

create table if not exists public.client_phone_lookups (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  phone_hash text not null,
  looked_up_at timestamptz not null default now()
);

comment on table public.client_phone_lookups is
  'Журнал поисков клиента по номеру (member_find_client_by_phone) за сутки — предел 100 номеров на человека.';

create index if not exists client_phone_lookups_user_idx
  on public.client_phone_lookups (user_id, tenant_id, looked_up_at);

alter table public.client_phone_lookups enable row level security;
revoke all on table public.client_phone_lookups from public, anon, authenticated;

do $migration$
declare
  d text := pg_get_functiondef('public.member_find_client_by_phone(text, text)'::regprocedure);
  vol_old constant text := E' STABLE SECURITY DEFINER\n';
  vol_new constant text := E' VOLATILE SECURITY DEFINER\n';
  anchor constant text := E'  select c.* into hit\n    from public.clients c\n';
  block constant text := E'  -- Предел перебора: не больше 100 разных номеров за сутки (кроме владельца).\n'
    || E'  if caller_role is distinct from ''owner'' then\n'
    || E'    delete from public.client_phone_lookups l\n'
    || E'     where l.user_id = auth.uid() and l.looked_up_at < now() - interval ''1 day'';\n'
    || E'    if not exists (\n'
    || E'      select 1 from public.client_phone_lookups l\n'
    || E'       where l.user_id = auth.uid() and l.tenant_id = active_tenant\n'
    || E'         and l.phone_hash = md5(p_phone_e164)\n'
    || E'    ) then\n'
    || E'      if (select count(distinct l.phone_hash) from public.client_phone_lookups l\n'
    || E'           where l.user_id = auth.uid() and l.tenant_id = active_tenant) >= 100 then\n'
    || E'        raise exception ''Слишком много поисков клиента по номеру за сутки — попробуйте завтра''\n'
    || E'          using errcode = ''P0001'', hint = ''access:phone_lookup_limit'';\n'
    || E'      end if;\n'
    || E'      insert into public.client_phone_lookups (tenant_id, user_id, phone_hash)\n'
    || E'      values (active_tenant, auth.uid(), md5(p_phone_e164));\n'
    || E'    end if;\n'
    || E'  end if;\n\n';
begin
  if (length(d) - length(replace(d, vol_old, ''))) / length(vol_old) <> 1 then
    raise exception 'member_find_client_by_phone: якорь STABLE не найден ровно один раз';
  end if;
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'member_find_client_by_phone: якорь поиска клиента не найден ровно один раз';
  end if;
  execute replace(replace(d, vol_old, vol_new), anchor, block || anchor);
end;
$migration$;
