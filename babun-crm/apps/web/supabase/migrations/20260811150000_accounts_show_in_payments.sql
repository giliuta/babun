-- «ПОКАЗЫВАТЬ ЭТОТ СЧЁТ ПРИ ОПЛАТЕ ЗАЯВОК» — переключатель на самом счёте.
--
-- ЗАЧЕМ. Владелец 2026-08-11: «должна быть функция показывать ли этот счёт в
--   оплате в заявках; если я нажимаю тумблер — бригадир может нажать "зачислено
--   на этот счёт", и оно автоматически зачисляет».
--   Сегодня в пикере оплаты видны ВСЕ активные счета команды. Как только у
--   бригады появляется счёт, который трогать нельзя — накопительный, резервный,
--   чужой карман, — бригадир всё равно видит его в списке и может положить туда
--   выручку одним промахом пальца. Отменить такое можно, но заметят через месяц.
--
-- ПОЧЕМУ ОТДЕЛЬНАЯ КОЛОНКА, А НЕ `kind`. Вид счёта («наличные», «карта») из
--   формы создания убран: владелец называет счёт словами и не хочет выбирать
--   классификацию. Значит вопрос «принимаем ли сюда деньги» перестал выводиться
--   из вида и стал самостоятельным — его и спрашиваем прямо.
--
-- ПОЧЕМУ ПО УМОЛЧАНИЮ TRUE. Все существующие счета сегодня видны в оплате;
--   default false молча выключил бы приём денег у всех сразу, и первая же
--   заявка после накатки не нашла бы счёт. Новое поведение включается вручную
--   и по одному счёту.
--
-- ГДЕ ЭТО ДЕЙСТВУЕТ — в ДВУХ местах, и оба обязательны:
--   1. `list_payment_accounts_safe` — пикер, который видит бригадир;
--   2. `resolve_appointment_finance_account` — автоподбор счёта, когда касса
--      явно не выбрана (закрытие дня, импорт, старые записи). Если фильтровать
--      только пикер, деньги всё равно уедут на спрятанный счёт автоматом, и
--      тумблер окажется декорацией.

alter table public.accounts
  add column if not exists show_in_payments boolean not null default true;

comment on column public.accounts.show_in_payments is
  'Показывать счёт при оплате заявок: бригадир видит его в пикере, а автоподбор может на него зачислить. Выключенный счёт остаётся в списке счетов и в переводах — он просто перестаёт принимать деньги заявок.';

-- ─── Пикер приёма оплаты у бригадира ─────────────────────────────────
-- Проекция намеренно тощая — ни балансов, ни скрытых полей: мастер видит
-- НАЗВАНИЯ касс, в которые может принять деньги, и никогда сами деньги.
create or replace function public.list_payment_accounts_safe(p_team_id text)
returns setof jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', a.id,
    'name', a.name,
    'kind', a.kind,
    'scope', a.scope,
    'icon', a.icon,
    'color', a.color,
    'position', a.position
  )
    from public.accounts a
   where p_team_id is not null
     and btrim(p_team_id) <> ''
     and a.tenant_id = public.current_tenant_id()
     and a.is_active = true
     and a.show_in_payments = true
     and (
       public.current_user_role() in ('owner', 'dispatcher')
       or p_team_id = any(public.current_user_team_ids())
     )
     and (
       (a.scope = 'team' and a.brigade_id = p_team_id)
       or (a.scope = 'company' and exists (
         select 1 from public.account_teams att
          where att.account_id = a.id and att.team_id = p_team_id
       ))
     )
   order by (a.scope = 'team') desc, a.is_primary desc, a.position, a.name, a.id
$function$;

revoke all on function public.list_payment_accounts_safe(text) from public, anon;
grant execute on function public.list_payment_accounts_safe(text) to authenticated;

-- ─── Автоподбор счёта, когда касса не выбрана явно ───────────────────
create or replace function public.resolve_appointment_finance_account(
  p_tenant_id uuid,
  p_team_id text,
  p_payment_method text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  account_id uuid;
  required_kind text;
begin
  if p_team_id is null or btrim(p_team_id) = '' then
    raise exception 'Укажите команду заявки перед оплатой';
  end if;
  if p_payment_method is null
     or p_payment_method not in ('cash', 'card', 'transfer', 'other') then
    raise exception 'Выберите способ оплаты заявки';
  end if;
  required_kind := case p_payment_method
    when 'cash' then 'cash'
    when 'card' then 'card'
    when 'transfer' then 'bank'
    else 'other'
  end;

  select a.id into account_id
    from public.accounts a
   where a.tenant_id = p_tenant_id
     and a.kind = required_kind
     and a.is_active = true
     and a.show_in_payments = true
     and (
       (a.scope = 'team' and a.brigade_id = p_team_id)
       or (a.scope = 'company' and exists (
         select 1 from public.account_teams att
          where att.account_id = a.id and att.team_id = p_team_id
       ))
     )
   order by (a.scope = 'team') desc, a.is_primary desc, a.position, a.name, a.id
   limit 1;
  if account_id is null then
    raise exception 'Для этого способа оплаты нет счёта, принимающего деньги заявок';
  end if;
  return account_id;
end;
$function$;

revoke all on function public.resolve_appointment_finance_account(uuid, text, text)
  from public, anon, authenticated;

-- ─── Deploy assertions ───────────────────────────────────────────────
do $audit$
begin
  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.accounts'::regclass
       and attname = 'show_in_payments'
       and not attisdropped
       and attnotnull
  ) then
    raise exception 'оплата заявок: колонки accounts.show_in_payments нет или она допускает NULL';
  end if;

  -- Обе двери обязаны уважать тумблер. Если фильтр останется только в пикере,
  -- автоподбор продолжит зачислять на выключенный счёт, и тумблер станет ложью.
  if (select count(*)
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'list_payment_accounts_safe',
           'resolve_appointment_finance_account'
         )
         and p.prosrc like '%show_in_payments%') <> 2 then
    raise exception 'оплата заявок: тумблер уважает не обе двери (пикер и автоподбор)';
  end if;

  -- Существующие счета обязаны остаться видимыми: выключить приём денег у всех
  -- разом — это заявка, которая внезапно не находит куда положить оплату.
  if exists (select 1 from public.accounts where show_in_payments is not true) then
    raise exception 'оплата заявок: после накатки есть счета с выключенным приёмом — default должен быть true';
  end if;
end;
$audit$;
