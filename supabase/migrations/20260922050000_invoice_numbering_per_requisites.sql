-- НУМЕРАЦИЯ ИНВОЙСОВ — НА РЕКВИЗИТАХ.
--
-- Владелец 22.09: «я могу вручную выбрать номер, и оно автоматически должно
-- продолжаться с выбранного: пишу номер этого инвойса 104 — следующий 105-й,
-- и неважно, с какой командой … запоминается на реквизиты».
--
-- Реквизиты — это юрлицо на бумаге, у каждого юрлица своя серия номеров.
-- Серия живёт на `companies`:
--   • `invoice_next_number` — номер, который получит СЛЕДУЮЩИЙ инвойс этих
--     реквизитов; после выпуска сервер сам ставит сюда N + 1, поэтому ручной
--     номер «продолжается», даже если он меньше уже выданных;
--   • `invoice_next_year` — год, к которому относится счётчик: при ежегодном
--     обнулении январский инвойс начинает серию года заново.
-- Пусто — как раньше: max(seq) + 1 по инвойсам этих реквизитов.
-- Занятый номер не выдаётся никогда: серия перешагивает его.
--
-- Старые инвойсы без реквизитов (company_id пусто) считаются инвойсами
-- основных реквизитов — перепривязывать их не нужно (снимки бумаги целы).
-- Команда в номер не входит: серия одна на реквизиты.

begin;

set local lock_timeout = '5s';

alter table public.companies add column if not exists invoice_next_number integer;
alter table public.companies add column if not exists invoice_next_year integer;
alter table public.companies drop constraint if exists companies_invoice_next_number_range;
alter table public.companies
  add constraint companies_invoice_next_number_range
  check (invoice_next_number is null or (invoice_next_number between 1 and 999999));

comment on column public.companies.invoice_next_number is
  'Номер следующего инвойса этих реквизитов. Пусто — max(seq) + 1.';
comment on column public.companies.invoice_next_year is
  'Год, к которому относится invoice_next_number (для ежегодной серии).';

-- Уникальность номера — внутри серии реквизитов, а не всей компании.
alter table public.invoices drop constraint if exists invoices_tenant_kind_year_seq_key;
drop index if exists public.invoices_tenant_kind_year_seq_key;
create unique index invoices_series_seq_key
  on public.invoices (
    tenant_id, kind,
    coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    year, seq
  );

-- Инвойс серии: свои реквизиты, либо «без реквизитов» у основных.
create or replace function public.invoice_in_series(
  p_invoice_company uuid, p_company uuid, p_default_company uuid
) returns boolean
language sql
immutable
set search_path = public
as $$
  select p_invoice_company is not distinct from p_company
      or (p_invoice_company is null and p_company is not distinct from p_default_company);
$$;

