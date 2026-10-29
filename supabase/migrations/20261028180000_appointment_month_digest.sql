-- ОТПЕЧАТОК ЗАПИСЕЙ ПО МЕСЯЦАМ — СВЕРКА БЕЗ ПОЛНОГО ЧТЕНИЯ (035 пачка 6, П2).
--
-- Каждая сверка календаря тянула `appointments select=*` всего аккаунта
-- (≈1 кБ на строку). При переносе истории из Bumpix это мегабайты на каждый
-- старт и возврат в приложение. Теперь телефон спрашивает дельту
-- (`updated_at` новее метки) и отпечаток по месяцам; целиком перечитывается
-- только месяц, отпечаток которого разошёлся с кэшем. Так ловится всё, что
-- дельта не видит: удаление (любым путём, и мимо корзины), запись, ставшая
-- невидимой партнёру, пропущенная дельта.
--
-- ОТПЕЧАТОК — СУММА ХЭШЕЙ СТРОК ПО МОДУЛЮ P = 2^31 − 1. Не md5: телефон
-- считает тот же отпечаток по своему кэшу, а библиотеки хэшей в приложении
-- нет. Хэш строки — от `id` и `updated_at` (микросекунды), целочисленный:
--   c0..c3 = четыре 32-битных куска hex `id`,
--   u      = updated_at в микросекундах с 1970 года,
--   h      = (c0·M0 + c1·M1 + c2·M2 + c3·M3 + u·M4) mod P, каждое слагаемое mod P.
-- Тот же расчёт в приложении — `packages/shared/src/sync/appointment-digest.ts`;
-- совпадение держит `appointment-digest.test.ts` на строках, посчитанных этой
-- функцией. Месяц — `left(date, 7)` (дата записи, а не правки).
--
-- ПРАВА — ЧИТАЮЩЕГО: `security invoker`, строки идут под RLS вызывающего,
-- поэтому отпечаток равен отпечатку того, что он получил бы полным чтением.
-- Мастер читает записи безопасной функцией (`list_master_appointments_safe`),
-- напрямую ему RLS не отдаёт ничего — у него сверка остаётся прежней.
--
-- ИНДЕКС ДЛЯ ДЕЛЬТЫ: `(tenant_id, updated_at, id)` — чтение «новее метки» в
-- порядке (updated_at, id). Для месяцев хватает `idx_appointments_tenant_date`.

create index if not exists idx_appointments_tenant_updated
  on public.appointments (tenant_id, updated_at, id);

create or replace function public.appointment_month_digest(p_tenant uuid)
returns table (month text, n integer, digest bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with h as (
    select left(a.date, 7) as month,
           replace(a.id::text, '-', '') as hex,
           (extract(epoch from a.updated_at) * 1000000)::bigint as u
      from public.appointments a
     where a.tenant_id = p_tenant
  ), r as (
    select h.month,
           (  ((('x' || lpad(substr(h.hex,  1, 8), 16, '0'))::bit(64)::bigint % 2147483647) * 16777619 % 2147483647)
            + ((('x' || lpad(substr(h.hex,  9, 8), 16, '0'))::bit(64)::bigint % 2147483647) * 805306457 % 2147483647)
            + ((('x' || lpad(substr(h.hex, 17, 8), 16, '0'))::bit(64)::bigint % 2147483647) * 1610612741 % 2147483647)
            + ((('x' || lpad(substr(h.hex, 25, 8), 16, '0'))::bit(64)::bigint % 2147483647) * 402653189 % 2147483647)
            + ((h.u % 2147483647) * 201326611 % 2147483647)
           ) % 2147483647 as row_hash
      from h
  )
  select r.month, count(*)::integer, (sum(r.row_hash) % 2147483647)::bigint
    from r
   group by r.month
   order by r.month
$$;

revoke all on function public.appointment_month_digest(uuid) from public, anon;
grant execute on function public.appointment_month_digest(uuid) to authenticated;

comment on function public.appointment_month_digest(uuid) is
  'Отпечаток записей по месяцам (left(date,7)): число и сумма хэшей (id, updated_at) mod 2^31-1, под RLS вызывающего. Телефон перечитывает только разошедшиеся месяцы (sync/appointment-digest.ts).';
