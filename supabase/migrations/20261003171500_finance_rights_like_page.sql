-- ПРАВА «ФИНАНСОВ» — КАК СТРАНИЦА (владелец 03.10: права — плитками страницы
-- «Финансы» и строками её шестерёнки, как уже сделано у «Клиентов»).
--
-- Плитки страницы: Счета · Документы · Доход · Расход · Долги · Прибыль.
-- Шестерёнка: Счета · Выгрузка для бухгалтера · Категории · Валюта ·
-- Реквизиты. У каждой плитки и у каждой строки шестерёнки — своё право, и
-- реестр стоит в том же порядке.
--
-- Функции ниже правятся НА ЖИВОМ ТЕЛЕ: тело берётся из базы
-- (`pg_get_functiondef`), сверяется md5 его `prosrc` (снят 03.10), меняются
-- только места с пометкой «03.10», и каждое должно найтись ровно столько раз,
-- сколько ожидается. Тело поменяли с тех пор — миграция падает, а не затирает
-- чужое. Ветки владельца не меняются: каждое новое условие стоит за
-- `current_user_role() is distinct from 'owner'` или за отказом, который
-- владелец уже прошёл.
--
--   1. «Документы» — своё право команды `finance.documents`: «Скрыты» ·
--      «Видит» · «Выставляет». Команда документа — его собственная колонка,
--      которую сервер ставит при выпуске: у инвойса и кредит-ноты
--      `brigade_id` (NOT NULL; команда записи, дохода или счёта, у
--      кредит-ноты — команда её инвойса), у чека `team_id` (команда денег).
--      Команда клиента правилом не служит: клиент одной команды бывает в
--      работе другой, и такие документы в базе уже есть.
--      «Видит» — инвойсы, кредит-ноты, их строки и чеки своих команд.
--      «Выставляет» — `issue_invoice` в своей команде: от юрлица этой команды
--      (у команды без своего юрлица — от основного), клиент — из записи, из
--      дохода или из его базы клиентов, доход для привязки — который он видит
--      («Доходы»), счёт оплаты — счёт этой команды. Язык документа (второй
--      шаг выпуска) — правкой одной колонки; остальное в выставленном
--      документе партнёр не трогает (сторож `invoices_member_columns_guard`).
--      Чек к оплаченному инвойсу своей команды — `issue_receipt` («Чек —
--      только у инвойса»). Отмена (кредит-нота), оплата и возврат по инвойсу,
--      начало нумерации — остаются за владельцем: документ после выпуска
--      неизменяем, отменяется только кредит-нотой, а нумерация живёт у юрлица.
--      Чеки клиента в его карточке по-прежнему идут за «Историей»
--      (`receipts_read_own_money`) — это карточка клиента, не плитка.
--   2. «Прибыль» — `finance.profit`: «Скрыта» · «Видит». Только экран:
--      прибыль — доход минус расход, которые он и так видит своими правами;
--      своих строк в базе у неё нет.
--   3. Шестерёнка финансов — по праву на строку:
--      «Счета» (`finance.settings_accounts`, команда): «Скрыты» · «Только
--        видит» · «Видит и меняет». Заводить и править счета команды теперь
--        решает это право, а не плитка «Счета» — у плитки остаются остатки и
--        переводы. У кого плитка стояла на «Управляет», получает «Видит и
--        меняет» здесь — никто молча не теряет правки.
--      «Выгрузка для бухгалтера» (`finance.settings_export`, команда):
--        «Скрыта» · «Выгружает». Только экран: файл собирается на телефоне из
--        операций, которые он и так читает.
--      «Категории» (`finance.settings_categories`, команда): «Скрыты» ·
--        «Только видит» · «Видит и меняет» — категории своей команды,
--        служебные сервера — никогда. Заменяет «Категории операций» на всю
--        компанию: кому они стояли, получает то же положение в каждой своей
--        команде (владелец 15.09: уровень хранится и применяется, когда блок
--        оживёт).
--      «Валюта» (`finance.settings_currency`, на аккаунт): «Скрыта» ·
--        «Только видит». Менять нельзя: валюта одна на весь аккаунт, её смена
--        переписала бы деньги и документы команд, которых партнёр не видит.
--      «Реквизиты» (`finance.settings_requisites`, на аккаунт): «Скрыты» ·
--        «Только видит» (юрлица). Менять нельзя: реквизиты общие для всех
--        команд, а смена IBAN или VAT-номера — это чужие деньги и чужие
--        документы. Бланк счёта и нумерация — у владельца.
--      Каждую таблицу, которую партнёр теперь пишет (`accounts`,
--      `finance_categories`), сторожит тариф (`tenant_partner_writes_guard`);
--      `invoices` и `receipts` он сторожил и раньше.
--   4. Права, которых больше нет ни на одной странице, уходят из реестра:
--      «Доходы и расходы» (`finance.operations`), «Файл к операции»,
--      «Шаблоны операций», VAT, «Счета клиентам», «Категории операций».
--      Сначала их строки в ждущих приглашениях и у людей, потом реестр.
--   5. Названия и порядок — словами и порядком страницы: «Счета» (было
--      «Счета и остатки»), «Документы» (было «Инвойсы и чеки»).

