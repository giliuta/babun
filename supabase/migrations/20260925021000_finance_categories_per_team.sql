-- КАТЕГОРИИ ДЕНЕГ — У КОМАНДЫ (владелец 2026-09-24: «у нас всё отдельно под
-- каждую команду»; «у каждой команды свой тип расходов, свой тип доходов и так
-- далее»).
--
-- До этой миграции категория принадлежала компании, а скрытие и порядок жили
-- отдельными таблицами на компанию (их завели, когда категории были общими
-- для всех компаний). Теперь:
--   • у категории компании есть команда (`team_id`, NOT NULL для строк
--     компании; служебные категории сервера — `tenant_id is null` — без
--     команды, ими подписывает сервер);
--   • скрытие и порядок — колонки самой категории: она и так своя у команды;
--   • каждая категория компании раздаётся всем действующим командам и тем,
--     где ею уже пользовались: первая команда оставляет саму строку, прочие
--     получают копии; операции, шаблоны и долги переезжают на копию своей
--     команды — у прошлых денег подпись не пропадает и не уходит в чужую
--     команду;
--   • сторожа целостности операции и шаблона требуют категорию СВОЕЙ команды;
--   • сотрудник видит категории только тех команд, к деньгам которых у него
--     есть доступ.
--
-- Связь категории с командой — без внешнего ключа: команду стирают через
-- архив календаря, а деньги архива (и их подписи) остаются; жёсткая связь
-- либо не дала бы стереть команду, либо унесла бы подписи.

alter table public.finance_categories
  add column if not exists team_id text,
  add column if not exists hidden boolean not null default false,
  add column if not exists position integer not null default 0;

-- Скрытие и порядок — со старых таблиц, пока строка ещё одна на компанию.
update public.finance_categories c
   set hidden = true
 where c.tenant_id is not null
   and exists (
     select 1 from public.finance_category_hidden h
      where h.category_id = c.id and h.tenant_id = c.tenant_id
   );

update public.finance_categories c
   set position = o.position
  from public.finance_category_order o
 where o.category_id = c.id and o.tenant_id = c.tenant_id;

-- РАЗДАЧА ПО КОМАНДАМ.
create temporary table _category_team_map (
  old_id uuid not null,
  team_id text not null,
  new_id uuid not null
) on commit drop;

do $$
declare
  cat record;
  team record;
  first_team text;
  copy_id uuid;
begin
  for cat in
    select * from public.finance_categories
     where tenant_id is not null and team_id is null
     order by tenant_id, type, name
  loop
    first_team := null;
    for team in
      select t.id
        from public.teams t
       where t.tenant_id = cat.tenant_id
         and (
           t.is_active
           or exists (
             select 1 from public.finance_transactions f
               left join public.accounts a on a.id = f.account_id
              where f.category_id = cat.id
                and coalesce(f.team_id, a.brigade_id) = t.id
           )
           or exists (
             select 1 from public.finance_templates p
              where p.category_id = cat.id and p.brigade_id = t.id
           )
           or exists (
             select 1 from public.debts d
              where d.category_id = cat.id and d.team_id = t.id
           )
         )
       order by t.is_active desc, t.position, t.created_at
    loop
      if first_team is null then
        first_team := team.id;
        update public.finance_categories set team_id = team.id where id = cat.id;
        insert into _category_team_map values (cat.id, team.id, cat.id);
      else
        copy_id := gen_random_uuid();
        insert into public.finance_categories (
          id, tenant_id, team_id, slug, name, type, icon, color,
          ask_employee, ask_client, require_receipt, is_system, retired,
          monthly_budget, hidden, position
        ) values (
          copy_id, cat.tenant_id, team.id,
          cat.slug || '@' || team.id,
          cat.name, cat.type, cat.icon, cat.color,
          cat.ask_employee, cat.ask_client, cat.require_receipt,
          cat.is_system, cat.retired,
          cat.monthly_budget, cat.hidden, cat.position
        );
        insert into _category_team_map values (cat.id, team.id, copy_id);
      end if;
    end loop;
  end loop;
end
$$;

-- Деньги — на копию своей команды. Команда операции — своя, а у старых строк
-- без команды — команда счёта (то же правило, что у ленты «Финансов»).
update public.finance_transactions f
   set category_id = m.new_id
  from _category_team_map m
 where f.category_id = m.old_id
   and m.new_id <> m.old_id
   and m.team_id = coalesce(
         f.team_id,
         (select a.brigade_id from public.accounts a where a.id = f.account_id)
       );

