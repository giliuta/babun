-- УДАЛЕНИЕ СЧЁТА НЕ ДОЛЖНО ОБЕЗЛИЧИВАТЬ ДЕНЬГИ.
--
-- ЧТО СЕЙЧАС. `finance_transactions_account_id_fkey` стоит на `on delete set
-- null`. Это значит, что на уровне СХЕМЫ удаление счёта разрешено: операции не
-- исчезают, они теряют адрес. Строка остаётся в ленте, но выпадает из всех
-- балансов — деньги как будто есть и одновременно их ни на одном счёте нет.
-- В проде такая строка уже есть: доход €120 у тенанта test@babun.dev с
-- `account_id is null`. Она появилась не из воздуха — её обезличил именно этот
-- FK при каком-то удалении счёта.
--
-- ПОЧЕМУ ТРИГГЕРА МАЛО. Настоящая защита сегодня одна —
-- `trg_guard_account_delete` (BEFORE DELETE, человеческий текст «Счёт «X»
-- нельзя удалить: на нём N операц…»). Он работает, пока работают триггеры.
-- А триггеры молчат при `session_replication_role = 'replica'` — то есть ровно
-- при восстановлении данных из дампа, когда защита нужнее всего. Тот же эффект
-- даёт любое обслуживание через `alter table … disable trigger user` (такой
-- приём уже используется в `delete_sole_owned_tenants_for_account`). Правило
-- внешнего ключа в этих режимах тоже не проверяется, но разница
-- принципиальная: `set null` в такой момент АКТИВНО ПОРТИТ данные, а `restrict`
-- в худшем случае просто ничего не делает. Схема обязана быть не строже
-- триггера, а безопаснее его при отказе.
--
-- ПОБОЧНАЯ ПОЛЬЗА. Кнопка «Удалить счёт» становится честной: она либо удаляет,
-- либо падает — но никогда не «удаляет, тихо порвав историю».
--
-- ─────────────────────────────────────────────────────────────────────
-- ВАЖНО ПЕРЕД ПРИМЕНЕНИЕМ — КАСКАД УДАЛЕНИЯ КОМПАНИИ.
--   `delete_sole_owned_tenants_for_account` (удаление аккаунта, требование
--   App Store) делает `delete from public.tenants`. Оттуда каскадом уходят и
--   `accounts` (tenant_id … on delete cascade), и `finance_transactions`
--   (тоже cascade). Проверка `restrict` НЕМЕДЛЕННАЯ и отложить её нельзя: если
--   каскад успеет удалить счета РАНЬШЕ операций, удаление компании упадёт
--   «violates foreign key constraint finance_transactions_account_id_fkey».
--   Порядок этих двух каскадов задаётся порядком создания констрейнтов и от
--   среды к среде разный. В проде на 2026-08-10 он благоприятный:
--   RI-триггер FK операций (RI_ConstraintTrigger_a_34934) идёт перед
--   RI-триггером FK счетов (RI_ConstraintTrigger_a_35939), то есть операции
--   удаляются первыми и проверке нечего запрещать.
--   ЭТОТ ПОРЯДОК БОЛЬШЕ НЕ НА ЧЕСТНОМ СЛОВЕ: шаг 1b ниже проверяет его на той
--   базе, куда применяется миграция, и отказывается менять правило, если он
--   неблагоприятный. Лекарство в этом случае — одна строка: правило меняется на
--   `on delete no action deferrable initially deferred`. Оно защищает от
--   удаления счёта с историей ровно так же, но проверяется в конце транзакции,
--   когда каскад уже убрал операции.
--   Прогон удаления аккаунта на копии всё равно желателен: проверка 1b
--   доказывает порядок каскадов, но не поведение всей процедуры целиком.
-- ─────────────────────────────────────────────────────────────────────

-- ─── 1. Данные должны позволить ужесточение ──────────────────────────
-- Строка, ссылающаяся на несуществующий счёт, сделала бы констрейнт
-- неустановимым, и миграция упала бы посреди `alter table` с текстом от
-- Postgres, по которому непонятно, что чинить. Падаем раньше и по-русски.
-- (Операции с `account_id is null` — это НЕ такой случай: NULL внешним ключом
-- не проверяется. Их чинит §9.11 отдельной строкой «Операции без счёта».)
do $preflight$
declare
  orphan_count integer;
begin
  select count(*) into orphan_count
    from public.finance_transactions ft
   where ft.account_id is not null
     and not exists (
       select 1 from public.accounts a where a.id = ft.account_id
     );
  if orphan_count > 0 then
    raise exception
      'Нельзя ужесточить связь операций со счетами: % операц. ссылаются на несуществующий счёт. Сначала верните им счёт или обнулите account_id вручную.',
      orphan_count;
  end if;
