# Финансы до конца: общие счета, запись→счёт, права мастеров, VAT, инвойсы, credit note, чеки

Дата: 2026-07-27. Сводный проектный документ по 9 recon- и 8 design-отчётам; решения владельца от 2026-07-27 (VAT/страна — на каждую команду; страница доступа под каждого мастера; язык PDF — на тенанта, дефолт EN) вшиты в текст.
Репо: `/Users/artem/Documents/Project Claude/Babun/babun2/babun-crm` (симлинк на `~/Documents/babun2/babun-crm`).
Сокращения: `mobile/` = `apps/mobile/`, `shared/` = `packages/shared/src/`, `mig/` = `apps/web/supabase/migrations/`.
Канон: Halo Cobalt (`apps/mobile/docs/DESIGN-SYSTEM.md`), вето владельца (без эмодзи, минимализм, цвет = смысл, чёрное вместо серого), листы = канонический `BottomSheet`, код чисто и с первого раза, tsc = 0, bun.

## Разрешённые противоречия проектировщиков (что отклонено и почему — одной строкой)

| Тема | Принято | Отклонено |
|---|---|---|
| Создание чеков | Авто-триггер на каждую income-строку с appointment/invoice + `status='void'` при откате | Ленивая материализация «чек по первому открытию» (design-data-model) — владелец явно требует «создаётся по факту для всех»; void сохраняет номер, серия не дырявится |
| FK чека на транзакцию | `on delete set null` + авто-void чека | `on delete restrict` (design-documents) — restrict блокировал бы штатный `undo_appointment_payment` |
| Носитель VAT-настроек | Дефолты компании на `tenants` (`vat_mode ('off'\|'inclusive'\|'exclusive')` + ставка + exemption note) + переопределение на команду в узкой таблице `team_finance_settings`; действующие значения — одна функция `effective_vat_settings(team_id)` | VAT на тенанта целиком (ранняя редакция) — владелец: команды работают в разных странах; пара `vat_enabled + vat_pricing` (design-documents) — два поля вместо одного; колонки на `teams` — широкая видимость против owner-only RLS финансов, отрицательный прецедент `calendar_window_*`; jsonb `teams.members` — типизированным данным с CHECK-инвариантами не место в помойке |
| Носитель прав мастера | Таблица `master_permissions` (per-master, sparse overrides + дефолты роли), словарь `finance.*`, каждый тумблер энфорсится сервером | Однофлаговый `finance_record_payment` из `teams.members` jsonb (ранняя редакция §2.2) — владелец требует пер-мастерскую страницу с набором тумблеров; jsonb-массив не индексируется, гранула per-brigade расходится у мастера в двух командах, запись всего массива = lost update |
| Отмена инвойса | Новый статус `cancelled` + RPC `cancel_invoice` (порождает CN); `void` — легаси read-only | Переиспользовать `void` как статус отмены (design-data-model) — смешивает «внутреннее удаление» и «документ-сторно» |
| Переводы между счетами | Разрешены команда↔компания и компания↔компания; team A↔team B напрямую — запрещено | Полная либерализация любых пар (design-edges) — межкомандный перевод идёт через общий счёт, прямой путь лишь размывает атрибуцию |
| Агрегаты при «глазике» | Σ = только видимые счета + маркер EyeOff | «Честная полная сумма» (design-ux-accounts) — скрытый баланс восстанавливается вычитанием, маскировка теряла бы смысл |
| Период на странице счёта | MonthStepper `‹ Июль 2026 ›` | Полная строка периода с PeriodSheets (design-reporting) — владелец сформулировал разрез «за месяц», один жест против двух попапов |
| Префикс чеков | `RC` | `RCP` (design-documents) — единообразие с 2-буквенными INV/CN |
| Пикер счетов для не-owner | Один RPC `list_payment_accounts_safe(p_team_id)` | Три разных имени из трёх доков — оставлено одно, по паттерну `list_operational_teams_safe` |

---

## 1. Резюме

Строим завершённую страницу финансов: счета получают охват `team | company` (общий счёт компании, например бизнес-карта Revolut, подключается к нескольким/всем командам через явный список `account_teams`), у каждого счёта появляются «глазик» (скрытие баланса), полноценные страницы детали и настроек с помесячной разбивкой «сколько зашло с каждой команды (нал/карта)»; в записи мастер/диспетчер вместо абстрактного способа оплаты нажимает конкретный СЧЁТ (чипы счетов команды + общих), выбор едет колонкой `appointments.payment_account_id` через существующую офлайн-очередь, а сервер кладёт авто-income ровно на этот счёт с fallback на прежний resolve; права мастеров на деньги перестают быть клиентской бутафорией — новый серверно-читаемый словарь `finance.*` (таблица `master_permissions`, sparse overrides поверх дефолтов роли) со страницей доступа под каждого мастера: семь тумблеров «что видит / что может», каждый энфорсится своим гейтом в RPC; каждая транзакция уже несёт заметку и жёсткую связь с записью — добавляется тап «Открыть запись»; VAT переезжает из localStorage в БД по решению владельца «страна и ставка — на каждую команду»: дефолты компании на `tenants` (режим + ставка + текст освобождения + язык документов, дефолт EN) плюс переопределение на команду в `team_finance_settings` (одна команда в Греции — 24%, другая на Кипре — 19%), действующие значения везде считает `effective_vat_settings(team_id)`, снапшоты персистятся на инвойсе и транзакции; настройки финансов получают собственный хаб (шестерёнка → «Настройки финансов»: дефолты компании, тап по команде → её страница «НДС и страна» — паттерн настроек календаря, доступ мастеров, язык документов); цепочка документов достраивается: доход на счёт компании → «Выставить инвойс» (механика уже есть, появляется условие по scope), отмена неоплаченного инвойса → номерная credit note серии CN со статусом `cancelled` у оригинала, и новая сущность `receipts` — нефискальная квитанция о приёме денег, автоматически создаваемая под каждый платёж записи и инвойса, отправляемая клиенту по share-sheet. Всё поверх существующего RPC-first леджера (идемпотентные request_id, immutable-снапшоты, owner-only RLS); фильтрация периодов/команд не трогается.

**Шаг 0 (жёсткий блокер):** прод `rdtokosbqvgemicqeqwz` восстановлен из бэкапа, и его лист миграций прыгает `20260625…→20260722…` — отсутствует и волна `20260720210001…20260720210015`, и `20260720212500_transactional_quota_guards.sql`. При этом `database.types.ts` и репозитории уже требуют RPC волны (`issue_invoice`, `record_invoice_payment`, `set_appointment_prepayment`, `record_account_transfer`…) — сейчас инвойсы/предоплаты/переводы падают PGRST202. Перед любой работой пере-применить волну 01–15 **и** `212500` (квота-триггеры — самостоятельный аддитивный backstop; без него серверные лимиты подписки не сериализуются). Данных мало: 9 счетов, 28 tx, 0 инвойсов. `20260624_004_reference_fk_hardening.sql` (REVIEW BEFORE APPLY) в проект не входит.

---

## 2. Модель данных + SQL-миграции

Все миграции — в `mig/`, аддитивные, поверх волны 01–15 + `212500` (Слайс 0), нумерация файлов = порядок применения = порядок слайсов. После каждой: `bun run db:types` в `apps/web` → tsc = 0.

### 2.1 `20260727100001_shared_accounts.sql` — общие счета + глазик

```sql
alter table public.accounts
  add column if not exists scope text not null default 'team',
  add column if not exists balance_hidden boolean not null default false;
alter table public.accounts add constraint accounts_scope_check
  check (scope in ('team','company'));
alter table public.accounts alter column brigade_id drop not null;
alter table public.accounts add constraint accounts_scope_brigade_check
  check ((scope = 'team'    and brigade_id is not null)
      or (scope = 'company' and brigade_id is null));

-- Уникальность имени: старый unique не работает с NULL brigade_id.
alter table public.accounts drop constraint if exists accounts_tenant_id_brigade_id_name_key;
create unique index ux_accounts_team_name
  on public.accounts (tenant_id, brigade_id, name) where scope = 'team';
create unique index ux_accounts_company_name
  on public.accounts (tenant_id, name) where scope = 'company';

create table public.account_teams (
  account_id uuid not null references public.accounts(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  team_id    text not null,
  created_at timestamptz not null default now(),
  primary key (account_id, team_id)
);
create index idx_account_teams_tenant_team on public.account_teams (tenant_id, team_id);
-- RLS: owner-only (tenant_id = current_tenant_id() AND current_user_role() = 'owner'),
-- обе клаузы using + with check.
-- Триггер assert_account_team_integrity: счёт своего tenant, scope='company',
-- команда существует в teams.

-- Единственный источник истины «счёт обслуживает команду»:
create function public.account_serves_team(p_account_id uuid, p_team_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.accounts a
    where a.id = p_account_id
      and ((a.scope = 'team' and a.brigade_id = p_team_id)
        or (a.scope = 'company' and exists (
              select 1 from public.account_teams att
               where att.account_id = a.id and att.team_id = p_team_id))));
$$;

-- Индекс под помесячную разбивку счёта:
create index idx_finance_tx_account_occurred
  on public.finance_transactions (account_id, occurred_on desc)
  where account_id is not null;
```

Правки существующих функций (в той же миграции, `create or replace` целиком):

1. **`assert_finance_transaction_integrity`** (`mig/20260720210006:174-539`), блок :322-326 «главный замок»:
   - `scope='team'` → как сейчас: `team_id := brigade_id`, несовпадение = exception;
   - `scope='company'`, `type in ('income','expense')`, `team_id NOT NULL` → требуется членство в `account_teams`, иначе «Команда не привязана к этому счёту»;
   - `scope='company'`, `source='manual'` → `team_id` допускается NULL («операция компании»);
   - `source='auto'` → `team_id` ОБЯЗАТЕЛЕН (наследуется из записи — носитель требования №4);
   - `type='refund'` → membership НЕ проверяется: действует существующее «возврат по исходному счёту и команде» (историческая операция не должна ломаться отвязкой команды);
   - `type='transfer'` → team_id ноги = `brigade_id` ЕЁ счёта (NULL у company-ноги);
   - все безусловные чтения `new.team_id` (проверка teams, master∈команда) обернуть `if new.team_id is not null`.
