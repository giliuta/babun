-- ДЕНЬГИ ЗАЯВКИ НЕ ЗАДВАИВАЮТСЯ МЕЖДУ ПЛИТКОЙ И ИНВОЙСОМ: сверка смотрит в
-- журнал, а не на «было / стало» (шаг 2 плана «НДС в оплате записи»,
-- спецификация 2026-09-15, §6.2, §6.3, §6.4; разбор, пункты A6 и N1, пробелы
-- инвойсов 3, 4 и 5).
--
-- ПОРЯДОК ПРИМЕНЕНИЯ: только после 20260915090000_appointment_vat_choice_off.
-- Та миграция тоже пересоздаёт `reconcile_appointment_finance` — старым телом
-- «было / стало». Применённая позже этой, она молча вернула бы двойной доход
-- A6, а остальные защиты этой миграции остались бы жить вполсилы. Поэтому
-- первым стоит сторож: пока в базе жив механизм «НДС записи» из 080000 (его
-- триггер, его функция или его блок в сверке), миграция откатывается
-- целиком. По той же причине 090000 нельзя применять повторно после этой.
-- 20260915100000_manual_vat_snapshot трогает только `fill_transaction_vat` и
-- её триггер — с функциями этой миграции она не пересекается.
--
-- Деньги приходят в заявку двумя дорогами: плитка оплаты (авто-доход, его
-- пишет сверка) и страница инвойса (ручной доход; его зачитывает в заявку
-- `settle_appointment_from_invoice_payment` элементом `pay-inv-<id дохода>`).
-- Сверка знала только первую. Сухой прогон на проде 2026-09-15 до этой
-- миграции:
--
-- A6. INV-2026-002: 150 и 147.50 на странице инвойса, затем правка одного
--     комментария заявки — сверка не видит ни одного авто-дохода, считает
--     заявку «оплаченной без денег» и пишет второй доход на 250 (и второй чек).
-- 3.  Плитка 250, затем оплата инвойса 297.50 — принимается: в журнале 547.50
--     за работу на 250.
-- 4.  Отмена заявки со 150 по инвойсу — проходит: заявка «возвращена», а деньги
--     и инвойс остаются как были.
-- 5.  Частичный возврат платежа инвойса снимает из заявки весь его элемент
--     `pay-inv-…`, а `paid_amount` уменьшает только на сумму возврата.
-- N1. «Деньги не поступили» по единственной доплате, затем правка цены —
--     отказ «Сначала отмените оплату…»: снятый платёж продолжал считаться
--     доплатой.
--
-- Что закрывает эта миграция:
--
-- 1. СВЕРКА ПО ЖУРНАЛУ. Цель авто-доходов = цель заявки минус деньги, уже
--    лежащие в журнале другой дорогой: зачёт платежей инвойса (элементы
--    `pay-inv-<id>` одного дохода, не больше его чистой суммы) и чистые ручные
--    доходы с этой заявкой без инвойса. Дельта = эта цель минус чистая сумма
--    авто-доходов (доход минус возвраты), по видам; у старых строк без вида —
--    одной суммой. Деньги инвойса и ручные доходы гасят только доплату:
--    предоплата бывает лишь с плитки.
--    Ручной доход с заявкой без инвойса в проде один (a936f7b6, 120, заявка
--    оплачена), и без него ворота показали бы по этой заявке +120.
-- 2. ДВАЖДЫ НЕ ПИШЕТСЯ — СВЕРКА ПАДАЕТ: «Деньги по заявке уже учтены — сверка
--    их не задвоит», когда
--    • платёж плитки записал в заявку сумму, а провести можно меньше (часть уже
--      лежит в журнале) — тапнутые деньги не теряются молча;
--    • сверка должна доплатить, а зачёт какого-то инвойса меньше, чем его
--      деньги дают заявке: меньшего из чистых денег инвойса и суммы его строк
--      (работы; налог «сверху» — не работа). Так бывает, когда элементы
--      `pay-inv-…` стёрла посторонняя правка `payments` (устаревший реплей
--      старой сборки), — сколько денег инвойса уже в заявке, неизвестно.
--      Оставшийся налог «сверху» сюда не попадает: у INV-2026-002 после 250 и
--      47.50 зачёт 250 равен сумме строк, хотя денег 297.50.
-- 3. ИНВОЙС НЕ БЕРЁТ ДЕНЬГИ ЗА УЖЕ ОПЛАЧЕННУЮ РАБОТУ. Оплата инвойса — и
--    `record_invoice_payment`, и триггер вставки (любая дорога) — отказ, когда
--    у неотменённой заявки есть деньги вне этого инвойса (предоплата, плитка,
--    ручной доход, другой инвойс) и вместе с работой инвойса они больше итога
--    заявки: «По заявке уже есть оплата вне инвойса — аннулируйте инвойс»
--    (и выставьте новый на остаток, если он есть). Свой зачёт инвойса деньгами
--    вне инвойса не считается: налог «сверху» после зачтённых 250 из 297.50
--    принимается, settle зачтёт ноль. Полностью оплаченный инвойс отвечает, как
--    и раньше, «Инвойс уже полностью оплачен». Заявка под замком: плитка,
--    оплатившая её параллельно, дождётся или будет дождана.
--    Инвойс, отменённый кредит-нотой (статус `cancelled` из
--    20260915120000_invoice_vat_mode_credit_notes), оплату не принимает ни
--    одной дорогой: отказ стоит рядом с отказом аннулированному и не ждёт,
--    пока статус пересчитается по журналу.
-- 4. ПЛИТКА НЕ ПЛАТИТ ЗАЯВКУ, ПОКА ОТКРЫТЫЙ ИНВОЙС ДЕРЖИТ ЕЁ ДЕНЬГИ: «По заявке
--    открыт инвойс N — оплату примите в нём». Иначе плитка заняла бы остаток
--    инвойса, сам инвойс по п. 3 больше не принял бы ни цента, а аннулировать
--    инвойс с деньгами нельзя. Снять платёж плитки можно всегда.
-- 5. АВТО-СТРОКА НЕ ТРОГАЕТ ЗАЯВКУ ЧЕРЕЗ ИНВОЙС. Возврат, который сверка
--    пишет по авто-доходу, привязанному к инвойсу, наследует `invoice_id` и
--    раньше второй раз уменьшал `paid_amount`. Теперь settle такие строки
--    пропускает.
-- 6. ЧАСТИЧНЫЙ ВОЗВРАТ ПЛАТЕЖА ИНВОЙСА ДЕРЖИТ ЗАЧЁТ ЧЕСТНЫМ. Элемент
--    `pay-inv-…` становится меньшим из прежнего зачёта и чистой суммы дохода
--    после возврата и уходит только в ноль; `paid_amount` меняется на ту же
--    разницу. 150 и возврат 50 — зачёт и `paid_amount` по 100; возврат 47.50
--    из платежа 147.50, зачтённого на 100, заявку не трогает.
-- 7. РУЧНОЙ ДОХОД НЕ ПРИВЯЗЫВАЕТСЯ К ИНВОЙСУ ЗАЯВКИ. Привязка
--    (`issue_invoice(p_link_to_tx_id)`) — правка строки: settle её не видит, и
--    заявка о деньгах не узнаёт. Заявка с таким доходом замерзала на п. 2 при
--    любой правке, а если заявка была только у инвойса — плитка брала те же
--    деньги второй раз. `protect_invoice_payment_row` отказывает, если заявка
--    есть у дохода или у инвойса. Авто-доход плитки привязывается к инвойсу
--    своей заявки, как раньше: его держит сверка.
-- 8. ОТМЕНА ЗАЯВКИ С ДЕНЬГАМИ ИНВОЙСА — ОТКАЗ «Сначала верните оплату
--    инвойса N». Сверка их не вернёт (это не её деньги), а заявка не должна
--    притворяться возвращённой.
-- 9. ДОПЛАТА — ТОЛЬКО НЕВОЗВРАЩЁННАЯ (N1). Снятый целиком платёж больше не
--    замораживает цену и дату заявки.
--
-- Что остаётся до шага 5 (НДС на платеже):
-- • плитка не платит открытый инвойс — пока это отказ п. 4, а не оплата;
-- • предоплата плиткой и инвойс на всю работу не сходятся: оплата такого
--   инвойса — отказ п. 3. Проходит инвойс на остаток (сумма строк не больше
--   итога минус деньги вне инвойса) или остаток плитками. Генератор строк
--   инвойса пока всегда берёт весь итог заявки;
-- • НДС на каждом платеже и колонка зачёта `appointment_credit`: зачёт платежа
--   инвойса живёт только в элементе `pay-inv-…`.
--
-- Ворота (SELECT на проде 2026-09-15, до миграции): по новой формуле у всех
-- 43 рабочих заявок пяти компаний дельта 0 — применение миграции не пишет ни
-- одной строки. Платежей инвойса с заявкой, элементов `pay-inv-…` и открытых
-- инвойсов заявок с деньгами в проде ноль. Заявка a936f7b6 по-прежнему не
-- правится («Выберите способ оплаты заявки» — у неё пуст способ оплаты); это
-- отдельный вопрос.
--
-- Владелец, права, SECURITY DEFINER / INVOKER и search_path — как у живых
-- функций; тела взяты из `pg_get_functiondef` 2026-09-15, сверка — из
-- 20260915090000 (без блока «НДС записи»).

