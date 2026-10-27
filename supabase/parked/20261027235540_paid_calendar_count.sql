-- ЗА КАКИЕ КАЛЕНДАРИ ПЛАТЯТ — ОДНО ПРАВИЛО ДЛЯ СЕРВЕРА.
--
-- Платит живой календарь, в котором есть РАБОТА: хотя бы одна запись
-- (`appointments.kind = 'work'`), операция финансов или SMS. Календарь только
-- с событиями бесплатен, как бы он ни назывался: «Личный» с событиями — так
-- же, как пустой скрытый. Появилась работа — календарь платный со следующего
-- платежа (сверка количества перед счётом в `stripe-webhook`).
--
-- Удалённые записи и операции уже лежат в своих ящиках
-- (`deleted_appointments`, `deleted_operations`), поэтому здесь не считаются.
--
-- ПОЧЕМУ ФУНКЦИЯ, А НЕ ЗАПРОСЫ ИЗ EDGE: у `service_role` нет права читать
-- `finance_transactions`, а выдавать служебному ключу чтение денег целиком
-- ради одного «есть или нет» — шире, чем нужно. Функция определителя
-- отвечает одним числом.
--
-- Зовут: `tariff-checkout` (количество в оплате и в сверке «sync») и
-- `stripe-webhook` (сверка перед счётом). Приложение считает тем же правилом
-- своими запросами под RLS (`session/calendar-price.ts` +
-- `features/tariffs/use-live-calendars.ts`) — оно работает и до наката этой
-- миграции; совпадение правил держит
-- `features/tariffs/paid-calendars-parity.test.ts`.
--
-- ПОРЯДОК ВЫКЛАДКИ: сначала эта миграция, потом `tariff-checkout` и
-- `stripe-webhook` — функции без неё отвечают 5xx на оплату и на сверку.
--
-- Число без «не меньше одного»: минимум в подписке ставит вызывающий.

create or replace function public.paid_calendar_count(p_tenant uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.teams t
   where t.tenant_id = p_tenant
     and t.is_active
     and (
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
     )
$$;

-- Только служебный ключ: число платных календарей чужого аккаунта не дело
-- ни гостя, ни вошедшего (новая функция в `public` иначе исполнима всеми).
revoke all on function public.paid_calendar_count(uuid) from public, anon, authenticated;
grant execute on function public.paid_calendar_count(uuid) to service_role;

comment on function public.paid_calendar_count(uuid) is
  'Сколько живых календарей аккаунта платят: есть запись work, операция финансов или SMS. Календарь только с событиями бесплатен. Зовут tariff-checkout и stripe-webhook (service_role).';
