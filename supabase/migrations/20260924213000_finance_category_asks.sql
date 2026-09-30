-- ЧТО КАТЕГОРИЯ СПРАШИВАЕТ В ОПЕРАЦИИ — НАБОРОМ, А НЕ ОДНИМ ВЫБОРОМ
-- (владелец 2026-09-24: «продумай, что вообще можно туда прикрепить ещё,
-- доработай и сделай на максимум»).
--
-- Вчерашний `attach` умел одно из трёх: ничего / сотрудник / клиент. Но
-- жизнь не делится так ровно: чаевые — это и клиент, который дал, и мастер,
-- которому досталось; топливо без фото чека бухгалтер не примет. Поэтому
-- три независимых флажка:
--   • ask_employee  — в операции есть «Кому» / «Сотрудник» (`master_id`);
--   • ask_client    — в операции есть «Клиент» (`client_id`); клиентская
--                     база — книга контактов, поставщик в ней тоже живёт;
--   • require_receipt — без фото чека операцию не сохранить.
-- Значения `attach` переезжают во флажки; сама колонка, заведённая сегодня
-- и никем, кроме этой волны, не читаемая, уходит.

alter table public.finance_categories
  add column if not exists ask_employee boolean not null default false,
  add column if not exists ask_client boolean not null default false,
  add column if not exists require_receipt boolean not null default false;

update public.finance_categories
   set ask_employee = (attach = 'employee'),
       ask_client = (attach = 'client')
 where attach in ('employee', 'client');

alter table public.finance_categories
  drop constraint if exists finance_categories_attach_check;

alter table public.finance_categories
  drop column if exists attach;

-- СТОРОЖ: «Зарплата» Giliuta, спрашивавшая сотрудника, спрашивает его и
-- теперь.
do $$
begin
  if exists (
    select 1 from public.finance_categories
     where tenant_id is not null and slug = 'salary' and not ask_employee
  ) then
    raise exception 'зарплата потеряла вопрос о сотруднике';
  end if;
end
$$;