create or replace function public.next_company_invoice_number(
  p_tenant_id uuid, p_company_id uuid, p_year integer
) returns table(seq integer, number text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  prefix text;
  padding integer := 3;
  yearly_reset boolean := true;
  tenant_next integer;
  company_uuid uuid;
  default_company uuid;
  company_next integer;
  company_year integer;
  computed integer;
begin
  if p_tenant_id is null or p_tenant_id is distinct from public.current_tenant_id() then
    raise exception 'Номер инвойса доступен только своей компании'
      using errcode = '42501', hint = 'access:not_member';
  end if;

  select
      regexp_replace(btrim(coalesce(tenant.invoice_prefix, 'INV')), '[[:space:]-]+$', ''),
      coalesce(tenant.invoice_number_padding, 3),
      coalesce(tenant.invoice_number_yearly_reset, true),
      tenant.invoice_next_number
    into prefix, padding, yearly_reset, tenant_next
    from public.tenants tenant
   where tenant.id = p_tenant_id;
  if prefix is null or prefix = '' then prefix := 'INV'; end if;

  company_uuid := public.resolve_company_id(p_tenant_id, p_company_id);
  default_company := public.resolve_company_id(p_tenant_id, null);
  if company_uuid is not null then
    select c.invoice_next_number, c.invoice_next_year
      into company_next, company_year
      from public.companies c
     where c.id = company_uuid;
  end if;

  if company_next is not null and (not yearly_reset or company_year = p_year) then
    -- Счётчик реквизитов: ручной номер или «прошлый + 1».
    computed := company_next;
  else
    select coalesce(max(inv.seq), 0) + 1 into computed
      from public.invoices inv
     where inv.tenant_id = p_tenant_id
       and inv.kind = 'invoice'
       and (not yearly_reset or inv.year = p_year)
       and public.invoice_in_series(inv.company_id, company_uuid, default_company);
    -- Старое «продолжить с номера» компании — только вперёд.
    if tenant_next is not null and tenant_next > computed then
      computed := tenant_next;
    end if;
  end if;

  -- Занятый номер не выдаём: серия перешагивает его.
  while exists (
    select 1 from public.invoices inv
     where inv.tenant_id = p_tenant_id
       and inv.kind = 'invoice'
       and (not yearly_reset or inv.year = p_year)
       and inv.seq = computed
       and public.invoice_in_series(inv.company_id, company_uuid, default_company)
  ) loop
    computed := computed + 1;
  end loop;

  seq := computed;
  number := public.format_invoice_number(prefix, p_year, computed, padding, yearly_reset);
  return next;
end;
$$;

-- Прежнее имя — основные реквизиты.
create or replace function public.next_invoice_number(p_tenant_id uuid, p_year integer)
returns table(seq integer, number text)
language sql
stable
security definer
set search_path = public
as $$
  select n.seq, n.number from public.next_company_invoice_number(p_tenant_id, null, p_year) n;
$$;

-- Ручной номер: «этот инвойс — 104». Пишет только владелец; занятый — отказ.
create or replace function public.set_company_invoice_next_number(
  p_company_id uuid, p_year integer, p_number integer
) returns public.companies
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_uuid uuid := public.current_tenant_id();
  yearly_reset boolean;
  default_company uuid;
  company_row public.companies;
begin
  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Нумерацию меняет только владелец';
  end if;
  if p_number is null or p_number < 1 or p_number > 999999 then
    raise exception 'Номер — целое число от 1 до 999999';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2999 then
    raise exception 'Некорректный год';
  end if;
  select * into company_row
    from public.companies
   where id = p_company_id and tenant_id = tenant_uuid
   for update;
  if not found then
    raise exception 'Реквизиты не найдены в этой компании';
  end if;
  select coalesce(t.invoice_number_yearly_reset, true) into yearly_reset
    from public.tenants t where t.id = tenant_uuid;
  default_company := public.resolve_company_id(tenant_uuid, null);
  if exists (
    select 1 from public.invoices inv
     where inv.tenant_id = tenant_uuid
       and inv.kind = 'invoice'
       and (not yearly_reset or inv.year = p_year)
       and inv.seq = p_number
       and public.invoice_in_series(inv.company_id, company_row.id, default_company)
  ) then
    raise exception 'Номер % уже занят', p_number;
  end if;
  update public.companies
     set invoice_next_number = p_number,
         invoice_next_year = p_year
   where id = company_row.id
  returning * into company_row;
  return company_row;
end;
$$;

revoke all on function public.next_company_invoice_number(uuid, uuid, integer) from public, anon;
revoke all on function public.set_company_invoice_next_number(uuid, integer, integer) from public, anon;
revoke all on function public.invoice_in_series(uuid, uuid, uuid) from public, anon;
grant execute on function public.next_company_invoice_number(uuid, uuid, integer) to authenticated;
grant execute on function public.set_company_invoice_next_number(uuid, integer, integer) to authenticated;
grant execute on function public.invoice_in_series(uuid, uuid, uuid) to authenticated;

-- issue_invoice: реквизиты разрешаются ДО номера, номер — из их серии,
-- после выпуска счётчик реквизитов уходит на N + 1.
do $migration$
declare
  body text;
  old_decl constant text :=
    '  invoice_vat_mode text;' || chr(10) || 'begin';
  new_decl constant text :=
    '  invoice_vat_mode text;' || chr(10) ||
    '  resolved_company_id uuid;' || chr(10) || 'begin';
  old_num constant text :=
    '    from public.next_invoice_number(tenant_uuid, invoice_year) as numbering;';
  new_num constant text :=
    '    from public.next_company_invoice_number(' || chr(10) ||
    '      tenant_uuid, resolved_company_id, invoice_year' || chr(10) ||
    '    ) as numbering;';
  old_lock constant text :=
    '  perform pg_advisory_xact_lock(hashtextextended(tenant_uuid::text, 0));';
  new_lock constant text :=
    '  -- Серия номеров — на реквизитах (миграция 20260922050000).' || chr(10) ||
    '  resolved_company_id := public.resolve_company_id(tenant_uuid, p_company_id);' || chr(10) ||
    '  perform pg_advisory_xact_lock(hashtextextended(tenant_uuid::text, 0));';
  old_ins constant text :=
    '    p_company_id,' || chr(10) || '    p_account_id' || chr(10) || '  )';
  new_ins constant text :=
    '    resolved_company_id,' || chr(10) || '    p_account_id' || chr(10) || '  )';
  old_after constant text :=
    '  update public.tenants' || chr(10) ||
    '     set invoice_next_number = null';
  new_after constant text :=
    '  update public.companies' || chr(10) ||
    '     set invoice_next_number = invoice_seq + 1,' || chr(10) ||
    '         invoice_next_year = invoice_year' || chr(10) ||
    '   where id = resolved_company_id' || chr(10) ||
    '     and tenant_id = tenant_uuid' || chr(10) ||
    '     and invoice_seq < 999999;' || chr(10) || chr(10) ||
    '  update public.tenants' || chr(10) ||
    '     set invoice_next_number = null';
  anchors text[] := array[old_decl, old_num, old_lock, old_ins, old_after];
  anchor text;
begin
  select pg_get_functiondef(
    'public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid)'::regprocedure
  ) into body;
  foreach anchor in array anchors loop
    if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
      raise exception 'issue_invoice: anchor not unique: %', left(anchor, 60);
    end if;
  end loop;
  body := replace(body, old_decl, new_decl);
  body := replace(body, old_num, new_num);
  body := replace(body, old_lock, new_lock);
  body := replace(body, old_ins, new_ins);
  body := replace(body, old_after, new_after);
  execute body;
end
$migration$;

-- Сторож.
do $$
begin
  if not exists (
    select 1 from pg_proc
     where pronamespace = 'public'::regnamespace and proname = 'issue_invoice'
       and prosrc like '%next_company_invoice_number%'
       and prosrc like '%invoice_next_number = invoice_seq + 1%'
       and prosrc like '%resolved_company_id,%'
  ) then
    raise exception 'issue_invoice does not number by requisites';
  end if;
  if has_function_privilege('anon', 'public.set_company_invoice_next_number(uuid, integer, integer)', 'execute')
     or has_function_privilege('anon', 'public.next_company_invoice_number(uuid, uuid, integer)', 'execute') then
    raise exception 'numbering functions are callable by anon';
  end if;
  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.companies'::regclass
       and attname in ('invoice_next_number', 'invoice_next_year') and atthasmissing
  ) then
    raise exception 'companies numbering columns stamped existing rows';
  end if;
end
$$;

commit;
