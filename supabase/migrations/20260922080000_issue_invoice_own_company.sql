-- ВЫСТАВЛЕНИЕ ИНВОЙСА ПАДАЛО: «permission denied for function resolve_company_id».
--
-- Миграция 20260922050000 (нумерация на реквизитах) позвала
-- `resolve_company_id` прямо из `issue_invoice`. Та работает с правами
-- вызывающего (SECURITY INVOKER), а `resolve_company_id` закрыта от роли
-- `authenticated` намеренно: она отвечает про ЛЮБУЮ компанию по её id.
-- Сухой прогон шёл от администратора базы и падения не увидел; владелец
-- увидел его на первом же настоящем инвойсе.
--
-- Узкая дверь: `resolve_own_company_id` — только своя компания
-- (`current_tenant_id()`), открыта `authenticated`. Сторож проверяет права
-- ИМЕННО этой роли: без него ошибка повторилась бы тихо.

begin;

create or replace function public.resolve_own_company_id(p_company_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.resolve_company_id(public.current_tenant_id(), p_company_id);
$$;

revoke all on function public.resolve_own_company_id(uuid) from public, anon;
grant execute on function public.resolve_own_company_id(uuid) to authenticated;

do $migration$
declare
  body text;
  old_call constant text := 'public.resolve_company_id(tenant_uuid, p_company_id)';
begin
  select pg_get_functiondef(
    'public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text)'::regprocedure
  ) into body;
  if (length(body) - length(replace(body, old_call, ''))) / length(old_call) <> 1 then
    raise exception 'issue_invoice: resolve_company_id call not unique';
  end if;
  execute replace(body, old_call, 'public.resolve_own_company_id(p_company_id)');
end
$migration$;

-- Сторож: всё, что `issue_invoice` зовёт с правами вызывающего, открыто
-- роли `authenticated`.
do $$
declare
  fn text;
begin
  if exists (
    select 1 from pg_proc
     where pronamespace = 'public'::regnamespace and proname = 'issue_invoice'
       and prosrc like '%resolve_company_id(%'
  ) then
    raise exception 'issue_invoice still calls resolve_company_id directly';
  end if;
  foreach fn in array array[
    'public.resolve_own_company_id(uuid)',
    'public.next_company_invoice_number(uuid, uuid, integer)',
    'public.current_tenant_id()',
    'public.current_user_role()'
  ] loop
    if not has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'authenticated cannot execute %', fn;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.resolve_own_company_id(uuid)', 'execute') then
    raise exception 'resolve_own_company_id is callable by anon';
  end if;
end
$$;

commit;