2. **`guard_account_financial_history`** (:663-718) — добавить `scope` во frozen-список при истории («Тип охвата счёта с операциями нельзя изменить»); закрытие только при нулевом балансе — без изменений.
3. **`record_account_transfer`** (:1912-2065) — проверка «одна команда» остаётся ТОЛЬКО для пары team-счетов разных бригад (запрещено); team↔company и company↔company разрешены. `team_id` каждой ноги = `brigade_id` её счёта (NULL у company). `finance_transfer_requests.team_id` → nullable.
4. **`resolve_appointment_finance_account`** (:848-893) — выборка через `account_serves_team`, `order by (scope='team') desc, position, id` — командный счёт приоритетнее общего.
5. **`assert_finance_template_integrity`** (:542-657) — проверка счёта шаблона через `account_serves_team`.
6. **`record_invoice_payment` / `validate_invoice_payment_insert`** (`20260720210005`) — guard «счёт принадлежит команде инвойса» → `account_serves_team(account_id, invoice.brigade_id)`; `team_id` строки платежа всегда = `invoice.brigade_id`.
7. **Новый RPC `list_payment_accounts_safe(p_team_id text)`** — SECURITY DEFINER, слим-проекция `(id, name, kind, scope, icon, color, position, balance numeric)` БЕЗ `balance_hidden`. Колонка `balance` закладывается в сигнатуру сразу (клиентский тип не перегенерировать дважды), но в ЭТОЙ миграции заполняется только owner/dispatcher (`opening_balance + Σ` по `idx_finance_tx_account_occurred`), мастеру — NULL; начинку по тумблеру `finance.see_account_balances` и доступ по тумблерам довезёт §2.2. Активные счета команды ∪ привязанные общие; проверка в этой миграции: `current_user_role() in ('owner','dispatcher') or p_team_id = any(current_user_team_ids())`. Паттерн — `list_operational_teams_safe`.

Backfill не нужен: существующие 9 счетов получают `scope='team'` через default; «Карта компании = две строки» у AirFix остаётся — владелец закроет дубли и заведёт один company-счёт руками (склейку истории НЕ делаем). Деплой-ассерты в конце миграции по образцу `20260720210006:2221-2226`.

### 2.2 `20260727100002_master_permissions.sql` — права мастеров: словарь `finance.*`

Сегодня в кодовой базе ДВЕ матрицы прав мастера, обе чисто клиентские (сервер их не читает): глобальная `MasterPermissions` (~25 флагов, `shared/local/masters.ts:14-90`, живёт в `masters.profile.permissions`, UI — `cabinet/masters/[id]/access.tsx`) и пер-бригадная `BrigadeMemberPermissions` (~55 флагов, `teams.members[].permissions`, UI — `cabinet/teams/[id]/masters/[masterId].tsx`); RLS `20260720210001` просто закрывает всю финансовую поверхность owner-only. Вводится третий, канонический слой — таблица `master_permissions` — **единственный серверно-читаемый источник**. Словарь v1 = только `finance.*`, но расширяемый: календарные/клиентские домены со временем мигрируют сюда новыми ключами без смены схемы, а обе legacy-матрицы становятся косметическими и усыхают. Мы сознательно не строим четвёртую параллельную систему «только под финансы» — мы строим будущий единственный дом всех прав, заселяя первый этаж.

Словарь v1 — 7 тумблеров, единый модуль `shared/local/master-permissions.ts` (из него же генерится SQL-белый список в миграции). Правило зависимостей: дочерний эффективен только при включённом родителе — энфорсится ДВАЖДЫ, в UI (indent + disabled) и в SQL-резолвере (конъюнкция), чтобы кривая запись `{"finance.choose_account": true}` без `record_payment` ничего не открывала.

| Ключ | Тумблер | Родитель | Что делает / где энфорсится |
|---|---|---|---|
| `finance.see_amounts` | Суммы и цены в записях | — | Цена услуг, итог, аванс, долг в карточке записи. OFF → блок денег в `CrewAppointmentSheet` скрыт. Клиентский гейт (см. «не энфорсится» ниже) |
| `finance.see_account_balances` | Балансы счетов | — | Остатки на счетах его команд + общих привязанных. Сервер: колонка `balance` в `list_payment_accounts_safe` (иначе NULL) |
| `finance.view_page` | Страница «Финансы» | — | Таб «Финансы» в скоупе его команд. Сервер: `list_team_finance_summary_safe` / `list_team_transactions_safe` (Слайс 13) |
| `finance.record_payment` | Принимать оплату | `see_amounts` | Фиксирует «оплачено» при закрытии заказа. Сервер: платёжный whitelist `update_master_appointment_safe`, не-owner ветка `set_appointment_prepayment` (§2.3) |
| `finance.choose_account` | Выбирать счёт зачисления | `record_payment` | Чипы счетов + `payment_account_id`. OFF → только факт оплаты способом, счёт резолвит сервер. Сервер: отдельная ветка whitelist'а (§2.3) |
| `finance.edit_amount` | Редактировать сумму записи | `see_amounts` | Меняет цену/итог/скидку — отдельный тумблер по прямому слову владельца («кто может менять сумму, кто нет»). Сервер: ключи суммы в whitelist (§2.3) |
| `finance.create_expense` | Создавать расходы | — | Расход своей команды (материалы/бензин). Сервер: `record_team_expense_safe` (Слайс 13) |

```sql
create table public.master_permissions (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  master_id  uuid not null references public.masters(id) on delete cascade,
  overrides  jsonb not null default '{}'::jsonb,   -- ТОЛЬКО отличия от дефолта роли: {"finance.record_payment": false}
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (tenant_id, master_id)
);
-- RLS: все операции — tenant_id = current_tenant_id() AND current_user_role() = 'owner'
-- (обе клаузы using + with check). Мастер свою строку напрямую НЕ читает — только my_finance_permissions().
-- Триггер-валидатор: ключи overrides ∈ белый список словаря, значения строго boolean.

create function public.master_role_default(p_role text, p_key text)
returns boolean language sql immutable as $$
  select case
    when p_role in ('lead','admin','dispatcher') then true   -- лидер: всё включено (слово владельца)
    else p_key = 'finance.see_amounts'                       -- helper: видит суммы, остальное выключено
  end
$$;
```

- **Sparse overrides + дефолты роли** (а не полный снапшот): эффективное право = `coalesce(overrides->>key, master_role_default(role, key))`; роль = `coalesce(m.profile->>'role', m.role, 'helper')` — зеркало `getMasterRole` (`mobile/src/features/reference/master-profile.ts:57`), словарь ролей `MasterRole` (`shared/local/masters.ts:6`). Нет строки = дефолты роли (ни одного backfill на нового мастера); нет ключа = дефолт роли (ключи v2 деплоятся без миграции данных); смена роли мгновенно меняет незатронутые тумблеры, а override переживает её осознанно (сброс — отдельной кнопкой).
- **`master_has_finance_permission(p_master_id, p_key)`** — stable SECURITY DEFINER, единая точка чтения: coalesce + конъюнкция с родительской цепочкой (плоский CASE, без рекурсии). Грант `revoke from public / grant to authenticated` — по образцу `current_user_master_id` (`20260720210001:47-62`). Owner/dispatcher минуют мастерские проверки там, где у них шире права (owner — всё; dispatcher без `master_id` — как сегодня; у диспетчера-мастера действует его матрица).
- **`set_master_permission(p_master_id, p_key, p_value)`** — owner-only: upsert строки + `jsonb_set` ОДНОГО ключа (параллельные тумблеры не съедают друг друга); ключ по белому списку; `p_value is null` → удалить override (вернуть к дефолту роли). **`reset_master_permissions(p_master_id)`** — owner-only, `overrides = '{}'`. **`my_finance_permissions()`** — резолвнутая карта всех `finance.*` текущего пользователя (owner/dispatcher — по роли); единственное окно клиента в свои права.
- **`list_payment_accounts_safe`** (create or replace поверх §2.1.7): `balance` заполняется для owner/dispatcher всегда, для мастера — только при `see_account_balances`; доступ мастера — при хотя бы одном из `choose_account | view_page | see_account_balances`, иначе пустой результат (не exception — клиентский fallback на чипы способов из §4.3 остаётся рабочим). Отсюда же ответ на «мастер увидит имена общих счетов?» — это следствие его тумблеров, отдельный флаг «прятать от мастеров» на счёте не нужен.
- **Бэкфилл из legacy** (одноразово, в той же миграции): для каждого мастера с `finance_record_payment = false` хоть в одной `teams.members[].permissions` — вставить `{"finance.record_payment": false}`; аналогично `finance_see_total=false → finance.see_amounts=false`, `finance_change_total=false → finance.edit_amount=false` (консервативная свёртка «false хоть где-то → false»). Данных мало (один живой тенант), сюрпризов при переключении источника нет.
- **Смена контракта**: старое клиентское «нет матрицы = всё разрешено» заменяется на «нет строки = дефолт РОЛИ». Для lead ничего не меняется (всё true), у helper `record_payment` гаснет — ровно просьба владельца («помощнику эта информация излишняя»); в релиз-нотах слайса фиксируем: если где-то помощники реально закрывали заказы с деньгами — owner включает им тумблер.
- **Офлайн**: клиент кэширует `my_finance_permissions()` в MMKV (`babun:perm:<masterId>`, рефреш на foreground и после логина) и гейтит UI по кэшу. Право выключили, пока мастер офлайн → патч уезжает в очередь, реплей получает отказ whitelist'а — существующая механика ошибок очереди (`appointmentsCached`) показывает конфликт, деньги не проводятся молча. Это правильнее «тихо стрипнуть»: потерянный платёж хуже видимой ошибки. Нет кэша → UI гейтит по дефолту роли из локального словаря (то же, что вернул бы сервер без overrides).
- **Честно НЕ энфорсится сервером в v1**: `finance.see_amounts` — клиентский гейт (строка записи с ценой уже приходит мастеру по RLS appointments; проекционного RPC для записей ради v1 не городим). Сервер при этом жёстко держит мутации: подсмотреть сумму взломом клиента можно, изменить или провести деньги — нет. Серверная проекция записей — кандидат волны «календарь в словарь». Кандидаты v2 (имена зарезервированы, в словарь v1 не включать): `finance.see_debts`, `finance.apply_discount`, `finance.issue_receipt_share`, `calendar.*`, `clients.*`.

### 2.3 `20260727100003_appointment_payment_account.sql` — счёт в записи

```sql
alter table public.appointments
  add column payment_account_id uuid references public.accounts(id) on delete set null;
create index idx_appointments_payment_account
  on public.appointments (payment_account_id) where payment_account_id is not null;
```

- `reconcile_appointment_finance` (:1186-1476): в точке вставки income-дельты — если `payment_account_id` задан, счёт активен, kind соответствует методу и `account_serves_team` → использовать его; иначе **тихий fallback** на resolve (офлайн-реплей нельзя «спросить заново», жёсткий отказ заморозил бы очередь).
- `set_appointment_prepayment` + `p_account_id uuid default null` — здесь валидация ЖЁСТКАЯ (RPC синхронный, ошибка видна оператору); вызов не-owner'ом разрешён при `master_has_finance_permission(...,'finance.record_payment')`, `p_account_id is not null` дополнительно требует `finance.choose_account`; при не-NULL пишет счёт в `appointments.payment_account_id` до reconcile.
- **`move_appointment_payment_account(p_tx_id, p_account_id)`** — owner-only смена счёта задним числом: правит `account_id`/`payment_method` авто-income-строки (через `_finance_write_context`, по образцу allow_auto_invoice_link) + все её linked-refund'ы + зеркала `payments[]`/`payment` записи. Гранула — конкретный приём денег, не запись (частичные оплаты = несколько строк с разными счетами).
- **`set_transaction_note(p_tx_id, p_note)`** — закрывает требование №6 «заметка по КАЖДОЙ транзакции» целиком: сейчас freeze авто-строк (`assert_finance_transaction_integrity`, notes входит в byte-for-byte-сравнение) не оставляет пути дописать заметку на авто-income. RPC owner-only, правит ТОЛЬКО `notes` (trim, nullif, лимит длины) любой строки через `_finance_write_context`-байпас в триггере (узкая ветка: разрешён UPDATE, где все поля, кроме `notes`, `is not distinct from` old — прямые UPDATE остаются заморожены); для `transfer` обновляет обе ноги группы (зеркальный инвариант `min(notes)` из `20260720210006:96-113` сохраняется). Manual-строки продолжают правиться как сейчас (полный edit), RPC для них не обязателен, но работает.
- `update_master_appointment_safe` — расширить whitelist ключами платёжного патча при условиях: запись команды мастера, статус после патча `completed`, и гейты словаря §2.2 (**чтение `teams.members` для прав — нигде**): платёжные ключи (`payments`, `payment`, `payment_status`, `payment_method`, `paid_amount`) ⇒ `master_has_finance_permission(current_user_master_id(), 'finance.record_payment')`; ключ `payment_account_id` ⇒ дополнительно `finance.choose_account` — при отказе ключ ОТКЛОНЯЕТСЯ целиком, не стрипается молча (офлайн-патч честно падает в видимую ошибку очереди, §2.2 «Офлайн»); ключи суммы записи (`price`, строки `services` с ценами, скидка — фактические имена сверить по текущему whitelist в Слайсе 7) ⇒ `finance.edit_amount`.
- `payment_account_id` в freeze-список `protect_paid_appointment_finance` НЕ добавлять (читается только в момент дельты).

