-- СВОДКА ПО КОМАНДАМ — ОДИН ЗАПРОС ВМЕСТО ТРЁХ НА КАЖДУЮ.
--
-- «Тариф» и лист «Новый календарь» в настройках календаря называют сумму,
-- а для неё считают платные календари: живой календарь с работой (запись
-- `kind = 'work'`, операция финансов или SMS). Приложение спрашивало это
-- по `limit(1)` на каждую команду и каждую таблицу: у Air Fix (6 команд) —
-- 6 + 4 + 4 запросов на круг, а круг повторяется при каждом сбросе ключа
-- «teams». Теперь — один вызов, ответ — строка на живую команду.
--
-- ПРАВА — КАК У ПРЕЖНИХ ЧТЕНИЙ: функция `security invoker`, все `exists`
-- идут под RLS вызывающего. Владельцу видно всё, партнёру — своё; ровно то же
-- число, что давали прежние запросы. Точный счёт для Stripe по-прежнему у
-- `paid_calendar_count` (определитель, только `service_role`), правило
-- одно — его сверяет `features/tariffs/paid-calendars-parity.test.ts` и
-- `features/tariffs/calendar-work-summary-contract.test.ts`.
--
-- Удалённые записи и операции лежат в своих ящиках и здесь не считаются —
-- как в `paid_calendar_count`.
--
-- Порядок выкладки любой: приложение без функции (PGRST202) считает прежними
-- запросами (`use-live-calendars.ts`).

create or replace function public.calendar_work_summary(p_tenant uuid)
returns table (team_id text, has_work boolean)
language sql
stable
security invoker
set search_path = public
as $$
  select t.id,
         exists (
           select 1 from public.appointments a
            where a.team_id = t.id and a.tenant_id = p_tenant and a.kind = 'work'
         )
         or exists (
           select 1 from public.finance_transactions f
            where f.team_id = t.id and f.tenant_id = p_tenant
         )
         or exists (
           select 1 from public.sms_messages s
            where s.team_id = t.id and s.tenant_id = p_tenant
         )
    from public.teams t
   where t.tenant_id = p_tenant
     and t.is_active
$$;

-- Вошедшему — да (под его RLS), гостю — нет: новая функция в `public`
-- иначе исполнима всеми.
revoke all on function public.calendar_work_summary(uuid) from public, anon;
grant execute on function public.calendar_work_summary(uuid) to authenticated;

comment on function public.calendar_work_summary(uuid) is
  'Живые команды аккаунта и есть ли в каждой работа (запись work, операция финансов, SMS) — под RLS вызывающего. Зовут «Тариф» и «Новый календарь» (use-live-calendars.ts).';
