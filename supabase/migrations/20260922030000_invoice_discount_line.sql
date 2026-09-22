-- СКИДКА В ИНВОЙСЕ — ТАК ЖЕ, КАК В ЗАПИСИ.
--
-- Владелец 22.09: «в „Итого“ нет скидки — в записи клиента она есть, должно
-- прописываться и в инвойсе, можно выдавать скидку». Шторка «Итого» у
-- инвойса та же, что у записи и чека; сервер же не принимал строку с
-- отрицательной ценой, и скидку было нечем записать.
--
-- Скидка — ОДНА СТРОКА СЧЁТА С ФЛАГОМ `discount`: количество 1, цена
-- отрицательная, название «Скидка» / «Discount» на языке бумаги. Налог
-- считается с суммы ПОСЛЕ скидки — как у записи и у чека. Отдельной колонки
-- нет: бумага печатает скидку строкой, и выставленный документ хранит её
-- ровно так, как она напечатана.
--
-- Правка — точечная замена в ЖИВЫХ телах `issue_invoice` и
-- `update_invoice_draft` (оба переопределялись несколькими миграциями;
-- переписывать их по памяти нельзя). Сигнатуры, умолчания и права не
-- меняются: `create or replace` с тем же заголовком.

begin;

set local lock_timeout = '5s';

do $migration$
declare
  fn text;
  body text;
  patched text;
  old_check constant text :=
    '    if unit_price_value is null or unit_price_value < 0 or unit_price_value > 999999999 then';
  new_check constant text :=
    '    if (line_item->>''discount'') = ''true'' then' || chr(10) ||
    '      -- Скидка: одна строка, количество 1, цена меньше нуля.' || chr(10) ||
    '      if unit_price_value is null or unit_price_value >= 0' || chr(10) ||
    '         or unit_price_value < -999999999 or qty_value <> 1 then' || chr(10) ||
    '        raise exception ''Некорректная скидка'';' || chr(10) ||
    '      end if;' || chr(10) ||
    '      discount_lines := discount_lines + 1;' || chr(10) ||
    '      if discount_lines > 1 then' || chr(10) ||
    '        raise exception ''Скидка в инвойсе может быть только одна'';' || chr(10) ||
    '      end if;' || chr(10) ||
    '    elsif unit_price_value is null or unit_price_value < 0 or unit_price_value > 999999999 then';
  old_decl constant text := '  line_count integer := 0;';
  new_decl constant text := '  line_count integer := 0;' || chr(10) || '  discount_lines integer := 0;';
begin
  foreach fn in array array['issue_invoice', 'update_invoice_draft'] loop
    select pg_get_functiondef(p.oid) into body
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = fn;
    if body is null then
      raise exception '% not found', fn;
    end if;
    -- Ровно одно вхождение каждого якоря — иначе замена легла бы не туда.
    if (length(body) - length(replace(body, old_check, ''))) / length(old_check) <> 1 then
      raise exception '%: price check anchor not unique', fn;
    end if;
    if (length(body) - length(replace(body, old_decl, ''))) / length(old_decl) <> 1 then
      raise exception '%: declare anchor not unique', fn;
    end if;
    patched := replace(replace(body, old_check, new_check), old_decl, new_decl);
    execute patched;
  end loop;
end
$migration$;

-- Сторож: обе функции знают скидку и по-прежнему отбивают отрицательную
-- цену у обычной строки.
do $$
begin
  if (
    select count(*) from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname in ('issue_invoice', 'update_invoice_draft')
       and prosrc like '%discount_lines := discount_lines + 1;%'
       and prosrc like '%elsif unit_price_value is null or unit_price_value < 0%'
  ) <> 2 then
    raise exception 'invoice discount line is not wired into both invoice writers';
  end if;
end
$$;

commit;
