-- БЮДЖЕТ НА МЕСЯЦ — СВОЙСТВО КАТЕГОРИИ (владелец 2026-09-24: «когда создам
-- категорию, мы можем выставить определённый бюджет по этой категории, и
-- потом она просто пришлёт уведомление, что перевалил лимит»).
--
-- Одна колонка, а не таблица бюджетов: бюджет один на категорию и не зависит
-- от месяца — «топливо 250 в месяц» действует, пока его не поменяли. Пусто —
-- бюджета нет. Потрачено считает приложение по журналу текущего месяца;
-- хранить его здесь значило бы завести вторую правду о расходах.
--
-- Колонка без умолчания: прошлые строки получают пусто и ничего не
-- «прошивается» (см. `add column … default`).

alter table public.finance_categories
  add column if not exists monthly_budget numeric(12, 2);

alter table public.finance_categories
  drop constraint if exists finance_categories_monthly_budget_positive;

alter table public.finance_categories
  add constraint finance_categories_monthly_budget_positive
  check (monthly_budget is null or monthly_budget > 0);

-- СТОРОЖ: ни у одной прошлой категории бюджет сам не появился.
do $$
begin
  if exists (select 1 from public.finance_categories where monthly_budget is not null) then
    raise exception 'бюджет появился у категорий, которым его не ставили';
  end if;
end
$$;
