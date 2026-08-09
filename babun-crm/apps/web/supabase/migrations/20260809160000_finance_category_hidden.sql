-- «ЭТА КАТЕГОРИЯ МНЕ НЕ НУЖНА».
--
-- Стандартные категории общие на весь продукт (tenant_id is null), поэтому
-- RLS не даёт их ни переименовать, ни удалить — иначе один тенант правил бы
-- список всем остальным. Но и терпеть в своём списке чужие строки нельзя:
-- владелец просил, чтобы список менялся полностью.
--
-- Скрытие — это ЛИЧНОЕ отношение тенанта к общей строке. История не страдает:
-- операции, уже отнесённые к скрытой категории, продолжают показывать её имя,
-- скрытая строка просто не предлагается при выборе.

create table if not exists finance_category_hidden (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  category_id uuid not null references finance_categories(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, category_id)
);

alter table finance_category_hidden enable row level security;

drop policy if exists finance_category_hidden_owner_all on finance_category_hidden;
create policy finance_category_hidden_owner_all on finance_category_hidden
  for all to authenticated
  using (tenant_id = current_tenant_id() and current_user_role() = 'owner')
  with check (tenant_id = current_tenant_id() and current_user_role() = 'owner');

comment on table finance_category_hidden is
  'Скрытые для тенанта категории. Строка есть = категория не предлагается в выборе.';
