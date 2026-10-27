-- УБОРЩИК STORAGE: СПИСОК «НЕ ТРОГАТЬ» И КРОН, КОТОРЫЙ ВСТАЁТ ВЫКЛЮЧЕННЫМ
-- (035, 27.10).
--
-- `storage_janitor_candidates` (20261027224300) отдаёт на снос файлы живой
-- компании, на которые не ссылается ни одна строка, — старше 2 дней. На
-- боевой под это попадают 3 файла Giliuta из августа: 2 чека и логотип.
-- Ссылок на них нет нигде, но владелец их не удалял. Решение 035: не трогать.
--
-- `storage_janitor_keep` — файлы, которые уборщик не берёт, пока компания
-- жива. Компанию удалили — её файлы уходят и из этого списка: удаление
-- аккаунта должно стирать всё. Список читает и пишет только сервер.
--
-- Крон `storage-janitor` после этой миграции выключен. Первый запуск —
-- руками в режиме `{"mode":"dry"}`, с показом списка владельцу; крон
-- включает `cron.alter_job(…, active := true)` по его слову.
--
-- Тело `storage_janitor_candidates` правится по якорю в живом определении,
-- поэтому накат — только после 20261027224300.

do $order$
begin
  if to_regprocedure('public.storage_janitor_candidates(integer, interval)') is null
     or not exists (select 1 from cron.job where jobname = 'storage-janitor') then
    raise exception 'Сначала накатить 20261027224300_storage_janitor';
  end if;
end;
$order$;

create table if not exists public.storage_janitor_keep (
  bucket_id text not null,
  name text not null,
  reason text not null,
  kept_at timestamptz not null default now(),
  primary key (bucket_id, name)
);

comment on table public.storage_janitor_keep is
  'Файлы живой компании, которые storage-janitor не сносит, хотя ссылок на них нет.';

alter table public.storage_janitor_keep enable row level security;
revoke all on table public.storage_janitor_keep from public, anon, authenticated;

insert into public.storage_janitor_keep (bucket_id, name, reason) values
  ('receipts', '11365a87-bef9-4f6c-a030-b15083fe646b/cde75144-9dcc-4ee7-a92e-6c2b63c11736.jpg',
   'Giliuta: чек от 09.08 без ссылки, владелец не удалял'),
  ('receipts', '11365a87-bef9-4f6c-a030-b15083fe646b/db4b06ec-a585-429b-9f34-b9c1b56c6a2d.heic',
   'Giliuta: чек от 09.08 без ссылки, владелец не удалял'),
  ('tenant-logos', '11365a87-bef9-4f6c-a030-b15083fe646b/37381e76-ca65-44d4-adce-8c2be13d393e.jpg',
   'Giliuta: логотип от 10.08 без ссылки, владелец не удалял')
on conflict (bucket_id, name) do nothing;

do $migration$
declare
  d text := pg_get_functiondef('public.storage_janitor_candidates(integer, interval)'::regprocedure);
  anchor constant text := E'   where c.reason is not null\n';
  replacement constant text := E'   where c.reason is not null\n'
    || E'     -- Список «не трогать» держит файл, пока компания жива.\n'
    || E'     and (c.reason = ''tenant_gone'' or not exists (\n'
    || E'       select 1 from public.storage_janitor_keep k\n'
    || E'        where k.bucket_id = c.bucket_id and k.name = c.name\n'
    || E'     ))\n';
begin
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'storage_janitor_candidates: якорь «where c.reason is not null» не найден ровно один раз';
  end if;
  execute replace(d, anchor, replacement);
end;
$migration$;

select cron.alter_job(j.jobid, active := false)
  from cron.job j
 where j.jobname = 'storage-janitor';

do $guard$
begin
  if exists (
    select 1
      from public.storage_janitor_candidates(1000) c
      join public.storage_janitor_keep k on k.bucket_id = c.bucket_id and k.name = c.name
     where c.reason <> 'tenant_gone'
  ) then
    raise exception 'storage janitor: файл из списка «не трогать» всё ещё идёт на снос';
  end if;
  if exists (select 1 from cron.job where jobname = 'storage-janitor' and active) then
    raise exception 'storage janitor: крон должен встать выключенным';
  end if;
  if has_function_privilege('authenticated', 'public.storage_janitor_candidates(integer, interval)', 'execute')
     or has_function_privilege('anon', 'public.storage_janitor_candidates(integer, interval)', 'execute') then
    raise exception 'storage janitor: candidates must stay service-only';
  end if;
end;
$guard$;