set local lock_timeout = '5s';

-- ─── 1. «Документы» ──────────────────────────────────────────────────────

update public.access_blocks
   set title_ru = 'Документы',
       levels = array['off', 'read', 'write'],
       live = true,
       enforced_by = array[
         'policy:public.invoices.invoices_select_documents',
         'policy:public.invoices.invoices_update_documents',
         'policy:public.invoice_lines.invoice_lines_select_documents',
         'policy:public.receipts.receipts_select_documents',
         'function:public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text, text)',
         'function:public.resolve_company_id(uuid, uuid)',
         'function:public.issue_receipt(uuid, jsonb, uuid)',
         'function:public.invoices_member_columns_guard()'
       ]
 where key = 'finance.documents';

drop policy if exists invoices_select_documents on public.invoices;
create policy invoices_select_documents
  on public.invoices
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and brigade_id in (select unnest(public.access_calendars('finance.documents', 'read')))
  );

drop policy if exists invoice_lines_select_documents on public.invoice_lines;
create policy invoice_lines_select_documents
  on public.invoice_lines
  for select
  to authenticated
  using (
    invoice_id in (
      select invoice.id
        from public.invoices invoice
       where invoice.tenant_id = (select public.current_tenant_id())
         and invoice.brigade_id in (select unnest(public.access_calendars('finance.documents', 'read')))
    )
  );

drop policy if exists receipts_select_documents on public.receipts;
create policy receipts_select_documents
  on public.receipts
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('finance.documents', 'read')))
  );

-- Язык выставленного документа — второй шаг выпуска (`useIssueInvoice`).
-- Колонки, открытые приложению на запись, — `language`, `pdf_url`, `status`;
-- партнёру из них — только язык (сторож ниже).
drop policy if exists invoices_update_documents on public.invoices;
create policy invoices_update_documents
  on public.invoices
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and brigade_id in (select unnest(public.access_calendars('finance.documents', 'write')))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and brigade_id in (select unnest(public.access_calendars('finance.documents', 'write')))
  );

create or replace function public.invoices_member_columns_guard()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  -- Мерится только прямая правка из приложения (роль `authenticated`):
  -- выпуск, оплата и отмена пишут инвойс изнутри своих функций и этим
  -- сторожем не меряются. Владелец правит без ограничений.
  if current_user <> 'authenticated'
     or auth.uid() is null
     or public.current_user_role() is not distinct from 'owner' then
    return new;
  end if;
  if (to_jsonb(new) - 'language' - 'updated_at')
     is distinct from (to_jsonb(old) - 'language' - 'updated_at') then
    raise exception 'В выставленном документе партнёр меняет только язык'
      using errcode = '42501', hint = 'block:finance.documents';
  end if;
  return new;
end;
$function$;

revoke all on function public.invoices_member_columns_guard() from public, anon, authenticated;

drop trigger if exists invoices_member_columns_guard on public.invoices;
create trigger invoices_member_columns_guard
  before update on public.invoices
  for each row execute function public.invoices_member_columns_guard();

