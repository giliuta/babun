-- НДС СЧЁТА — ОДИН ПЕРЕКЛЮЧАТЕЛЬ «С НДС» (владелец 2026-09-15: «да, есть
-- переключатель — с НДС или без НДС»).
--
-- До этой миграции у счёта было четыре ответа: «Как в настройках», «Без НДС»,
-- «НДС включён», «Плюс НДС». Владелец спрашивает о другом: идут ли деньги этого
-- счёта с налогом. КАК налог считается — в цене или сверху — и по какой ставке,
-- решают команда и компания; у счёта своего мнения об этом нет.
--
-- Новое значение `on` = «С НДС»: налог включён, режим и ставка — от команды,
-- а если команда налог у себя выключила — от компании. `off` = «Без НДС», как и
-- было. `inclusive` / `exclusive` остаются допустимыми для старых сборок; новое
-- приложение их не пишет. Компания без НДС по-прежнему глушит всё: `on` у счёта
-- не включает налог компании, у которой его нет.

alter table public.accounts drop constraint if exists accounts_vat_mode_check;
alter table public.accounts
  add constraint accounts_vat_mode_check
  check (vat_mode is null or vat_mode in ('off', 'inclusive', 'exclusive', 'on'));

comment on column public.accounts.vat_mode is
  'НДС счёта: null — как у команды/компании; on — «С НДС» (режим и ставка от команды, иначе от компании); off — «Без НДС». inclusive/exclusive — наследие старых сборок.';

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