### 2.4 `20260727100004_vat_settings.sql` — VAT: дефолты компании + переопределение на команду

Решение владельца: VAT/страна живут НА КАЖДОЙ КОМАНДЕ — команды могут быть в разных странах (Греция — 24%, Кипр — 19%). Тенант хранит **дефолты компании** (+ язык документов), команда — **необязательное переопределение** в узкой таблице `team_finance_settings`: строка есть = «у команды свои настройки», строки нет = «как у компании». Действующие значения всегда считает одна функция `effective_vat_settings(team_id)` = `coalesce(команда, тенант)` — и сервер (снапшоты), и UI ходят только через неё. Это точная калька живого паттерна календаря: `useTeamSchedule` возвращает `undefined` → действуют общие часы, «первая правка материализует строку», «Сбросить» удаляет строку (`app/calendar/[teamId]/schedule.tsx:48-60`).

```sql
-- Дефолты тенанта + язык документов (tenants.country УЖЕ ЕСТЬ — ISO-2,
-- становится дефолтной страной VAT):
alter table public.tenants
  add column vat_mode text not null default 'off'
    check (vat_mode in ('off','inclusive','exclusive')),
  add column vat_rate_percent numeric(5,2) not null default 19
    check (vat_rate_percent >= 0 and vat_rate_percent <= 100),
  add column vat_exemption_note text,
  add column document_language text not null default 'en'
    check (document_language in ('en','ru','el')),
  add column credit_note_prefix text not null default 'CN',
  add column receipt_prefix     text not null default 'RC';

-- Переопределение команды. Поля nullable: coalesce по КАЖДОМУ полю
-- (владелец может переопределить только страну+ставку, оставив режим компании).
create table public.team_finance_settings (
  team_id    text primary key references public.teams(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  country    text check (country is null or country ~ '^[A-Z]{2}$'),
  vat_mode   text check (vat_mode is null or vat_mode in ('off','inclusive','exclusive')),
  vat_rate_percent numeric(5,2) check (vat_rate_percent is null
                                    or (vat_rate_percent >= 0 and vat_rate_percent <= 100)),
  vat_exemption_note text check (vat_exemption_note is null
                              or char_length(vat_exemption_note) <= 500),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create index idx_team_finance_settings_tenant on public.team_finance_settings (tenant_id);
-- RLS: owner-only (обе клаузы using + with check). Триггер
-- assert_team_finance_settings_integrity: команда принадлежит тому же тенанту
-- (паттерн assert_account_team_integrity), updated_at := now().

-- Единственный источник действующих настроек для ВСЕХ потребителей:
create function public.effective_vat_settings(p_team_id text)
returns table (country text, vat_mode text,
               vat_rate_percent numeric, vat_exemption_note text)
language sql stable security definer set search_path = public as $$
  select coalesce(tfs.country, tn.country),
         coalesce(tfs.vat_mode, tn.vat_mode),
         coalesce(tfs.vat_rate_percent, tn.vat_rate_percent),
         coalesce(tfs.vat_exemption_note, tn.vat_exemption_note)
    from public.tenants tn
    left join public.team_finance_settings tfs
           on p_team_id is not null and tfs.team_id = p_team_id
          and tfs.tenant_id = tn.id
   where tn.id = coalesce(
           (select t.tenant_id from public.teams t where t.id = p_team_id),
           public.current_tenant_id());
$$;
revoke execute on function public.effective_vat_settings(text) from anon;

-- Снапшоты (история неприкосновенна — меняется только ИСТОЧНИК значений):
alter table public.invoices
  add column vat_mode text not null default 'off'
    check (vat_mode in ('off','inclusive','exclusive'));
-- бэкфилл эвристикой invoiceVatMode (на проде 0 инвойсов — no-op)

alter table public.finance_transactions
  add column vat_rate numeric(5,2),      -- NULL = VAT не применялся
  add column vat_amount numeric(12,2);   -- доля VAT, ВКЛЮЧЁННАЯ в amount (amount остаётся брутто)
```

Откуда берётся VAT в каждой точке:

| Событие | Источник VAT |
|---|---|
| Авто-income записи (`reconcile_appointment_finance`) | `effective_vat_settings(appointment.team_id)` — `team_id` у авто-строк обязателен (§2.1 п.1), источник всегда определён; mode `off` → поля NULL, иначе inclusive-расщепление (SQL-аналог `splitVatInclusive`) |
| Инвойс (`issue_invoice`/`update_invoice_draft`) | параметры клиента; дефолты редактора — `effective(invoice.brigade_id)`, без команды — дефолты тенанта; `vat_mode` персистится на инвойсе (параметр RPC уже есть) |
| Платёж инвойса (`record_invoice_payment`) | пропорция С ИНВОЙСА — настройки команды на момент платежа НЕ читаются, документ уже зафиксировал условия |
| Refund | vat исходной строки отрицательной долей |
| Ручная операция | OperationSheet VAT НЕ спрашивает (минимализм), поля NULL; правка в `TransactionPopup` только у manual без invoice_id — дефолт ставки из `effective(tx.team_id)`, для `team_id NULL` — тенанта |
| `seller_snapshot` инвойса/чека | + `vat_exemption_note` и `country` из `effective_vat_settings` по команде документа (§2.5); печатается при `vat_mode='off'` |

- **ВАЖНО:** ветка `allow_auto_invoice_link` в integrity-триггере (:229-257) сравнивает `row(...) is not distinct from row(...)` — добавить `vat_rate, vat_amount` в оба row(), иначе линковка авто-дохода к инвойсу сломается.
- Смена настроек команды не переписывает историю — это снапшот. Переезд команды из Греции на Кипр = правка её настроек: старые строки хранят 24%, новые получают 19%.
- Транзакция без команды (`team_id NULL` — ручная «операция компании» с общего счёта): VAT-поля NULL при создании; если owner правит vat руками — дефолты тенанта. Согласовано с §6.1: NULL-строки общекорпоративные, их юрисдикция = юрисдикция юрлица.
- **Справочник «страна → ставка» — клиентский, не БД** (ставки меняются законом, история защищена снапшотами): `shared/local/finance/vat-countries.ts` — `VAT_COUNTRIES` (27 стран ЕС со стандартными ставками: CY 19, GR 24, DE 19, HU 27, …), `vatCountryLabel`, `standardVatRate`. Выбор страны в UI **подставляет** ставку (записывает её явно в переопределение), дальше ставка редактируема — смена справочника в будущем не трогает ни одну команду. Свободный ввод ISO-2 вне списка допустим (без подстановки).
- **Язык документов** — на тенанта (решение владельца): `tenants.document_language` ('en'|'ru'|'el', дефолт **en**); словари — `shared/local/documents/i18n.ts` (`DOC_STRINGS: Record<'en'|'ru'|'el', …>` — все подписи шаблонов инвойса/CN/чека). v1 обязателен en+ru (текущие шаблоны русские, дефолт становится en), el добивается словарём там же.
- Доменные режимы exempt_sme/reverse_charge выражаются как `off` + exemption note — словарь режимов не расширяем.
- Деплой-ассерты: `to_regclass('public.team_finance_settings')`, 4 новые колонки tenants, `perform effective_vat_settings(null)`.

### 2.5 `20260727100005_documents.sql` — credit note + receipts

```sql
-- Credit note = строка invoices (CN структурно идентичен инвойсу: строки, VAT,
-- снапшоты, PDF, freeze — отдельная таблица продублировала бы 80% механики).
alter table public.invoices
  add column kind text not null default 'invoice' check (kind in ('invoice','credit_note')),
  add column parent_invoice_id uuid references public.invoices(id) on delete restrict,
  add column supply_on date;   -- дата выполнения работ (ст. 226 VAT Directive)
alter table public.invoices add constraint invoices_credit_note_parent_check
  check ((kind = 'invoice' and parent_invoice_id is null)
      or (kind = 'credit_note' and parent_invoice_id is not null));
-- Статусы: 'issued','paid','void','cancelled' (void — легаси, UI больше не производит).
-- КРИТИЧНО: табличный CHECK из 20260528_002:131 знает только ('issued','paid','void') —
-- без пересоздания UPDATE в 'cancelled' упадёт на констрейнте, а не в триггере.
alter table public.invoices drop constraint invoices_status_check;
alter table public.invoices add constraint invoices_status_check
  check (status in ('issued','paid','void','cancelled'));
alter table public.invoices drop constraint invoices_tenant_id_year_seq_key;
create unique index ux_invoices_series on public.invoices (tenant_id, kind, year, seq);
create unique index ux_invoices_cn_per_parent
  on public.invoices (parent_invoice_id) where kind = 'credit_note';

create table public.receipts (
  id              uuid primary key,                    -- gen_random_uuid / request_id
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  number          text not null,                       -- 'RC-2026-001'
  year int not null, seq int not null,
  status          text not null default 'issued' check (status in ('issued','void')),
  transaction_id  uuid references public.finance_transactions(id) on delete set null,
  appointment_id  uuid references public.appointments(id) on delete set null,
  invoice_id      uuid references public.invoices(id) on delete set null,
  client_id       uuid references public.clients(id) on delete set null,
  team_id         text,
  amount          numeric(12,2) not null check (amount > 0),
  currency        text not null default 'EUR',
  payment_method  text not null check (payment_method in ('cash','card','transfer','other')),
  received_on     date not null,                       -- = tx.occurred_on
  vat_rate numeric(5,2), vat_amount numeric(12,2),
  seller_snapshot jsonb not null,
  client_snapshot jsonb,
  service_snapshot jsonb,                              -- {title, appointment_date, invoice_number?}
  notes text, pdf_url text, sent_at timestamptz, sent_to text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (tenant_id, year, seq)
);
create unique index ux_receipts_transaction
  on public.receipts (transaction_id) where transaction_id is not null;
-- + индексы (tenant, year desc, seq desc), appointment_id, invoice_id partial
-- RLS: owner-only. Freeze-триггер: выпущенный чек неизменяем,
-- кроме pdf_url/sent_at/sent_to/notes и перехода issued→void.
```

