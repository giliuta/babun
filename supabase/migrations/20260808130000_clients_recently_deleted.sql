-- «Недавно удалённые» как в Фото на iPhone: удаление не стирает клиента,
-- а кладёт его в корзину на 30 дней.
--
-- Разница между архивом и корзиной — одна колонка:
--   deleted_at есть, purge_at пуст  → АРХИВ (бессрочно, «больше не работаем»)
--   deleted_at есть, purge_at стоит → КОРЗИНА (сотрётся в эту дату)
-- Отдельная таблица не нужна: клиент остаётся клиентом со своей историей,
-- меняется только его видимость.

alter table public.clients
  add column if not exists purge_at timestamptz;

comment on column public.clients.purge_at is
  'Когда клиента сотрут навсегда (корзина «Недавно удалённые»). NULL у активных и у архивных.';

-- Читается только корзиной: частичный индекс не трогает основной список.
create index if not exists clients_purge_at_idx
  on public.clients (tenant_id, purge_at)
  where purge_at is not null;

-- ЕЖЕДНЕВНАЯ ОЧИСТКА.
-- Клиента с заявками, инвойсами или деньгами стереть нельзя — это запрещает
-- триггер guard_client_hard_delete_history, и правильно: за ним чужая
-- финансовая история. Такой клиент в корзину и не попадает (интерфейс
-- предлагает ему только архив), но условия повторены здесь: одна защищённая
-- строка иначе уронила бы весь DELETE, и корзина не чистилась бы никогда.
create or replace function public.purge_expired_clients()
returns integer
language plpgsql
set search_path to 'public'
as $$
declare
  removed integer;
begin
  delete from public.clients c
   where c.purge_at is not null
     and c.purge_at <= now()
     and not exists (select 1 from public.appointments a where a.client_id = c.id)
     and not exists (select 1 from public.invoices i where i.client_id = c.id)
     and not exists (select 1 from public.finance_transactions f where f.client_id = c.id);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Ночью, когда никто не работает. Задание идемпотентно: пере-планирование
-- по тому же имени заменяет расписание, а не заводит второе.
select cron.schedule(
  'purge-expired-clients',
  '17 3 * * *',
  $$select public.purge_expired_clients();$$
);