-- Выпуск инвойса партнёром.
do $migration$
declare
  fn constant regprocedure := 'public.issue_invoice(uuid, date, date, uuid, uuid, text, text, numeric, jsonb, text, uuid, uuid, uuid, text, text)'::regprocedure;
  olds constant text[] := array[
$inv_o1$  if tenant_uuid is null or public.current_user_role() is distinct from 'owner' then
    raise exception 'Недостаточно прав для создания инвойса';
  end if;$inv_o1$,
$inv_o2$  if found then
    return invoice_row;
  end if;$inv_o2$,
$inv_o3$  if resolved_brigade_id is not null and not exists (
    select 1 from public.teams where id = resolved_brigade_id and tenant_id = tenant_uuid
  ) then
    raise exception 'Команда не найдена или недоступна';
  end if;$inv_o3$
  ];
  news constant text[] := array[
$inv_n1$  -- 03.10: выставляет и партнёр с «Документы: Выставляет» — в команде, где у
  -- него это право (команда документа проверяется ниже, когда она известна).
  if tenant_uuid is null or (
    public.current_user_role() is distinct from 'owner'
    and cardinality(public.access_calendars('finance.documents', 'write')) = 0
  ) then
    raise exception 'Недостаточно прав для создания инвойса';
  end if;$inv_n1$,
$inv_n2$  if found then
    -- 03.10: повтор запроса партнёра отдаёт только документ его команды.
    if public.current_user_role() is distinct from 'owner'
       and (invoice_row.brigade_id = any(public.access_calendars('finance.documents', 'write'))) is not true then
      raise exception 'Недостаточно прав для создания инвойса';
    end if;
    return invoice_row;
  end if;$inv_n2$,
$inv_n3$  if resolved_brigade_id is not null and not exists (
    select 1 from public.teams where id = resolved_brigade_id and tenant_id = tenant_uuid
  ) then
    raise exception 'Команда не найдена или недоступна';
  end if;
  -- 03.10: партнёр с «Документы: Выставляет» — только в команде, где у него
  -- это право, и от юрлица этой команды (у команды без своего юрлица — от
  -- основного). Клиент без записи и без дохода — из его базы клиентов; доход
  -- для привязки — который он видит («Доходы»); счёт оплаты — счёт команды
  -- документа.
  if public.current_user_role() is distinct from 'owner' then
    if (resolved_brigade_id = any(public.access_calendars('finance.documents', 'write'))) is not true then
      raise exception 'Нет права выставлять документы этой команды'
        using errcode = '42501', hint = 'block:finance.documents';
    end if;
    if p_company_id is not null
       and p_company_id is distinct from coalesce(
         public.legal_entity_of_team(tenant_uuid, resolved_brigade_id),
         public.resolve_company_id(tenant_uuid, null)
       ) then
      raise exception 'Документ команды выставляется от реквизитов этой команды'
        using errcode = '42501', hint = 'block:finance.documents';
    end if;
    if p_link_to_tx_id is not null
       and (transaction_row.team_id = any(public.access_calendars('finance.income', 'read'))) is not true then
      raise exception 'Нет права видеть этот доход'
        using errcode = '42501', hint = 'block:finance.income';
    end if;
    if resolved_client_id is not null
       and resolved_appointment_id is null
       and (p_link_to_tx_id is null or transaction_row.client_id is null)
       and (resolved_client_id = any(
         public.access_client_ids_in(public.access_calendars('clients', 'read'))
       )) is not true then
      raise exception 'Клиент не найден или недоступен'
        using errcode = '42501', hint = 'block:clients';
    end if;
    if p_account_id is not null and not exists (
      select 1
        from public.accounts acc
       where acc.id = p_account_id
         and acc.tenant_id = tenant_uuid
         and acc.brigade_id = resolved_brigade_id
    ) then
      raise exception 'Оплату по документу команды ждут на счёт этой команды'
        using errcode = '42501', hint = 'block:finance.documents';
    end if;
  end if;$inv_n3$
  ];
  times constant integer[] := array[1, 2, 1];
  def text;
  i integer;
