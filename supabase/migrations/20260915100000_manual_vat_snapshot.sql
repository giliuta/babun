-- НДС РУЧНОЙ ОПЕРАЦИИ — СНИМОК, КОТОРЫЙ ПРИСЛАЛИ, СЕРВЕР И ХРАНИТ (шаг 3 плана
-- «НДС в оплате записи», спецификация 2026-09-15, §6.5; разбор, пункты A8 и A9).
--
-- До этой миграции `fill_transaction_vat` слышал в ручной операции только
-- «Без НДС». Режим «в цене» / «сверху» без готового снимка он пересобирал по
-- настройкам (счёт → команда → компания), а готовый снимок на правке молча
-- терял, как только менялся режим. Отсюда две ошибки:
--
-- A8. Лист операции показывает налог, которого в базе нет: клавишу нажали на
--     счёте, где настройка даёт «Без НДС», — строка ложится с режимом, но без
--     суммы налога, а сумма «сверху» уже поднята до брутто.
-- A9. Правка старой строки (режим пуст, налог есть) превращала её режим в
--     «в цене» — и сервер считал это сменой режима: налог стирался и
--     собирался заново по СЕГОДНЯШНИМ настройкам. Даже правка одной заметки.
--
-- Что теперь:
--
-- 1. ЦЕЛЫЙ СНИМОК ПОБЕЖДАЕТ НАСТРОЙКИ. Строка без инвойса с режимом «в цене»
--    или «сверху», со ставкой и с суммой налога хранится как есть, если налог
--    выделен из самой суммы по общему правилу: round(сумма · ставка /
--    (100 + ставка), 2), знак — от суммы. В настройки сервер тогда не
--    смотрит — ни на вставке, ни на правке, меняли сумму и режим или нет.
--    Снимок, который сходится с суммой, и есть налог по ставке самой строки:
--    ровно его дал бы пересчёт по этой ставке.
-- 2. ПРИСЛАННЫЙ СНИМОК ПРОВЕРЯЕТСЯ. «Прислан» значит: вставка или правка, где
--    ставка или налог отличаются от прежних. Ставка больше 0 и меньше 100 и не
--    больше двух знаков после запятой — как у `issue_invoice`; клиент (`vat.ts`)
--    считает центы на ставке в сотых долях процента, и лишний знак разводил бы
--    его цент с серверным. Налог не сходится с суммой — отказ, строка не
--    пишется: расхождение значит ошибку, а не округление. Подсказка ошибки —
--    `vat:snapshot`.
--    Прежний снимок, который с новой суммой не сходится, — не присланный, а
--    перенесённый: это обычная правка суммы, и дальше всё как было.
-- 3. СТАРАЯ СТРОКА НЕ ТЕРЯЕТ НАЛОГ. Режим уходит из пустого в «в цене» или
--    «сверху», сумма не менялась, налог у строки был и сходится с её суммой —
--    снимок остаётся прежним, даже если правка обнулила ставку или налог (A9).
--    Прежний налог, который с суммой НЕ сходится, не замораживается под новым
--    режимом: такая строка пересобирается по настройкам, как раньше.
-- 4. ОСТАЛЬНОЕ КАК БЫЛО. Перевод и «Без НДС» глушат налог; возврат зеркалит
--    исходный доход; строка инвойса (оплата инвойса с долей напечатанного
--    налога, привязка дохода к инвойсу) идёт прежними ветками — её доля
--    намеренно не равна выделенному из суммы налогу; без снимка режим и ставка
--    решаются счётом → командой → компанией.
--
-- Владелец, права, SECURITY DEFINER и search_path — как у живой функции; тело
-- взято из `pg_get_functiondef` 2026-09-15 и совпадает с
-- `20260915070000_account_vat_switch`.

