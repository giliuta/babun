-- СТРОКА ВЫСТАВЛЕННОГО СЧЁТА ТЕРЯЛА ОПИСАНИЕ. И ПОТЕРЯЛА БЫ ЕДИНИЦУ.
--
-- Найдено 2026-08-25 при возврате единицы измерения. `invoice_lines.description`
-- завели 21 августа со всей дорогой — от услуги до бумаги, — и проверили
-- ГЛАЗАМИ на черновике: там строки берутся из формы, и описание печаталось.
-- А выставляет счёт серверная функция, и она перечисляет колонки поимённо:
--   insert into public.invoice_lines (invoice_id, position, title, qty, unit_price, total)
-- Описания в этом списке нет. На проде 5 строк счетов, и `description` пуст
-- у ВСЕХ ПЯТИ — до бумаги клиента он не доехал ни разу.
--
-- Единица (`unit`, добавлена сегодня) шла бы той же дорогой в никуда: в
-- черновике «4 м», в выставленном документе — снова голое «4».
--
-- ПОЧЕМУ ЗАМЕНОЙ ПОДСТРОКИ, А НЕ ПОЛНЫМ ТЕКСТОМ ФУНКЦИЙ. `issue_invoice` —
-- 11 000 знаков, `update_invoice_draft` — 7 700, и обе стерегут деньги:
-- идемпотентность запроса, блокировку строки счёта, пересчёт итогов, связь с
-- проводкой. Переписать их целиком ради двух колонок значит внести весь этот
-- текст в новую миграцию и отвечать за каждую строку. Здесь меняется ровно
-- один оператор, а если он окажется другим — миграция падает с внятной
-- ошибкой вместо тихой порчи.
do $$
declare
  target text;
  src text;
  patched text;
  old_block constant text :=
    'insert into public.invoice_lines (' || E'\n' ||
    '    invoice_id, position, title, qty, unit_price, total' || E'\n' ||
    '  )' || E'\n' ||
    '  select' || E'\n' ||
    '    invoice_row.id,' || E'\n' ||
    '    ordinality::integer - 1,' || E'\n' ||
    '    btrim(value->>''title''),';
  new_block constant text :=
    'insert into public.invoice_lines (' || E'\n' ||
    '    invoice_id, position, title, description, unit, qty, unit_price, total' || E'\n' ||
    '  )' || E'\n' ||
    '  select' || E'\n' ||
    '    invoice_row.id,' || E'\n' ||
    '    ordinality::integer - 1,' || E'\n' ||
    '    btrim(value->>''title''),' || E'\n' ||
    '    nullif(btrim(coalesce(value->>''description'', '''')), ''''),' || E'\n' ||
    '    nullif(btrim(coalesce(value->>''unit'', '''')), ''''),';
begin
  foreach target in array array['issue_invoice', 'update_invoice_draft'] loop
    select pg_get_functiondef(p.oid) into src
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = target;

    if src is null then
      raise exception 'Функция %(...) не найдена', target;
    end if;
    if position(old_block in src) = 0 then
      raise exception
        'В %(...) не найден ожидаемый оператор вставки позиций — миграция устарела, проверьте функцию руками',
        target;
    end if;

    patched := replace(src, old_block, new_block);
    execute patched;
  end loop;
end $$;
