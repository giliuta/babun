-- КОМАНДУ С ДЕНЬГАМИ И ЗАПИСЯМИ УДАЛИТЬ НЕЛЬЗЯ.
--
-- Что случилось у владельца 2026-08-09: две команды удалили, а их 11 записей,
-- 27 операций и 4 счёта на €930 остались ссылаться в пустоту. Последствия:
-- записи ПРОПАЛИ из календаря (колонки для несуществующей команды нет), счета
-- сгрудились в два одинаковых блока «Без бригады», а долг по этой работе
-- продолжал считаться в финансах. Деньги стали недостижимы.
--
-- Правило продукта: справочная запись, на которую ссылается история,
-- ВЫКЛЮЧАЕТСЯ (is_active = false), а не стирается. Команда уходит из выбора,
-- прошлое остаётся связным. Тот же принцип уже защищает клиентов
-- (guard_client_hard_delete_history).

create or replace function public.guard_team_delete_with_history()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n_appointments integer;
  n_accounts integer;
  n_transactions integer;
begin
  -- Снесённый тенант уносит всё за собой — там проверять нечего.
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;

  select count(*) into n_appointments
    from public.appointments where team_id = old.id;
  select count(*) into n_accounts
    from public.accounts where brigade_id = old.id;
  select count(*) into n_transactions
    from public.finance_transactions where team_id = old.id;

  if n_appointments > 0 or n_accounts > 0 or n_transactions > 0 then
    raise exception
      'У команды есть история: записей %, счетов %, операций %. Такую команду выключают, а не удаляют.',
      n_appointments, n_accounts, n_transactions
      using errcode = '23503';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_guard_team_delete_history on public.teams;
create trigger trg_guard_team_delete_history
  before delete on public.teams
  for each row execute function public.guard_team_delete_with_history();