-- СТОРОЖ ПОРЯДКА. 20260915090000 снимает триггер и функцию «НДС записи» и
-- ставит сверку без этого блока. Пока жива хоть одна из трёх примет, та
-- миграция не применена — и, применённая после этой, она заменила бы сверку
-- старым телом.
do $$
begin
  if exists (
       select 1
         from pg_trigger
        where tgrelid = 'public.appointments'::regclass
          and tgname = 'trg_guard_appointment_vat_mode'
     )
     or to_regprocedure('public.guard_appointment_vat_mode()') is not null
     or exists (
       select 1
         from pg_proc p
        where p.oid = to_regprocedure('public.reconcile_appointment_finance(uuid, numeric, numeric, numeric, text, text, boolean)')
          and p.prosrc like '%appointment_row.vat_mode%'
     ) then
    raise exception 'Сначала примените 20260915090000_appointment_vat_choice_off: эта миграция идёт только после неё';
  end if;
end;
$$;

-- 1, 2, 4. СВЕРКА ПО ЖУРНАЛУ. Тело — из 20260915090000: заменён расчёт дельты
-- (журнал вместо «было / стало»), добавлены отказы п. 2 и п. 4. Проверки сумм
-- и запись строк не менялись.
CREATE OR REPLACE FUNCTION public.reconcile_appointment_finance(p_appointment_id uuid, p_old_total numeric, p_old_prepaid numeric, p_old_paid numeric, p_old_payment_status text, p_old_status text, p_is_insert boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  appointment_row public.appointments%rowtype;
  services_category_id uuid;
  refund_category_id uuid;
  resolved_account_id uuid;
  new_prepayment_target numeric := 0;
  new_settlement_target numeric := 0;
  prepayment_delta numeric := 0;
  settlement_delta numeric := 0;
  total_delta numeric := 0;
  legacy_income_count integer := 0;
  received_amount numeric := 0;
  adjustment record;
  income_candidate record;
  remaining_refund numeric := 0;
  refund_piece numeric := 0;
  business_today date;
  meta_occurred_on date;
  meta_payment_id text;
  -- Деньги заявки, пришедшие НЕ через сверку: зачёт платежей инвойса и
  -- ручные доходы с этой заявкой без инвойса.
  held_invoice numeric := 0;
  held_manual numeric := 0;
  -- Чистые суммы авто-доходов (доход минус его возвраты).
  auto_prepayment_held numeric := 0;
  auto_settlement_held numeric := 0;
  auto_all_held numeric := 0;
  auto_settlement_target numeric := 0;
  meta_entry_amount numeric;
  meta_entry_kind text;
  meta_delta numeric;
  -- Открытый инвойс заявки, в котором уже лежат деньги.
  open_invoice_number text;
begin
  if exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'invoice_payment'
       and entity_id = p_appointment_id
  ) then
    return;
  end if;
  if exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'appointment_payment_cancel'
       and entity_id = p_appointment_id
  ) then
    return;
  end if;

  select * into appointment_row
    from public.appointments
   where id = p_appointment_id
   for share;
  if not found then
    raise exception 'Заявка для синхронизации оплаты не найдена';
  end if;
  business_today := public.tenant_business_date(appointment_row.tenant_id);
  select c.occurred_on, c.payment_id
    into meta_occurred_on, meta_payment_id
    from public._finance_write_context c
   where c.transaction_id = txid_current()
     and c.kind = 'appointment_payment_meta'
     and c.entity_id = p_appointment_id
   limit 1;

  -- ПЛИТКА ПРИ ОТКРЫТОМ ИНВОЙСЕ С ДЕНЬГАМИ. Платёж плитки (контекст
  -- `appointment_payment_meta` кладёт `record_appointment_payment`) занял бы
  -- остаток, который принадлежит инвойсу: сам инвойс после этого не принял
  -- бы ни цента, а аннулировать инвойс с деньгами нельзя. До шага 5, где
  -- плитка платит сам инвойс, — отказ. Снять платёж плитки можно всегда: в
  -- контексте `cancel_appointment_payment` сверка не работает.
  if meta_payment_id is not null then
    select i.number into open_invoice_number
      from public.invoices i
     where i.appointment_id = appointment_row.id
       and i.tenant_id = appointment_row.tenant_id
       and i.kind = 'invoice'
       and i.status = 'issued'
       and coalesce((
         select sum(tx.amount)
           from public.finance_transactions tx
           left join public.finance_transactions original
             on original.id = tx.refund_of_id
          where tx.tenant_id = appointment_row.tenant_id
            and tx.source = 'manual'
            and tx.type in ('income', 'refund')
            and coalesce(tx.invoice_id, original.invoice_id) = i.id
       ), 0) > 0
     order by i.issued_on, i.number
     limit 1;
    if open_invoice_number is not null then
      raise exception 'По заявке открыт инвойс % — оплату примите в нём', open_invoice_number;
    end if;
  end if;

  if appointment_row.total_amount = 'NaN'::numeric
     or appointment_row.prepaid_amount = 'NaN'::numeric
     or appointment_row.paid_amount = 'NaN'::numeric
     or appointment_row.total_amount < 0
     or appointment_row.prepaid_amount < 0
     or appointment_row.paid_amount < 0 then
    raise exception 'Суммы оплаты заявки некорректны';
  end if;
  if appointment_row.prepaid_amount > appointment_row.total_amount then
    raise exception 'Предоплата не может быть больше итоговой суммы';
  end if;
  if round(appointment_row.total_amount, 2) is distinct from appointment_row.total_amount
     or round(appointment_row.prepaid_amount, 2) is distinct from appointment_row.prepaid_amount
     or round(appointment_row.paid_amount, 2) is distinct from appointment_row.paid_amount then
    raise exception 'Укажите не больше двух знаков после запятой';
  end if;
  received_amount := appointment_row.prepaid_amount + case
    when appointment_row.payment_status in ('partial', 'paid')
      then appointment_row.paid_amount
    else 0
  end;
  if appointment_row.status <> 'cancelled'
     and appointment_row.payment_status <> 'refunded' then
    if received_amount > appointment_row.total_amount then
      raise exception 'Полученная сумма больше итога заявки';
    end if;
    if appointment_row.payment_status = 'paid'
       and appointment_row.total_amount > 0
       and received_amount < appointment_row.total_amount then
      raise exception 'Для статуса «Оплачено» не хватает полученной суммы';
    end if;
    if appointment_row.payment_status = 'partial'
       and (received_amount <= 0 or received_amount >= appointment_row.total_amount) then
      raise exception 'Частичная оплата должна быть меньше итога заявки';
    end if;
    if appointment_row.payment_status = 'unpaid'
       and appointment_row.paid_amount > 0 then
      raise exception 'Сумма доплаты указана для неоплаченной заявки';
    end if;
  end if;
  if received_amount > 0 and (
    appointment_row.payment_method is null
    or appointment_row.payment_method not in ('cash', 'card', 'transfer', 'other')
  ) then
    raise exception 'Выберите способ оплаты заявки';
  end if;

  if appointment_row.status <> 'cancelled'
     and appointment_row.payment_status <> 'refunded' then
    new_prepayment_target := greatest(appointment_row.prepaid_amount, 0);
    new_settlement_target := case appointment_row.payment_status
      when 'paid' then greatest(
        appointment_row.total_amount - appointment_row.prepaid_amount,
        0
      )
      when 'partial' then greatest(appointment_row.paid_amount, 0)
      else 0
    end;
  end if;

  -- ЗАЧЁТ ПЛАТЕЖЕЙ ИНВОЙСА. settle кладёт в `payments[]` элемент
  -- `pay-inv-<id дохода>` с суммой, которую он зачёл в заявку (не больше её
  -- остатка — «сверху» доход инвойса больше зачёта). Зачёт дохода — сумма
  -- его элементов, но не больше чистой суммы самого дохода: возвращённое в
  -- заявке не лежит. Элемент без своего ручного дохода не значит ничего.
  select coalesce(sum(least(credit.entry_sum, greatest(credit.net, 0))), 0)
    into held_invoice
    from (
      select income.amount - coalesce((
               select sum(abs(refund.amount))
                 from public.finance_transactions refund
                where refund.refund_of_id = income.id
                  and refund.type = 'refund'
             ), 0) as net,
             (
               select sum(round((e.elem ->> 'amount')::numeric, 2))
                 from jsonb_array_elements(coalesce(appointment_row.payments, '[]'::jsonb)) as e(elem)
                where e.elem ->> 'id' = 'pay-inv-' || income.id::text
             ) as entry_sum
        from public.finance_transactions income
       where income.appointment_id = appointment_row.id
         and income.type = 'income'
         and income.source = 'manual'
         and income.invoice_id is not null
    ) credit
   where credit.entry_sum > 0;

  -- РУЧНЫЕ ДОХОДЫ С ЗАЯВКОЙ БЕЗ ИНВОЙСА — тоже деньги этой работы.
  select coalesce(sum(greatest(income.amount - coalesce((
           select sum(abs(refund.amount))
             from public.finance_transactions refund
            where refund.refund_of_id = income.id
              and refund.type = 'refund'
         ), 0), 0)), 0)
    into held_manual
    from public.finance_transactions income
   where income.appointment_id = appointment_row.id
     and income.source = 'manual'
     and income.type = 'income'
     and income.invoice_id is null;

  -- ЧТО УЖЕ ПРОВЕЛА САМА СВЕРКА: чистые авто-доходы по видам.
  select
    count(*) filter (where held.payment_kind is null),
    coalesce(sum(held.net) filter (where held.payment_kind = 'prepayment'), 0),
    coalesce(sum(held.net) filter (where held.payment_kind = 'settlement'), 0),
    coalesce(sum(held.net), 0)
    into legacy_income_count, auto_prepayment_held, auto_settlement_held, auto_all_held
    from (
      select income.appointment_payment_kind as payment_kind,
             income.amount - coalesce((
               select sum(abs(refund.amount))
                 from public.finance_transactions refund
                where refund.refund_of_id = income.id
                  and refund.type = 'refund'
             ), 0) as net
        from public.finance_transactions income
       where income.appointment_id = appointment_row.id
         and income.source = 'auto'
         and income.type = 'income'
    ) held;

  -- ДЕЛЬТА = ЦЕЛЬ АВТО МИНУС УЖЕ ПРОВЕДЁННОЕ. Деньги инвойса и ручные доходы
  -- гасят только доплату: предоплата бывает лишь с плитки.
  auto_settlement_target := greatest(
    new_settlement_target - held_invoice - held_manual,
    0
  );
  if legacy_income_count > 0 then
    total_delta :=
      (new_prepayment_target + auto_settlement_target) - auto_all_held;
  else
    prepayment_delta := new_prepayment_target - auto_prepayment_held;
    settlement_delta := auto_settlement_target - auto_settlement_held;
  end if;

  -- ПЛАТЁЖ ПЛИТКИ ПРОВОДИТСЯ ЦЕЛИКОМ. `record_appointment_payment` уже положил
  -- элемент в заявку; если сверка может провести меньше его суммы, часть этих
  -- денег уже лежит в журнале — не пишем и не теряем молча.
  if meta_payment_id is not null then
    select round((e.elem ->> 'amount')::numeric, 2), 'settlement'
      into meta_entry_amount, meta_entry_kind
      from jsonb_array_elements(coalesce(appointment_row.payments, '[]'::jsonb)) as e(elem)
     where e.elem ->> 'id' = meta_payment_id
     limit 1;
    if meta_entry_amount is null then
      select round((e.elem ->> 'amount')::numeric, 2), 'prepayment'
        into meta_entry_amount, meta_entry_kind
        from jsonb_array_elements(coalesce(appointment_row.prepayments, '[]'::jsonb)) as e(elem)
       where e.elem ->> 'id' = meta_payment_id
       limit 1;
    end if;
    if meta_entry_amount is not null then
      meta_delta := case
        when legacy_income_count > 0 then total_delta
        when meta_entry_kind = 'prepayment' then prepayment_delta
        else settlement_delta
      end;
      if meta_delta < meta_entry_amount then
        raise exception 'Деньги по заявке уже учтены — сверка их не задвоит';
      end if;
    end if;
  end if;

  if prepayment_delta = 0 and settlement_delta = 0 and total_delta = 0 then
    return;
  end if;

  -- ДОПЛАТА ПРИ ПОТЕРЯННОМ ЗАЧЁТЕ ИНВОЙСА. Деньги инвойса дают заявке зачёт до
  -- меньшего из двух: их чистой суммы и суммы строк инвойса (работа; налог
  -- «сверху» — не работа). Зачёт меньше — значит, элементы `pay-inv-…` стёрла
  -- посторонняя правка `payments` (устаревший реплей старой сборки), и сколько
  -- денег инвойса уже в заявке, не знает никто. Доплатить поверх значило бы
  -- задвоить.
  if (settlement_delta > 0 or total_delta > 0) and exists (
    select 1
      from (
        select income.invoice_id,
               sum(greatest(credit.net, 0)) as net_money,
               sum(case
                 when credit.entry_sum > 0
                   then least(credit.entry_sum, greatest(credit.net, 0))
                 else 0
               end) as credited
          from public.finance_transactions income
          cross join lateral (
            select income.amount - coalesce((
                     select sum(abs(refund.amount))
                       from public.finance_transactions refund
                      where refund.refund_of_id = income.id
                        and refund.type = 'refund'
                   ), 0) as net,
                   (
                     select sum(round((e.elem ->> 'amount')::numeric, 2))
                       from jsonb_array_elements(coalesce(appointment_row.payments, '[]'::jsonb)) as e(elem)
                      where e.elem ->> 'id' = 'pay-inv-' || income.id::text
                   ) as entry_sum
          ) credit
         where income.appointment_id = appointment_row.id
           and income.type = 'income'
           and income.source = 'manual'
           and income.invoice_id is not null
         group by income.invoice_id
      ) per_invoice
     where per_invoice.credited < least(
             per_invoice.net_money,
             coalesce((
               select sum(line.total)
                 from public.invoice_lines line
                where line.invoice_id = per_invoice.invoice_id
             ), 0)
           )
  ) then
    raise exception 'Деньги по заявке уже учтены — сверка их не задвоит';
  end if;

  select id into services_category_id
    from public.finance_categories
   where slug = 'services'
     and (tenant_id is null or tenant_id = appointment_row.tenant_id)
   order by tenant_id nulls last
   limit 1;
  select id into refund_category_id
    from public.finance_categories
   where slug = 'refund'
     and type = 'income'
     and (tenant_id is null or tenant_id = appointment_row.tenant_id)
   order by tenant_id nulls last
   limit 1;

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (
    txid_current(), 'appointment_auto', appointment_row.id, appointment_row.tenant_id
  )
  on conflict do nothing;

  for adjustment in
    select * from (values
      ('prepayment'::text, prepayment_delta),
      ('settlement'::text, settlement_delta),
      ('all'::text, total_delta)
    ) changes(payment_kind, amount)
    where amount <> 0
  loop
    if adjustment.amount > 0 then
      resolved_account_id := public.resolve_appointment_payment_account(
        appointment_row.tenant_id,
        appointment_row.team_id,
        appointment_row.payment_method,
        appointment_row.payment_account_id
      );
      insert into public.finance_transactions (
        tenant_id, type, amount, category_id, account_id, appointment_id,
        client_id, team_id, master_id, payment_method, occurred_on, source,
        appointment_payment_kind, notes, appointment_payment_id
      ) values (
        appointment_row.tenant_id,
        'income',
        round(adjustment.amount, 2),
        services_category_id,
        resolved_account_id,
        appointment_row.id,
        appointment_row.client_id,
        appointment_row.team_id,
        appointment_row.master_id,
        appointment_row.payment_method,
        coalesce(meta_occurred_on, business_today),
        'auto',
        case
          when adjustment.payment_kind = 'prepayment' then 'prepayment'
          else 'settlement'
        end,
        case
          when adjustment.payment_kind = 'prepayment' then 'Предоплата по заявке'
          else 'Оплата по заявке'
        end,
        meta_payment_id
      );
    else
      remaining_refund := abs(round(adjustment.amount, 2));
      for income_candidate in
        select
          income.id,
          income.account_id,
          income.client_id,
          income.team_id,
          income.master_id,
          income.payment_method,
          income.invoice_id,
          coalesce(income.appointment_payment_kind, 'settlement') as payment_kind,
          greatest(
            income.amount - coalesce((
              select sum(abs(refund.amount))
                from public.finance_transactions refund
               where refund.refund_of_id = income.id
                 and refund.type = 'refund'
            ), 0),
            0
          ) as refundable
        from public.finance_transactions income
        where income.appointment_id = appointment_row.id
          and income.source = 'auto'
          and income.type = 'income'
          and (
            adjustment.payment_kind = 'all'
            or coalesce(income.appointment_payment_kind, 'settlement') =
               adjustment.payment_kind
          )
        order by income.created_at desc, income.id desc
        for update of income
      loop
        exit when remaining_refund <= 0;
        if income_candidate.refundable <= 0 then continue; end if;
        refund_piece := least(remaining_refund, income_candidate.refundable);
        insert into public.finance_transactions (
          tenant_id, type, amount, category_id, account_id, appointment_id,
          client_id, team_id, master_id, payment_method, occurred_on, source,
          refund_of_id, invoice_id, appointment_payment_kind, notes
        ) values (
          appointment_row.tenant_id,
          'refund',
          -refund_piece,
          refund_category_id,
          income_candidate.account_id,
          appointment_row.id,
          income_candidate.client_id,
          income_candidate.team_id,
          income_candidate.master_id,
          income_candidate.payment_method,
          business_today,
          'auto',
          income_candidate.id,
          income_candidate.invoice_id,
          income_candidate.payment_kind,
          case
            when appointment_row.status = 'cancelled'
              then 'Возврат при отмене заявки'
            when appointment_row.payment_status = 'refunded'
              then 'Возврат оплаты заявки'
            else 'Изменение предоплаты по заявке'
          end
        );
        remaining_refund := remaining_refund - refund_piece;
      end loop;
      if remaining_refund > 0 then
        raise exception 'Не удалось вернуть всю сумму; финансовая история не изменена';
      end if;
    end if;
  end loop;

  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'appointment_auto'
     and entity_id = appointment_row.id;
