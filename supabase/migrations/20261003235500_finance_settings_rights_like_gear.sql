-- ПРАВА ШЕСТЕРЁНКИ «ФИНАНСОВ» — СТРОКАМИ ШЕСТЕРЁНКИ (владелец 03.10: «сделай
-- полноценно страницу доступа в финансах… соблюдай наш стиль и архитектуру»;
-- его закон: права = плитки страницы и строки шестерёнки, по строке на
-- каждую).
--
-- Шестерёнка в тот же вечер стала блоками «Деньги · Категории · Документы ·
-- Общие», и у неё появились новые строки. Права догоняют её:
--
--   1. «Категории» → три права, как три строки шестерёнки: «Доходы»,
--      «Расходы», «Долги» (`finance.settings_categories_income / _expense /
--      _debts`). Прежний ключ переименовывается в «…_income» — выданные
--      права едут за ним сами (FK `member_access_block_fkey on update
--      cascade`, приглашения — триггер `access_blocks_rename_in_invitations`);
--      затем каждое выданное право копируется в «…_expense» и «…_debts» с тем
--      же положением: никто ничего не теряет. Политики `finance_categories`
--      читают право своего вида (`type` = income / expense / debt).
--   2. «Удалённые операции» (`finance.settings_trash`, команда, Скрыты /
--      Видит / Возвращает). «Видит» — ящик команды, но только тех видов денег,
--      которые человек и так видит; «Возвращает» — вернуть или стереть
--      насовсем СВОЮ удалённую операцию (вставка «Вернуть» и так требует
--      автора — политики создания операции). Без права ящика партнёр своё
--      удалённое больше не видит — его возвращает владелец (до этого двери к
--      ящику у партнёра не было вовсе). Умолчание «Скрыты».
--   3. «Инвойсы» (`finance.settings_invoices`, компания, Скрыты / Только
--      видит): что подставлять в новый счёт — строки, срок, приписка.
--      Колонки `tenants.invoice_*` партнёру не отдавались (`tenants` читает
--      только владелец). Теперь `current_tenant_profile_safe` отдаёт их тому,
--      у кого «Инвойсы: Только видит», и тому, кто сам выставляет инвойсы
--      («Документы: Выставляет» хоть в одной команде) — иначе его новый
--      инвойс брал бы чужой срок по умолчанию. Менять — только владельцу
--      (`tenants_update_owner`).
--   4. Порядок — порядок шестерёнки: 150 «Счета», 151 «Выгрузка», 152
--      «Удалённые операции», 153–155 категории, 156 «Реквизиты», 157
--      «Инвойсы», 158 «Валюта».

set local lock_timeout = '5s';

-- ─── 0. Реестр — как прочитан 03.10 ───

do $pre$
begin
  if not exists (
    select 1 from public.access_blocks
     where key = 'finance.settings_categories'
       and scope = 'calendar' and levels = array['off', 'read', 'write'] and live
  ) then
    raise exception 'реестр: «Категории» не такие, как прочитаны 03.10';
  end if;
  if exists (
    select 1 from public.access_blocks
     where key in ('finance.settings_categories_income', 'finance.settings_categories_expense',
                   'finance.settings_categories_debts', 'finance.settings_trash',
                   'finance.settings_invoices')
  ) then
    raise exception 'реестр: новые права финансов уже заведены';
  end if;
end
$pre$;

-- ─── 1. «Категории» по видам ───

update public.access_blocks
   set key = 'finance.settings_categories_income',
       title_ru = 'Доходы',
       position = 153
 where key = 'finance.settings_categories';

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values
  ('finance.settings_categories_expense', 'finance', 'calendar', array['off', 'read', 'write'],
   'Расходы', false, true,
   array['policy:public.finance_categories.finance_categories_select_settings',
         'policy:public.finance_categories.finance_categories_write_settings'], 154),
  ('finance.settings_categories_debts', 'finance', 'calendar', array['off', 'read', 'write'],
   'Долги', false, true,
   array['policy:public.finance_categories.finance_categories_select_settings',
         'policy:public.finance_categories.finance_categories_write_settings'], 155);

-- Выданное право «Категорий» — во все три вида, тем же положением.
insert into public.member_access (tenant_id, user_id, block, team_id, level, set_by, set_at)
select ma.tenant_id, ma.user_id, kinds.key, ma.team_id, ma.level, ma.set_by, ma.set_at
  from public.member_access ma
 cross join (values ('finance.settings_categories_expense'), ('finance.settings_categories_debts')) as kinds(key)
 where ma.block = 'finance.settings_categories_income'
on conflict (tenant_id, user_id, block, team_id) do nothing;

