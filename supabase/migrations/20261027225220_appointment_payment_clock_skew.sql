-- ДАТА ОПЛАТЫ ЗАПИСИ — ПО ЧАСАМ СЕРВЕРА, А НЕ ТЕЛЕФОНА (аудит 035, dat/M-07).
--
-- `record_appointment_payment(p_paid_at)` берёт время оплаты с телефона.
-- Сервер обрезает только будущее; телефон со сбитыми часами («вчера») кладёт
-- платёж и доход во вчерашнюю кассу задним числом.
--
-- `now()` вместо `p_paid_at` не годится: очередь мастера без сети
-- (`member-queue-senders.ts`) отправляет платёж позже, с настоящим временем
-- оплаты, — он должен лечь в свой день. Поэтому телефон присылает ещё и
-- `p_sent_at` — свои часы В МОМЕНТ ОТПРАВКИ. Разница с часами сервера и есть
-- сбой часов телефона; на неё сдвигается время оплаты. Задержка сети (до двух
-- минут) сдвигом не считается. Без `p_sent_at` (старые сборки) — как раньше.
--
-- Тело функции правится по якорям в ЖИВОМ определении: сигнатура и одна
-- строка `paid_at_value`. Новый параметр меняет сигнатуру, поэтому старая
-- функция удаляется, а права возвращаются как были (`authenticated`).
--
-- ОКНО «ОГРАНИЧЕНИЯ ЗАПИСЕЙ» (аудит 035, cab/R-06): мастер, у которого запись
-- за пределами окна, её не видит, но по сохранённому номеру принимал по ней
-- оплату. Теперь для роли master такая запись — «не найдена», как в
-- `member_appointment_update`. Та же функция — тот же файл.
--
-- КЛИЕНТ (отдельный шаг, после наката): `payment-mutations.ts` и
-- `member-queue-senders.ts` шлют `p_sent_at: new Date().toISOString()` в
-- момент отправки запроса, не в момент оплаты; `database.types.ts` — новый
-- аргумент.

create or replace function public.client_clock_skew(p_sent_at timestamptz)
returns interval
language sql
stable
set search_path = public
as $function$
  select case
    when p_sent_at is null then interval '0'
    when abs(extract(epoch from (now() - p_sent_at))) <= 120 then interval '0'
    else now() - p_sent_at
  end
$function$;

comment on function public.client_clock_skew(timestamptz) is
  'На сколько часы телефона отстают от сервера (now() − его время отправки); до двух минут — ноль (сеть).';

revoke all on function public.client_clock_skew(timestamptz) from public, anon;
grant execute on function public.client_clock_skew(timestamptz) to authenticated;

do $migration$
declare
  old_sig constant text := 'public.record_appointment_payment(uuid, uuid, numeric, uuid, text, timestamptz, boolean)';
  d text := pg_get_functiondef(old_sig::regprocedure);
  sig_old constant text := 'p_close_visit boolean DEFAULT false)';
  sig_new constant text := 'p_close_visit boolean DEFAULT false, p_sent_at timestamp with time zone DEFAULT NULL::timestamp with time zone)';
  line_old constant text := 'paid_at_value timestamptz := coalesce(p_paid_at, now());';
  line_new constant text := 'paid_at_value timestamptz := coalesce(p_paid_at, now()) + public.client_clock_skew(p_sent_at);';
  rights_old constant text := E'  if not public.current_user_can_pay_appointment(appt.team_id, appt.master_id) then\n';
  window_block constant text := E'  -- Запись за окном «Ограничения записей» мастеру не видна — и не оплачивается.\n'
    || E'  if public.current_user_role() = ''master''\n'
    || E'     and public.member_record_hidden(appt.kind, appt.team_id, appt.date) then\n'
    || E'    raise exception ''Запись не найдена'' using errcode = ''P0002'', hint = ''appointment:outside_window'';\n'
    || E'  end if;\n';
begin
  if (length(d) - length(replace(d, sig_old, ''))) / length(sig_old) <> 1 then
    raise exception 'record_appointment_payment: якорь сигнатуры не найден ровно один раз';
  end if;
  if (length(d) - length(replace(d, line_old, ''))) / length(line_old) <> 1 then
    raise exception 'record_appointment_payment: якорь paid_at_value не найден ровно один раз';
  end if;
  if (length(d) - length(replace(d, rights_old, ''))) / length(rights_old) <> 1 then
    raise exception 'record_appointment_payment: якорь права оплаты не найден ровно один раз';
  end if;
  d := replace(replace(replace(d, sig_old, sig_new), line_old, line_new), rights_old, window_block || rights_old);
  execute 'drop function ' || old_sig;
  execute d;
end;
$migration$;

revoke all on function public.record_appointment_payment(uuid, uuid, numeric, uuid, text, timestamptz, boolean, timestamptz)
  from public, anon, service_role;
grant execute on function public.record_appointment_payment(uuid, uuid, numeric, uuid, text, timestamptz, boolean, timestamptz)
  to authenticated;