-- ЗАМОК НЕ ЖДЁТ ДОЛГО. Замена триггера берёт замок на `finance_transactions`;
-- пока он ждёт чужую открытую транзакцию, за ним встают все записи денег.
-- Через пять секунд миграция падает целиком — её повторяют в тихую минуту.
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fill_transaction_vat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tenant_mode text;
  mode text;
  rate numeric;
  original public.finance_transactions%rowtype;
  snapshot_sent boolean := false;
begin
  -- Перевод — не событие для налога: деньги не пришли и не ушли, они просто
  -- сменили карман.
  if new.type = 'transfer' then
    new.vat_rate := null;
    new.vat_amount := null;
    return new;
  end if;

  -- «Без НДС» сказано вслух — молчим, даже если у компании налог включён и
  -- даже если пришёл готовый снимок. Это самое сильное правило в функции.
  if new.vat_mode = 'none' then
    new.vat_rate := null;
    new.vat_amount := null;
    return new;
  end if;

  -- Возврат зеркалит исходный доход: та же ставка, пропорциональная доля
  -- налога. Знаки сходятся сами: сумма возврата отрицательная.
  if new.type = 'refund' and new.refund_of_id is not null then
    select * into original
      from public.finance_transactions
     where id = new.refund_of_id;
    if found then
      if original.vat_amount is null or coalesce(original.amount, 0) = 0 then
        new.vat_rate := null;
        new.vat_amount := null;
      else
        new.vat_rate := original.vat_rate;
        new.vat_amount := round(original.vat_amount * new.amount / original.amount, 2);
      end if;
      return new;
    end if;
  end if;

  -- ЦЕЛЫЙ СНИМОК СТРОКИ БЕЗ ИНВОЙСА: режим «в цене» или «сверху», ставка и
  -- налог. Налог всегда выделен из суммы — «сверху» к этому моменту уже
  -- поднял сумму до брутто, и выделение возвращает тот же цент (A10).
  -- Инвойсная строка сюда не заходит: её налог — доля напечатанного на бумаге.
  if new.invoice_id is null
     and new.vat_mode in ('inclusive', 'exclusive')
     and new.vat_rate is not null
     and new.vat_amount is not null then
    -- Прислан — значит вставка или правка, сменившая ставку или налог. Иначе
    -- это снимок, перенесённый со старой строки.
    if tg_op = 'INSERT' then
      snapshot_sent := true;
    else
      snapshot_sent := new.vat_rate is distinct from old.vat_rate
        or new.vat_amount is distinct from old.vat_amount;
    end if;

    -- Ставку проверяем отдельной веткой и первой: при ставке −100 формула
    -- ниже делила бы на ноль.
    if new.vat_rate <= 0 or new.vat_rate >= 100 then
      if snapshot_sent then
        raise exception 'Ставка НДС должна быть больше 0 и меньше 100'
          using hint = 'vat:snapshot';
      end if;
    elsif snapshot_sent and round(new.vat_rate, 2) <> new.vat_rate then
      raise exception 'Ставка НДС — не больше двух знаков после запятой'
        using hint = 'vat:snapshot';
    elsif new.vat_amount = round(new.amount * new.vat_rate / (100 + new.vat_rate), 2) then
      -- Сходится — храним, присланный он или перенесённый: это налог по
      -- ставке самой строки, и сменой режима или суммы его не отменить.
      return new;
    elsif snapshot_sent then
      raise exception 'НДС % не сходится с суммой %: при ставке % %% налог — %',
        new.vat_amount, new.amount, new.vat_rate,
        round(new.amount * new.vat_rate / (100 + new.vat_rate), 2)
        using hint = 'vat:snapshot';
    end if;
    -- Перенесённый снимок не сходится с новой суммой — это обычная правка
    -- суммы: дальше как всегда.
  end if;

  if tg_op = 'UPDATE' then
    -- Клиент прислал НОВЫЙ снимок сознательно — уважаем его.
    if new.vat_amount is not null
       and new.vat_amount is distinct from old.vat_amount then
      return new;
    end if;
    -- Инвойсная строка напечатана на бумаге; экономические правки таких
    -- строк и так запрещены защитными триггерами.
    if new.invoice_id is not null then
      return new;
    end if;
    -- СТАРАЯ СТРОКА БЕЗ РЕЖИМА (A9). Режим пришёл, сумма та же, а ставку или
    -- налог правка обнулила — прежний снимок остаётся, если он сходится с
    -- суммой. Несходящийся налог под новым режимом не замораживаем: он
    -- пересобирается по настройкам ниже, как раньше.
    if old.vat_mode is null
       and new.vat_mode in ('inclusive', 'exclusive')
       and new.amount is not distinct from old.amount
       and old.vat_rate > 0 and old.vat_rate < 100
       and old.vat_amount = round(old.amount * old.vat_rate / (100 + old.vat_rate), 2) then
      new.vat_rate := old.vat_rate;
      new.vat_amount := old.vat_amount;
      return new;
    end if;
    if new.vat_mode is not distinct from old.vat_mode then
      -- Изменилась сумма: пересчитываем налог по ставке самой операции.
      if old.vat_rate is not null then
        new.vat_rate := old.vat_rate;
        new.vat_amount := round(new.amount * old.vat_rate / (100 + old.vat_rate), 2);
      else
        new.vat_rate := null;
        new.vat_amount := null;
      end if;
      return new;
    end if;
    -- Режим сменили явно — снимок пересобирается по настройкам ниже.
    new.vat_rate := null;
    new.vat_amount := null;
  end if;

  -- Явно переданный снимок уважаем: инвойс печатает свою ставку и она уже
  -- напечатана на бумаге — пересчитывать её задним числом нельзя.
  if new.vat_amount is not null then
    return new;
  end if;

  -- Режим: счёт → команда → компания. Ставка: команда → компания (у счёта
  -- своей ставки нет — её задаёт страна работы команды).
  -- «С НДС» у счёта (`on`) включает налог, но не выбирает, как его считать:
  -- режим берётся у команды, а выключенный у команды — у компании.
  select t.vat_mode,
         case
           when a.vat_mode = 'on' then coalesce(nullif(s.vat_mode, 'off'), t.vat_mode)
           else coalesce(a.vat_mode, s.vat_mode, t.vat_mode)
         end,
         coalesce(s.vat_rate, t.vat_rate)
    into tenant_mode, mode, rate
    from public.tenants t
    left join public.team_finance_settings s
      on s.tenant_id = t.id and s.team_id = new.team_id
    left join public.accounts a
      on a.id = new.account_id and a.tenant_id = t.id
   where t.id = new.tenant_id;

  if tenant_mode is null or tenant_mode = 'off'
     or mode is null or mode = 'off' or coalesce(rate, 0) <= 0 then
    new.vat_rate := null;
    new.vat_amount := null;
    return new;
  end if;

  new.vat_rate := rate;
  -- Из ВАЛОВОЙ суммы: в кассу пришло 480, налог внутри — 80.
  -- Знак сохраняем (возврат уносит и налог).
  new.vat_amount := round(new.amount * rate / (100 + rate), 2);
  return new;
end;
$function$;

-- ТРИГГЕР СЛЫШИТ И САМ СНИМОК. Раньше функция просыпалась только на правке
-- суммы, режима, счёта, команды, инвойса или вида — правка одной ставки или
-- одного налога проходила мимо проверки и уезжала в чек. Теперь в списке и
-- `vat_rate`, `vat_amount`. Серверные функции эти колонки не правят
-- (`issue_invoice` ставит только `invoice_id`), лист операции их пока не
-- шлёт, поэтому ни один нынешний путь записи не меняется. Имя то же — порядок
-- срабатывания BEFORE-триггеров (по имени) прежний.
CREATE OR REPLACE TRIGGER trg_fill_transaction_vat
  BEFORE INSERT OR UPDATE OF amount, vat_mode, vat_rate, vat_amount, account_id, team_id, invoice_id, type
  ON public.finance_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fill_transaction_vat();
