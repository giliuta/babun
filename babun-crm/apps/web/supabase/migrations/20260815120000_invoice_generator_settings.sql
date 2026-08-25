-- ГЕНЕРАТОР ИНВОЙСОВ — НАСТРОЙКИ ТОГО, ЧТО ВНУТРИ ДОКУМЕНТА.
--
-- Владелец 2026-08-15: «для генерации инвойсов нужно сделать настройки и
-- редактировать, как будет генерировать инвойс — полноценный генератор,
-- который прислоняется к самой записи клиента».
--
-- Номер документа настраивался с 2026-08-10 (invoice_prefix и соседи). Всё
-- остальное было зашито намертво: срок оплаты ровно семь дней, одна строка
-- «Услуги» на весь визит, приписки внизу нет. Компания, которая работает по
-- предоплате или расписывает клиенту каждую услугу отдельно, каждый раз
-- переделывала документ руками.
--
-- ЧЕТЫРЕ ВОПРОСА, А НЕ КОНСТРУКТОР ШАБЛОНОВ — то же правило, что у нумерации:
--   invoice_due_days           — через сколько дней платить (0 = по факту);
--   invoice_line_source        — расписывать услуги или свести в одну строку;
--   invoice_default_line_title — как назвать строку, когда услуг нет;
--   invoice_footer_note        — приписка внизу (условия оплаты, реквизиты).
--
-- Настройки — только ДЕФОЛТЫ. Выставленный документ хранит свои строки и свой
-- срок: поменяли настройку — старые счета не переписываются, как и положено
-- бумаге.

alter table public.tenants
  add column if not exists invoice_due_days integer not null default 7,
  add column if not exists invoice_line_source text not null default 'services',
  add column if not exists invoice_default_line_title text not null default 'Услуги',
  add column if not exists invoice_footer_note text;

-- Ноль разрешён намеренно: «оплата по факту» — обычная для выездных бригад
-- схема, и это не отсутствие срока, а срок «сегодня». Потолок в год отсекает
-- опечатку вроде 3650, из-за которой счёт никогда не станет просроченным.
alter table public.tenants drop constraint if exists tenants_invoice_due_days_check;
alter table public.tenants add constraint tenants_invoice_due_days_check
  check (invoice_due_days between 0 and 365);

alter table public.tenants drop constraint if exists tenants_invoice_line_source_check;
alter table public.tenants add constraint tenants_invoice_line_source_check
  check (invoice_line_source in ('services', 'total'));

-- Пустое название строки сделало бы документ без предмета: клиент видит сумму
-- и не видит, за что. Пробелы обрезаем здесь, а не в приложении, — иначе
-- каждый новый клиент базы обязан помнить это правило.
alter table public.tenants drop constraint if exists tenants_invoice_default_line_title_check;
alter table public.tenants add constraint tenants_invoice_default_line_title_check
  check (btrim(invoice_default_line_title) <> '');

comment on column public.tenants.invoice_due_days is
  'Через сколько дней после выставления счёт считается просроченным. 0 — оплата по факту (срок = день выставления).';
comment on column public.tenants.invoice_line_source is
  'services — каждая услуга записи отдельной строкой; total — одна строка на весь визит.';
comment on column public.tenants.invoice_default_line_title is
  'Название строки, когда услуг у записи нет или выбран режим «одной строкой».';
comment on column public.tenants.invoice_footer_note is
  'Приписка внизу счёта: условия оплаты, реквизиты, благодарность. Подставляется в новый документ и правится в нём.';
