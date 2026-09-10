-- ДОЛГ КАК СУЩНОСТЬ (STORY-080). До этой миграции долг был не строкой, а
-- ВЫЧИСЛЕНИЕМ: работа сделана, деньги не пришли. Отсюда две дыры, о которых
-- сказал владелец:
--
--   «Вася должен мне €100» без визита — записать негде, и кнопка «Добавить
--   долг» уводила в форму записи (2026-09-10: «зачем нам открывать форму
--   записи»).
--
--   «Я должен Gree €900» за кондиционеры, взятые до оплаты (2026-09-08) —
--   записать негде вовсе: тип операции знает только доход, расход, перевод и
--   возврат, и за 137 миграций не расширялся.
--
-- Обе — об одном: долг умел рождаться только из записи. Здесь он получает
-- собственную строку с направлением: «мне должны» и «я должен» — одна форма,
-- одна арифметика, разное только направление.
--
-- ДОЛГ — НЕ ДЕНЬГИ. Он не доход и не расход и в прибыль не входит никогда;
-- в прибыль входит ПЛАТЁЖ по нему — обычная операция с `debt_id`. Поэтому в
-- момент, когда Gree выдал кондиционеры, со счёта ничего не уходит и «Расход»
-- не врёт, а в момент оплаты появляется настоящее движение денег. Закон
-- `expense` = «уже случившееся движение денег» остаётся цел, и жёсткий триггер
-- assert_finance_transaction_integrity переписывать не нужно.
--
-- Статуса «погашен» здесь нет НАРОЧНО: остаток считается как сумма минус
-- привязанные операции, ровно как долг записи. Колонка статуса разъезжается с
-- деньгами на первой же правке — это уже было с плиткой и списком долгов.

create table if not exists public.debts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  -- «incoming» — должны НАМ, «outgoing» — должны МЫ.
  direction    text not null check (direction in ('incoming', 'outgoing')),
  -- Кто. Клиент из справочника либо свободное имя: поставщик, магазин,
  -- сосед. Имя хранится ВСЕГДА — клиента могли удалить, а долг остаётся.
  client_id    uuid references public.clients(id) on delete set null,
  counterparty text not null check (length(btrim(counterparty)) > 0),
  amount       numeric not null check (amount > 0),
  currency     text not null default 'EUR',
  -- Категории у долгов СВОИ (владелец 2026-09-10: «под расход свои, под доход
  -- свои, под долги свои, они не смешиваются») — см. расширение CHECK ниже.
  category_id  uuid references public.finance_categories(id) on delete set null,
  note         text,
  occurred_on  date not null,
  team_id      text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Списки долгов режутся тенантом и направлением, сортируются по дню.
create index if not exists idx_debts_tenant_direction
  on public.debts (tenant_id, direction, occurred_on desc);

alter table public.debts enable row level security;

drop policy if exists debts_read on public.debts;
create policy debts_read on public.debts
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  );

drop policy if exists debts_insert on public.debts;
create policy debts_insert on public.debts
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  );

drop policy if exists debts_update on public.debts;
create policy debts_update on public.debts
  for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  );

drop policy if exists debts_delete on public.debts;
create policy debts_delete on public.debts
  for delete to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  );

-- Права роли приложения: политики решают, ЧТО видно, а grant — можно ли
-- обращаться к таблице вообще. Без него RLS не спасёт: запрос упрётся в отказ
-- прав раньше политики (поймано сухим прогоном 2026-09-10).
grant select, insert, update, delete on public.debts to authenticated;

-- ─── Платёж по долгу — обычная операция ──────────────────────────────────────
-- `on delete set null`, а не cascade: удалив долг, деньги не стирают. Платёж
-- случился, он лежит на счёте и в прибыли; он просто перестаёт быть привязан.
alter table public.finance_transactions
  add column if not exists debt_id uuid references public.debts(id) on delete set null;

create index if not exists idx_finance_transactions_debt
  on public.finance_transactions (debt_id)
  where debt_id is not null;

-- ─── Третий вид категорий ────────────────────────────────────────────────────
-- Категории долгов не смешиваются с доходными и расходными: у долга свой
-- справочник (поставщики, займы), и подмешивать в него «Бензин» нельзя.
alter table public.finance_categories
  drop constraint if exists finance_categories_type_check;
alter table public.finance_categories
  add constraint finance_categories_type_check
  check (type = any (array['income'::text, 'expense'::text, 'debt'::text]));

-- ПРОВЕРЕНО СУХИМ ПРОГОНОМ на боевой базе (begin/rollback, 2026-09-10):
-- владелец заводит и читает долг; чужое направление, пустой контрагент и
-- отрицательная сумма отвергнуты; платёж с `debt_id` записывается и даёт
-- остаток 900 − 300 = 600; удаление долга снимает связь, а деньги остаются;
-- категория вида «debt» принята, «whatever» отвергнута; чужой тенант не видит
-- долгов и не может их завести.
--
-- Прогон заодно напомнил два ограничения леджера, важных для формы: АВТО-
-- операцию (зеркало записи) править нельзя — платёж по долгу заводится новой
-- ручной строкой; и триггер целостности требует счёт, команду и способ оплаты.

comment on table public.debts is
  'Долг с направлением: incoming — должны нам, outgoing — должны мы. Не деньги: в прибыль входит платёж по нему (finance_transactions.debt_id), а не сам долг.';
