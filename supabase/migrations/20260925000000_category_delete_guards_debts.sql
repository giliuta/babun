-- УДАЛЕНИЕ КАТЕГОРИИ НЕ ОБДИРАЕТ ДОЛГИ (аудит финансов 2026-09-24).
--
-- Сторож `guard_finance_category_history_delete` не давал удалить категорию,
-- на которой висят операции или шаблоны, — а долги не проверял. У
-- `debts.category_id` связь `on delete set null`, и удаление категории молча
-- снимало подпись со всех её долгов. Теперь долги держат категорию так же,
-- как операции: удалить нельзя, экран категорий предлагает скрыть.
--
-- Тело функции не переписывается руками: берётся живое определение, в нём
-- ровно один фрагмент дополняется проверкой долгов.

do $$
declare
  def text;
  old_frag text := '    or exists (select 1 from public.finance_templates where category_id = old.id)
  ) then
    raise exception ''Категория используется в финансовой истории и не может быть удалена'';';
  new_frag text := '    or exists (select 1 from public.finance_templates where category_id = old.id)
    or exists (select 1 from public.debts where category_id = old.id)
  ) then
    raise exception ''Категория используется в финансовой истории и не может быть удалена'';';
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'guard_finance_category_history_delete';
  if def is null then
    raise exception 'функции guard_finance_category_history_delete нет';
  end if;
  if (length(def) - length(replace(def, old_frag, ''))) / length(old_frag) <> 1 then
    raise exception 'фрагмент проверки удаления встречается не ровно один раз';
  end if;
  execute replace(def, old_frag, new_frag);
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_proc
     where proname = 'guard_finance_category_history_delete'
       and prosrc like '%from public.debts where category_id = old.id%'
  ) then
    raise exception 'проверка долгов в стороже категорий не встала';
  end if;
end
$$;
