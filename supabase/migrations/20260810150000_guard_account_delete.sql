-- УДАЛЕНИЕ СЧЁТА С ИСТОРИЕЙ МОЛЧА УНОСИЛО ДЕНЬГИ.
--
-- Все ссылки на счёт стоят с `on delete set null`: finance_transactions,
-- receipts, finance_templates, appointments.payment_account_id. Значит удаление
-- счёта не падало и ничего не спрашивало — операции ОСТАВАЛИСЬ в «Финансах», но
-- теряли привязку и исчезали из всех балансов. «Всего на счетах» уменьшалось на
-- остаток счёта, и никакого следа: ни строки, ни ошибки.
--
-- Кнопку «Удалить» приложение гасило само, спрашивая «есть ли история», но
-- ответ кэшировался на 30 секунд, а второе устройство про него вообще не знает.
-- Клиентская проверка не может быть последней преградой перед деньгами.
--
-- Теперь удалить можно ТОЛЬКО пустой счёт. Счёт с историей закрывают
-- (is_active = false): он уходит из выбора, но все документы остаются целыми.

create or replace function public.guard_account_delete_with_history()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  tx_count integer;
  receipt_count integer;
  template_count integer;
  appointment_count integer;
begin
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;

  select count(*) into tx_count
    from public.finance_transactions where account_id = old.id;
  select count(*) into receipt_count
    from public.receipts where account_id = old.id;
  select count(*) into template_count
    from public.finance_templates where account_id = old.id;
  select count(*) into appointment_count
    from public.appointments where payment_account_id = old.id;

  if tx_count > 0 or receipt_count > 0 or appointment_count > 0 then
    raise exception
      'Счёт «%» нельзя удалить: на нём % операц., % чек(ов), % оплат по заявкам. Закройте счёт — история останется целой.',
      old.name, tx_count, receipt_count, appointment_count;
  end if;

  -- Шаблон операции — не деньги, его можно просто отвязать.
  if template_count > 0 then
    update public.finance_templates set account_id = null where account_id = old.id;
  end if;

  return old;
end;
$$;

drop trigger if exists trg_guard_account_delete on public.accounts;
create trigger trg_guard_account_delete
  before delete on public.accounts
  for each row execute function public.guard_account_delete_with_history();