begin
  if (select md5(prosrc) from pg_proc where oid = fn) is distinct from '330e2645a4af508acee88eb52a54858b' then
    raise exception 'issue_invoice изменилась после чтения 03.10 — перечитать тело перед правкой';
  end if;
  def := pg_get_functiondef(fn);
  for i in 1 .. cardinality(olds) loop
    if (length(def) - length(replace(def, olds[i], ''))) / length(olds[i]) <> times[i] then
      raise exception 'issue_invoice: место правки % найдено не % раз', i, times[i];
    end if;
    def := replace(def, olds[i], news[i]);
  end loop;
  execute def;
end
$migration$;

-- Юрлицо документа: партнёр выставляет от юрлица своей команды. Эту функцию
-- зовут и выпуск, и сторож снимков инвойса (`capture_invoice_document_snapshots`)
-- с уже выбранным юрлицом — без правки партнёр не выставил бы ничего.
do $migration$
declare
  fn constant regprocedure := 'public.resolve_company_id(uuid, uuid)'::regprocedure;
  olds constant text[] := array[
$rci_o1$    if caller_role is not null and caller_role not in ('owner', 'dispatcher') then
      raise exception 'Выбирать реквизиты может владелец или диспетчер';
    end if;$rci_o1$
  ];
  news constant text[] := array[
$rci_n1$    -- 03.10: партнёр с «Документы: Выставляет» выставляет документ от юрлица
    -- своей команды (у команды без своего юрлица — от основного); выбирать
    -- чужие реквизиты он по-прежнему не может.
    if caller_role is not null and caller_role not in ('owner', 'dispatcher')
       and not exists (
         select 1
           from public.teams team
          where team.tenant_id = p_tenant_id
            and team.id = any(public.access_calendars('finance.documents', 'write'))
            and coalesce(team.legal_entity_id, public.resolve_company_id(p_tenant_id, null)) = p_company_id
       ) then
      raise exception 'Выбирать реквизиты может владелец или диспетчер';
    end if;$rci_n1$
  ];
  times constant integer[] := array[1];
  def text;
  i integer;
begin
  if (select md5(prosrc) from pg_proc where oid = fn) is distinct from '00a2f9bc2c5eb711daaefdb5317eed2b' then
    raise exception 'resolve_company_id изменилась после чтения 03.10 — перечитать тело перед правкой';
  end if;
  def := pg_get_functiondef(fn);
  for i in 1 .. cardinality(olds) loop
    if (length(def) - length(replace(def, olds[i], ''))) / length(olds[i]) <> times[i] then
      raise exception 'resolve_company_id: место правки % найдено не % раз', i, times[i];
    end if;
    def := replace(def, olds[i], news[i]);
  end loop;
  execute def;
end
$migration$;

-- Чек к оплаченному инвойсу своей команды.
do $migration$
declare
  fn constant regprocedure := 'public.issue_receipt(uuid, jsonb, uuid)'::regprocedure;
  olds constant text[] := array[
$rcp_o1$  if allowed is not true then
    raise exception 'Недостаточно прав, чтобы выписать чек по этой операции';
  end if;$rcp_o1$
  ];
  news constant text[] := array[
$rcp_n1$  -- 03.10: чек — документ оплаченного инвойса («Чек — только у инвойса»):
  -- его выписывает и партнёр с «Документы: Выставляет» в команде инвойса.
  if allowed is not true
     and tx.invoice_id is not null
     and exists (
       select 1
         from public.invoices invoice
        where invoice.id = tx.invoice_id
          and invoice.tenant_id = tenant_uuid
          and invoice.brigade_id = tx.team_id
          and invoice.brigade_id = any(public.access_calendars('finance.documents', 'write'))
     ) then
    allowed := true;
  end if;
  if allowed is not true then
    raise exception 'Недостаточно прав, чтобы выписать чек по этой операции';
  end if;$rcp_n1$
  ];
  times constant integer[] := array[1];
  def text;
  i integer;
begin
  if (select md5(prosrc) from pg_proc where oid = fn) is distinct from 'ad5324ce384fe32e44218f4ec5f56922' then
    raise exception 'issue_receipt изменилась после чтения 03.10 — перечитать тело перед правкой';
  end if;
  def := pg_get_functiondef(fn);
  for i in 1 .. cardinality(olds) loop
    if (length(def) - length(replace(def, olds[i], ''))) / length(olds[i]) <> times[i] then
      raise exception 'issue_receipt: место правки % найдено не % раз', i, times[i];
    end if;
    def := replace(def, olds[i], news[i]);
  end loop;
  execute def;
