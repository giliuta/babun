-- КОРЗИНЫ ЗАПИСЕЙ, ОПЕРАЦИЙ И КЛИЕНТОВ ЗНАЮТ ДРУГ О ДРУГЕ; ДОЛГ — ТОЖЕ
-- ИСТОРИЯ (аудит 035: dat/X-05, хвосты dat/X-07).
--
-- «История клиента» проверялась в четырёх местах одинаково узко — записи,
-- инвойсы, деньги:
--   • `client_history_never_purges` (корзина клиентов не стирает клиента с историей),
--   • `guard_client_hard_delete_history` и `guard_client_history_delete`
--     (стереть клиента с историей нельзя),
--   • `purge_expired_clients` (ночная чистка корзины клиентов).
-- Мимо проходили:
--   (а) запись клиента в «Удалённых записях»: удалить единственную запись →
--       удалить клиента → «Стереть навсегда» → «Вернуть» запись — она
--       возвращалась без клиента, молча (`deleted_appointment_ready` обнулял
--       `client_id`), а файлы клиента уже стёрты каскадом;
--   (б) долг: клиент с долгом без оплат стирался, `debts.client_id` уходил в
--       NULL — долг пропадал из карточки.
-- То же с операцией в «Удалённых операциях».
--
-- Теперь история — одна функция `client_has_history(клиент, с_корзинами)`:
--   • постоянная история — записи, инвойсы, деньги, долги: клиент не
--     стирается никогда (как было, плюс долги);
--   • корзины записей и операций держат клиента, пока лежат: стереть его
--     сейчас нельзя, ночная чистка пропускает его до следующей ночи, а
--     `purge_at` не обнуляется — через 30 дней запись уйдёт из ящика, и клиент
--     сотрётся следом.
--
-- Хвосты удаления (X-07):
--   • запись не возвращается в календарь, лежащий в архиве — отказ «верните
--     календарь» вместо записи в невидимом календаре;
--   • метки (`cities`), удалённые 30 дней назад, стирает сервер раз в сутки
--     (`purge_deleted_cities`); раньше это делал телефон по своим часам при
--     открытии экрана меток — со сбитыми часами раньше срока, без захода на
--     экран никогда. Клиентская зачистка (`usePurgeExpiredCities`) после
--     наката снимается отдельным шагом.

create or replace function public.client_has_history(p_client uuid, p_with_trash boolean default true)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (select 1 from public.appointments a where a.client_id = p_client)
      or exists (select 1 from public.invoices i where i.client_id = p_client)
      or exists (select 1 from public.finance_transactions f where f.client_id = p_client)
      or exists (select 1 from public.debts d where d.client_id = p_client)
      or (
        p_with_trash
        and (
          exists (select 1 from public.deleted_appointments da where da.appointment ->> 'client_id' = p_client::text)
          or exists (select 1 from public.deleted_operations dop where dop.operation ->> 'client_id' = p_client::text)
        )
      )
$function$;

comment on function public.client_has_history(uuid, boolean) is
  'История клиента: записи, инвойсы, деньги, долги; с p_with_trash — и записи/операции в «Удалённых».';

-- Внутренний помощник триггеров и ночной чистки — не для API.
revoke all on function public.client_has_history(uuid, boolean) from public, anon, authenticated;

create index if not exists deleted_appointments_client_idx
  on public.deleted_appointments ((appointment ->> 'client_id'));
create index if not exists deleted_operations_client_idx
  on public.deleted_operations ((operation ->> 'client_id'));
create index if not exists debts_client_id_idx on public.debts (client_id);

create or replace function public.client_history_never_purges()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- Постоянная история клиента в корзине не стирается никогда. Корзины
  -- записей и операций сюда не входят: они временные, и `purge_at` остаётся —
  -- ночная чистка просто подождёт, пока ящик опустеет.
  if new.purge_at is not null and public.client_has_history(new.id, false) then
    new.purge_at := null;
  end if;
  return new;
end;
$function$;

create or replace function public.guard_client_hard_delete_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not exists (
    select 1 from public.tenants t where t.id = old.tenant_id
  ) then
    return old;
  end if;

  if public.client_has_history(old.id, false) then
    raise exception 'client with history must be archived, not deleted'
      using errcode = '23503';
  end if;
  if public.client_has_history(old.id, true) then
    raise exception 'Запись или операция этого клиента лежит в «Удалённых» — сначала сотрите её или верните'
      using errcode = '23503', hint = 'client:history_in_trash';
  end if;

  return old;
end;
$function$;

create or replace function public.guard_client_history_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;
  if public.client_has_history(old.id, true) then
    raise exception 'Клиента с заявками или финансовой историей нельзя удалить';
  end if;
  return old;
end;
$function$;

create or replace function public.purge_expired_clients()
returns integer
language plpgsql
set search_path = public
as $function$
declare
  removed integer;
begin
  delete from public.clients c
   where c.purge_at is not null
     and c.purge_at <= now()
     and not public.client_has_history(c.id, true);
  get diagnostics removed = row_count;
  return removed;
end;
$function$;

do $migration$
declare
  d text := pg_get_functiondef('public.deleted_appointment_ready(jsonb)'::regprocedure);
  anchor constant text := E'  if ready->>''client_id'' is not null and not exists (';
  block constant text := E'  -- Календарь в архиве: запись встала бы туда, где её никто не видит.\n'
    || E'  if ready->>''team_id'' is not null and exists (\n'
    || E'    select 1 from public.teams t\n'
    || E'     where t.tenant_id = tenant and t.id = ready->>''team_id'' and not t.is_active\n'
    || E'  ) then\n'
    || E'    raise exception ''Календарь этой записи в архиве — сначала верните календарь''\n'
    || E'      using errcode = ''23503'', hint = ''appointment:team_archived'';\n'
    || E'  end if;\n';
begin
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'deleted_appointment_ready: якорь client_id не найден ровно один раз';
  end if;
  execute replace(d, anchor, block || anchor);
end;
$migration$;

create or replace function public.purge_deleted_cities()
returns integer
language plpgsql
set search_path = public
as $function$
declare
  removed integer;
begin
  delete from public.cities c
   where c.deleted_at is not null
     and c.deleted_at < now() - interval '30 days';
  get diagnostics removed = row_count;
  return removed;
end;
$function$;

comment on function public.purge_deleted_cities() is
  'Окончательно стирает метки, удалённые больше 30 дней назад (pg_cron раз в сутки).';

revoke all on function public.purge_deleted_cities() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'purge-deleted-cities';
select cron.schedule('purge-deleted-cities', '7 4 * * *', 'select public.purge_deleted_cities();');
