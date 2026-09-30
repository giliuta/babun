-- ПЕРЕСЧЁТ КАССЫ УДАЛЁН (владелец 2026-09-30: «пересчёт кассы нам не
-- требуется, можешь убрать это»).
--
-- Дверь в приложении ушла раньше; здесь уходит серверная часть целиком:
--   • `record_cash_count` — сверка остатка наличных с коррекцией «Излишек» /
--     «Недостача»;
--   • сторож `guard_cash_count_transaction_delete` на журнале — он запрещал
--     править и удалять коррекцию сверки;
--   • таблица `account_cash_counts` (история сверок);
--   • служебные категории «Излишек» (`cash_surplus`) и «Недостача»
--     (`cash_shortage`);
--   • строка удаления сверок в `delete_calendar`.
-- На 30.09 в базе ни одной сверки, ни одной коррекции и ни одной операции с
-- этими категориями — терять нечего (сторож ниже это проверяет, а не верит).
--
-- `delete_calendar` не переписывается руками: из живого тела вырезается ровно
-- одна команда — удаление сверок счетов календаря.

do $pre$
begin
  if exists (select 1 from public.account_cash_counts) then
    raise exception 'сторож: в базе есть сверки кассы — удаление остановлено';
  end if;
  if exists (
    select 1
      from public.finance_transactions ft
      join public.finance_categories c on c.id = ft.category_id
     where c.slug in ('cash_surplus', 'cash_shortage')
  ) then
    raise exception 'сторож: есть операции с категориями «Излишек» / «Недостача»';
  end if;
end
$pre$;

drop trigger if exists trg_guard_cash_count_transaction_write on public.finance_transactions;
drop function if exists public.guard_cash_count_transaction_delete();
drop function if exists public.record_cash_count(uuid, numeric, text, uuid);

do $calendar$
declare
  def text;
  frag text := E'  delete from public.account_cash_counts\n   where account_id = any (v_accounts);\n\n';
begin
  select pg_get_functiondef('public.delete_calendar(text)'::regprocedure) into def;
  if (length(def) - length(replace(def, frag, ''))) / length(frag) <> 1 then
    raise exception 'сторож: удаление сверок в delete_calendar встречается не ровно один раз';
  end if;
  execute replace(def, frag, '');
end
$calendar$;

drop table if exists public.account_cash_counts;

delete from public.finance_categories
 where tenant_id is null
   and slug in ('cash_surplus', 'cash_shortage');

do $guard$
declare
  v_left text;
begin
  select string_agg(p.proname, ', ') into v_left
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.prosrc ilike '%account_cash_counts%'
       or p.prosrc ilike '%cash_surplus%'
       or p.prosrc ilike '%cash_shortage%'
       or p.proname ilike '%cash_count%');
  if v_left is not null then
    raise exception 'сторож: пересчёт кассы ещё живёт в функциях: %', v_left;
  end if;
  if to_regclass('public.account_cash_counts') is not null then
    raise exception 'сторож: таблица сверок осталась';
  end if;
  if exists (select 1 from public.finance_categories where slug in ('cash_surplus', 'cash_shortage')) then
    raise exception 'сторож: категории «Излишек» / «Недостача» остались';
  end if;
  if exists (
    select 1 from pg_trigger
     where tgrelid = 'public.finance_transactions'::regclass
       and tgname = 'trg_guard_cash_count_transaction_write'
  ) then
    raise exception 'сторож: сторож сверки на журнале остался';
  end if;
end
$guard$;
