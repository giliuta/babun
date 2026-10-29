-- ИСТОРИЯ КЛИЕНТА У ПАРТНЁРА — С АВАНСОМ (страница клиентов, Н3).
--
-- `member_client_history` отдавал `prepaid_amount: 0`, а `paid_amount` — как
-- есть, БЕЗ аванса (аванс живёт в своей колонке, `getPaidAmount` прибавляет
-- его отдельно). У партнёра с «Историей» долг клиента выходил больше на аванс:
-- запись на €737.80, оплаченная авансом целиком, висела долгом €737.80, и
-- этот долг уходил в фильтр «Неоплаченные» и в SMS ({debt}). Теперь аванс
-- отдаётся вместе с остальными суммами — при открытой «Истории», как и они.
--
-- Тело правится по якорю в живом определении.

do $migration$
declare
  d text := pg_get_functiondef('public.member_client_history(uuid)'::regprocedure);
  anchor constant text := E'      ''prepaid_amount'', 0,\n';
  replacement constant text := E'      ''prepaid_amount'', case when h.see_money then coalesce(a.prepaid_amount, 0) else 0 end,\n';
begin
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'member_client_history: якорь аванса не найден ровно один раз';
  end if;
  execute replace(d, anchor, replacement);
end;
$migration$;

do $guard$
begin
  if position('''prepaid_amount'', case when h.see_money then coalesce(a.prepaid_amount, 0) else 0 end' in
       pg_get_functiondef('public.member_client_history(uuid)'::regprocedure)) = 0 then
    raise exception 'member_client_history снова отдаёт историю без аванса';
  end if;
end;
$guard$;
