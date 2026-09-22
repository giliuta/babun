-- ВЫСТАВЛЕННЫЙ ИНВОЙС НЕ ПРАВИТСЯ.
--
-- Владелец 22.09: «после того как мы выставили инвойс, он сохраняется, и
-- редактировать уже нельзя — только PDF; PDF можно удалить или потом —
-- кредит-нота». Приложение больше не зовёт `update_invoice_draft` (экран
-- правки и «Выбрать клиента» на выставленном документе сняты). Закрываем
-- дверь и на сервере: правка была единственным путём переписать строки,
-- суммы, получателя и реквизиты уже выданной бумаги — и привязка клиента
-- через неё молча стирала реквизиты и счёт документа.
--
-- Функция не удаляется (её знают тесты паритета расчёта), у неё отзывается
-- право вызова для всех ролей клиента.

begin;

revoke all on function public.update_invoice_draft(
  uuid, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid
) from public, anon, authenticated;

do $$
begin
  if has_function_privilege('authenticated',
       'public.update_invoice_draft(uuid, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid)',
       'execute') then
    raise exception 'issued invoices are still editable';
  end if;
end
$$;

commit;