end;
$function$;

-- 5, 6. SETTLE: АВТО-СТРОКА — НЕ ПЛАТЁЖ ИНВОЙСА, ВОЗВРАТ ДЕРЖИТ ЗАЧЁТ.
-- Остальное тело не менялось.
CREATE OR REPLACE FUNCTION public.settle_appointment_from_invoice_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  appt public.appointments%rowtype;
  room numeric;
  applied numeric;
  new_paid numeric;
  received numeric;
  is_refund boolean;
  -- Возврат: элемент исходного платежа в заявке и его зачёт до и после.
  entry_id text;
  entry_credit numeric := 0;
  entry_position bigint;
  income_net numeric := 0;
  credit_after numeric := 0;
begin
  -- Авто-строка — не платёж инвойса: её деньги в заявке держит сверка.
  -- `invoice_id` у авто-дохода — только привязка к бумаге, а у авто-возврата —
  -- наследство от такого дохода.
  if new.source = 'auto' then
    return new;
  end if;

  is_refund := new.type = 'refund' and new.invoice_id is not null
               and new.appointment_id is not null and new.amount < 0;
  if not is_refund and (
       new.type <> 'income'
       or new.invoice_id is null
       or new.appointment_id is null
       or new.amount <= 0
     ) then
    return new;
  end if;

  select * into appt
    from public.appointments
   where id = new.appointment_id and tenant_id = new.tenant_id
   for update;
  if not found then return new; end if;
  if appt.status = 'cancelled' or appt.payment_status = 'refunded' then
    return new;
  end if;

  if is_refund then
    -- ЗАЧЁТ ПОСЛЕ ВОЗВРАТА. Элемент `pay-inv-<исходный доход>` держит то, что
    -- доход зачёл в заявку. После возврата зачёт — меньшее из прежнего и
    -- чистой суммы дохода (эта строка возврата уже в журнале). Возврат той
    -- части, что в заявку не легла (налог «сверху», платёж без зачёта),
    -- заявку не трогает; элемент уходит только в ноль. Раньше элемент
    -- снимался целиком, а `paid_amount` падал на сумму возврата — зачёт
    -- расходился с заявкой, и её правки замерзали на сверке.
    entry_id := 'pay-inv-' || new.refund_of_id::text;
    select coalesce(sum(round((e.elem ->> 'amount')::numeric, 2)), 0),
           min(e.ord)
      into entry_credit, entry_position
      from jsonb_array_elements(coalesce(appt.payments, '[]'::jsonb))
        with ordinality as e(elem, ord)
     where e.elem ->> 'id' = entry_id;
    if entry_position is null then
      return new;
    end if;
    select income.amount - coalesce((
             select sum(abs(refund.amount))
               from public.finance_transactions refund
              where refund.refund_of_id = income.id
                and refund.type = 'refund'
           ), 0)
      into income_net
      from public.finance_transactions income
     where income.id = new.refund_of_id;
    credit_after := greatest(least(entry_credit, coalesce(income_net, 0)), 0);
    -- Не ниже нуля: часть могла быть погашена другим путём.
    applied := greatest(credit_after - entry_credit, -appt.paid_amount);
  else
    -- Больше остатка не зачисляем: инвойс может быть выставлен на часть
    -- работ или, наоборот, на несколько заявок.
    room := greatest(appt.total_amount - appt.prepaid_amount - appt.paid_amount, 0);
    if room <= 0 then return new; end if;
    applied := least(round(new.amount, 2), room);
  end if;
  if applied = 0 then return new; end if;

  new_paid := round(appt.paid_amount + applied, 2);
  received := appt.prepaid_amount + new_paid;

  insert into public._finance_write_context
    (transaction_id, kind, entity_id, tenant_id)
  values (txid_current(), 'invoice_payment', appt.id, appt.tenant_id)
  on conflict do nothing;

  update public.appointments
     set paid_amount = new_paid,
         -- Способ появляется у заявки, только если его ещё не было: у
         -- предоплаты свой способ, и перебивать его платежом инвойса нельзя.
         payment_method = case
           when new_paid = 0 and prepaid_amount = 0 then null
           else coalesce(payment_method, new.payment_method)
         end,
         payment_status = case
           when received <= 0 then 'unpaid'
           when total_amount > 0 and received >= total_amount then 'paid'
           else 'partial'
         end,
         -- Витрина платежей карточки: без строки в леджере долг на экране
         -- не гаснет, сколько бы денег ни легло на счёт. Возврат МЕНЯЕТ свою
         -- строку до нового зачёта и снимает её только в ноль, а не
         -- добавляет отрицательную — иначе история платежей превращается в
         -- бухгалтерскую ленту.
         payments = case
           when is_refund then coalesce((
             select jsonb_agg(
                      case
                        when e.ord = entry_position
                          then jsonb_set(e.elem, '{amount}', to_jsonb(credit_after))
                        else e.elem
                      end
                      order by e.ord
                    )
               from jsonb_array_elements(coalesce(payments, '[]'::jsonb))
                 with ordinality as e(elem, ord)
              where e.elem ->> 'id' is distinct from entry_id
                 or (e.ord = entry_position and credit_after > 0)
           ), '[]'::jsonb)
           else coalesce(payments, '[]'::jsonb) || jsonb_build_array(
             jsonb_build_object(
               'id', 'pay-inv-' || new.id::text,
               'method', new.payment_method,
               'amount', applied,
               'paid_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               'account_id', new.account_id
             )
           )
         end
   where id = appt.id and tenant_id = appt.tenant_id;

  delete from public._finance_write_context
   where transaction_id = txid_current()
     and kind = 'invoice_payment'
     and entity_id = appt.id;
  return new;
