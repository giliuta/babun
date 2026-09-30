-- У ДЕНЕГ ВСЕГДА ЕСТЬ КОМАНДА (владелец 2026-09-24: «у нас всё отдельно под
-- каждую команду»; каждая операция, счёт, долг, перевод, шаблон, инвойс и
-- чек — с командой; счёта «компании» без команды нет, деньги между командами
-- ходят переводом).
--
-- 1. Сервер сам дописывает команду, если её не прислали: у операции — команда
--    счёта, затем инвойса, записи, долга; у инвойса — исходного инвойса
--    (кредит-нота), счёта, записи; у чека — операции, инвойса, счёта,
--    записи; у шаблона — счёта; у заявки на перевод — счёта «откуда». Так
--    остаются рабочими оплата личного события (у записи нет команды — есть у
--    счёта), пересчёт кассы и прочие серверные пути, которые команду не
--    передают. Не нашлась — отказ словами, а не голым «null value».
-- 2. Старые строки без команды получают её по тем же связям. Строки, не
--    связанные ни с чем (операция и два шаблона тестовой компании
--    test@babun.dev, два аннулированных чека Giliuta без операции), получают
--    первую команду своей компании.
-- 3. Колонки команды — NOT NULL; счёт — только командный (scope 'team').
--
-- Внешнего ключа на teams нет намеренно: команду стирают через архив
-- календаря, а деньги архива остаются (три счёта уже ссылаются на
-- стёртые команды) — жёсткая связь не дала бы стереть календарь.

alter table public.receipts add column if not exists team_id text;

create or replace function public.fill_money_team()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  found_team text;
begin
  if tg_table_name = 'finance_transactions' then
    if new.team_id is null then
      select a.brigade_id into found_team
        from public.accounts a
       where a.id = new.account_id and a.tenant_id = new.tenant_id;
      if found_team is null and new.invoice_id is not null then
        select i.brigade_id into found_team
          from public.invoices i
         where i.id = new.invoice_id and i.tenant_id = new.tenant_id;
      end if;
      if found_team is null and new.appointment_id is not null then
        select ap.team_id into found_team
          from public.appointments ap
         where ap.id = new.appointment_id and ap.tenant_id = new.tenant_id;
      end if;
      if found_team is null and new.debt_id is not null then
        select d.team_id into found_team
          from public.debts d
         where d.id = new.debt_id and d.tenant_id = new.tenant_id;
      end if;
      new.team_id := found_team;
    end if;
    if new.team_id is null then
      raise exception using
        errcode = '23502',
        message = 'Операция без команды не записывается: выберите команду или счёт команды';
    end if;
  elsif tg_table_name = 'invoices' then
    if new.brigade_id is null then
      if new.credit_note_of_id is not null then
        select i.brigade_id into found_team
          from public.invoices i
         where i.id = new.credit_note_of_id and i.tenant_id = new.tenant_id;
      end if;
      if found_team is null and new.account_id is not null then
        select a.brigade_id into found_team
          from public.accounts a
         where a.id = new.account_id and a.tenant_id = new.tenant_id;
      end if;
      if found_team is null and new.appointment_id is not null then
        select ap.team_id into found_team
          from public.appointments ap
         where ap.id = new.appointment_id and ap.tenant_id = new.tenant_id;
      end if;
      new.brigade_id := found_team;
    end if;
    if new.brigade_id is null then
      raise exception using
        errcode = '23502',
        message = 'Инвойс без команды не выставляется: выберите команду';
    end if;
  elsif tg_table_name = 'receipts' then
    if new.team_id is null then
      if new.transaction_id is not null then
        select f.team_id into found_team
          from public.finance_transactions f
         where f.id = new.transaction_id and f.tenant_id = new.tenant_id;
      end if;
      if found_team is null and new.invoice_id is not null then
        select i.brigade_id into found_team
          from public.invoices i
         where i.id = new.invoice_id and i.tenant_id = new.tenant_id;
      end if;
      if found_team is null and new.account_id is not null then
        select a.brigade_id into found_team
          from public.accounts a
         where a.id = new.account_id and a.tenant_id = new.tenant_id;
      end if;
      if found_team is null and new.appointment_id is not null then
        select ap.team_id into found_team
          from public.appointments ap
         where ap.id = new.appointment_id and ap.tenant_id = new.tenant_id;
      end if;
      new.team_id := found_team;
    end if;
    if new.team_id is null then
      raise exception using
        errcode = '23502',
        message = 'Чек без команды не выписывается: у денег нет команды';
    end if;
  elsif tg_table_name = 'finance_templates' then
    if new.brigade_id is null and new.account_id is not null then
      select a.brigade_id into new.brigade_id
        from public.accounts a
       where a.id = new.account_id and a.tenant_id = new.tenant_id;
    end if;
    if new.brigade_id is null then
      raise exception using
        errcode = '23502',
        message = 'Шаблон без команды не сохраняется: выберите команду';
    end if;
  elsif tg_table_name = 'finance_transfer_requests' then
    if new.team_id is null then
      select a.brigade_id into new.team_id
        from public.accounts a
       where a.id = new.from_account_id and a.tenant_id = new.tenant_id;
    end if;
    if new.team_id is null then
      raise exception using
        errcode = '23502',
        message = 'Перевод без команды не записывается: выберите счёт команды';
    end if;
  elsif tg_table_name = 'debts' then
    if new.team_id is null then
      raise exception using
        errcode = '23502',
        message = 'Долг без команды не записывается: выберите команду';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.fill_money_team() from public, anon, authenticated;