-- Ждущие приглашения: имя уже переписал триггер переименования — добавляем
-- те же положения для двух новых видов.
update public.invitations i
   set access_changes = i.access_changes || coalesce((
     select jsonb_agg(change || jsonb_build_object('block', kinds.key))
       from jsonb_array_elements(i.access_changes) as change
      cross join (values ('finance.settings_categories_expense'), ('finance.settings_categories_debts')) as kinds(key)
      where change->>'block' = 'finance.settings_categories_income'
   ), '[]'::jsonb)
 where jsonb_typeof(i.access_changes) = 'array'
   and exists (
     select 1 from jsonb_array_elements(i.access_changes) as change
      where change->>'block' = 'finance.settings_categories_income'
   );

-- Шаблоны прав связи с реестром не имеют — переписываем сами.
update public.access_templates t
   set levels = (t.levels - 'finance.settings_categories')
     || jsonb_build_object(
          'finance.settings_categories_income', t.levels->'finance.settings_categories',
          'finance.settings_categories_expense', t.levels->'finance.settings_categories',
          'finance.settings_categories_debts', t.levels->'finance.settings_categories')
 where t.levels ? 'finance.settings_categories';

drop policy finance_categories_select_settings on public.finance_categories;
create policy finance_categories_select_settings on public.finance_categories
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (type = 'income'
        and team_id in (select unnest(public.access_calendars('finance.settings_categories_income', 'read'))))
      or (type = 'expense'
        and team_id in (select unnest(public.access_calendars('finance.settings_categories_expense', 'read'))))
      or (type = 'debt'
        and team_id in (select unnest(public.access_calendars('finance.settings_categories_debts', 'read'))))
    )
  );

drop policy finance_categories_write_settings on public.finance_categories;
create policy finance_categories_write_settings on public.finance_categories
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and not is_system
    and (
      (type = 'income'
        and team_id in (select unnest(public.access_calendars('finance.settings_categories_income', 'write'))))
      or (type = 'expense'
        and team_id in (select unnest(public.access_calendars('finance.settings_categories_expense', 'write'))))
      or (type = 'debt'
        and team_id in (select unnest(public.access_calendars('finance.settings_categories_debts', 'write'))))
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and not is_system
    and (
      (type = 'income'
        and team_id in (select unnest(public.access_calendars('finance.settings_categories_income', 'write'))))
      or (type = 'expense'
        and team_id in (select unnest(public.access_calendars('finance.settings_categories_expense', 'write'))))
      or (type = 'debt'
        and team_id in (select unnest(public.access_calendars('finance.settings_categories_debts', 'write'))))
    )
  );

-- ─── 2. «Удалённые операции» ───

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values
  ('finance.settings_trash', 'finance', 'calendar', array['off', 'read', 'write'],
   'Удалённые операции', false, true,
   array['policy:public.deleted_operations.deleted_operations_select',
         'policy:public.deleted_operations.deleted_operations_delete',
         'function:public.restore_deleted_operation(uuid)'], 152);

drop policy deleted_operations_select on public.deleted_operations;
create policy deleted_operations_select on public.deleted_operations
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or (
        team_id in (select unnest(public.access_calendars('finance.settings_trash', 'read')))
        -- Только те виды денег, что он и так видит в команде.
        and (
          (operation->>'debt_id' is null and type = 'income'
            and team_id in (select unnest(public.access_calendars('finance.income', 'read'))))
          or (operation->>'debt_id' is null and type = 'expense'
            and team_id in (select unnest(public.access_calendars('finance.expense', 'read'))))
          or (operation->>'debt_id' is not null
            and team_id in (select unnest(public.access_calendars('finance.debts', 'read'))))
        )
      )
    )
  );

-- «Вернуть» забирает снимок удалением (`restore_deleted_operation`), «Удалить
-- насовсем» — тоже удаление: обоим нужна «Возвращает», и только своё.
drop policy deleted_operations_delete on public.deleted_operations;
create policy deleted_operations_delete on public.deleted_operations
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or (
        team_id in (select unnest(public.access_calendars('finance.settings_trash', 'write')))
        and operation->>'created_by' = (select auth.uid())::text
        and (
          (operation->>'debt_id' is null and type = 'income'
            and team_id in (select unnest(public.access_calendars('finance.income', 'read'))))
          or (operation->>'debt_id' is null and type = 'expense'
            and team_id in (select unnest(public.access_calendars('finance.expense', 'read'))))
          or (operation->>'debt_id' is not null
            and team_id in (select unnest(public.access_calendars('finance.debts', 'read'))))
        )
      )
    )
  );

-- ─── 3. «Инвойсы» ───

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position)
values
  ('finance.settings_invoices', 'finance', 'company', array['off', 'read'],
   'Инвойсы', false, true,
   array['function:public.current_tenant_profile_safe()',
         'ui:менять бланк инвойса — только владельцу (tenants_update_owner)'], 157);