- **RPC `cancel_invoice(p_invoice_id, p_request_id, p_reason)`** — owner-only, идемпотентен (id CN = request_id), одна транзакция: лочит оригинал (`kind='invoice'`, `status='issued'`, ноль строк леджера — как в `void_invoice`); вставляет CN (копия заголовка и строк с ПОЛОЖИТЕЛЬНЫМИ суммами, тот же vat_mode/percent ОРИГИНАЛА — настройки команды не перечитываются, `parent_invoice_id`, свежие снапшоты, серия `CN-YYYY-NNN` через advisory-lock по `hashtext(tenant_id || kind)`); оригиналу `status='cancelled'`. Отмена оплаченного — v2 (сначала возврат платежей через `refund_invoice_payment`).
- **`build_invoice_seller_snapshot`** (`20260720210008`) — сигнатура расширяется до `(p_tenant_id, p_team_id text default null)`: добавляет `vat_exemption_note` и `country` из `effective_vat_settings(p_team_id)` (§2.4); вызовы передают команду документа: `issue_invoice` → `brigade_id`, `cancel_invoice` → `parent.brigade_id`, `create_receipt_for_income` → `tx.team_id`. Текст основания замораживается в документ; печатается при `vat_mode='off'`.
- Guard'ы: `prevent_settled_invoice_rewrite` (`mig/20260720210008:156-268`) переиздаётся целиком: список допустимых статусов (:210) расширяется до `('issued','paid','void','cancelled')`; переход в `cancelled` разрешён только из `issued` без строк леджера (зеркало правила для `void`); сам `cancelled` терминален (любая смена статуса с него — exception, как у `void`). `kind='credit_note'` — insert-only с рождения; `validate_invoice_payment_insert` — платежи по CN и cancelled запрещены; `update_invoice_draft` — только `kind='invoice'`; `sync_invoice_status_from_ledger` — скип CN.
- **AFTER INSERT-триггер `create_receipt_for_income`** на `finance_transactions`: `WHEN new.type='income' AND (appointment_id IS NOT NULL OR invoice_id IS NOT NULL)` → вставляет чек (номер через advisory-lock серии RC, `seller_snapshot` через `build_invoice_seller_snapshot(tenant_id, new.team_id)`, vat-поля копией с транзакции). Точек рождения income три и все серверные (reconcile, record_invoice_payment, link при issue) — один триггер закрывает все пути, клиент «забыть чек» не может, `ux_receipts_transaction` даёт идемпотентность. Ручной доход без записи/инвойса → чека нет (внутренняя проводка).
- **Void чека:** `undo_appointment_payment`/`reset_appointment_payment` (удаляют income) и `refund_invoice_payment` при ПОЛНОМ возврате дополнительно ставят `receipts.status='void'` по transaction_id. Номер сохраняется — серия непрерывна. **Частичный возврат чек НЕ трогает**: квитанция документирует свершившийся факт приёма денег на полную сумму и остаётся `issued`; возврат — отдельное событие леджера (linked-refund), в v1 своего документа не имеет («возвратная квитанция» — кандидат v2). Правило детерминированное: `Σ|refund| ≥ income.amount` → void, иначе — без изменений.

### 2.6 Итоговый граф связей

```
appointments 1─* finance_transactions (appointment_id, appointment_payment_kind)
appointments ──▶ accounts               (payment_account_id — «пожелание», не маршрут)
finance_transactions *─1 invoices       (invoice_id: и линковка дохода, и платежи)
finance_transactions 1─* finance_transactions (refund_of_id — linked-refund)
invoices 1─0..1 invoices                (parent_invoice_id: credit note → оригинал)
receipts 1─1 finance_transactions       (transaction_id unique — чек = один приём денег)
accounts 1─* account_teams *─1 teams    (membership общего счёта)
teams 1─0..1 team_finance_settings      (переопределение страны/VAT команды; нет строки = дефолты тенанта)
masters 1─0..1 master_permissions       (sparse overrides прав finance.*; нет строки = дефолты роли)
```

---

## 3. Экраны и UX (счета, настройки, деталь, глазик)

Роут-структура: `cabinet/accounts.tsx` → директория `app/(dashboard)/cabinet/accounts/` из трёх экранов: `index.tsx` (список), `[id]/index.tsx` (деталь), `[id]/settings.tsx` (настройки); плюс новый стек `cabinet/finance-settings/` (§3.7) и перестройка `cabinet/masters/[id]/access.tsx` (§3.8). Существующие ссылки (`/cabinet/accounts`, `?create=1&brigadeId=`) работают без правок. Весь стек счетов и настроек — owner-only (`RoleCapabilityBoundary capability="view-finances"`).

### 3.1 Список счетов (`index.tsx`)

Apple Settings grouped list: hero «ВСЕГО НА СЧЕТАХ» (Σ видимых + EyeOff-маркер при скрытых) → секция «КОМПАНИЯ» (только при наличии общих счетов; строка 56pt: иконка-тайл `KIND_ICON` 32pt, имя Headline 17/600, подстрока «Общий · N команд», баланс Callout tabular или `••••`, шеврон) → секции по командам (eyebrow = имя команды с 6pt цветной точкой) → Card действий (`NavRow` «Перевод между счетами», `AddRow` «+ Добавить счёт») → тихая `NavRow` «Закрытые счета · N» (режим `?archived=1` того же файла; тап по закрытому — ActionSheetIOS «Открыть счёт снова»). Разделители left-inset 68, максимум 3 кегля, цвет только смысловой.

### 3.2 Создание — канонический BottomSheet

Название (autoFocus) → `SegmentedControl` «Команды | Общий» → radio-чипы команд ИЛИ чек-лист команд с галками (первая строка «Все команды» — мастер-галка; минимум 1; подпись «Счёт увидят только выбранные команды») → Вид (4 kind-чипа; дефолт cash при «Команды», bank при «Общий») → Стартовый баланс (только при создании). CTA `GradientButton` «Создать счёт». Поля icon/color счёта не настраиваются (вид даёт иконку, команда — цвет).

### 3.3 Деталь счёта (`[id]/index.tsx`) — Revolut-структура

1. **Hero**: иконка вида + «Наличные · Юра» / «Банк · Общий, 3 команды» (ряд цветных точек команд); баланс Display 34/800 tabular (`opening_balance + Σ` all-time — не оконный); **глазик** Eye/EyeOff 22pt в 44pt-зоне: видимый → тап скрывает И сохраняет (`balance_hidden=true`); скрытый → тап показывает ВРЕМЕННО (локальный state, сброс при уходе с экрана); снять скрытие насовсем — Switch в настройках. Хаптика на переключение.
2. **`NavRow` «Перевод»** → transfer-sheet с предзаполненным «Откуда».
3. **MonthStepper** `‹ Июль 2026 ›` (44pt chevron-зоны; вперёд дальше текущего месяца не листается) — управляет обоими блоками ниже; одно чтение `listTransactionsForRange(monthFrom, monthTo, {accountIds:[id]})` кормит и разбивку, и ленту.
4. **«ПОСТУПЛЕНИЯ ПО КОМАНДАМ»** (только `scope='company'`): строка 48pt на команду — эмалевая полоска 2×16 цвета команды + имя, сумма Callout tabular `success`, вторичная строка «Нал X · Карта Y» (только ненулевые методы) — это и есть требование №4. Формула: `Σ income − Σ|refund|` по `tx.team_id` за месяц (переводы/расходы не входят). Команда с нулём показывается (`€0` — информация); отвязанная с историей — с суффиксом «· отключена». Ниже блок «Инкассации» (transfer-ноги «плюс», атрибуция по команде счёта-источника через `transfer_group_id`) и строка «Переводы · ±X» — отдельно от прямых оплат, иначе месяц команды задвоится. Футер «За месяц» + итог.
5. **Лента транзакций счёта** — переиспользованный `TransactionsFeed` (проп `contextMode="team"`) + `TransactionPopup` со всеми действиями.

### 3.4 Настройки счёта (`[id]/settings.tsx`) — «закон строки» (`card-rows.tsx`)

Примитивы строк (`FieldRow`/`NavRow`/`AddRow`/`ActionRow`/`ControlRow`/`RowCaption`) сегодня живут в `mobile/src/features/clients/card-rows.tsx` — тянуть их из чужой фичи в финансы нельзя (кросс-фичевой импорт против канона «UI consistency»). Перед первым использованием файл поднимается целиком в `mobile/src/components/ui/card-rows.tsx`; старый путь — тонкий реэкспорт (клиентскую фичу не трогаем, импорты мигрируют по мере касания). Один механический коммит в начале Слайса 4.

