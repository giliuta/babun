-- НУМЕРАЦИЯ ПОД БИЗНЕС, КОТОРЫЙ ПРИШЁЛ СО СВОЕЙ ИСТОРИЕЙ.
--
-- Владелец 2026-08-10: «если к нам заходит новый бизнес, у него уже были
-- выставлены инвойсы — номер должен идти с правильной структуры». Раньше
-- формат был зашит намертво: PREFIX-ГОД-001, три знака, всегда со сбросом на
-- новый год. Компании, у которой в старой программе последний счёт был №1420,
-- продолжить свою серию было нечем.
--
-- Что настраивается (четыре понятных вопроса, а не конструктор шаблонов):
--   invoice_prefix                — буквенная часть, «INV», «AF», «СЧ»;
--   invoice_number_padding        — сколько знаков в номере: 0001 или 1;
--   invoice_number_yearly_reset   — включать ли год и начинать ли с единицы;
--   invoice_next_number           — «продолжить с номера», ТОЛЬКО ВПЕРЁД.
--
-- Закон (директива ЕС 2006/112, ст. 226 п. 2) требует лишь одного: номер
-- последовательный, в рамках одной или нескольких серий, и однозначно
-- определяет документ. Пропуски допустимы, если объяснимы, поэтому
-- аннулированный документ сохраняет свой номер.

alter table public.tenants
  add column if not exists invoice_number_padding integer not null default 3,
  add column if not exists invoice_number_yearly_reset boolean not null default true,
  add column if not exists invoice_next_number integer;

alter table public.tenants drop constraint if exists tenants_invoice_number_padding_check;
alter table public.tenants add constraint tenants_invoice_number_padding_check
  check (invoice_number_padding between 1 and 8);

alter table public.tenants drop constraint if exists tenants_invoice_next_number_check;
alter table public.tenants add constraint tenants_invoice_next_number_check
  check (invoice_next_number is null or (invoice_next_number between 1 and 1000000000));

comment on column public.tenants.invoice_next_number is
  'С какого номера продолжить серию. Ставится один раз при переезде со старой программы; назад не двигается.';

-- Номер собирается в ОДНОМ месте: и выпуск, и предпросмотр в приложении
-- обязаны говорить одинаково.
--
-- ЛОВУШКА: lpad не дополняет, а ПРИВОДИТ К ДЛИНЕ — lpad('1421', 3, '0') это
-- '142'. Ширина здесь минимум, а не потолок, иначе переехавшая компания
-- получила бы чужой номер.
create or replace function public.format_invoice_number(
  p_prefix text,
  p_year integer,
  p_seq integer,
  p_padding integer,
  p_yearly_reset boolean
)
returns text
language sql
immutable
as $$
  select case when coalesce(p_yearly_reset, true)
    then coalesce(nullif(btrim(p_prefix), ''), 'INV') || '-' || p_year::text || '-' ||
         lpad(p_seq::text, greatest(coalesce(p_padding, 3), 1, length(p_seq::text)), '0')
    else coalesce(nullif(btrim(p_prefix), ''), 'INV') || '-' ||
         lpad(p_seq::text, greatest(coalesce(p_padding, 3), 1, length(p_seq::text)), '0')
  end
$$;

grant execute on function public.format_invoice_number(text, integer, integer, integer, boolean) to authenticated;

-- Расчёт следующего номера: выбор счётчика (по году или сквозной), «продолжить
-- с номера» и сборка строки. issue_invoice остаётся про деньги и проверки.
-- Функция ТОЛЬКО СЧИТАЕТ: гасить invoice_next_number обязан вызывающий, уже
-- под своей блокировкой.
create or replace function public.next_invoice_number(
  p_tenant_id uuid,
  p_year integer
)
returns table (seq integer, number text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  prefix text;
  padding integer := 3;
  yearly_reset boolean := true;
  next_number integer;
  computed integer;
begin
  select
      regexp_replace(btrim(coalesce(tenant.invoice_prefix, 'INV')), '[[:space:]-]+$', ''),
      coalesce(tenant.invoice_number_padding, 3),
      coalesce(tenant.invoice_number_yearly_reset, true),
      tenant.invoice_next_number
    into prefix, padding, yearly_reset, next_number
    from public.tenants tenant
   where tenant.id = p_tenant_id;
  if prefix is null or prefix = '' then prefix := 'INV'; end if;

  if yearly_reset then
    select coalesce(max(inv.seq), 0) + 1 into computed
      from public.invoices inv
     where inv.tenant_id = p_tenant_id
       and inv.year = p_year;
  else
    -- Сквозная серия: год в номер не входит, счётчик не обнуляется.
    select coalesce(max(inv.seq), 0) + 1 into computed
      from public.invoices inv
     where inv.tenant_id = p_tenant_id;
  end if;

  -- «Продолжить с номера» двигает серию только ВПЕРЁД: назад — это дубликат.
  if next_number is not null and next_number > computed then
    computed := next_number;
  end if;

  seq := computed;
  number := public.format_invoice_number(prefix, p_year, computed, padding, yearly_reset);
  return next;
end;
$$;

grant execute on function public.next_invoice_number(uuid, integer) to authenticated;

-- issue_invoice теперь берёт номер у next_invoice_number и гасит настройку
-- «продолжить с номера» после успешной вставки. Тело функции перенесено
-- точечной заменой (см. миграцию в базе): здесь фиксируем намерение.