-- Тело — с живой базы (pg_get_functiondef 03.10); добавлены только поля
-- бланка инвойса в ветке партнёра.
create or replace function public.current_tenant_profile_safe()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when public.current_user_role() = 'owner' then
      to_jsonb(t) || jsonb_build_object('tier', public.tenant_effective_plan(t.id))
    when public.current_user_role() in ('dispatcher', 'master') then
      jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'vertical', t.vertical,
        'city', t.city,
        'country', t.country,
        'address', t.address,
        'logo_url', t.logo_url,
        'contact_phone', t.contact_phone,
        'contact_email', t.contact_email,
        'contact_whatsapp', t.contact_whatsapp,
        'contact_telegram', t.contact_telegram,
        'contact_instagram', t.contact_instagram,
        'onboarded_at', t.onboarded_at,
        'personal_calendar_enabled', t.personal_calendar_enabled,
        'track_units', t.track_units,
        -- валюта сумм: без неё сотрудник видит € у любой компании (этап 0(е))
        'currency', t.currency,
        'created_at', t.created_at,
        -- тариф владельца команды: партнёр работает по нему (01.10)
        'tier', public.tenant_effective_plan(t.id)
      )
      -- Бланк инвойса (03.10): тому, кто видит «Инвойсы» в шестерёнке, и
      -- тому, кто сам выставляет инвойсы, — его новый счёт берёт срок,
      -- строки и приписку компании, а не умолчания приложения.
      || case
        when public.access_company('finance.settings_invoices', 'read')
          or cardinality(public.access_calendars('finance.documents', 'write')) > 0 then
          jsonb_build_object(
            'invoice_due_days', t.invoice_due_days,
            'invoice_line_source', t.invoice_line_source,
            'invoice_default_line_title', t.invoice_default_line_title,
            'invoice_footer_note', t.invoice_footer_note
          )
        else '{}'::jsonb
      end
    else null
  end
    from public.tenants t
   where t.id = public.current_tenant_id()
   limit 1
$function$;

-- ─── 4. Порядок шестерёнки ───

update public.access_blocks set position = 156 where key = 'finance.settings_requisites';
update public.access_blocks set position = 158 where key = 'finance.settings_currency';

-- ─── 5. Сторож ───

do $guard$
declare
  expected jsonb := jsonb_build_object(
    'finance.settings_accounts', jsonb_build_array('calendar', 150, array['off', 'read', 'write']),
    'finance.settings_export', jsonb_build_array('calendar', 151, array['off', 'write']),
    'finance.settings_trash', jsonb_build_array('calendar', 152, array['off', 'read', 'write']),
    'finance.settings_categories_income', jsonb_build_array('calendar', 153, array['off', 'read', 'write']),
    'finance.settings_categories_expense', jsonb_build_array('calendar', 154, array['off', 'read', 'write']),
    'finance.settings_categories_debts', jsonb_build_array('calendar', 155, array['off', 'read', 'write']),
    'finance.settings_requisites', jsonb_build_array('company', 156, array['off', 'read']),
    'finance.settings_invoices', jsonb_build_array('company', 157, array['off', 'read']),
    'finance.settings_currency', jsonb_build_array('company', 158, array['off', 'read'])
  );
  actual jsonb;
begin
  select jsonb_object_agg(key, jsonb_build_array(scope, position, levels))
    into actual
    from public.access_blocks
   where key like 'finance.settings%' and live;
  if actual is distinct from expected then
    raise exception 'сторож: реестр шестерёнки финансов не такой, как задуман: %', actual;
  end if;

  if exists (select 1 from public.member_access where block = 'finance.settings_categories')
     or exists (select 1 from public.access_templates where levels ? 'finance.settings_categories') then
    raise exception 'сторож: прежний ключ «Категорий» остался в правах или шаблонах';
  end if;

  -- Каждое выданное право категорий — во всех трёх видах одинаково.
  if exists (
    select 1
      from public.member_access income
     where income.block = 'finance.settings_categories_income'
       and (
         select count(*) from public.member_access other
          where other.tenant_id = income.tenant_id
            and other.user_id = income.user_id
            and other.team_id is not distinct from income.team_id
            and other.block in ('finance.settings_categories_expense', 'finance.settings_categories_debts')
            and other.level = income.level
       ) <> 2
  ) then
    raise exception 'сторож: права категорий разошлись по видам';
  end if;

  if position('finance.settings_invoices' in (
       select prosrc from pg_proc where oid = 'public.current_tenant_profile_safe()'::regprocedure)) = 0 then
    raise exception 'сторож: профиль компании не отдаёт бланк инвойса';
  end if;
end
$guard$;
