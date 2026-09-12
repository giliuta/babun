-- Счета календаря видит тот, кому в этом календаре выдали «финансы».
--
-- Сегодня счета — строго владельческие: политика `accounts_owner_all` одна на
-- все действия, и ни диспетчер, ни мастер не получают ни строки (для оплаты
-- записи им отдаёт проекцию `list_payment_accounts_safe`). Это не «слишком
-- строго» — это отсутствие середины: либо всё, либо ничего.
--
-- Середина появляется здесь: право `finance` в КОНКРЕТНОМ календаре открывает
-- счета ЭТОГО календаря. Проверено на боевой базе в begin/rollback: мастер с
-- `finance` в одном календаре видит 2 счёта из 6 в компании — ровно те, что
-- принадлежат его календарю; сегодня он видит 0; владелец как видел 6, так и
-- видит.
--
-- ЧИТАТЬ — ПО КАЛЕНДАРЮ, ПИСАТЬ — ПО-ПРЕЖНЕМУ ВЛАДЕЛЬЦУ. Завести счёт значит
-- изменить устройство денег компании, а не «сделать работу в календаре».
-- Право на это выдаётся отдельно (`settings`) и отдельным шагом, когда экран
-- прав научится его выдавать. Пока политика записи не трогается вовсе.
--
-- ОБЩИЕ СЧЕТА (`scope = 'company'` + таблица `account_teams`) в этот шаг НЕ
-- входят намеренно. Во-первых, живых таких нет: все 15 счетов боевой базы —
-- `scope = 'team'` со своим `brigade_id`. Во-вторых, предикат по `account_teams`
-- внутри политики счетов потянул бы за собой RLS соседней таблицы — путь, на
-- котором легко получить либо рекурсию, либо молча пустой список. Появятся
-- общие счета — появится и свой шаг с собственной проверкой.
--
-- СЧЁТ БЕЗ КАЛЕНДАРЯ ОСТАЁТСЯ ВЛАДЕЛЬЧЕСКИМ: `brigade_id is null` не совпадёт
-- ни с одним календарём, и это правильное умолчание — «ничьи» деньги компании
-- не показываются никому, кроме владельца.

drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.current_user_role() = 'owner'
      or brigade_id in (select unnest(public.current_user_calendar_ids('finance')))
    )
  );

do $$
begin
  -- Владельческая политика на запись обязана остаться нетронутой: если её
  -- снесли, счета станут доступны на изменение тому, кому дали лишь чтение.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'accounts'
       and policyname = 'accounts_owner_all' and cmd = 'ALL'
  ) then
    raise exception 'счета: владельческая политика на запись пропала';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'accounts'
       and policyname = 'accounts_select'
       and qual like '%current_user_calendar_ids%'
  ) then
    raise exception 'счета: чтение по календарю не встало';
  end if;
end $$;