end;
$function$;

-- 3. ИНВОЙС НЕ БЕРЁТ ДЕНЬГИ ЗА УЖЕ ОПЛАЧЕННУЮ РАБОТУ (RPC). Раньше settle
-- молча выходил при нулевом остатке, а деньги оставались на счёте вторым
-- доходом. Остальное тело не менялось.
CREATE OR REPLACE FUNCTION public.record_invoice_payment(p_invoice_id uuid, p_request_id uuid, p_amount numeric, p_account_id uuid, p_payment_method text, p_occurred_on date DEFAULT NULL::date, p_notes text DEFAULT NULL::text)
 RETURNS finance_transactions
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  invoice_row public.invoices%rowtype;
  account_row public.accounts%rowtype;
  payment_row public.finance_transactions%rowtype;
  appointment_row public.appointments%rowtype;
  income_total numeric(12,2) := 0;
  direct_refunds numeric(12,2) := 0;
  linked_refunds numeric(12,2) := 0;
  paid_total numeric(12,2) := 0;
  remaining_total numeric(12,2) := 0;
  amount_value numeric(12,2);
  payment_date date;
  affected integer := 0;
  payment_vat_mode text;
  payment_vat_rate numeric;
  payment_vat_amount numeric;
  -- Деньги заявки вне этого инвойса и работа инвойса (сумма его строк).
  credited_here numeric := 0;
  other_money numeric := 0;
  invoice_work numeric := 0;