-- «aa» в имени — чтобы стоять ПЕРВЫМ среди BEFORE-триггеров таблицы: сторож
-- целостности и расчёт НДС читают уже дописанную команду.
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'finance_transactions', 'invoices', 'receipts',
    'finance_templates', 'finance_transfer_requests', 'debts'
  ]
  loop
    execute format('drop trigger if exists trg_aa_fill_money_team on public.%I', tbl);
    execute format(
      'create trigger trg_aa_fill_money_team before insert or update on public.%I '
      || 'for each row execute function public.fill_money_team()',
      tbl
    );
  end loop;
end
$$;

-- ДОПИСАТЬ СТАРЫЕ СТРОКИ. Это перенос, а не правка денег: сторожа, штампы
-- времени и синхронизация чеков здесь не нужны — выключаем их на время.
set local session_replication_role = replica;

update public.finance_transactions f
   set team_id = coalesce(
     (select a.brigade_id from public.accounts a where a.id = f.account_id),
     (select i.brigade_id from public.invoices i where i.id = f.invoice_id),
     (select ap.team_id from public.appointments ap where ap.id = f.appointment_id),
     (select d.team_id from public.debts d where d.id = f.debt_id)
   )
 where f.team_id is null;

-- Инвойс без счёта и записи — команда его оплат.
update public.invoices i
   set brigade_id = coalesce(
     (select a.brigade_id from public.accounts a where a.id = i.account_id),
     (select ap.team_id from public.appointments ap where ap.id = i.appointment_id),
     (select f.team_id from public.finance_transactions f
       where f.invoice_id = i.id and f.team_id is not null
       order by f.created_at limit 1)
   )
 where i.brigade_id is null;

update public.finance_templates p
   set brigade_id = (select a.brigade_id from public.accounts a where a.id = p.account_id)
 where p.brigade_id is null and p.account_id is not null;

update public.finance_transfer_requests r
   set team_id = (select a.brigade_id from public.accounts a where a.id = r.from_account_id)
 where r.team_id is null;

-- Ни с чем не связанные строки (только тестовая компания) — первая команда.
update public.finance_transactions f
   set team_id = (
     select t.id from public.teams t
      where t.tenant_id = f.tenant_id
      order by t.is_active desc, t.position, t.created_at limit 1
   )
 where f.team_id is null;

update public.finance_templates p
   set brigade_id = (
     select t.id from public.teams t
      where t.tenant_id = p.tenant_id
      order by t.is_active desc, t.position, t.created_at limit 1
   )
 where p.brigade_id is null;

update public.receipts r
   set team_id = coalesce(
     (select f.team_id from public.finance_transactions f where f.id = r.transaction_id),
     (select i.brigade_id from public.invoices i where i.id = r.invoice_id),
     (select a.brigade_id from public.accounts a where a.id = r.account_id),
     (select ap.team_id from public.appointments ap where ap.id = r.appointment_id)
   )
 where r.team_id is null;

-- Аннулированные чеки, чьи операции стёрты, ни с чем не связаны (у Giliuta
-- два: RC-2026-007 и RC-2026-008) — первая команда компании; номер и
-- аннулирование остаются как были. Владелец 2026-09-25: данные в базе —
-- тестовые, перед публикацией он их зачистит.
update public.receipts r
   set team_id = (
     select t.id from public.teams t
      where t.tenant_id = r.tenant_id
      order by t.is_active desc, t.position, t.created_at limit 1
   )
 where r.team_id is null;

set local session_replication_role = origin;

-- СЧЁТ — ТОЛЬКО КОМАНДНЫЙ.
alter table public.accounts alter column scope set default 'team';
alter table public.accounts drop constraint if exists accounts_scope_brigade_check;
alter table public.accounts drop constraint if exists accounts_scope_check;
alter table public.accounts
  add constraint accounts_scope_check check (scope = 'team');

-- КОМАНДА ОБЯЗАТЕЛЬНА.
alter table public.accounts alter column brigade_id set not null;
alter table public.finance_transactions alter column team_id set not null;
alter table public.finance_transfer_requests alter column team_id set not null;
alter table public.debts alter column team_id set not null;
alter table public.finance_templates alter column brigade_id set not null;
alter table public.invoices alter column brigade_id set not null;
alter table public.receipts alter column team_id set not null;

create index if not exists receipts_tenant_team_idx on public.receipts (tenant_id, team_id);

-- СТОРОЖА РЕЗУЛЬТАТА.
do $$
declare
  missing int;
begin
  select count(*) into missing
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where t.tgname = 'trg_aa_fill_money_team'
     and c.relname in ('finance_transactions', 'invoices', 'receipts',
                       'finance_templates', 'finance_transfer_requests', 'debts');
  if missing <> 6 then
    raise exception 'дописывание команды стоит не на всех шести таблицах (%)', missing;
  end if;
  if has_function_privilege('anon', 'public.fill_money_team()', 'execute') then
    raise exception 'fill_money_team исполнима для anon';
  end if;
end
$$;
