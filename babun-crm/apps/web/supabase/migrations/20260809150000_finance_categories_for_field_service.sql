-- КАТЕГОРИИ ПОД ВЫЕЗДНОЙ СЕРВИС, А НЕ ПОД ДЕМО.
--
-- Было пять расходных категорий (Еда, Зарплата, Материалы, Топливо, Иное) —
-- в них не помещается ничего из того, на что реально уходят деньги бригады:
-- аренда склада, ремонт машины, инструмент, налоги, банк, субподряд.
-- Владелец 2026-08-09: «сделать категории правильных расходов и категории
-- доходов, чтоб это можно было всё менять в настройках».
--
-- Добавляем, а НЕ переименовываем: у старых категорий уже есть операции, и
-- переписывать им название задним числом — менять историю.
--
-- Цвет проставляем всем: в выборе категория читается точкой, а серые точки
-- ничего не различают.

insert into finance_categories (tenant_id, slug, name, type, icon, color)
values
  (null, 'rent',        'Аренда',            'expense', null, '#A2845E'),
  (null, 'vehicle',     'Машина и ремонт',   'expense', null, '#FF9500'),
  (null, 'tools',       'Инструмент',        'expense', null, '#5856D6'),
  (null, 'subcontract', 'Субподряд',         'expense', null, '#BF5AF2'),
  (null, 'marketing',   'Реклама',           'expense', null, '#FF2D55'),
  (null, 'taxes',       'Налоги и сборы',    'expense', null, '#FF3B30'),
  (null, 'bank_fee',    'Комиссия банка',    'expense', null, '#8E8E93'),
  (null, 'comms',       'Связь и интернет',  'expense', null, '#32ADE6'),
  (null, 'insurance',   'Страховка',         'expense', null, '#30B0C7')
on conflict do nothing;

update finance_categories set color = '#FF9500' where tenant_id is null and slug = 'fuel'      and color is null;
update finance_categories set color = '#5856D6' where tenant_id is null and slug = 'supplies'  and color is null;
update finance_categories set color = '#007AFF' where tenant_id is null and slug = 'salary'    and color is null;
update finance_categories set color = '#FFCC00' where tenant_id is null and slug = 'food'      and color is null;
update finance_categories set color = '#8E8E93' where tenant_id is null and slug = 'other_exp' and color is null;
update finance_categories set color = '#34C759' where tenant_id is null and slug = 'services'  and color is null;
update finance_categories set color = '#00C7BE' where tenant_id is null and slug = 'goods'     and color is null;
update finance_categories set color = '#AF52DE' where tenant_id is null and slug = 'tips'      and color is null;
update finance_categories set color = '#FF3B30' where tenant_id is null and slug = 'refund'    and color is null;
update finance_categories set color = '#8E8E93' where tenant_id is null and slug = 'other_inc' and color is null;
