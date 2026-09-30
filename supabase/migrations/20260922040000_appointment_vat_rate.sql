-- VAT В «ИТОГО» ЗАПИСИ — КАК В ЧЕКЕ И ИНВОЙСЕ.
--
-- Владелец 22.09: «скидка, всё в „Итого“ высчитывается, потом VAT
-- начисляется; к счёту привязывается — заходят деньги туда плюсом VAT, и
-- отдельно высчитывается уже по счёту». Шторка «Итого» одна на запись, чек и
-- инвойс, но у записи налога не было: клавиша VAT в ней не показывалась.
--
-- Запись хранит СВОЙ выбор, как документ:
--   • `vat_mode` — 'exclusive' (сверху цены), 'inclusive' (внутри цены),
--     'none' (без налога); старые 'on' / 'off' остаются законными;
--   • `vat_rate` — ставка, написанная цифрами.
-- `total_amount` — «К оплате» (услуги − скидка + налог); по нему как и
-- прежде считаются долг и остаток.
--
-- Оплата записи ложится на счёт проводкой `reconcile_appointment_finance`.
-- Теперь проводка несёт снимок налога ЗАПИСИ: ставку и налог, выделенный из
-- пришедших денег той же формулой, что у `fill_transaction_vat`. Без выбора
-- (старые записи) — как раньше: налог подставят настройки.

begin;

set local lock_timeout = '5s';

alter table public.appointments drop constraint if exists appointments_vat_mode_check;
alter table public.appointments
  add constraint appointments_vat_mode_check
  check (vat_mode is null or vat_mode in ('on', 'off', 'none', 'inclusive', 'exclusive'));

-- Без `default`: прошлые записи не получают ставку, которую никто не выбирал.
alter table public.appointments add column if not exists vat_rate numeric(5, 2);
alter table public.appointments drop constraint if exists appointments_vat_rate_range;
alter table public.appointments
  add constraint appointments_vat_rate_range
  check (vat_rate is null or (vat_rate >= 0 and vat_rate < 100));

comment on column public.appointments.vat_rate is
  'Ставка VAT записи, написанная в «Итого». Пусто — налог не выбран.';

do $migration$
declare
  body text;
  old_cols constant text :=
    '        appointment_payment_kind, notes, appointment_payment_id' || chr(10) ||
    '      ) values (' || chr(10) ||
    '        appointment_row.tenant_id,' || chr(10) ||
    '        ''income'',';
  new_cols constant text :=
    '        appointment_payment_kind, notes, appointment_payment_id,' || chr(10) ||
    '        vat_mode, vat_rate, vat_amount' || chr(10) ||
    '      ) values (' || chr(10) ||
    '        appointment_row.tenant_id,' || chr(10) ||
    '        ''income'',';
  old_tail constant text :=
    '          else ''Оплата по заявке''' || chr(10) ||
    '        end,' || chr(10) ||
    '        meta_payment_id' || chr(10) ||
    '      );';
  new_tail constant text :=
    '          else ''Оплата по заявке''' || chr(10) ||
    '        end,' || chr(10) ||
    '        meta_payment_id,' || chr(10) ||
    '        -- Налог записи — снимком на проводке (миграция 20260922040000).' || chr(10) ||
    '        case' || chr(10) ||
    '          when appointment_row.vat_mode in (''inclusive'', ''exclusive'')' || chr(10) ||
    '           and appointment_row.vat_rate > 0 then appointment_row.vat_mode' || chr(10) ||
    '          when appointment_row.vat_mode = ''none'' then ''none''' || chr(10) ||
    '        end,' || chr(10) ||
    '        case' || chr(10) ||
    '          when appointment_row.vat_mode in (''inclusive'', ''exclusive'')' || chr(10) ||
    '           and appointment_row.vat_rate > 0 then appointment_row.vat_rate' || chr(10) ||
    '        end,' || chr(10) ||
    '        case' || chr(10) ||
    '          when appointment_row.vat_mode in (''inclusive'', ''exclusive'')' || chr(10) ||
    '           and appointment_row.vat_rate > 0 then' || chr(10) ||
    '            round(round(adjustment.amount, 2) * appointment_row.vat_rate' || chr(10) ||
    '                  / (100 + appointment_row.vat_rate), 2)' || chr(10) ||
    '        end' || chr(10) ||
    '      );';
begin
  select pg_get_functiondef('public.reconcile_appointment_finance'::regproc) into body;
  if (length(body) - length(replace(body, old_cols, ''))) / length(old_cols) <> 1 then
    raise exception 'reconcile_appointment_finance: income column anchor not unique';
  end if;
  if (length(body) - length(replace(body, old_tail, ''))) / length(old_tail) <> 1 then
    raise exception 'reconcile_appointment_finance: income values anchor not unique';
  end if;
  execute replace(replace(body, old_cols, new_cols), old_tail, new_tail);
end
$migration$;

-- Сторож: колонка есть и не прошита, проводка несёт снимок налога записи.
do $$
begin
  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.appointments'::regclass and attname = 'vat_rate' and atthasmissing
  ) then
    raise exception 'appointments.vat_rate stamped existing rows';
  end if;
  if not exists (
    select 1 from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname = 'reconcile_appointment_finance'
       and prosrc like '%vat_mode, vat_rate, vat_amount%'
  ) then
    raise exception 'appointment payment does not carry the record VAT';
  end if;
end
$$;

commit;
