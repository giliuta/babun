-- ЖУРНАЛ ВЫДАЧИ СПИСКА КЛИЕНТОВ ПАРТНЁРУ (аудит 035, cab/R-05; решение 035).
--
-- С решения «видит клиента — видит номер» `list_member_clients` отдаёт
-- партнёру всех клиентов его окна с номерами одним вызовом. Журнал и предел,
-- которые держала прежняя дверь «по одному номеру» (`member_client_contacts`),
-- на эту выдачу не распространялись: выгрузку закрывал только экран.
--
-- Теперь каждая выдача СПИСКА (без `p_client_id`) не-владельцу пишется в
-- `client_list_disclosures`: кто, когда, сколько клиентов с открытыми
-- номерами получил. Это честное «кто сколько видел» для владельца; предел на
-- перебор по номеру — в `20261027225310_client_phone_lookup_limit.sql`.
--
-- Тело выдачи не меняется: прежняя функция переименована в
-- `list_member_clients_rows` (права и определитель — её), а
-- `list_member_clients` — тонкая обёртка с записью в журнал (VOLATILE).
-- Журнал старше 90 дней чистит pg_cron.

create table if not exists public.client_list_disclosures (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  clients_count integer not null,
  disclosed_at timestamptz not null default now()
);

comment on table public.client_list_disclosures is
  'Кто из партнёров когда получил список клиентов с номерами (list_member_clients) и сколько.';

create index if not exists client_list_disclosures_tenant_idx
  on public.client_list_disclosures (tenant_id, disclosed_at desc);

alter table public.client_list_disclosures enable row level security;
revoke all on table public.client_list_disclosures from public, anon, authenticated;

alter function public.list_member_clients(uuid) rename to list_member_clients_rows;
revoke all on function public.list_member_clients_rows(uuid) from public, anon, authenticated;

create or replace function public.list_member_clients(p_client_id uuid default null)
returns setof jsonb
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  given integer;
begin
  return query select x from public.list_member_clients_rows(p_client_id) x;
  get diagnostics given = row_count;
  if p_client_id is null and public.current_user_role() is distinct from 'owner' and auth.uid() is not null then
    insert into public.client_list_disclosures (tenant_id, user_id, clients_count)
    values (public.current_tenant_id(), auth.uid(), given);
  end if;
end;
$function$;

comment on function public.list_member_clients(uuid) is
  'Клиенты партнёра (тело — list_member_clients_rows); выдача списка пишется в client_list_disclosures.';

revoke all on function public.list_member_clients(uuid) from public, anon;
grant execute on function public.list_member_clients(uuid) to authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'client-list-disclosures-purge';
select cron.schedule('client-list-disclosures-purge', '29 4 * * *',
  $$delete from public.client_list_disclosures where disclosed_at < now() - interval '90 days'$$);