end
$migration$;

-- ─── 2. «Прибыль» ────────────────────────────────────────────────────────

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values (
  'finance.profit', 'finance', 'calendar', array['off', 'read'], 'Прибыль', false, true,
  array['ui:прибыль — доход минус расход, видимые правами finance.income и finance.expense; своих строк в базе нет'],
  106
)
on conflict (key) do nothing;

-- ─── 3. Шестерёнка финансов ──────────────────────────────────────────────

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values
  (
    'finance.settings_accounts', 'finance', 'calendar', array['off', 'read', 'write'], 'Счета', false, true,
    array[
      'policy:public.accounts.accounts_select_settings',
      'policy:public.accounts.accounts_insert_calendar',
      'policy:public.accounts.accounts_update_calendar'
    ],
    150
  ),
  (
    'finance.settings_export', 'finance', 'calendar', array['off', 'write'], 'Выгрузка для бухгалтера', false, true,
    array['ui:файл собирается на телефоне из операций, которые он и так читает (finance_transactions под RLS)'],
    151
  ),
  (
    'finance.settings_categories', 'finance', 'calendar', array['off', 'read', 'write'], 'Категории', false, true,
    array[
      'policy:public.finance_categories.finance_categories_select_settings',
      'policy:public.finance_categories.finance_categories_write_settings'
    ],
    152
  ),
  (
    'finance.settings_currency', 'finance', 'company', array['off', 'read'], 'Валюта', false, true,
    array['ui:валюта одна на аккаунт и известна каждому участнику; менять — только владельцу (tenants_update_owner)'],
    153
  ),
  (
    'finance.settings_requisites', 'finance', 'company', array['off', 'read'], 'Реквизиты', false, true,
    array['policy:public.legal_entities.legal_entities_select_settings'],
    154
  )
on conflict (key) do nothing;

-- «Счета»: заводить и править счета команды — право строки шестерёнки.
drop policy if exists accounts_select_settings on public.accounts;
create policy accounts_select_settings
  on public.accounts
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and brigade_id in (select unnest(public.access_calendars('finance.settings_accounts', 'read')))
  );

alter policy accounts_insert_calendar
  on public.accounts
  with check (
    tenant_id = (select public.current_tenant_id())
    and brigade_id in (select unnest(public.access_calendars('finance.settings_accounts', 'write')))
    and (created_by is null or created_by = (select auth.uid()))
  );

alter policy accounts_update_calendar
  on public.accounts
  using (
    tenant_id = (select public.current_tenant_id())
    and brigade_id in (select unnest(public.access_calendars('finance.settings_accounts', 'write')))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and brigade_id in (select unnest(public.access_calendars('finance.settings_accounts', 'write')))
  );

update public.access_blocks
   set enforced_by = array_remove(
         array_remove(enforced_by, 'policy:public.accounts.accounts_insert_calendar'),
         'policy:public.accounts.accounts_update_calendar'
       )
 where key = 'finance.accounts';

insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
select ma.tenant_id, ma.user_id, 'finance.settings_accounts', ma.team_id, 'write', ma.set_by, ma.set_at
  from public.member_access ma
 where ma.block = 'finance.accounts'
   and ma.level = 'write'
   and exists (
     select 1
       from public.member_calendars mc
      where mc.tenant_id = ma.tenant_id
        and mc.user_id = ma.user_id
        and mc.team_id = ma.team_id
   )
on conflict (tenant_id, user_id, block, team_id) do nothing;

drop trigger if exists accounts_partner_writes_guard on public.accounts;
create trigger accounts_partner_writes_guard
  before insert or delete or update on public.accounts
  for each row execute function public.tenant_partner_writes_guard();

-- «Категории»: категории своей команды; служебные — никогда.
drop policy if exists finance_categories_select_settings on public.finance_categories;
create policy finance_categories_select_settings
  on public.finance_categories
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and team_id in (select unnest(public.access_calendars('finance.settings_categories', 'read')))
  );