- **«Основное»**: `FieldRow` Название (live, on-blur); Вид и Стартовый баланс — редактируемы только без истории, с историей — disabled + `RowCaption quiet` с причиной (зеркало `guard_account_financial_history`).
- **«Команды»**: командный счёт — одна строка «Команда» (смена только без истории; конвертация team→company не поддерживается — создайте общий и переведите остаток); общий счёт — строка на подключённую команду (тап → ActionSheetIOS «Отключить команду», destructive; отключение разрешено всегда — история хранит свой team_id, блокируются только новые операции; последнюю команду отключить нельзя) + `AddRow` «+ Подключить команду» (виден только при наличии неподключённых активных команд — «видно кого можно добавить») → BottomSheet-чек-лист.
- **«Приватность»**: `ControlRow` «Скрывать баланс» + Switch = `balance_hidden`; caption «Баланс печатается как •••• во всех списках».
- **«Архив»**: `ActionRow danger` «Закрыть счёт» — существующая логика (ненулевой баланс → «Перевести остаток» → transfer-sheet; ноль → confirm → `softCloseAccount`). Счёт БЕЗ единой транзакции — жёсткий DELETE (новый repo-метод с серверным guard'ом).

### 3.5 Глазик — единая семантика по всем поверхностям

- Строка счёта: `••••` моноширинно в том же tabular-слоте (строка не прыгает), ink-цвет (не серый). Тап по скрытой сумме в `AccountsPanel` — транзиентный показ (локальный Set, сброс при анмаунте).
- ВСЕ агрегаты (мини-карточка «Счета» в FinanceOverview, шапка панели «N счетов · Σ», hero списка) = **сумма только видимых + EyeOff 12px `t.faint`** при наличии скрытых.
- «Поступления по командам» глазиком не маскируются (скрывается остаток, не обороты — owner-only экран).
- `balance_hidden` не входит во frozen-список guard'а; слим-RPC для мастеров колонку не отдаёт.

### 3.6 Вписывание в страницу «Финансы»

- `AccountsPanel`: две секции (командные / «Общие счета»), строки становятся тапабельными → деталь счёта (шеврон появляется по NavRow-закону); в командном скоупе общий счёт показан ПОЛНЫМ балансом + вторичная строка «С этой команды за период · +X»; футер → «Все счета · Перевод».
- Скоуп-фильтр счетов (`finances.tsx:186-189`): «командный счёт этой команды ИЛИ общий, к которому команда подключена»; **Σ мини-карточки в командном скоупе — только командные счета** (полный баланс общего умножался бы на число команд при переключении чипов).
- `OperationSheet`/`InvoicePaymentSheet`/transfer-sheet: фильтр счетов расширяется через `accountServesTeam`; чип общего счёта подписывается «· Общий»; умный дефолт не меняется (командный раньше общего).
- Шестерёнка финансов (`finances.tsx:398-426`): ActionSheet сокращается до двух пунктов — «Настройки финансов» (push хаба §3.7) и «Экспорт CSV за период» (остаётся здесь: экспорт привязан к периоду на экране). Пункт «Счета» живёт строкой ВНУТРИ хаба.

### 3.7 Настройки финансов — хаб и страница команды

Роуты (стек `cabinet`, owner-only под `RoleCapabilityBoundary capability="view-finances"`; в `DISPATCHER/MASTER_CABINET_ROUTES` НЕ добавляются; топ-левел `/finances/…` невозможен — `(dashboard)` группа, таб `(dashboard)/finances.tsx` уже занимает URL):

```
mobile/app/(dashboard)/cabinet/finance-settings/index.tsx      — хаб «Финансы»
mobile/app/(dashboard)/cabinet/finance-settings/[teamId].tsx   — «НДС и страна» команды
```

**Хаб** — зеркало экрана настроек календаря (`app/calendar/index.tsx`): `Screen` + `ScreenHeader title="Финансы" right={<SavedIndicator/>}` + grouped-секции `SectionEyebrow/SectionCard/SectionFooter`, instant-commit без кнопки «Сохранить» (паттерн `patchTeam`, calendar/index.tsx:91-100):

1. **«Счета»**: `NavRow «Счета»` (подстрока «N счетов») → `/cabinet/accounts`.
2. **«Компания»** — дефолты тенанта, редактируются прямо здесь (это базовый слой, а не «одна из команд»): `ValueRow «Страна»` (значение `vatCountryLabel(tenants.country)`; тап → `OptionSheet` стран §2.4; выбор пишет `tenants.country` и после confirm-alert «Подставить ставку 24%?» — `vat_rate_percent`); `SwitchRow «Начислять VAT»` (off ↔ последний ненулевой режим, MMKV-память экрана, первый раз — `inclusive`); при включённом — `ValueRow «Режим»` («Включён в цену» / «Сверх цены») и `ValueRow «Ставка»` (OptionSheet: стандартная ставка страны + частые + «Другая…» → prompt); при выключенном — `ValueRow «Текст освобождения»` (prompt-sheet; печатается на инвойсах и чеках). `SectionFooter`: «Действует для всех команд, у которых нет своих настроек.»
3. **«Команды»** — по строке на активную команду (паттерн «Другие календари», calendar/index.tsx:224-272): 6pt цветная точка, имя, подстрока = действующее резюме — «Как у компании» (`t.faint`) либо «Греция · VAT 24%, включён в цену» / «Кипр · VAT выключен» (`t.sub`); шеврон; тап → push `[teamId]`. Секция видна всегда, даже с одной командой — подэкран содержательный.
4. **«Доступ мастеров»** — строка на мастера (имя + счётчик «N из 7») → `/cabinet/masters/[id]/access` (§3.8 — один экран, две двери).
5. **«Документы»**: `ValueRow «Язык документов»` — `OptionSheet`: English (дефолт) / Русский / Ελληνικά → `tenants.document_language`; `RowCaption quiet`: «Инвойсы, кредит-ноты и квитанции для клиентов». Реквизиты продавца НЕ дублируем — `NavRow «Реквизиты для счетов»` → `/cabinet/business` (одна правда). Секция «VAT» в `business.tsx` НЕ создаётся — VAT целиком живёт в этом стеке, `business.tsx` остаётся про реквизиты.

**Страница команды `[teamId].tsx` — «НДС и страна»**: `ScreenHeader title="НДС и страна" subtitle={team.name}` (паттерн `calendar/[teamId]/schedule.tsx:64`). Семантика наследования — календарная, «материализация первой правкой»:

- Пока строки `team_finance_settings` нет: контролы показывают ДЕЙСТВУЮЩИЕ (тенантские) значения приглушённо (`t.faint`, как `inheritedHours` в schedule.tsx:98), сверху — `SectionFooter` «Сейчас действуют настройки компании. Измените что-нибудь — у команды появятся свои.»
- **Первая правка** любого контрола: upsert строки = копия текущих effective-значений + правка («ничего не прыгает после сохранения»). Дальше все контролы живые.
- Контролы — тот же диалект, что секция «Компания» хаба: `ValueRow «Страна работ»` (первый пункт OptionSheet — «Как у компании · Кипр», пишет `country = NULL`; выбор страны подставляет её стандартную ставку с confirm, если владелец уже правил ставку руками, + хаптика; `RowCaption quiet`: «Ставка подставлена по стране — её можно поправить»); `SwitchRow «Начислять VAT»` + «Режим»/«Ставка»/«Текст освобождения» (дефолт подстроки — тенантский note, если свой не задан).
- **Секция «Превью»** — живой пример на €100 в стиле карточки-сноски (ink на карточке, без серого): `inclusive` → «Итого €100,00 · в т.ч. VAT 24% = €19,35»; `exclusive` → «€100,00 + VAT 24% = €124,00»; `off` → «VAT не начисляется» + текст освобождения курсивом. Пересчёт мгновенный — «понять, не выпуская инвойс».
- **Секция-хвост**: `ActionRow «Вернуть настройки компании»` (видна только при существующей строке) → confirm → `DELETE` строки, контролы возвращаются в приглушённый inherited-вид. Не destructive-red: это не потеря данных, история в снапшотах. `SectionFooter` внизу: «Настройки применяются к НОВЫМ операциям и документам этой команды. Уже созданные хранят свои ставки.»
- Instant-commit + `SavedIndicator` + `Alert` на ошибку; мутация — `useUpsertTeamFinanceSettings`.

Данные клиента: `shared/db/repositories/team-finance-settings.ts` (`listTeamFinanceSettings` — все строки тенанта одним запросом под подстроки хаба, `upsertTeamFinanceSettings`, `deleteTeamFinanceSettings`); `shared/local/finance/vat.ts` (`EffectiveVat`, `resolveEffectiveVat(tenant, override?)` — клиентское зеркало SQL-резолвера для подстрок и превью без раунд-трипа, `splitVatInclusive`/`addVatExclusive` — переиспользуются превью, инвойсом, PDF); `mobile/src/features/finances/vat-settings.ts` (хуки, ключи под `["finance-settings"]`, инвалидация сбрасывает и `["invoices","prefill"]`-дефолты).

### 3.8 Страница доступа мастера

Роут — перестраиваем существующий `mobile/app/(dashboard)/cabinet/masters/[id]/access.tsx`: это уже «страница доступа под каждого мастера», вход с карточки мастера (`masters/[id]/index.tsx:419-420`, NavRow «Доступы» с превью-счётчиком); новых точек входа не плодим, вторичный вход — секция «Доступ мастеров» хаба §3.7. Паттерн «тап по сущности → её настройки» — тот же, что `/calendar/[teamId]` и §3.7. Канон: «закон строки» card-rows (после подкоммита Слайса 4 — из `components/ui/`), БЕЗ эмодзи (поле `emoji` legacy-групп не переносим), Switch `trackColor={{true: t.accent}}`, хаптика на переключение.

```
ScreenHeader «Доступы» · подзаголовок: имя мастера
├─ Шапка-строка: роль мастера (ROLE_LABELS + смена роли — как сейчас на карточке),
│    caption «Права по умолчанию зависят от роли»
├─ SectionCard «ФИНАНСЫ — ЧТО ВИДИТ»
│    ControlRow «Суммы и цены в записях»  [Switch]
│    ControlRow «Балансы счетов»          [Switch]
│    ControlRow «Страница „Финансы“»      [Switch]
│      RowCaption quiet: «Доход, расход и долги его команд. Балансы счетов — отдельным тумблером выше.»
├─ SectionCard «ФИНАНСЫ — ЧТО МОЖЕТ»
│    ControlRow «Принимать оплату»        [Switch]
│      ControlRow indent «Выбирать счёт зачисления» [Switch]   ← disabled при выкл. родителе
│    ControlRow indent «Редактировать сумму записи» [Switch]   ← indent под «Суммы и цены»
│    ControlRow «Создавать расходы»       [Switch]
│      RowCaption quiet: «Материалы, бензин — расход попадает в финансы команды.»
├─ ActionRow «Сбросить к роли: Лидер» → confirm → reset_master_permissions
│    RowCaption quiet: видна только при overrides («Изменено вручную: 2»)
└─ ниже — существующие legacy-блоки страницы (пресеты, видимость команд, группы
   Календарь/Клиенты/Чаты/Админ) БЕЗ изменений, кроме одного: из legacy-группы «Финансы»
   флаги see_finances / see_all_company_finances УДАЛЯЮТСЯ — их заменил серверный блок
   сверху; два выключателя об одном — запрещено
```

Поведение тумблеров:

- Значение = эффективное (override ∨ дефолт роли). Отклонение от дефолта роли — точка-акцент 2pt у лейбла (тихий маркер «изменено вручную», без текста).
- Тап → optimistic-переключение + `set_master_permission` (per-key RPC — параллельные тапы не съедают друг друга; write-mutex из access.tsx:63 больше не нужен). Ошибка → откат + Alert.
- Ребёнок при выключенном родителе: indent, disabled, значение показывается как выключенное (эффективное); override при этом не стирается — включил родителя обратно, дети вернулись как были.
- Секции всегда видимы owner'у целиком; страница уже за owner-гейтом кабинета.

Легаси-страница бригады (`cabinet/teams/[id]/masters/[masterId].tsx`): группы `finance` и `brigade_finance` УДАЛЯЮТСЯ из `BRIGADE_PERMISSION_GROUPS` (источники двоевластия), в конце страницы — тихая `NavRow` «Финансовые права — в доступах мастера» → `/cabinet/masters/[id]/access`. Ключи в интерфейсе `BrigadeMemberPermissions` пока остаются (совместимость сохранённых jsonb), помечаются `@deprecated`; физическая чистка — при миграции календарного домена.

---

## 4. Поток «запись → счёт»

Резюме: чипы способов оплаты в записи ЗАМЕНЯЮТСЯ чипами реальных счетов (свои + общие привязанные); `payment_method` выводится из kind счёта (новая биекция `paymentMethodForAccountKind`: cash→cash, card→card, bank→transfer, other→other). Выбор едет `appointments.payment_account_id` через офлайн-очередь; сервер кладёт авто-income на этот счёт, resolve — fallback.

1. **`buildDebtPaidPatch`** (`mobile/src/features/appointments/payment.ts:55-113`) остаётся единственной точкой признания денег; сигнатура: `{ account: {id, kind} | {method}, amount, remainingDebt }` — вторая форма для legacy-входов без счетов. Новое шестое поле патча — `payment_account_id`. Все 5 входов правятся в одном слайсе.
2. **`Payment.account_id`** (jsonb `payments[]`) — офлайн-витрина счёта в карточке записи: леджер online-only и owner-only, а карточка обязана показывать счёт всем ролям и без сети. Legacy-платежи без поля → «Счёт: автоматически».
3. **`PaymentAccountChips`** — новый компонент (`features/appointments/`): данные из `useTeamPaymentAccounts(teamId)` (RPC `list_payment_accounts_safe`, без балансов), чип = имя счёта + иконка kind, radio-поведение как у нынешних чипов способов; порядок: командные (by position), затем общие; дефолт НЕ предвыбран (оператор осознанно тапает — «мастер нажимает счёт»); мастеру чипы показываются только при `finance.choose_account`; пустой список/ошибка/нет права → fallback на прежние 4 чипа способа (приём денег никогда не блокируем, счёт резолвит сервер). Чип «Позже» — снаружи.
4. **Точки монтажа**: `AppointmentSheet` секция «Оплата» (:2078-2164) + строка «Оплачено · €N · Наличка»; секция «Расчёты» — по строке на каждый платёж с его счётом, owner-тап → BottomSheet «Счёт платежа» → `move_appointment_payment_account`; `PrepaymentEditor` → `set_appointment_prepayment(p_account_id)`; `/book` (счёт применяется к совместимой строке); контекст-меню календаря и карточка клиента — ActionSheetIOS с именами счетов; close-day/unclosed — оставить `{method}` без счёта (resolve).
5. **Мастер**: секция оплаты появляется в `CrewAppointmentSheet` (вынос общего `PaymentSection`), патч через расширенный whitelist `update_master_appointment_safe`; гейты — `useMyFinancePermissions()` (кэш `my_finance_permissions`, §2.2): `see_amounts` — показывать ли блок денег, `record_payment` — кнопки оплаты, `choose_account` — чипы счетов или legacy-чипы способов, `edit_amount` — редактируемость суммы. Счёт своих платежей мастер видит read-only; балансов в чипах нет и не будет (`see_account_balances` работает на страницах счетов и «Финансы», не в контексте выбора).
6. **Офлайн**: `payment_account_id` ОБЯЗАТЕЛЬНО добавить в `makeServerRow` (`shared/sync/appointmentsCached.ts:454-516`) и `patchToRow` (:518-568) — иначе реплей молча потеряет поле; `FINANCE_FIELDS` (`calendar/mutations.ts:58-68`) — тоже. Финансовые таблицы в офлайн-очередь НЕ входят (`CachedTable`-юнион не расширяем).
7. **Транзакция → запись (требование №6)**: в `TransactionPopup` — действие «Открыть запись» (ПЕРВОЕ для авто-строк) при `tx.appointment_id`: `router.push({pathname:"/(dashboard)", params:{appointmentId, teamId}})` — паттерн `invoices/[id].tsx:260-270`. Упрочнить обработчик `?appointmentId=` (`(dashboard)/index.tsx:451-563`): не нашёл в срезе → `getAppointment(id)` из репозитория (чинит и пуши). Заметка: поле `notes` в `TransactionPopup` становится редактируемым для owner у ВСЕХ строк — у manual через существующий полный edit (`canEdit`, :130), у авто-строк/платежей инвойсов/переводов через `set_transaction_note` (§2.3) — строка «Заметка» с тапом → prompt-sheet. Там же для owner и auto-строк — «Сменить счёт».

Состояния записи не меняются (`unpaid|partial|paid` + производный долг); счёт присоединяется к каждому СОБЫТИЮ денег: аванс — свой счёт, каждая доплата — свой (аванс картой, остаток налом — валидно), возвраты идут по исходным счетам автоматически (БД-инвариант), смена счёта задним числом переносит income вместе с его refund'ами.

---

## 5. Документы: VAT, инвойс, credit note, receipts

### 5.1 Три документа, один механизм

| Документ | Носитель | Когда создаётся | Серия | Изменяемость |
|---|---|---|---|---|
| Invoice | `invoices`, `kind='invoice'` | по кнопке (из транзакции / записи / с нуля) | `INV-YYYY-NNN` | правится до первого платежа, дальше заморожен |
| Credit note | `invoices`, `kind='credit_note'` | по кнопке «Отменить инвойс» на неоплаченном issued | `CN-YYYY-NNN` | insert-only с рождения |
| Receipt | `receipts` | **автоматически** на каждый приём денег (записи и инвойса) | `RC-YYYY-NNN` | insert-only; issued→void при полном откате |

Нумерация: единый механизм advisory-lock → `max(seq)+1` per (tenant, year[, kind]) → `formatDocumentNumber` (переименованный `formatInvoiceNumber`, старое имя — алиас). Серия на юрлицо (tenant), НЕ на команду и НЕ на счёт. Номер присваивается атомарно, никогда не переиспользуется; отменённый документ хранит номер. Статус `draft` сознательно НЕ вводим — «issued правится до первого платежа» и есть черновик соло-владельца.

Язык всех трёх шаблонов = `tenants.document_language` (дефолт en, §2.4): подписи из `DOC_STRINGS` (`shared/local/documents/i18n.ts`); суммы, ставки и exemption note печатаются из СНАПШОТОВ документа, не из живых настроек — инвойс греческой команды навсегда хранит её 24% и её текст освобождения.

### 5.2 Статусная машина инвойса

```
issued ──платежи──▶ partial(view) ──▶ paid
  │ └─ due_on < today ──▶ overdue(view)
  └──cancel_invoice──▶ cancelled  (+ рождается CN, immutable)
void — легаси, только чтение (UI больше не производит)
```

`invoiceDisplayStatus` — ветка `cancelled` первой; `InvoiceStatusBadge` — neutral-тон. UI: `/invoices/[id]` кнопка «Отменить инвойс» (условия: issued, платежей 0) → confirm с причиной → `useCancelInvoice`; у отменённого — строка «Отменён · CN-2026-001» → карточка CN. Карточка CN = тот же `[id].tsx`: hero «Кредит-нота», ссылка на оригинал, секции оплаты скрыты, действия — только share PDF/текст. В summary «К оплате/Просрочено/Оплачено» CN не входят. PDF — один шаблон `pdf.ts`, режим по `kind` (суммы с минусом в итогах — знак забота рендера, в БД суммы положительные).

### 5.3 Receipt — нефискальная квитанция о приёме денег

Чек = ровно одна income-строка леджера (авто-строки `prepayment`/`settlement` и платежи инвойса уже событийные, 1:1). Требования 10 и 11 закрываются одним примитивом: `appointment_id` → чек оплаты записи; `invoice_id` → чек-подтверждение оплаты инвойса. Частичные платежи → чек на каждый приём; частичный ВОЗВРАТ чек не аннулирует (правило §2.5 — void только при полном откате приёма). В шаблоне НЕ называть фискальным (Kassenbon/paragon) — CRM без сертификации фискальные чеки выдавать не может.

UI: чеки всплывают из родителей, отдельного корневого раздела в v1 нет — `TransactionPopup` строка «Чек RC-2026-001» (тап = share PDF); карточка записи — номер чека под каждой строкой платежа; карточка инвойса — действие «Чек» у каждого платежа истории (= требование 11). Отправка клиенту = системный share-sheet («иногда отправляется, иногда нет» решается самим share, автоотправки нет). Новые файлы: `mobile/src/features/receipts/{pdf.ts, queries.ts, share.ts}`; PDF — компактный макет на каркасе инвойсного: продавец из `seller_snapshot`, «Получено от {клиент}», сумма крупно, способ, «За: {услуга / Оплата инвойса INV-…}», строка VAT «в т.ч. {rate}% = {vat_amount}» либо `vat_exemption_note` из снапшота.

### 5.4 «Выставить инвойс» с дохода на счёт компании (требование 8)

Механика готова (`TransactionPopup` → `openTransactionInvoice` → `/invoices/new` prefill → `issue_invoice(link_to_tx_id)` → сразу paid, allow_auto_invoice_link). Дополняем: при `account.scope==='company'` и `tx.invoice_id == null` кнопка становится PRIMARY (кобальтовая), для остальных доходов — второстепенная строка как сейчас; `InvoicePrefill` получает `vatRate` из `tx.vat_rate` (режим inclusive — сумма транзакции брутто, итог сходится до цента). После выпуска — «Открыть инвойс» (уже работает). Автосоздание инвойса на каждый доход — сознательно НЕ делаем (номерной юридический документ — только осознанное действие).

### 5.5 Immutability — сводка

| Объект | Правило |
|---|---|
| Инвойс issued без платежей | правится целиком, снапшоты обновляются (есть) |
| Инвойс с платежами / cancelled | заморожен полностью (расширение `prevent_settled_invoice_rewrite`) |
| Credit note / Receipt | insert-only с рождения (кроме pdf_url/sent_*/notes/void у чека) |
| Авто-транзакции, платежи инвойсов | immutable кроме RPC (есть); `notes` — правится всегда через `set_transaction_note` (§2.3) |
| vat_rate/vat_amount на tx | правятся только у manual без invoice_id |

PDF всегда рендерится из снапшотов on-device (expo-print) — хранение файлов не добавляет юридической силы; мёртвый `setInvoicePdfUrl` снести (standing rule про мёртвый код).

---

## 6. Отчётность и скоупы

Главный принцип: **P&L (Доход/Расход/Долги/Прибыль) уже считается по `tx.team_id` и общих счетов не замечает — не трогаем.** Меняются только поверхности, где фигурирует СЧЁТ.

1. **Скоуп «Компания»** = все строки, включая `team_id = NULL` (общекорпоративные расходы с общего счёта); **скоуп «Команда»** = `team_id = scope` (NULL-строки выпадают — желаемо: аренда офиса с Revolut не размазывается по командным P&L). Инвариант, закрепить тестом: `Доход(Компания) = Σ Доход(команд) + Доход(team_id=NULL)`.
2. **Балансы общих счетов НЕ делятся на «долю команды»** — доля-фикция врёт; показываем два честных числа: полный баланс счёта (всегда) + приток команды за период (точная атрибуция потока).
3. **Модуль `account-inflow.ts`** (`mobile/src/features/finances/`, чистые функции + тест): `breakdownAccountInflowByTeam(txs, accounts) → { direct, collections, transfersNet }` — direct: income/refund по `team_id × payment_method` (неттинг возвратов в команду исходника, сирота → «Компания»); collections: transfer-ноги «плюс» по команде счёта-источника; transfersNet: сальдо остального. Sanity-тест: Σ разрезов = общей дельте счёта.
4. **Хук `useAccountTransactions(accountId, from, to)`** — новый ключ под префиксом `["transactions", ...]` → центральная инвалидация `invalidateLedger` покрывает бесплатно; сигнатуру `useTransactions` не трогаем.
5. **CSV-экспорт** (`export.ts`): 5 → 8 колонок `Дата, Тип, Категория, Команда, Счёт, Способ оплаты, Сумма, Заметка`; `team_id NULL` → «Компания»; переводы по-прежнему исключены. VAT-колонки — после появления снапшотов, в этом же генераторе.
6. **Без изменений**: `breakdown.ts`, `ProfitBreakdown`, `IncomeShareDonut`, `DebtorsList`, `TransactionsFeed`, `period.ts`, `PeriodSheets` — фильтрация периодов/команд остаётся как есть (требование 12: каркас готов, закрываем поверх него). Разбор прибыли остаётся gross/кассовым (нетто-аналитика «без VAT» — non-goal этой волны).

---

## 7. Крайние случаи — правила

1. **Переводы**: разрешены команда↔компания («инкассация налички на бизнес-карту») и компания↔компания; пара team-счетов разных бригад — запрещена (путь через общий счёт). `FOR UPDATE order by id` + овердрафт-чек — без изменений; `delete_account_transfer` работает как есть.
2. **Возвраты**: инварианты НЕ меняются — refund всегда копирует `account_id`/`team_id` исходного дохода и НЕ проверяется на текущий membership (отвязка команды не должна блокировать возврат клиенту). Возврат со закрытого счёта запрещён — UI показывает причину. LIFO-раскладка linked-refund'ов работает для общих счетов без правок.
3. **Отвязка команды от общего счёта**: разрешена всегда, управляет только БУДУЩИМИ операциями; история неприкосновенна (строки хранят свой team_id). Гонка «мастер закрывает заказ ↔ владелец отвязывает» — два эшелона, согласованно с §2.3: в норме отвязка видна ДО вставки, и reconcile сам тихо фолбэчится на resolve ещё до INSERT (падения нет); INSERT упирается в integrity-триггер только если отвязка коммитится в узком окне между проверкой membership и вставкой внутри reconcile — тогда патч остаётся в очереди, реплей повторяет reconcile, и уже первый эшелон (fallback до INSERT) выбирает другой счёт. Общий счёт с нулём команд — валидное состояние (мягкое предупреждение в UI, не блок).
4. **Смена scope** у счёта с историей — запрещена (frozen-список); без истории — разрешена. Миграционный путь: создать общий, перевести остаток, закрыть старый.
5. **Офлайн-мастер выбрал счёт, который к реплею закрыт/отвязан**: `payment_account_id` — ПОЖЕЛАНИЕ, не жёсткий маршрут → тихий fallback на resolve; если и он пуст — существующий exception, патч остаётся в очереди.
6. **Гонки балансов**: баланс не хранится, а выводится (`opening + Σ`) — у двух команд, одновременно жмущих нал на общий счёт, нет разделяемой ячейки; потерянных обновлений не бывает по построению. **Инвариант: материализованный `accounts.balance` не вводить никогда.** Запись сериализуется advisory-lock'ом по appointment_id; reconcile дельтовый — повторный реплей не удваивает доход.
7. **Роли**: owner — всё; dispatcher — как сегодня; мастер — строго по словарю `finance.*` (§2.2). Балансы счетов не-owner'у отдаёт ТОЛЬКО `list_payment_accounts_safe` и только при `see_account_balances`; имена счетов — при хотя бы одном из `choose_account | view_page | see_account_balances`, иначе пустой список (клиент фолбэчится на чипы способов); страница «Финансы» мастера — `view_page` (Слайс 13). Граница по хукам: `useAccountsWithBalances` — owner-экранам, `useTeamPaymentAccounts` — всем. Никогда не передавать баланс в props компонентов не-owner экранов.
8. **Идемпотентность** всех новых RPC — по образцу существующих: `p_request_id` = id создаваемой строки, advisory-lock, контрольное чтение (`assertInvoiceControlRead`-паттерн, контракт `write-confirmation.test.ts`).
9. **Закрытые дни** (`guard_closed_day_finance_write`) — правила не меняются; `tenant_business_date` — источник дат.
10. **Права и офлайн/гонки**: право выключили, пока мастер офлайн → реплей падает отказом whitelist'а с ВИДИМОЙ ошибкой очереди, деньги не проводятся молча (§2.2 «Офлайн»). Два owner'а одновременно тумблерят одного мастера → per-key `jsonb_set`: последний тап по каждому ключу побеждает независимо, потерь целого объекта нет. Смена роли lead→helper сужает дефолты мгновенно, overrides остаются (могут теперь РАСШИРЯТЬ helper'а — валидно: «помощник, которому доверили оплату»). Удаление мастера каскадит строку прав; legacy-клиент старой версии не знает гейтов UI, но сервер режет мутации — деградация безопасная.

---

## 8. Пошаговый план внедрения

Каждый слайс = один осмысленный коммит. После каждого: tsc = 0, `bun test` (shared), для UI — проверка в симуляторе (`babun-sim`), self-review + чистка мёртвого кода. Нумерация миграций совпадает с порядком слайсов.

### Слайс 0 — Выравнивание прода (блокер)
- Пере-применить волну `mig/20260720210001…20260720210015` **плюс** `mig/20260720212500_transactional_quota_guards.sql` на прод (сначала прогнать на Supabase-бранче), `apps/web` → `bun run db:types`.
- **Готово когда**: `list_migrations` содержит волну и `212500`; RPC `issue_invoice`/`record_invoice_payment`/`set_appointment_prepayment`/`record_account_transfer` существуют на проде; оплата инвойса и предоплата записи проходят вживую; tsc = 0.

### Слайс 1 — Миграция общих счетов
- Создать: `mig/20260727100001_shared_accounts.sql` (§2.1 целиком: scope/balance_hidden/CHECK/уникальности, `account_teams`+RLS+триггер, `account_serves_team`, правки 6 функций, `list_payment_accounts_safe` — сразу с nullable-колонкой `balance`, индекс, деплой-ассерты).
- Изменить: `shared/db/database.types.ts` (regen).
- **Готово когда**: миграция применена на бранче; старые операции (командные счета, переводы одной команды, оплата записи) ведут себя байт-в-байт как раньше; company-счёт создаётся SQL-ом и принимает income с team_id привязанной команды; income с непривязанной командой отклоняется; `list_payment_accounts_safe` отдаёт мастеру строки с `balance = NULL`.

### Слайс 2 — Shared-слой счетов
- Изменить: `shared/local/finance/account.ts` (`scope`, `brigade_id: string|null`, `team_ids`, `balance_hidden`; снять комментарий «strictly per-brigade»); `shared/db/repositories/accounts.ts` (`AccountDraft.scope/team_ids`, `listAccounts`+склейка team_ids, `listPaymentAccountsSafe`, `setAccountTeams`, `deleteAccount` для счёта без истории, `rowToAccount`); `shared/local/finance/integrity.ts` (`transferValidationError` по §7.1, `accountServesTeam`, `paymentMethodForAccountKind`).
- **Готово когда**: tsc = 0; юнит-тесты на `accountServesTeam`/`transferValidationError`/биекцию kind↔method зелёные.

### Слайс 3 — UI счетов: список, создание, панель
- Создать: `mobile/app/(dashboard)/cabinet/accounts/index.tsx` (перенос из `accounts.tsx` + секции Компания/команды + archived-режим), `mobile/src/features/finances/account-ui.ts` (вынесенный `KIND_ICON`), `AccountCreateSheet` (сегмент «Команды | Общий» + чек-лист команд).
- Изменить: `mobile/src/features/finances/AccountsPanel.tsx` (две секции, тапабельные строки, `••••`, Σ видимых + EyeOff), `FinanceOverview.tsx` (проп `acctMasked`), `finances.tsx` (скоуп-фильтр §3.6), `OperationSheet.tsx` и `InvoicePaymentSheet.tsx` (фильтр через `accountServesTeam`, подпись «· Общий»), transfer-sheet (валидация §7.1). Удалить: старый `cabinet/accounts.tsx`.
- **Готово когда**: в симе создаётся общий счёт на 2 команды, виден в секции «КОМПАНИЯ», попадает в фильтры OperationSheet обеих команд; перевод команда→компания проходит; tsc = 0.

### Слайс 4 — Деталь и настройки счёта, глазик, приток
- Сначала (механический подкоммит): перенос `features/clients/card-rows.tsx` → `components/ui/card-rows.tsx`, старый путь = реэкспорт (§3.4).
- Создать: `mobile/app/(dashboard)/cabinet/accounts/[id]/index.tsx` (hero+глазик, NavRow «Перевод», MonthStepper, блок поступлений, лента), `[id]/settings.tsx` (§3.4), `mobile/src/features/finances/account-inflow.ts` + `account-inflow.test.ts`, компоненты `AccountHero`/`MonthStepper`/`AccountTeamInflow`/`TeamChecklistSheet`.
- Изменить: `mobile/src/features/finances/queries.ts` (`useAccountTransactions`), `accounts.ts` фичи (`HIDDEN_BALANCE_LABEL`, `useSharedAccountsInflow`), `TransactionsFeed.tsx` (проп `contextMode`), `export.ts` + `export.test.ts` (8 колонок).
- **Готово когда**: страница счёта показывает разбивку «Нал/Карта по командам» за месяц, суммы сходятся с лентой; глазик скрывает/показывает по §3.5 и синкается через `balance_hidden`; тест inflow (неттинг возвратов, сирота, инкассация, NULL-команда) зелёный.

### Слайс 5 — Права мастеров: словарь + таблица
- Создать: `mig/20260727100002_master_permissions.sql` (§2.2 целиком: таблица + RLS + валидатор ключей, `master_role_default`, `master_has_finance_permission`, `set_master_permission`, `reset_master_permissions`, `my_finance_permissions`, create-or-replace `list_payment_accounts_safe` — balance по `see_account_balances`, доступ по тумблерам, — бэкфилл из `teams.members`, деплой-ассерты); `shared/local/master-permissions.ts` (словарь v1: ключи, лейблы, группы «видит/может», родители, `resolveEffective(role, overrides)` — зеркало SQL для optimistic UI); `shared/db/repositories/master-permissions.ts` (`getMasterPermissionOverrides`, `setMasterPermission`, `resetMasterPermissions`, `myFinancePermissions`); `mobile/src/features/settings/master-permissions.ts` (хуки + MMKV-кэш `my_finance_permissions`).
- Изменить: `shared/db/database.types.ts` (regen).
- **Готово когда**: тумблер выключен → RPC-проверка false; нет строки → дефолты роли (lead всё true, helper только `see_amounts`); ребёнок без родителя = false на СЕРВЕРЕ; бэкфилл перенёс legacy-false из `teams.members`; сброс чистит overrides; `list_payment_accounts_safe` отдаёт balance только по праву; tsc = 0, тесты `resolveEffective` зелёные.

### Слайс 6 — Страница доступа мастера
- Изменить: `mobile/app/(dashboard)/cabinet/masters/[id]/access.tsx` (§3.8: серверные секции «что видит / что может» сверху, optimistic per-key тумблеры, маркер отклонения от роли, «Сбросить к роли»; удаление `see_finances`/`see_all_company_finances` из `PERMISSION_GROUPS.finance` и пресетов `master-presets.ts`), `cabinet/teams/[id]/masters/[masterId].tsx` + `shared/local/brigade-permissions.ts` (удаление групп `finance`/`brigade_finance` из UI, `@deprecated` на ключах, NavRow-указатель).
- **Готово когда**: в симе тумблеры пишутся per-key через `set_master_permission`, параллельные тапы не теряются; ребёнок disabled при выключенном родителе, override переживает выключение/включение родителя; на легаси-страницах не осталось второго выключателя об одном; ни одного эмодзи; tsc = 0.

### Слайс 7 — Миграция «запись→счёт»
- Создать: `mig/20260727100003_appointment_payment_account.sql` (§2.3: колонка, reconcile, `set_appointment_prepayment(p_account_id)` с не-owner веткой, `move_appointment_payment_account`, `set_transaction_note` + notes-ветка байпаса в integrity-триггере, whitelist `update_master_appointment_safe` с гейтами `finance.record_payment` / `finance.choose_account` / `finance.edit_amount`). Зависит от Слайса 5 (`master_has_finance_permission`).
- Изменить: `shared/db/database.types.ts` (regen).
- **Готово когда**: запись с явным `payment_account_id` кладёт income на этот счёт; невалидный счёт тихо фолбэчится на resolve; смена счёта задним числом переносит income + его refund'ы; `set_transaction_note` дописывает заметку на авто-income (а прямой UPDATE notes по-прежнему отклоняется); мастер с `finance.record_payment` проводит платёжный патч, без него — отказ; `payment_account_id` без `finance.choose_account` отклоняется целиком; ключи суммы без `finance.edit_amount` отклоняются.

### Слайс 8 — Клиент «запись→счёт»
- Создать: `mobile/src/features/appointments/PaymentAccountChips.tsx`, `PaymentSection.tsx` (вынос секции оплаты).
- Изменить: `shared/local/appointments.ts` (`Payment.account_id`, `Appointment.payment_account_id`), `shared/sync/appointmentsCached.ts` (`makeServerRow`/`patchToRow` — КРИТИЧНО), `shared/db/repositories/appointments.ts` (маппинг), `finance-transactions.ts` (`setAppointmentPrepayment` + accountId, `moveAppointmentPaymentAccount`, `setTransactionNote`, `listAppointmentAutoIncomes`), `mobile/src/features/appointments/payment.ts` (`buildDebtPaidPatch` — новая сигнатура + все 5 входов), `AppointmentSheet.tsx` (чипы счетов, счёт в «Оплачено», строки платежей в «Расчётах» + BottomSheet смены счёта), `CrewAppointmentSheet.tsx` (гейты `useMyFinancePermissions` по §4.5), `book/index.tsx`, `(dashboard)/index.tsx` (контекст-меню + фолбэк deep-link'а `?appointmentId=`), `clients/[id].tsx`, `calendar/mutations.ts` (`FINANCE_FIELDS`, master-whitelist), `TransactionPopup.tsx` («Открыть запись», «Сменить счёт», редактируемая «Заметка» у всех строк для owner — §4.7).
- **Готово когда**: в симе полный цикл: мастер с правами закрывает заказ тапом по счёту «Наличка» → income на этом счёте → тап по транзакции → «Открыть запись» открывает полноценную карточку; мастер без `choose_account` видит только чипы способов; офлайн-закрытие (авиарежим) доносит счёт после реплея.

### Слайс 9 — VAT per-team: миграция + shared
- Создать: `mig/20260727100004_vat_settings.sql` (§2.4 целиком: дефолты tenants + `document_language`, `team_finance_settings` + RLS + триггер, `effective_vat_settings`, снапшот-колонки invoices/finance_transactions, правки reconcile/issue_invoice/record_invoice_payment/allow_auto_invoice_link, деплой-ассерты); `shared/db/repositories/team-finance-settings.ts`; `shared/local/finance/vat.ts` (`EffectiveVat`, `resolveEffectiveVat`, `splitVatInclusive`/`addVatExclusive`); `shared/local/finance/vat-countries.ts`; `shared/local/documents/i18n.ts` (`DOC_STRINGS` en/ru/el).
- Изменить: `shared/local/finance/transaction.ts` (+vat-поля), `invoice-ledger.ts` (`vat_mode` персистентный, эвристика `invoiceVatMode` — фолбэк для дорелизных строк), `company.ts` (пометить legacy), `finance-transactions.ts` (`rowToTx`), `features/settings/tenant.ts` (+`vat_*`, `document_language`; расширить `current_tenant_profile_safe`), `database.types.ts` (regen).
- **Готово когда**: команда с override Греция/24 даёт снапшот 24 на своих авто-строках, соседняя без override — тенантские дефолты; удаление override меняет только НОВЫЕ строки, старые хранят свои ставки; линковка авто-дохода к инвойсу (allow_auto_invoice_link) НЕ ломается (тест); инвойс хранит vat_mode явно; `effective_vat_settings(null)` = дефолты тенанта; юнит-тесты резолвера (полный/частичный/пустой override) и расщепления до цента зелёные.

### Слайс 10 — Настройки финансов: хаб + страница команды
- Создать: `mobile/app/(dashboard)/cabinet/finance-settings/index.tsx` (хаб §3.7: Счета / Компания / Команды / Доступ мастеров / Документы), `mobile/app/(dashboard)/cabinet/finance-settings/[teamId].tsx` («НДС и страна»: материализация первой правкой, превью €100, «Вернуть настройки компании»), `mobile/src/features/finances/vat-settings.ts` (`useTeamFinanceSettingsMap`, `useUpsertTeamFinanceSettings`, `useDeleteTeamFinanceSettings`; ключи `["finance-settings"]`, инвалидация сбрасывает префилл инвойсов).
- Изменить: `finances.tsx` (шестерёнка → «Настройки финансов» + «Экспорт CSV», §3.6), `invoices/new.tsx` (дефолты vat_mode/percent из `resolveEffectiveVat` по команде префилла, без команды — тенант), `TransactionPopup.tsx` (показ/правка vat у manual с дефолтом по команде строки).
- **Готово когда**: в симе тап по команде в хабе открывает её страницу; первая правка материализует строку `team_finance_settings`; «Вернуть настройки компании» удаляет строку и контролы гаснут в inherited-вид; превью пересчитывается мгновенно; подстроки хаба показывают действующие резюме («Как у компании» / «Греция · VAT 24%…»); язык документов переключается; tsc = 0.

### Слайс 11 — Миграция документов (CN + receipts)
- Создать: `mig/20260727100005_documents.sql` (§2.5: invoices.kind/parent/supply_on/cancelled, серии, `cancel_invoice`, `build_invoice_seller_snapshot(p_team_id)` + effective-note/country, таблица `receipts` + RLS + freeze + `create_receipt_for_income` + void-связка в undo/reset/refund RPC).
- Изменить: `database.types.ts` (regen).
- **Готово когда**: `cancel_invoice` порождает CN серии CN-YYYY-NNN и ставит оригиналу `cancelled` (UPDATE проходит пересозданный `invoices_status_check`); оплата записи и оплата инвойса автоматически рождают чек RC-… с exemption note ЕГО команды в снапшоте; `reset_appointment_payment` войдит чек, частичный возврат оставляет чек `issued`; платежи по CN/cancelled отклоняются.

### Слайс 12 — Клиент документов
- Создать: `shared/local/finance/receipt.ts`, `shared/db/repositories/receipts.ts` (read-only: `getReceiptByTransactionId`, `listReceiptsForAppointment/Invoice`), `mobile/src/features/receipts/{pdf.ts, queries.ts, share.ts}`.
- Изменить: `shared/db/repositories/invoices.ts` (`cancelInvoice` + контрольное чтение; удалить мёртвый `setInvoicePdfUrl`), `invoice-ledger.ts` (labels/статусы `cancelled`, kind), `mobile/src/features/invoices/queries.ts` (`useCancelInvoice`), `invoices/[id].tsx` (кнопка «Отменить инвойс», карточка CN, «Чек» у платежей), `invoices/index.tsx` (бейдж «Сторно», CN вне summary), `InvoiceStatusBadge.tsx`, `invoices/pdf.ts` (режим CN; рендер подписей по `DOC_STRINGS[tenant.document_language]`), `receipts/pdf.ts` (то же), `share-pdf.ts` (обобщение до `shareDocumentPdf`), `TransactionPopup.tsx` (строка «Чек RC-…»), `AppointmentSheet.tsx` (номера чеков у платежей), `InvoiceEditor.tsx` (`vatRate` в prefill, primary-CTA инвойса для company-счёта в `TransactionPopup`).
- **Готово когда**: в симе полная цепочка: заказ → оплата на счёт → чек (share PDF) → доход на счёт компании → primary «Выставить инвойс» → инвойс в разделе → оплата инвойса → чек об оплате → отмена другого инвойса → CN с PDF; PDF печатается на языке тенанта, exemption note — из снапшота (инвойс греческой команды печатает её note, кипрской — её); tsc = 0, все тесты зелёные.

### Слайс 13 — Страница «Финансы» для мастера
Независим от Слайсов 9–12 (VAT/документы) — может идти параллельно после Слайса 8.
- Создать: `mig/20260727100006_master_finance_rpcs.sql` (`list_team_finance_summary_safe(p_team_id, p_from, p_to)` и `list_team_transactions_safe(...)` — гейт `finance.view_page`, скоуп = команды мастера, проекции ровно под мастерскую страницу, без owner-сущностей; `record_team_expense_safe(p_team_id, p_amount, p_category_id, p_account_id, p_note, p_request_id)` — гейт `finance.create_expense`, команда ∈ команд мастера, счёт `account_serves_team` + активен, `p_account_id is null` → resolve по kind, вставка manual-expense с `master_id = current_user_master_id()`, идемпотентность по §7.8).
- Изменить: `mobile/src/features/settings/role-policy.ts` (capability `view-finances`: динамическая ветка для master по `my_finance_permissions().view_page` — сейчас статическое owner-only, :39-72), `finances.tsx` (мастерский режим: скоуп-чипы только его команд, обзор + лента, панель счетов при `see_account_balances`, «＋ Операция» — только расход и только при `create_expense`), `database.types.ts` (regen).
- **Готово когда**: мастер с `view_page` видит таб «Финансы» и данные только своих команд; без права таба нет (как сейчас); расход мастера ложится manual-expense с его master_id; CRUD счетов/категорий/инвойсов/закрытие дня мастеру недоступны; tsc = 0.

### Слайс 14 — Полировка и фиксация канона
- Изменить: `apps/mobile/docs/DESIGN-SYSTEM.md` (паттерны: глазик/агрегаты, чипы счетов, MonthStepper, документные PDF, «хаб настроек + материализация переопределения первой правкой» — календарь и финансы теперь один диалект, «превью документа в настройках», «страница доступа: секции „что видит / что может“, indent-дети, сброс к роли»), финальный аудит `halo-cobalt-check` по новым экранам, прогон 8-колоночного CSV, сим-обход всех новых поверхностей.
- **Готово когда**: чек-лист аудита чист; ни одного эмодзи/серого структурного элемента; мёртвый код снесён.

---

## 9. Открытые вопросы владельцу

1. **Helper-дефолт прав**: заложено «видит суммы, больше ничего» (lead/admin/dispatcher — всё включено). Если помощник не должен видеть даже сумм — это один CASE в `master_role_default`.
2. **Фискализация наличных**: в Греции/на Кипре приём нала может требовать фискального чека помимо нашей нефискальной квитанции — уточнить у бухгалтера каждой юрисдикции. Схему не меняет (наша квитанция остаётся), влияет только на то, нужен ли внешний фискальный аппарат/сервис.