begin
  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Недостаточно прав для оплаты инвойса';
  end if;
  if p_request_id is null then
    raise exception 'Не указан идентификатор платежа';
  end if;

  amount_value := round(p_amount, 2);
  if amount_value is null or amount_value <= 0 then
    raise exception 'Сумма платежа должна быть больше нуля';
  end if;
  if amount_value is distinct from p_amount then
    raise exception 'Укажите не больше двух знаков после запятой';
  end if;
  if amount_value > 999999999.99 then
    raise exception 'Сумма платежа слишком большая';
  end if;
  if p_payment_method is null or p_payment_method not in ('cash', 'card', 'transfer', 'other') then
    raise exception 'Некорректный способ оплаты';
  end if;
  payment_date := coalesce(
    p_occurred_on,
    public.tenant_business_date(tenant_uuid)
  );
  if payment_date > public.tenant_business_date(tenant_uuid) then
    raise exception 'Платёж нельзя записать будущей датой';
  end if;

  -- Idempotent network retry: return the payment committed by this request.
  select * into payment_row
    from public.finance_transactions
   where id = p_request_id
     and tenant_id = tenant_uuid
     and invoice_id = p_invoice_id
     and type = 'income';
  if found then
    if payment_row.amount <> amount_value
       or payment_row.account_id is distinct from p_account_id
       or payment_row.payment_method is distinct from p_payment_method
       or payment_row.occurred_on <> payment_date
       or (
         nullif(btrim(p_notes), '') is not null
         and payment_row.notes is distinct from nullif(btrim(p_notes), '')
       ) then
      raise exception 'Идентификатор платежа уже использован с другими данными';
    end if;
    return payment_row;
  end if;

  select * into invoice_row
    from public.invoices
   where id = p_invoice_id
     and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Инвойс не найден или недоступен';
  end if;

  -- A concurrent retry can pass the optimistic lookup before the first
  -- request commits, then wait here on the invoice lock. Recheck after the
  -- lock so that retry returns the committed row instead of a UUID conflict.
  select * into payment_row
    from public.finance_transactions
   where id = p_request_id
     and tenant_id = tenant_uuid
     and invoice_id = p_invoice_id
     and type = 'income';
  if found then
    if payment_row.amount <> amount_value
       or payment_row.account_id is distinct from p_account_id
       or payment_row.payment_method is distinct from p_payment_method
       or payment_row.occurred_on <> payment_date
       or (
         nullif(btrim(p_notes), '') is not null
         and payment_row.notes is distinct from nullif(btrim(p_notes), '')
       ) then
      raise exception 'Идентификатор платежа уже использован с другими данными';
    end if;
    return payment_row;
  end if;

  if invoice_row.status = 'void' then
    raise exception 'Аннулированный инвойс нельзя оплачивать';
  end if;
  -- ОТМЕНЁННЫЙ КРЕДИТ-НОТОЙ — ТОЖЕ КОНЕЦ ПУТИ (статус `cancelled` из
  -- 20260915120000). Отказ явный, как у аннулированного, и не ждёт, пока
  -- статус пересчитается по журналу.
  if invoice_row.status = 'cancelled' then
    raise exception 'Инвойс отменён кредит-нотой — оплату по нему принять нельзя';
  end if;

  select * into account_row
    from public.accounts
   where id = p_account_id
     and tenant_id = tenant_uuid
     and is_active = true;
  if not found then
    raise exception 'Финансовый счёт не найден или закрыт';
  end if;
  if account_row.kind <> (case p_payment_method
       when 'cash' then 'cash'
       when 'card' then 'card'
       when 'transfer' then 'bank'
       else 'other'
     end) then
    raise exception 'Способ оплаты не соответствует выбранному счёту';
  end if;
  if invoice_row.brigade_id is not null
     and not public.account_serves_team(account_row.id, invoice_row.brigade_id) then
    raise exception 'Счёт должен принадлежать команде инвойса';
  end if;

  select
    coalesce(sum(case when type = 'income' then greatest(amount, 0) else 0 end), 0),
    coalesce(sum(case when type = 'refund' then abs(amount) else 0 end), 0)
    into income_total, direct_refunds
    from public.finance_transactions
   where tenant_id = tenant_uuid
     and invoice_id = p_invoice_id
     and type in ('income', 'refund');

  -- Older refund writers only set refund_of_id. Count those too, but not a
  -- refund already selected above through its own invoice_id.
  select coalesce(sum(abs(refund.amount)), 0)
    into linked_refunds
    from public.finance_transactions refund
    join public.finance_transactions original
      on original.id = refund.refund_of_id
   where original.tenant_id = tenant_uuid
     and original.invoice_id = p_invoice_id
     and original.type = 'income'
     and refund.tenant_id = tenant_uuid
     and refund.type = 'refund'
     and refund.invoice_id is null;

  paid_total := greatest(
    0,
    case
      when invoice_row.status = 'paid'
        then greatest(invoice_row.total, income_total)
      else income_total
    end - direct_refunds - linked_refunds
  );
  remaining_total := greatest(0, invoice_row.total - paid_total);

  if remaining_total <= 0 then
    raise exception 'Инвойс уже полностью оплачен';
  end if;
  if amount_value > remaining_total then
    raise exception 'Платёж превышает остаток % %', round(remaining_total, 2), invoice_row.currency;
  end if;

  -- ДЕНЬГИ ВНЕ ИНВОЙСА. Заявка уже держит деньги, пришедшие другой дорогой
  -- (предоплата, плитка, ручной доход, другой инвойс), и вместе с работой
  -- этого инвойса — суммой его строк, без налога «сверху» — они больше итога
  -- заявки: инвойс выставлен на уже оплаченную работу, и его деньги легли бы
  -- вторым доходом. Свой зачёт инвойса (элементы `pay-inv-…` его платежей)
  -- деньгами вне инвойса не считается: налог «сверху» после зачтённой работы
  -- принимается, settle зачтёт ноль. Проверка стоит после «Инвойс уже
  -- полностью оплачен» — у оплаченного инвойса ответ прежний. Отменённую
  -- заявку settle не трогает — здесь тоже. Заявка под замком: плитка,
  -- оплатившая её параллельно, дождётся или будет дождана.
  if invoice_row.appointment_id is not null then
    select * into appointment_row
      from public.appointments
     where id = invoice_row.appointment_id
       and tenant_id = tenant_uuid
     for update;
    if found
       and appointment_row.status <> 'cancelled'
       and appointment_row.payment_status <> 'refunded' then
      select coalesce(sum(least(credit.entry_sum, greatest(credit.net, 0))), 0)
        into credited_here
        from (
          select income.amount - coalesce((
                   select sum(abs(refund.amount))
                     from public.finance_transactions refund
                    where refund.refund_of_id = income.id
                      and refund.type = 'refund'
                 ), 0) as net,
                 (
                   select sum(round((e.elem ->> 'amount')::numeric, 2))
                     from jsonb_array_elements(coalesce(appointment_row.payments, '[]'::jsonb)) as e(elem)
                    where e.elem ->> 'id' = 'pay-inv-' || income.id::text
                 ) as entry_sum
            from public.finance_transactions income
           where income.appointment_id = appointment_row.id
             and income.invoice_id = invoice_row.id
             and income.type = 'income'
             and income.source = 'manual'
        ) credit
       where credit.entry_sum > 0;
      other_money := appointment_row.prepaid_amount + case
          when appointment_row.payment_status in ('partial', 'paid')
            then appointment_row.paid_amount
          else 0
        end - credited_here;
      select coalesce(sum(line.total), 0)
        into invoice_work
        from public.invoice_lines line
       where line.invoice_id = invoice_row.id;
      if other_money > 0
         and other_money + invoice_work > appointment_row.total_amount then
        if appointment_row.total_amount - other_money > 0 then
          raise exception 'По заявке уже есть оплата вне инвойса — аннулируйте инвойс и выставьте новый на остаток % %',
            round(appointment_row.total_amount - other_money, 2), invoice_row.currency;
        end if;
        raise exception 'По заявке уже есть оплата вне инвойса — аннулируйте инвойс';
      end if;
    end if;
  end if;

  -- Налог платежа — с бумаги, не из настроек: частичная оплата несёт
  -- пропорциональную долю напечатанного на инвойсе НДС.
  if coalesce(invoice_row.vat_amount, 0) <> 0 and coalesce(invoice_row.total, 0) <> 0 then
    payment_vat_mode := 'inclusive';
    payment_vat_rate := invoice_row.vat_percent;
    payment_vat_amount := round(invoice_row.vat_amount * amount_value / invoice_row.total, 2);
  else
    payment_vat_mode := 'none';
    payment_vat_rate := null;
    payment_vat_amount := null;
  end if;

  insert into public.finance_transactions (
    id,
    tenant_id,
    type,
    amount,
    currency,
    account_id,
    appointment_id,
    client_id,
    team_id,
    payment_method,
    notes,
    occurred_on,
    invoice_id,
    source,
    vat_mode,
    vat_rate,
    vat_amount
  ) values (
    p_request_id,
    tenant_uuid,
    'income',
    amount_value,
    invoice_row.currency,
    account_row.id,
    invoice_row.appointment_id,
    invoice_row.client_id,
    coalesce(invoice_row.brigade_id, account_row.brigade_id),
    p_payment_method,
    coalesce(nullif(btrim(p_notes), ''), 'Оплата инвойса ' || invoice_row.number),
    payment_date,
    invoice_row.id,
    'manual',
    payment_vat_mode,
    payment_vat_rate,
    payment_vat_amount
  )
  returning * into payment_row;

  update public.invoices
     set status = case
       when paid_total + amount_value >= invoice_row.total then 'paid'
       else 'issued'
     end
   where id = invoice_row.id
     and tenant_id = tenant_uuid;
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Статус инвойса не обновлён';
  end if;

  return payment_row;
