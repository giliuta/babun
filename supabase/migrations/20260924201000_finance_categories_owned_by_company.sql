-- КАТЕГОРИИ — СВОИ У КАЖДОЙ КОМПАНИИ (владелец 2026-09-24: «категорий вообще
-- не должно быть — клиент сам должен их создавать; может, у него вообще не
-- будет зарплаты или он по-другому хочет рассчитываться»; «при добавлении
-- категории надо понимать, что она должна делать — зарплата смотрит
-- сотрудников, другая прикрепляет клиента»).
--
-- 1. `attach` — что категория прикрепляет к операции: ничего, сотрудника
--    (`master_id`) или клиента (`client_id`). Выбирается при создании/правке.
-- 2. `retired` — общая готовая категория выведена из продукта: приложение её
--    не показывает и не предлагает. Строки НЕ удаляются — только гаснут.
-- 3. Готовые общие категории, которые компания уже использовала в операциях,
--    шаблонах или долгах, становятся ЕЁ собственными копиями (то же имя,
--    цвет, значок, вид), и ссылки переезжают на копии: история не теряет ни
--    одной подписи, а копию компания правит, скрывает и удаляет сама.
-- 4. Четыре служебные остаются общими и помечены `is_system`: ими подписывает
--    деньги сам сервер — «Услуги» (оплата записи), «Возврат», «Излишек» и
--    «Недостача» (пересчёт кассы). Человек их не выбирает.

alter table public.finance_categories
  add column if not exists attach text not null default 'none';

alter table public.finance_categories
  add column if not exists retired boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_categories'::regclass
       and conname = 'finance_categories_attach_check'
  ) then
    alter table public.finance_categories
      add constraint finance_categories_attach_check
      check (attach in ('none', 'employee', 'client'));
  end if;
end
$$;

update public.finance_categories
   set is_system = true
 where tenant_id is null
   and slug in ('services', 'refund', 'cash_surplus', 'cash_shortage');

create temp table _category_moves (
  tenant_id uuid not null,
  old_id uuid not null,
  new_id uuid not null
) on commit drop;

insert into _category_moves (tenant_id, old_id, new_id)
select distinct u.tenant_id, c.id, gen_random_uuid()
  from (
    select tenant_id, category_id from public.finance_transactions where category_id is not null
    union
    select tenant_id, category_id from public.finance_templates where category_id is not null
    union
    select tenant_id, category_id from public.debts where category_id is not null
  ) u
  join public.finance_categories c on c.id = u.category_id
 where c.tenant_id is null
   and not c.is_system;

insert into public.finance_categories (id, tenant_id, slug, name, type, icon, color, is_system, attach)
select m.new_id, m.tenant_id, c.slug, c.name, c.type, c.icon, c.color, false,
       case
         when c.slug in ('salary', 'debt_salary') then 'employee'
         when c.slug = 'debt_client' then 'client'
         else 'none'
       end
  from _category_moves m
  join public.finance_categories c on c.id = m.old_id;

-- ПЕРЕВЕШИВАНИЕ ССЫЛОК — ТОЛЬКО ПОДПИСЬ: та же компания, тот же вид, то же
-- имя. Сторожам журнала (закрытые счета, неизменяемые авто-строки) здесь
-- судить нечего, поэтому на время перевешивания их не зовём.
set local session_replication_role = replica;

update public.finance_transactions t
   set category_id = m.new_id
  from _category_moves m
 where t.tenant_id = m.tenant_id and t.category_id = m.old_id;

update public.finance_templates t
   set category_id = m.new_id
  from _category_moves m
 where t.tenant_id = m.tenant_id and t.category_id = m.old_id;

update public.debts d
   set category_id = m.new_id
  from _category_moves m
 where d.tenant_id = m.tenant_id and d.category_id = m.old_id;

update public.finance_category_order o
   set category_id = m.new_id
  from _category_moves m
 where o.tenant_id = m.tenant_id and o.category_id = m.old_id;

update public.finance_category_hidden h
   set category_id = m.new_id
  from _category_moves m
 where h.tenant_id = m.tenant_id and h.category_id = m.old_id;

set local session_replication_role = origin;

-- Общие несистемные гаснут для всего продукта.
update public.finance_categories
   set retired = true
 where tenant_id is null
   and not is_system;

-- СТОРОЖ: ни одна операция, шаблон или долг не смотрит на погашенную общую
-- категорию; служебные четыре на месте и живы.
do $$
declare
  n int;
begin
  select count(*) into n
    from (
      select category_id from public.finance_transactions
      union all select category_id from public.finance_templates
      union all select category_id from public.debts
    ) u
    join public.finance_categories c on c.id = u.category_id
   where c.retired;
  if n <> 0 then raise exception 'ссылки на погашенные категории остались: %', n; end if;
  select count(*) into n from public.finance_categories
   where tenant_id is null and is_system and not retired
     and slug in ('services', 'refund', 'cash_surplus', 'cash_shortage');
  if n <> 4 then raise exception 'служебных категорий не четыре: %', n; end if;
  select count(*) into n
    from public.finance_transactions t
    join public.finance_categories c on c.id = t.category_id
   where c.tenant_id is not null and c.tenant_id <> t.tenant_id;
  if n <> 0 then raise exception 'операция смотрит на категорию чужой компании: %', n; end if;
end
$$;
