-- ФАНТОМНЫЕ УЧАСТНИКИ ОБЩЕГО СЧЁТА.
--
-- `account_teams.team_id` — text без внешнего ключа. Команду, у которой нет
-- своих счетов, но которая подключена к общему, guard пропускал: своих счетов
-- ноль, записей ноль — удаляем. Строка членства оставалась висеть, и
-- `account_serves_team` продолжала отвечать «да» для команды, которой больше
-- нет: общий счёт считал себя доступным призраку.
--
-- Guard удаления команды теперь ВИДИТ членства, а чистая команда уносит свои
-- членства с собой — вместо FK, которого на text-ключе нет.

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
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;

  select count(*) into n_appointments
    from public.appointments where team_id = old.id;
  select count(*) into n_accounts
    from public.accounts a
   where a.brigade_id = old.id
      or exists (
        select 1 from public.account_teams at
         where at.account_id = a.id
           and at.team_id = old.id
           and at.tenant_id = old.tenant_id
      );
  select count(*) into n_transactions
    from public.finance_transactions where team_id = old.id;

  if n_appointments > 0 or n_accounts > 0 or n_transactions > 0 then
    raise exception
      'У команды есть история: записей %, счетов %, операций %. Такую команду выключают, а не удаляют.',
      n_appointments, n_accounts, n_transactions
      using errcode = '23503';
  end if;

  delete from public.account_teams
   where tenant_id = old.tenant_id and team_id = old.id;

  return old;
end;
$$;

delete from public.account_teams at
 where not exists (
   select 1 from public.teams t
    where t.id = at.team_id and t.tenant_id = at.tenant_id
 );