end;
$preflight$;

-- ─── 1b. Каскад удаления компании должен пережить ужесточение ────────
-- Проверка `restrict` немедленная, поэтому удаление компании
-- (`delete_sole_owned_tenants_for_account`, требование App Store) упадёт, если
-- каскад успеет снести СЧЕТА раньше ОПЕРАЦИЙ. Порядок каскадов задаётся
-- порядком срабатывания внутренних RI-триггеров на public.tenants, а Postgres
-- запускает AFTER-триггеры в АЛФАВИТНОМ порядке имён (`RI_ConstraintTrigger_a_<oid>`).
-- Значит порядок фиксируется в момент создания констрейнтов и от среды к среде
-- может отличаться — то есть проверять его надо на той базе, куда применяем, а
-- не «у нас же работало».
--
-- Это не косметика: без такой проверки неудачная среда получила бы миграцию
-- молча, а сломалось бы удаление аккаунта — сценарий, который проверяют раз в
-- полгода и который обязателен по требованию App Store.
do $cascade_order$
declare
  tx_trigger text;
  account_trigger text;
begin
  select min(t.tgname) into tx_trigger
    from pg_trigger t
    join pg_constraint c on c.oid = t.tgconstraint
   where t.tgrelid = 'public.tenants'::regclass
     and t.tgisinternal
     and c.conrelid = 'public.finance_transactions'::regclass
     and c.confrelid = 'public.tenants'::regclass
     and c.confdeltype = 'c';

  select min(t.tgname) into account_trigger
    from pg_trigger t
    join pg_constraint c on c.oid = t.tgconstraint
   where t.tgrelid = 'public.tenants'::regclass
     and t.tgisinternal
     and c.conrelid = 'public.accounts'::regclass
     and c.confrelid = 'public.tenants'::regclass
     and c.confdeltype = 'c';

  if tx_trigger is null or account_trigger is null then
    raise exception
      'Не найден каскад удаления компании (операции: %, счета: %). Без него ужесточение связи небезопасно: проверьте FK на public.tenants.',
      coalesce(tx_trigger, 'нет'), coalesce(account_trigger, 'нет');
  end if;

  -- Сравниваем именно строки имён: Postgres упорядочивает триггеры по имени, а
  -- не по числу внутри имени, и на длинных oid эти порядки расходятся.
  if tx_trigger > account_trigger then
    raise exception
      'Каскад удаления компании снесёт счета (%) раньше операций (%): с правилом restrict удаление аккаунта упадёт нарушением внешнего ключа. Примените вариант «on delete no action deferrable initially deferred» — он защищает так же, но проверяется в конце транзакции.',
      account_trigger, tx_trigger;
  end if;
end;
$cascade_order$;

-- ─── 2. Смена правила ────────────────────────────────────────────────
-- Обёрнуто в проверку текущего правила, чтобы повторный прогон был no-op:
-- `drop constraint` + `add constraint` сами по себе идемпотентны по результату,
-- но каждый прогон брал бы ACCESS EXCLUSIVE на денежную таблицу и заново
-- сканировал её. confdeltype: 'n' = SET NULL, 'r' = RESTRICT, 'a' = NO ACTION.
do $swap$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_transactions'::regclass
       and conname = 'finance_transactions_account_id_fkey'
       and contype = 'f'
       and confdeltype = 'r'
  ) then
    return;
  end if;

  alter table public.finance_transactions
    drop constraint if exists finance_transactions_account_id_fkey;

  alter table public.finance_transactions
    add constraint finance_transactions_account_id_fkey
    foreign key (account_id) references public.accounts(id)
    on delete restrict;
end;
$swap$;

-- ─── 3. Deploy assertions ────────────────────────────────────────────
do $audit$
declare
  delete_rule text;
begin
  select confdeltype into delete_rule
    from pg_constraint
   where conrelid = 'public.finance_transactions'::regclass
     and conname = 'finance_transactions_account_id_fkey'
     and contype = 'f';

  if delete_rule is null then
    raise exception 'связь операций со счетами: внешний ключ finance_transactions_account_id_fkey пропал';
  end if;
  if delete_rule <> 'r' then
    raise exception 'связь операций со счетами: правило удаления % вместо restrict — история по-прежнему обезличивается', delete_rule;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.finance_transactions'::regclass
       and conname = 'finance_transactions_account_id_fkey'
       and convalidated
  ) then
    raise exception 'связь операций со счетами: констрейнт не провалидирован';
  end if;
end;
$audit$;
