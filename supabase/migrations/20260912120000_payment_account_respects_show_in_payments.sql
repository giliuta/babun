-- ВТОРОЙ СЛОЙ ЗАЩИТЫ У ОПЛАТЫ ЗАЯВКИ (аудит счетов 2026-09-10).
--
-- Флаг `accounts.show_in_payments` («бригадир видит счёт при оплате заявки»)
-- появился 2026-08-11 и был добавлен в две двери из трёх: список счетов
-- (`list_payment_accounts_safe`) и автоподстановку
-- (`resolve_appointment_finance_account`). Третья — явный выбор счёта
-- бригадиром — проверяла тенант, активность и принадлежность команде, но не
-- сам флаг. То есть счёт, СПРЯТАННЫЙ владельцем от оплаты заявок, всё равно
-- принимал деньги, если его id доходил до запроса.
--
-- Сегодня это не эксплуатируется: единственный клиентский источник id идёт
-- через отфильтрованный список. Но у денег в этом продукте защита всегда
-- двухслойная, и «клиент отдаёт только правильное» слоем не считается.
--
-- Тело функции не тронуто ничем, кроме одной строки условия.

create or replace function public.resolve_appointment_payment_account(p_tenant_id uuid, p_team_id text, p_payment_method text, p_account_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  ok boolean;
begin
  if p_account_id is null then
    -- Легаси-вход без выбора (закрытие дня, импорт, старые записи).
    return public.resolve_appointment_finance_account(
      p_tenant_id, p_team_id, p_payment_method
    );
  end if;

  select true into ok
    from public.accounts a
   where a.id = p_account_id
     and a.tenant_id = p_tenant_id
     and a.is_active = true
     and a.show_in_payments = true
     and (
       (a.scope = 'team' and a.brigade_id = p_team_id)
       or (a.scope = 'company' and exists (
         select 1 from public.account_teams att
          where att.account_id = a.id and att.team_id = p_team_id
       ))
     );
  if ok is not true then
    raise exception 'Выбранный счёт не обслуживает команду этой заявки';
  end if;
  return p_account_id;
end;
$function$;