update public.finance_templates p
   set category_id = m.new_id
  from _category_team_map m
 where p.category_id = m.old_id
   and m.new_id <> m.old_id
   and m.team_id = p.brigade_id;

update public.debts d
   set category_id = m.new_id
  from _category_team_map m
 where d.category_id = m.old_id
   and m.new_id <> m.old_id
   and m.team_id = d.team_id;

-- У КАТЕГОРИИ КОМПАНИИ КОМАНДА ЕСТЬ ВСЕГДА. Компания без единой команды
-- категорий не имеет (проверено перед миграцией: таких строк нет).
alter table public.finance_categories
  drop constraint if exists finance_categories_team_required;
alter table public.finance_categories
  add constraint finance_categories_team_required
  check (tenant_id is null or team_id is not null);

create index if not exists finance_categories_tenant_team_idx
  on public.finance_categories (tenant_id, team_id);

-- Сотрудник — категории своих команд. Владелец читает всё своей политикой.
drop policy if exists finance_categories_select_access on public.finance_categories;
create policy finance_categories_select_access on public.finance_categories
  for select using (
    (
      tenant_id is null
      and (
        (select cardinality(public.access_calendars('finance.operations', 'read'))) > 0
        or (select cardinality(public.access_calendars('finance.debts', 'read'))) > 0
      )
    )
    or (
      tenant_id = (select public.current_tenant_id())
      and (
        team_id in (select unnest(public.access_calendars('finance.operations', 'read')))
        or team_id in (select unnest(public.access_calendars('finance.debts', 'read')))
      )
    )
  );

-- СТОРОЖА ЦЕЛОСТНОСТИ: категория — своей команды. Тела не переписываются
-- руками: в живом определении дополняется ровно одно условие.
do $$
declare
  def text;
  fn text;
  team_expr text;
  old_frag text := 'and (category.tenant_id is null or category.tenant_id = new.tenant_id)';
begin
  foreach fn in array array['assert_finance_transaction_integrity', 'assert_finance_template_integrity']
  loop
    team_expr := case fn
      when 'assert_finance_transaction_integrity' then 'new.team_id'
      else 'new.brigade_id'
    end;
    select pg_get_functiondef(p.oid) into def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;
    if def is null then
      raise exception 'функции % нет', fn;
    end if;
    if (length(def) - length(replace(def, old_frag, ''))) / length(old_frag) <> 1 then
      raise exception 'в % условие категории встречается не ровно один раз', fn;
    end if;
    execute replace(
      def,
      old_frag,
      old_frag || ' and (category.team_id is null or ' || team_expr
        || ' is null or category.team_id = ' || team_expr || ')'
    );
  end loop;
end
$$;

-- Скрытие и порядок живут теперь в самой категории. Прежние таблицы
-- остаются до следующей волны: уже установленные сборки приложения читают их
-- при каждом открытии категорий, и снос уронил бы у них весь справочник.
-- Новый код их не читает и не пишет.

-- СТОРОЖА РЕЗУЛЬТАТА.
do $$
begin
  if exists (
    select 1 from public.finance_categories where tenant_id is not null and team_id is null
  ) then
    raise exception 'категория компании осталась без команды';
  end if;
  if exists (
    select 1
      from public.finance_transactions f
      join public.finance_categories c on c.id = f.category_id
      left join public.accounts a on a.id = f.account_id
     where c.team_id is not null
       and coalesce(f.team_id, a.brigade_id) is not null
       and c.team_id <> coalesce(f.team_id, a.brigade_id)
  ) then
    raise exception 'операция подписана категорией чужой команды';
  end if;
  if exists (
    select 1
      from public.finance_templates p
      join public.finance_categories c on c.id = p.category_id
     where c.team_id is not null and p.brigade_id is not null and c.team_id <> p.brigade_id
  ) then
    raise exception 'шаблон подписан категорией чужой команды';
  end if;
  if exists (
    select 1 from pg_proc
     where proname in ('assert_finance_transaction_integrity', 'assert_finance_template_integrity')
       and prosrc not like '%category.team_id is null%'
  ) then
    raise exception 'сторож целостности не получил проверку команды категории';
  end if;
end
$$;
