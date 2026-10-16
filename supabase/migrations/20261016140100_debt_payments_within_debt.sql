-- ПЛАТЕЖИ ПО ДОЛГУ НЕ БОЛЬШЕ САМОГО ДОЛГА.
--
-- Остаток долга — сумма минус Σ |платежей| (`debt_id`). Сервер не ограничивал
-- ни платёж, ни правку суммы долга: оплата €700 по остатку €600 уходила в
-- доход и на счёт, остаток становился −€100, и строка долга пропадала из
-- списка — переплату нигде не было видно. То же давали правка платежа вверх,
-- «Вернуть» платёж из корзины после повторной оплаты и уменьшение суммы долга
-- ниже уже уплаченного со второго телефона.
--
-- Считает определитель (security definer): партнёр может не видеть часть
-- платежей по окну финансов, а лимит обязан учитывать все. Строка долга
-- блокируется — две оплаты разом не проскочат вместе.

create or replace function public.guard_debt_payment_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_debt public.debts%rowtype;
  v_paid numeric;
begin
  if new.debt_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.debt_id is not distinct from old.debt_id
     and abs(new.amount) <= abs(old.amount) then
    return new;
  end if;

  select * into v_debt from public.debts where id = new.debt_id for update;
  if not found then
    return new;
  end if;

  select coalesce(sum(abs(tx.amount)), 0) into v_paid
    from public.finance_transactions tx
   where tx.debt_id = new.debt_id
     and tx.id <> new.id;

  if v_paid + abs(new.amount) > v_debt.amount then
    raise exception 'По долгу осталось % — платёж не может быть больше', greatest(v_debt.amount - v_paid, 0)
      using errcode = 'P0001', hint = 'debt:overpay';
  end if;
  return new;
end;
$function$;

revoke all on function public.guard_debt_payment_total() from public, anon, authenticated;

drop trigger if exists trg_guard_debt_payment_total on public.finance_transactions;
create trigger trg_guard_debt_payment_total
  before insert or update of amount, debt_id on public.finance_transactions
  for each row execute function public.guard_debt_payment_total();

create or replace function public.guard_debt_amount_not_below_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_paid numeric;
begin
  if new.amount >= old.amount then
    return new;
  end if;
  select coalesce(sum(abs(tx.amount)), 0) into v_paid
    from public.finance_transactions tx
   where tx.debt_id = new.id;
  if new.amount < v_paid then
    raise exception 'По долгу уже уплачено % — сумма долга не может стать меньше', v_paid
      using errcode = 'P0001', hint = 'debt:below_paid';
  end if;
  return new;
end;
$function$;

revoke all on function public.guard_debt_amount_not_below_paid() from public, anon, authenticated;

drop trigger if exists trg_guard_debt_amount_not_below_paid on public.debts;
create trigger trg_guard_debt_amount_not_below_paid
  before update of amount on public.debts
  for each row execute function public.guard_debt_amount_not_below_paid();