end;
$function$;

-- 3. ТО ЖЕ ПРАВИЛО НА ЛЮБОЙ ДОРОГЕ ВСТАВКИ. Доход с инвойсом, минуя RPC,
-- упирается в ту же проверку. Возвраты сюда не заходят — их ветка выше.
-- Остальное тело не менялось.
CREATE OR REPLACE FUNCTION public.validate_invoice_payment_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  invoice_row public.invoices%rowtype;
  original_row public.finance_transactions%rowtype;
  appointment_row public.appointments%rowtype;
  income_total numeric := 0;
  direct_refunds numeric := 0;
  linked_refunds numeric := 0;
  paid_total numeric := 0;
  remaining_total numeric := 0;
  refunded_original numeric := 0;
  account_team_id text;
  account_kind text;
  -- Деньги заявки вне этого инвойса и работа инвойса (сумма его строк).
  credited_here numeric := 0;
  other_money numeric := 0;
  invoice_work numeric := 0;
begin
  if new.type = 'refund' and new.refund_of_id is not null then
    select * into original_row
      from public.finance_transactions
     where id = new.refund_of_id
       and tenant_id = new.tenant_id
       and type = 'income'
     for update;
    if not found then
      raise exception 'Исходный доход для возврата не найден';
    end if;
    if new.invoice_id is not null
       and new.invoice_id is distinct from original_row.invoice_id then
      raise exception 'Возврат относится к другому инвойсу';
    end if;
    if abs(new.amount) <= 0 then
      raise exception 'Сумма возврата должна быть больше нуля';
    end if;
    new.amount := -round(abs(new.amount), 2);
    if new.account_id is distinct from original_row.account_id
       or (
         new.team_id is not null
         and new.team_id is distinct from original_row.team_id
       ) then
      raise exception 'Возврат должен пройти по исходному счёту и команде';
    end if;
    if new.payment_method is not null
       and new.payment_method is distinct from original_row.payment_method then
      raise exception 'Возврат должен использовать способ исходного платежа';
    end if;

    select coalesce(sum(abs(amount)), 0) into refunded_original
      from public.finance_transactions
     where refund_of_id = original_row.id
       and type = 'refund';
    if refunded_original + abs(new.amount) > greatest(original_row.amount, 0) then
      raise exception 'Возврат превышает остаток исходного дохода';
    end if;

    new.invoice_id := original_row.invoice_id;
    new.currency := original_row.currency;
    new.appointment_id := original_row.appointment_id;
    new.client_id := original_row.client_id;
    new.team_id := original_row.team_id;
    new.master_id := original_row.master_id;
    new.payment_method := original_row.payment_method;
    if new.invoice_id is not null then
      select * into invoice_row
        from public.invoices
       where id = new.invoice_id
         and tenant_id = new.tenant_id
       for update;
      if not found or invoice_row.status = 'void' then
        raise exception 'Инвойс для возврата не найден или аннулирован';
      end if;
    end if;
    return new;
  end if;

  if new.invoice_id is null then
    return new;
  end if;
  if new.type <> 'income' or new.source <> 'manual' then
    raise exception 'К инвойсу можно добавить только ручной платёж или корректный возврат';
  end if;
  if new.amount <= 0 then
    raise exception 'Сумма платежа должна быть больше нуля';
  end if;
  if new.refund_of_id is not null or new.transfer_group_id is not null then
    raise exception 'Платёж инвойса не может быть возвратом или переводом';
  end if;
  if new.payment_method is null
     or new.payment_method not in ('cash', 'card', 'transfer', 'other') then
    raise exception 'Некорректный способ оплаты инвойса';
  end if;

  select * into invoice_row
    from public.invoices
   where id = new.invoice_id
     and tenant_id = new.tenant_id
   for update;
  if not found or invoice_row.status = 'void' then
    raise exception 'Инвойс не найден или аннулирован';
  end if;
  -- Отменённый кредит-нотой инвойс оплату не принимает ни одной дорогой.
  if invoice_row.status = 'cancelled' then
    raise exception 'Инвойс отменён кредит-нотой — оплату по нему принять нельзя';
  end if;
  select brigade_id, kind into account_team_id, account_kind
    from public.accounts
   where id = new.account_id
     and tenant_id = new.tenant_id
     and is_active = true;
  if not found or (
    invoice_row.brigade_id is not null
    and not public.account_serves_team(new.account_id, invoice_row.brigade_id)
  ) then
    raise exception 'Финансовый счёт не найден или не относится к команде инвойса';
  end if;
  if account_kind <> (case new.payment_method
       when 'cash' then 'cash'
       when 'card' then 'card'
       when 'transfer' then 'bank'
       else 'other'
     end) then
    raise exception 'Способ оплаты не соответствует выбранному счёту';
  end if;

  new.currency := invoice_row.currency;
  new.appointment_id := invoice_row.appointment_id;
  new.client_id := invoice_row.client_id;
  new.team_id := coalesce(invoice_row.brigade_id, account_team_id);

  select
    coalesce(sum(case when type = 'income' then greatest(amount, 0) else 0 end), 0),
    coalesce(sum(case when type = 'refund' then abs(amount) else 0 end), 0)
    into income_total, direct_refunds
    from public.finance_transactions
   where invoice_id = invoice_row.id
     and type in ('income', 'refund');
  select coalesce(sum(abs(refund.amount)), 0) into linked_refunds
    from public.finance_transactions refund
    join public.finance_transactions original on original.id = refund.refund_of_id
   where original.invoice_id = invoice_row.id
     and original.type = 'income'
     and refund.type = 'refund'
     and refund.invoice_id is null;
  paid_total := greatest(
    0,
    case
      when invoice_row.status = 'paid' then greatest(invoice_row.total, income_total)
      else income_total
    end - direct_refunds - linked_refunds
  );
  remaining_total := greatest(0, invoice_row.total - paid_total);
  if remaining_total <= 0 or new.amount > remaining_total then
    raise exception 'Платёж превышает остаток инвойса';
  end if;

  -- ДЕНЬГИ ВНЕ ИНВОЙСА — то же правило, что в `record_invoice_payment`, и там
  -- же, после проверки остатка инвойса.
  if invoice_row.appointment_id is not null then
    select * into appointment_row
      from public.appointments
     where id = invoice_row.appointment_id
       and tenant_id = new.tenant_id
     for update;
    if found
       and appointment_row.status <> 'cancelled'
       and appointment_row.payment_status <> 'refunded' then
      select coalesce(sum(least(credit.entry_sum, greatest(credit.net, 0))), 0)
        into credited_here
        from (
          select income.amount - coalesce((
                   select sum(abs(refund.amount))
                     from public.finance_transactions refund
                    where refund.refund_of_id = income.id
                      and refund.type = 'refund'
                 ), 0) as net,
                 (
                   select sum(round((e.elem ->> 'amount')::numeric, 2))
                     from jsonb_array_elements(coalesce(appointment_row.payments, '[]'::jsonb)) as e(elem)
                    where e.elem ->> 'id' = 'pay-inv-' || income.id::text
                 ) as entry_sum
            from public.finance_transactions income
           where income.appointment_id = appointment_row.id
             and income.invoice_id = invoice_row.id
             and income.type = 'income'
             and income.source = 'manual'
        ) credit
       where credit.entry_sum > 0;
      other_money := appointment_row.prepaid_amount + case
          when appointment_row.payment_status in ('partial', 'paid')
            then appointment_row.paid_amount
          else 0
        end - credited_here;
      select coalesce(sum(line.total), 0)
        into invoice_work
        from public.invoice_lines line
       where line.invoice_id = invoice_row.id;
      if other_money > 0
         and other_money + invoice_work > appointment_row.total_amount then
        if appointment_row.total_amount - other_money > 0 then
          raise exception 'По заявке уже есть оплата вне инвойса — аннулируйте инвойс и выставьте новый на остаток % %',
            round(appointment_row.total_amount - other_money, 2), invoice_row.currency;
        end if;
        raise exception 'По заявке уже есть оплата вне инвойса — аннулируйте инвойс';
      end if;
    end if;
  end if;
  return new;
end;
$function$;

