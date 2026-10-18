-- ПОВТОРНАЯ ОТМЕНА ВОССТАНОВЛЕННОЙ ЗАЯВКИ БЕЗ НОВЫХ ДЕНЕГ — НЕ «ВОЗВРАТ».
--
-- Отмена с деньгами — возврат: сторож ставит «возвращено», сверка пишет
-- сторно на каждый авто-доход. «Восстановить» начинает новый круг денег с
-- нуля («не оплачено»). Но сторож считал «были ли авто-доходы» по всей
-- истории заявки, вместе со сторнированными доходами прошлого круга, и
-- повторная отмена без единого нового платежа снова ставила «возвращено» —
-- заявка показывала возврат денег, которых в этом круге не было.
--
-- Теперь доходом считается только доход, возвращённый не целиком, — так же,
-- как сторож уже считает доплату (`has_settlement`) и деньги, держащие
-- клиента и команду. То же для «есть проводки» в заморозке отменённой
-- заявки: строки прошлого круга, ушедшие в ноль, не держат её — иначе
-- отменённую заново (теперь «не оплачено») заявку нельзя было бы
-- восстановить второй раз: «Возвращённую оплату нельзя изменить».
--
-- Деньги, которые лежат на заявке (доход, возвращённый не целиком, расход и
-- прочие строки), держат всё, как держали.
--
-- Правка — точечная замена в живом теле, якорь ровно один раз.

set local lock_timeout = '5s';

do $patch$
declare
  fn constant regprocedure := 'public.protect_paid_appointment_finance()'::regprocedure;
  body text := pg_get_functiondef(fn);
  anchor constant text :=
       E'  select exists (\n'
    || E'    select 1 from public.finance_transactions\n'
    || E'     where appointment_id = old.id and source = ''auto'' and type = ''income''\n'
    || E'  ) into has_any_auto_income;\n'
    || E'  select exists (\n'
    || E'    select 1 from public.finance_transactions where appointment_id = old.id\n'
    || E'  ) into has_linked_finance;\n';
  replacement constant text :=
       E'  -- Деньги на заявке — доход, возвращённый не целиком: сторнированный\n'
    || E'  -- доход прошлого круга (отмена, «не поступили») деньгами не считается.\n'
    || E'  select exists (\n'
    || E'    select 1 from public.finance_transactions income\n'
    || E'     where income.appointment_id = old.id\n'
    || E'       and income.source = ''auto''\n'
    || E'       and income.type = ''income''\n'
    || E'       and income.amount > coalesce((\n'
    || E'         select sum(abs(refund.amount))\n'
    || E'           from public.finance_transactions refund\n'
    || E'          where refund.refund_of_id = income.id\n'
    || E'            and refund.type = ''refund''\n'
    || E'       ), 0)\n'
    || E'  ) into has_any_auto_income;\n'
    || E'  select exists (\n'
    || E'    select 1 from public.finance_transactions income\n'
    || E'     where income.appointment_id = old.id\n'
    || E'       and income.type = ''income''\n'
    || E'       and income.amount > coalesce((\n'
    || E'         select sum(abs(refund.amount))\n'
    || E'           from public.finance_transactions refund\n'
    || E'          where refund.refund_of_id = income.id\n'
    || E'            and refund.type = ''refund''\n'
    || E'       ), 0)\n'
    || E'  ) or exists (\n'
    || E'    select 1 from public.finance_transactions other\n'
    || E'     where other.appointment_id = old.id\n'
    || E'       and other.type not in (''income'', ''refund'')\n'
    || E'  ) into has_linked_finance;\n';
begin
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'protect_paid_appointment_finance: якорь доходов заявки не найден ровно один раз';
  end if;
  execute replace(body, anchor, replacement);
end
$patch$;

do $guard$
declare
  fn_src text;
  fn_secdef boolean;
  fn_config text[];
begin
  select p.prosrc, p.prosecdef, p.proconfig
    into fn_src, fn_secdef, fn_config
    from pg_proc p
   where p.oid = 'public.protect_paid_appointment_finance()'::regprocedure;
  if fn_src like '%where appointment_id = old.id and source = ''auto'' and type = ''income''%'
     or fn_src not like '%other.type not in (''income'', ''refund'')%into has_linked_finance;%'
     or fn_src not like '%new.prepayments := ''[]''::jsonb;%' then
    raise exception 'сторож: protect_paid_appointment_finance — доходы заявки считаются по-старому';
  end if;
  if not fn_secdef or fn_config is distinct from array['search_path=public'] then
    raise exception 'сторож: protect_paid_appointment_finance — изменились security definer или search_path';
  end if;
end
$guard$;