drop policy if exists finance_categories_write_settings on public.finance_categories;
create policy finance_categories_write_settings
  on public.finance_categories
  for all
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and not is_system
    and team_id in (select unnest(public.access_calendars('finance.settings_categories', 'write')))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and not is_system
    and team_id in (select unnest(public.access_calendars('finance.settings_categories', 'write')))
  );

insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
select ma.tenant_id, ma.user_id, 'finance.settings_categories', mc.team_id, ma.level, ma.set_by, ma.set_at
  from public.member_access ma
  join public.member_calendars mc
    on mc.tenant_id = ma.tenant_id
   and mc.user_id = ma.user_id
 where ma.block = 'finance.categories'
   and ma.team_id is null
on conflict (tenant_id, user_id, block, team_id) do nothing;

drop trigger if exists finance_categories_partner_writes_guard on public.finance_categories;
create trigger finance_categories_partner_writes_guard
  before insert or delete or update on public.finance_categories
  for each row execute function public.tenant_partner_writes_guard();

-- «Реквизиты»: юрлица аккаунта — только видит.
drop policy if exists legal_entities_select_settings on public.legal_entities;
create policy legal_entities_select_settings
  on public.legal_entities
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.access_company('finance.settings_requisites', 'read'))
  );

-- ─── 4. Права, которых нет ни на одной странице ──────────────────────────

update public.invitations i
   set access_changes = (
     select coalesce(jsonb_agg(c.change order by c.ord), '[]'::jsonb)
       from jsonb_array_elements(i.access_changes) with ordinality as c(change, ord)
      where not coalesce(c.change ->> 'block' = any(array[
        'finance.operations', 'finance.operation_files', 'finance.templates',
        'finance.vat', 'finance.invoicing', 'finance.categories'
      ]), false)
   )
 where i.accepted_at is null
   and jsonb_typeof(i.access_changes) = 'array'
   and exists (
     select 1
       from jsonb_array_elements(
              case when jsonb_typeof(i.access_changes) = 'array' then i.access_changes else '[]'::jsonb end
            ) e
      where e ->> 'block' = any(array[
        'finance.operations', 'finance.operation_files', 'finance.templates',
        'finance.vat', 'finance.invoicing', 'finance.categories'
      ])
   );

delete from public.member_access
 where block = any(array[
   'finance.operations', 'finance.operation_files', 'finance.templates',
   'finance.vat', 'finance.invoicing', 'finance.categories'
 ]);

delete from public.access_blocks
 where key = any(array[
   'finance.operations', 'finance.operation_files', 'finance.templates',
   'finance.vat', 'finance.invoicing', 'finance.categories'
 ]);

-- ─── 5. Названия и порядок — как на странице ─────────────────────────────

update public.access_blocks set title_ru = 'Счета', position = 101 where key = 'finance.accounts';
update public.access_blocks set position = 102 where key = 'finance.documents';
update public.access_blocks set position = 103 where key = 'finance.income';
update public.access_blocks set position = 104 where key = 'finance.expense';
update public.access_blocks set position = 105 where key = 'finance.debts';

-- Сторож: реестр финансов ровно такой, как страница.
do $migration$
declare
  got text;
begin
  select string_agg(
           format('%s|%s|%s|%s|%s|%s', key, scope, array_to_string(levels, ','), title_ru, live::text, position),
           E'\n' order by position, key
         )
    into got
    from public.access_blocks
   where area = 'finance';
  if got is distinct from $expected$finance.accounts|calendar|off,read,write|Счета|true|101
finance.documents|calendar|off,read,write|Документы|true|102
finance.income|calendar|off,read,write,full|Доходы|true|103
finance.expense|calendar|off,read,write,full|Расходы|true|104
finance.debts|calendar|off,read,write|Долги|true|105
finance.profit|calendar|off,read|Прибыль|true|106
finance.settings_accounts|calendar|off,read,write|Счета|true|150
finance.settings_export|calendar|off,write|Выгрузка для бухгалтера|true|151
finance.settings_categories|calendar|off,read,write|Категории|true|152
finance.settings_currency|company|off,read|Валюта|true|153
finance.settings_requisites|company|off,read|Реквизиты|true|154$expected$ then
    raise exception 'реестр финансов не совпал со страницей: %', got;
  end if;
end
$migration$;
