-- ПОРЯДОК КАТЕГОРИЙ — ПО ТЕНАНТАМ (владелец 2026-09-10: «шесть точек справа для
-- передвижения… везде это добавь»).
--
-- Сами категории ГЛОБАЛЬНЫЕ: у всех 28 строк `tenant_id` пуст, справочник общий
-- на продукт. Колонка `position` в самой таблице переставляла бы список сразу у
-- всех компаний — поэтому порядок живёт отдельной таблицей на тенант, ровно как
-- скрытие (`finance_category_hidden`).
--
-- Строки нет — позиция ноль, дальше разводит имя: справочник, который никто не
-- перетаскивал, выглядит как раньше.

create table if not exists public.finance_category_order (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid not null references public.finance_categories(id) on delete cascade,
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, category_id)
);

alter table public.finance_category_order enable row level security;

drop policy if exists finance_category_order_owner_all on public.finance_category_order;
create policy finance_category_order_owner_all
  on public.finance_category_order
  for all
  using (tenant_id = public.current_tenant_id() and public.current_user_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_user_role() = 'owner');

comment on table public.finance_category_order is
  'Порядок категорий в справочнике — ПО ТЕНАНТАМ. Сами категории глобальные (tenant_id null), поэтому колонка position в них меняла бы порядок сразу у всех компаний; здесь у каждой свой. Скрытие устроено так же (finance_category_hidden).';
