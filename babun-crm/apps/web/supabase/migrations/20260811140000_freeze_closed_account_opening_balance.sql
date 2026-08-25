-- ОСТАТОК НА НАЧАЛО ЗАКРЫТОГО СЧЁТА ЗАМОРАЖИВАЕТСЯ
-- (ТЗ docs/plans/ACCOUNTS-PAGE-REDESIGN-2026-08-10.md §5.7, §9.7).
--
-- ДЫРА, КОТОРУЮ ЗАКРЫВАЕМ (воспроизводится сегодня, три шага):
--   1. завести счёт и не проводить по нему ни одной операции;
--   2. закрыть его — страж пропускает, потому что баланс нулевой;
--   3. задать ему «Остаток на начало» €500 — страж молчит, потому что
--      операций у счёта нет, а про `is_active` он не спрашивает вовсе.
--   На выходе — закрытый счёт с €500, которых нет ни в «Всего денег», ни в
--   одном подытоге: закрытые счета в суммы не входят по определению. Деньги
--   существуют в базе и не напечатаны нигде. Именно поэтому §9.7 называет
--   «остаток закрытого счёта нулевой» ПРОВЕРКОЙ, а не допущением: в архиве
--   такая строка печатается янтарным «Закрыт · €500 не входит в итог», а
--   появляться новым она больше не имеет права.
--
-- ПОЧЕМУ ЗАПРЕТ, А НЕ АВТОПРАВКА. Молча обнулить чужую цифру — переписать
--   историю за человека. Продукт говорит словами: «Счёт закрыт. Чтобы менять
--   остаток на начало, сначала откройте его снова» — и открытие счёта это
--   одно движение, обратимое и видимое.
--
-- ПОЧЕМУ `old.is_active`, А НЕ `new.is_active`. Правится строка, которая УЖЕ
--   закрыта; UPDATE, который одновременно открывает счёт и меняет остаток,
--   тоже отбивается — иначе запрет обходился бы одним запросом, а порядок
--   «сначала откройте» перестал бы что-либо значить.
--
-- ЗАОДНО — ГЛОССАРИЙ В СЕРВЕРНЫХ ТЕКСТАХ (§7). Страж отвечал «Тип счёта» и
--   «Начальный баланс» — словами, которые из продукта убраны: в интерфейсе это
--   «Вид счёта» и «Остаток на начало». Ошибка, называющая поле не тем именем,
--   которое человек только что видел на экране, читается как ошибка про другое
--   поле. Тексты в клиенте не разбираются по подстрокам (проверено grep-ом),
--   поэтому переименование безопасно.
--
-- Тело функции повторено целиком: `create or replace` заменяет её без остатка,
-- а не дописывает. Триггер не пересоздаётся — он уже висит на `accounts` и
-- продолжает звать эту же функцию.

create or replace function public.guard_account_financial_history()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ledger_balance numeric(14,2);
begin
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return new;
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'Компания счёта неизменяема';
  end if;
  if new.scope is distinct from old.scope and exists (
    select 1 from public.finance_transactions where account_id = old.id
  ) then
    raise exception 'Счёт с операциями нельзя сделать счётом компании и обратно';
  end if;
  if new.brigade_id is distinct from old.brigade_id and exists (
    select 1 from public.finance_transactions where account_id = old.id
  ) then
    raise exception 'Команду счёта с операциями изменить нельзя';
  end if;
  if new.kind is distinct from old.kind and exists (
    select 1 from public.finance_transactions where account_id = old.id
  ) then
    raise exception 'Вид счёта с операциями изменить нельзя';
  end if;
  -- ДВА РАЗНЫХ ЗАПРЕТА НА ОДНО ПОЛЕ, И ПРИЧИНЫ У НИХ РАЗНЫЕ: у счёта с
  -- операциями остаток на начало держит сходимость истории, у закрытого —
  -- он просто не напечатан нигде.
  if new.opening_balance is distinct from old.opening_balance then
    if exists (
      select 1 from public.finance_transactions where account_id = old.id
    ) then
      raise exception 'Остаток на начало счёта с операциями изменить нельзя';
    end if;
    if not old.is_active then
      raise exception
        'Счёт закрыт. Чтобы менять остаток на начало, сначала откройте его снова';
    end if;
  end if;
  if old.is_active and not new.is_active then
    select round(
      old.opening_balance + coalesce(sum(
        case
          when type = 'expense' then -amount
          when type = 'refund' then -abs(amount)
          else amount
        end
      ), 0),
      2
    ) into ledger_balance
    from public.finance_transactions
    where account_id = old.id;
    if ledger_balance <> 0 then
      raise exception
        'Счёт «%» нельзя закрыть: на нём остаётся %. Сначала переведите остаток.',
        old.name, ledger_balance;
    end if;
  end if;
  return new;
end;
$function$;

-- Проверка после применения: запрет действительно в теле функции, а старые
-- слова глоссария из неё ушли. Дешевле, чем ловить это глазами в проде.
do $audit$
declare
  body text;
begin
  select pg_get_functiondef(p.oid) into body
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'guard_account_financial_history';

  if body is null then
    raise exception 'guard_account_financial_history не найдена';
  end if;
  if position('not old.is_active' in body) = 0 then
    raise exception 'Заморозка остатка на начало у закрытого счёта не применилась';
  end if;
  if position('Начальный баланс' in body) > 0
     or position('Тип счёта' in body) > 0 then
    raise exception 'В тексте стража остались слова вне глоссария';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.accounts'::regclass
       and not tgisinternal
       and tgfoid = 'public.guard_account_financial_history()'::regprocedure
  ) then
    raise exception 'Триггер стража не висит на public.accounts';
  end if;
end
$audit$;