-- 7. РУЧНОЙ ДОХОД НЕ ПРИВЯЗЫВАЕТСЯ К ИНВОЙСУ ЗАЯВКИ. Остальное тело не
-- менялось.
CREATE OR REPLACE FUNCTION public.protect_invoice_payment_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  linked_invoice_id uuid;
  target_invoice public.invoices%rowtype;
begin
  -- Let company deletion cascade through all financial history.
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  linked_invoice_id := old.invoice_id;
  if linked_invoice_id is null and old.type = 'refund' and old.refund_of_id is not null then
    select invoice_id into linked_invoice_id
      from public.finance_transactions
     where id = old.refund_of_id;
  end if;
  if linked_invoice_id is not null and exists (
    select 1 from public.invoices where id = linked_invoice_id
  ) then
    raise exception 'Платёж инвойса нельзя изменить или удалить; оформите возврат';
  end if;

  if tg_op = 'UPDATE' and new.invoice_id is not null then
    if old.invoice_id is not null or old.type <> 'income' or new.type <> 'income' then
      raise exception 'Некорректная привязка операции к инвойсу';
    end if;
    if row(
      new.id, new.tenant_id, new.type, new.amount, new.currency,
      new.category_id, new.account_id, new.appointment_id, new.client_id,
      new.team_id, new.master_id, new.payment_method, new.notes,
      new.occurred_on, new.receipt_url, new.transfer_group_id,
      new.refund_of_id, new.source, new.created_at, new.created_by
    ) is distinct from row(
      old.id, old.tenant_id, old.type, old.amount, old.currency,
      old.category_id, old.account_id, old.appointment_id, old.client_id,
      old.team_id, old.master_id, old.payment_method, old.notes,
      old.occurred_on, old.receipt_url, old.transfer_group_id,
      old.refund_of_id, old.source, old.created_at, old.created_by
    ) then
      raise exception 'При привязке к инвойсу нельзя менять операцию';
    end if;

    select * into target_invoice
      from public.invoices
     where id = new.invoice_id
       and tenant_id = old.tenant_id
     for update;
    if not found or target_invoice.status <> 'issued' then
      raise exception 'Инвойс не найден или уже закрыт';
    end if;
    -- РУЧНОЙ ДОХОД ЗАЯВКИ В ИНВОЙС НЕ ПРИВЯЗЫВАЕТСЯ. Привязка — правка
    -- строки: settle (AFTER INSERT) её не видит и в заявку ничего не
    -- зачитывает. Заявка с таким доходом замёрзла бы на сверке («Деньги по
    -- заявке уже учтены»), а заявка только у инвойса приняла бы те же деньги
    -- второй раз плиткой. Деньги заявки попадают в инвойс только оплатой на
    -- его странице. Авто-доход плитки привязывается к инвойсу своей заявки,
    -- как раньше: его держит сверка.
    if old.source = 'manual'
       and (old.appointment_id is not null or target_invoice.appointment_id is not null) then
      raise exception 'Ручной доход не привязывается к инвойсу заявки — оплату заявки примите на странице инвойса';
    end if;
    if round(greatest(old.amount, 0), 2) <> round(target_invoice.total, 2) then
      raise exception 'Сумма дохода не совпадает с итогом инвойса';
    end if;
    if (old.appointment_id is not null
        and old.appointment_id is distinct from target_invoice.appointment_id)
       or (old.client_id is not null
        and old.client_id is distinct from target_invoice.client_id)
       or (old.team_id is not null
        and old.team_id is distinct from target_invoice.brigade_id) then
      raise exception 'Контекст дохода не совпадает с реквизитами инвойса';
    end if;
    if exists (
      select 1 from public.finance_transactions
       where invoice_id = target_invoice.id and id <> old.id
    ) or exists (
      select 1 from public.finance_transactions
       where refund_of_id = old.id and type = 'refund'
    ) then
      raise exception 'Операцию с платежами или возвратами нельзя привязать';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

-- 8–9. ЗАЩИТА ОПЛАЧЕННОЙ ЗАЯВКИ.
-- • Доплата — только та, что не возвращена целиком (N1): после «деньги не
--   поступили» заявка снова правится, как неоплаченная.
-- • Отмена заявки (и статус «возвращена») с деньгами ручного инвойса — отказ,
--   любой дорогой и в любом контексте: сверка их не вернёт.
-- Остальное тело не менялось.
CREATE OR REPLACE FUNCTION public.protect_paid_appointment_finance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  has_any_auto_income boolean := false;
  has_linked_finance boolean := false;
  has_settlement boolean := false;
  undo_context boolean := false;
  prepayment_context boolean := false;
  payment_reset_context boolean := false;
  invoice_payment_context boolean := false;
  payment_cancel_context boolean := false;
  is_refund_transition boolean;
  is_cancel_transition boolean;
  financial_fields_changed boolean;
  received_amount numeric;
  old_settlement_target numeric := 0;
  new_settlement_target numeric := 0;
  settlement_growth boolean := false;
  -- Полученное по НОВОЙ строке, без оглядки на статус.
  received_now numeric := 0;
  -- Статус сам сходил за изменившимся итогом — эта смена разрешена.
  status_follows_total boolean := false;
  -- Работы и цену править можно: деньги получены, леджер не тронут, итог их
  -- покрывает.
  bill_edit_allowed boolean := false;
  -- Номер инвойса, деньги которого ещё лежат на заявке.
  invoice_money_number text;
begin
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return new;
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'Компания заявки неизменяема';
  end if;
  select exists (
    select 1 from public.finance_transactions
     where appointment_id = old.id and source = 'auto' and type = 'income'
  ) into has_any_auto_income;
  select exists (
    select 1 from public.finance_transactions where appointment_id = old.id
  ) into has_linked_finance;
  -- Доплата, возвращённая целиком («деньги не поступили»), доплатой больше не
  -- считается.
  select exists (
    select 1 from public.finance_transactions income
     where income.appointment_id = old.id
       and income.source = 'auto'
       and income.type = 'income'
       and coalesce(income.appointment_payment_kind, 'settlement') = 'settlement'
       and income.amount > coalesce((
         select sum(abs(refund.amount))
           from public.finance_transactions refund
          where refund.refund_of_id = income.id
            and refund.type = 'refund'
       ), 0)
  ) into has_settlement;
  if (
    has_linked_finance
    or exists (select 1 from public.invoices where appointment_id = old.id)
  ) and (
    new.client_id is distinct from old.client_id
    or new.team_id is distinct from old.team_id
    or new.master_id is distinct from old.master_id
  ) then
    raise exception 'Сначала верните оплату; клиента, команду и исполнителя менять нельзя';
  end if;
  -- ОТМЕНА С ДЕНЬГАМИ ИНВОЙСА. Платёж инвойса — ручная строка: сверка его не
  -- вернёт, и заявка стала бы «возвращённой» с деньгами на счёте.
  if (old.status is distinct from 'cancelled' and new.status = 'cancelled')
     or (old.payment_status is distinct from 'refunded' and new.payment_status = 'refunded') then
    select i.number into invoice_money_number
      from public.invoices i
     where i.appointment_id = old.id
       and i.tenant_id = old.tenant_id
       and i.kind = 'invoice'
       and coalesce((
         select sum(tx.amount)
           from public.finance_transactions tx
           left join public.finance_transactions original
             on original.id = tx.refund_of_id
          where tx.tenant_id = old.tenant_id
            and tx.source = 'manual'
            and tx.type in ('income', 'refund')
            and coalesce(tx.invoice_id, original.invoice_id) = i.id
       ), 0) > 0
     order by i.issued_on, i.number
     limit 1;
    if invoice_money_number is not null then
      raise exception 'Сначала верните оплату инвойса %', invoice_money_number;
    end if;
  end if;
  select exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'appointment_undo'
       and entity_id = old.id
       and tenant_id = old.tenant_id
  ) into undo_context;
  select exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'appointment_prepayment'
       and entity_id = old.id
       and tenant_id = old.tenant_id
  ) into prepayment_context;
  select exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'appointment_payment_reset'
       and entity_id = old.id
       and tenant_id = old.tenant_id
  ) into payment_reset_context;
  -- Деньги уже проведены платежом (или возвратом) по инвойсу.
  select exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'invoice_payment'
       and entity_id = old.id
       and tenant_id = old.tenant_id
  ) into invoice_payment_context;
  -- Платёж снят RPC `cancel_appointment_payment`: сторно уже написано.
  select exists (
    select 1 from public._finance_write_context
     where transaction_id = txid_current()
       and kind = 'appointment_payment_cancel'
       and entity_id = old.id
       and tenant_id = old.tenant_id
  ) into payment_cancel_context;
  if undo_context or payment_reset_context or invoice_payment_context
     or payment_cancel_context then
    return new;
  end if;
  if not has_settlement
     and new.status <> 'cancelled'
     and new.payment_status <> 'refunded'
     and new.prepaid_amount > 0
     and new.paid_amount = 0
     and new.total_amount is distinct from old.total_amount then
    new.payment_status := case
      when new.total_amount > 0 and new.prepaid_amount >= new.total_amount
        then 'paid'
      else 'unpaid'
    end;
  end if;
  -- СТАТУС ИДЁТ ЗА ИТОГОМ. Итог вырос выше полученного — заявка частично
  -- оплачена; опустился до полученного — оплачена. Деньги не трогаются: цель
  -- проводки у `partial` равна уже полученному.
  --
  -- Только когда деньги ДЕЙСТВИТЕЛЬНО получены: у заявки, помеченной
  -- оплаченной без единого платежа, полученное равно нулю, и падение в
  -- `unpaid` подсказало бы сверке вернуть несуществующий доход.
  received_now := coalesce(new.prepaid_amount, 0) + coalesce(new.paid_amount, 0);
  if new.status <> 'cancelled'
     and new.payment_status <> 'refunded'
     and old.payment_status in ('paid', 'partial')
     and new.payment_status is not distinct from old.payment_status
     and new.total_amount is distinct from old.total_amount
     and new.paid_amount is not distinct from old.paid_amount
     and new.prepaid_amount is not distinct from old.prepaid_amount
     and coalesce(new.paid_amount, 0) > 0
     and received_now > 0 then
    new.payment_status := case
      when new.total_amount > 0 and received_now >= new.total_amount then 'paid'
      else 'partial'
    end;
    status_follows_total := new.payment_status is distinct from old.payment_status;
  end if;
  bill_edit_allowed :=
    new.status <> 'cancelled'
    and new.payment_status <> 'refunded'
    and coalesce(new.paid_amount, 0) > 0
    and new.payment_status in ('paid', 'partial')
    and new.paid_amount is not distinct from old.paid_amount
    and new.prepaid_amount is not distinct from old.prepaid_amount
    and new.payment is not distinct from old.payment
    and new.payments is not distinct from old.payments
    and new.total_amount >= received_now;
  financial_fields_changed :=
    new.total_amount is distinct from old.total_amount
    or new.prepaid_amount is distinct from old.prepaid_amount
    or new.paid_amount is distinct from old.paid_amount
    or new.payment_status is distinct from old.payment_status
    or new.payment_method is distinct from old.payment_method
    or new.status is distinct from old.status
    or new.payment is distinct from old.payment
    or new.payments is distinct from old.payments;
  if financial_fields_changed then
    if new.total_amount = 'NaN'::numeric
       or new.prepaid_amount = 'NaN'::numeric
       or new.paid_amount = 'NaN'::numeric
       or new.total_amount < 0
       or new.prepaid_amount < 0
       or new.paid_amount < 0 then
      raise exception 'Суммы оплаты заявки некорректны';
    end if;
    if new.prepaid_amount > new.total_amount then
      raise exception 'Предоплата не может быть больше итоговой суммы';
    end if;
    if (
      new.prepaid_amount > 0
      or new.paid_amount > 0
      or (new.payment_status = 'paid' and new.total_amount > 0)
    ) and (
      new.payment_method is null
      or new.payment_method not in ('cash', 'card', 'transfer', 'other')
    ) then
      raise exception 'Выберите способ оплаты заявки';
    end if;
    received_amount := new.prepaid_amount + case
      when new.payment_status in ('partial', 'paid') then new.paid_amount
      else 0
    end;
    if new.status <> 'cancelled' and new.payment_status <> 'refunded' then
      if received_amount > new.total_amount then
        raise exception 'Полученная сумма больше итога заявки';
      end if;
      if new.payment_status = 'paid'
         and new.total_amount > 0
         and received_amount < new.total_amount then
        raise exception 'Для статуса «Оплачено» не хватает полученной суммы';
      end if;
      if new.payment_status = 'partial'
         and (received_amount <= 0 or received_amount >= new.total_amount) then
        raise exception 'Частичная оплата должна быть меньше итога заявки';
      end if;
      if new.payment_status = 'unpaid' and new.paid_amount > 0 then
        raise exception 'Сумма доплаты указана для неоплаченной заявки';
      end if;
    end if;
  end if;
  if old.status <> 'cancelled' and old.payment_status <> 'refunded' then
    old_settlement_target := case old.payment_status
      when 'paid' then greatest(old.total_amount - old.prepaid_amount, 0)
      when 'partial' then greatest(old.paid_amount, 0)
      else 0
    end;
  end if;
  if new.status <> 'cancelled' and new.payment_status <> 'refunded' then
    new_settlement_target := case new.payment_status
      when 'paid' then greatest(new.total_amount - new.prepaid_amount, 0)
      when 'partial' then greatest(new.paid_amount, 0)
      else 0
    end;
  end if;
  settlement_growth := old.status <> 'cancelled'
    and old.payment_status <> 'refunded'
    and new_settlement_target > old_settlement_target;
  if has_any_auto_income and not prepayment_context
     and new.prepaid_amount is distinct from old.prepaid_amount then
    raise exception 'Предоплату и её способ меняйте через действие «Изменить предоплату»';
  end if;
  if has_any_auto_income and not prepayment_context
     and new.payment_method is distinct from old.payment_method
     and not settlement_growth then
    raise exception 'Способ предоплаты меняйте через действие «Изменить предоплату»';
  end if;
  is_cancel_transition := old.status is distinct from 'cancelled'
    and new.status = 'cancelled'
    and (
      has_any_auto_income
      or old.prepaid_amount > 0
      or old.paid_amount > 0
      or old.payment_status in ('partial', 'paid')
    );
  if is_cancel_transition then
    new.payment_status := 'refunded';
    new.paid_amount := 0;
  end if;
  is_refund_transition := old.payment_status is distinct from 'refunded'
    and new.payment_status = 'refunded';
  if is_refund_transition then
    new.paid_amount := 0;
  end if;
  if prepayment_context and not has_settlement then
    return new;
  end if;
  if settlement_growth then
    if new.tenant_id is distinct from old.tenant_id
       or new.client_id is distinct from old.client_id
       or new.team_id is distinct from old.team_id
       or new.master_id is distinct from old.master_id
       or new.kind is distinct from old.kind
       or new.date is distinct from old.date
       or new.total_amount is distinct from old.total_amount
       or new.custom_total is distinct from old.custom_total
       or new.discount_amount is distinct from old.discount_amount
       or new.services is distinct from old.services
       or new.service_ids is distinct from old.service_ids
       or new.service_price_overrides is distinct from old.service_price_overrides
       or new.global_discount is distinct from old.global_discount
       or new.prepaid_amount is distinct from old.prepaid_amount
       or (
         new.status is distinct from old.status
         and new.status is distinct from 'completed'
       ) then
      raise exception 'При доплате можно изменить только оплату и завершить заявку';
    end if;
    return new;
  end if;
  if not has_settlement and not (
    old.status = 'completed' and old.payment_status = 'paid'
  ) then
    -- Заморожены только ДЕНЬГИ: возвращённая оплата и отменённая заявка, у
    -- которой были предоплата, доплата или проводки.
    if old.payment_status = 'refunded'
       or (old.status = 'cancelled' and (
         has_linked_finance
         or old.prepaid_amount > 0
         or old.paid_amount > 0
         or old.payment_status in ('partial', 'paid')
       )) then
      if financial_fields_changed and not is_cancel_transition then
        raise exception 'Возвращённую оплату нельзя изменить; создайте новую заявку';
      end if;
    end if;
    return new;
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.client_id is distinct from old.client_id
     or new.team_id is distinct from old.team_id
     or new.master_id is distinct from old.master_id
     or new.date is distinct from old.date
     or new.payment_method is distinct from old.payment_method
     or new.prepaid_amount is distinct from old.prepaid_amount
     or new.payment is distinct from old.payment
     or new.payments is distinct from old.payments
     or (new.status is distinct from old.status and not is_cancel_transition)
     or (new.paid_amount is distinct from old.paid_amount and not is_refund_transition)
     or (
       new.payment_status is distinct from old.payment_status
       and not is_refund_transition
       and not status_follows_total
     )
     or ((old.status = 'cancelled' or old.payment_status = 'refunded') and
       (new.status is distinct from old.status or new.payment_status is distinct from old.payment_status))
     -- РАБОТЫ И ЦЕНА: замораживаются только когда правка не разрешена.
     or (not bill_edit_allowed and (
       new.total_amount is distinct from old.total_amount
       or new.custom_total is distinct from old.custom_total
       or new.discount_amount is distinct from old.discount_amount
       or new.services is distinct from old.services
       or new.service_ids is distinct from old.service_ids
       or new.service_price_overrides is distinct from old.service_price_overrides
       or new.global_discount is distinct from old.global_discount
     )) then
    raise exception 'Сначала отмените оплату или оформите возврат по заявке';
  end if;
  return new;
end;
$function$;
