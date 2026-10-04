# STORY-101 — Документы по закону о VAT Кипра: юрлица, инвойс, чек, кредит-нота

**Status:** `in-progress` — план утверждён 30.09 («давай делай»), перенос —
вариант А. Этап 101a накачен 01.10 по слову владельца («накатывай всё») и
закоммичен 17dae6d7; дальше — 101b.
**Estimate:** 31 point всего → пять историй ≤ 8 (раздел «Этапы»).
**Dependencies:** STORY-088 (права); решения владельца 30.09 («чек — только у
инвойса»; дополнение «несколько юрлиц в одном аккаунте»).

**User story:** как владелец сервисной компании на Кипре с несколькими
своими юрлицами, я хочу выставлять от каждого юрлица инвойсы, чеки и
кредит-ноты, которые проходят проверку налоговой (своя сплошная нумерация у
каждого юрлица без дыр, неизменяемость, обязательные реквизиты, VAT по
позициям), чтобы документы из Babun можно было отдавать клиентам и
бухгалтеру без переделки.

**Why now:** до запуска. Сейчас серия и префикс общие на аккаунт, чек
нумеруется на аккаунт `max+1`, VAT один на документ, аннулировать можно без
кредит-ноты, номер можно перескочить вручную, бригада не знает своего
юрлица.

---

## Шаг 0 — что есть сейчас (разведка 30.09: боевая база + код)

**Юрлицо уже есть — это `companies` («Реквизиты»).** Несколько наборов на
аккаунт; поля `name`, `legal_name`, `business_address`, `vat_number`,
`reg_number` (HE), `iban`, `bank_name`, `contact_phone`, `contact_email`,
`logo_url`, `is_default`, `archived_at`, `position`; ручной счётчик
`invoice_next_number/_year`. Нет: ставки VAT по умолчанию, префиксов, признака
плательщика VAT, связи с бригадами.

**Данные.** AirFix LTD: юрлицо одно — «AirFix LTD», VAT в базе
`CY60185555555X` (тестовый), бригады Y&D (+ Test в архиве); инвойс
INV-2026-105 (оплачен), чеки `RC-2026-001…016` (часть аннулирована, часть без
инвойса). Giliuta: юрлицо «Giliuta» без VAT, бригады «Команда 1», «Команда 3»;
инвойсы INV-2026-001…004 **без юрлица** (`company_id = NULL`), два
аннулированы; чеки `RC-2026-001…014`. Кредит-нот 0.

**Как сейчас выпускается** (сервер):
- `issue_invoice` — черновиков нет, документ сразу `issued` с номером:
  advisory-lock + `next_company_invoice_number` («ручной счётчик
  реквизитов, иначе `max(seq)+1`, занятый — перешагнуть»). Префикс и
  разрядность — **на аккаунт** (`tenants.invoice_prefix/…_padding`), у двух
  юрлиц номера совпадут строкой.
- Выпущенный документ уже неизменяем (`20260922070000_issued_invoice_is_final`),
  кроме: `void_invoice` аннулирует **без кредит-ноты**; язык и `pdf_url`
  пишутся прямым UPDATE; стирание календаря обходит сторожей.
- Кредит-нота (`cancel_invoice` → `_issue_credit_note`): `CN-YYYY-NNN` на
  аккаунт, только на всю сумму, без позиций, без юрлица, только до оплаты;
  на бумаге заголовок «INVOICE».
- Чек (`issue_receipt`): `RC-YYYY-NNN` на аккаунт, `max+1`; `lpad` режет
  номер 1000 до «100»; на бумаге нет номера инвойса и способа оплаты.
- Оплата — строка журнала (`record_invoice_payment`), статусы
  `issued | paid | void | cancelled` (частичная оплата только на экране).
- Деньги: в базе `numeric`, в приложении float-евро (центы только внутри
  расчётов); VAT — один `vat_percent` на документ, у позиций ставки нет.
- Нет `service_date` (tax point). Признака «клиент-бизнес» в базе нет
  (`clients.kind` не накатан); B2B распознаётся по выбранным реквизитам
  клиента (`invoices.client_requisites_id`).
- Снимки сторон строятся сервером; `billing_address` клиента выпадает при
  чтении и не печатается.

---

## Решения

- **D1. `legal_entities` = нынешние `companies`, переименованные.**
  Таблица уже хранит ровно юрлица; переименование
  (`companies → legal_entities`, `company_id → legal_entity_id` в
  документах) делается одной миграцией вместе с переписыванием функций
  документов. Новые поля: `default_vat_rate_bp`, `vat_registered`,
  `invoice_prefix`, `receipt_prefix`, `credit_note_prefix`,
  `number_padding`. Экран «Реквизиты» становится «Юрлица».
- **D2. Бригада → юрлицо.** `teams.legal_entity_id` (NOT NULL; при переносе
  — основное юрлицо аккаунта). Запись наследует юрлицо бригады; в черновике
  инвойса юрлицо подставляется от бригады и меняется выпадающим списком; после
  выпуска — навсегда.
- **D3. Серия на юрлицо:** ключ `(tenant_id, legal_entity_id, doc_type,
  year)`. Серии разных юрлиц не пересекаются; префиксы и разрядность — у
  юрлица.
- **D4. «Плательщик VAT» — свойство юрлица** (`vat_registered`, по умолчанию
  «да»). Без VAT-номера у плательщика инвойс не выпускается (сервер). У
  не-плательщика ставка 0 и на бумаге «Not VAT registered».
- **D5. B2B = инвойс на реквизиты клиента** → VAT клиента обязателен.
- **D6. Ручной номер — только старт пустой серии** (переход из прежней
  программы), пока у юрлица в серии года нет выпущенного документа.
- **D7. Возврат по оплаченному инвойсу** = кредит-нота на сумму возврата +
  строка возврата в журнале. Чеки неизменяемы и не гасятся.
- **D8. Скидка** — отрицательная позиция со своей ставкой VAT.
- **D9. Способ оплаты в чеке:** `cash | card | bank_transfer`.
- **D10. Доступ** — как сейчас, владелец; сотрудникам — отдельной историей.
- **D11. Центы** — `bigint *_cents` в документах, позициях, чеках; журнал
  операций остаётся `numeric(…,2)` (точная десятичная), на границе
  `round(amount*100)`.

## Перенос существующих документов — выбери вариант

**Вариант А (по дополнению: «серии продолжить с текущих номеров»).**
1. AirFix LTD: юрлицо `AirFix LTD` (есть, `d8babbc5…`). Его VAT в базе
   `CY60185555555X` — ставим `CY60184450X` из дополнения (данные юрлица;
   снимок в выпущенном INV-2026-105 не трогаем — он неизменяем). Бригады
   Y&D и Test → AirFix LTD.
2. Giliuta: юрлицо `Giliuta` (есть, `4da5ae07…`); инвойсы с
   `company_id = NULL` → привязываются к нему (правило «пусто = основное
   юрлицо» уже действует в `invoice_in_series`). Бригады → Giliuta.
3. Чеки без юрлица → юрлицо их инвойса, иначе основное юрлицо аккаунта.
4. Счётчики продолжают серию: AirFix `invoice/2026 = 105`,
   `receipt/2026 = 16`, `credit_note/2026 = 0`; Giliuta `invoice/2026 = 4`,
   `receipt/2026 = 14`. Следующие: `INV-2026-106`, `RC-2026-017`.
5. Чтобы 2026 год не сменил вид посреди серии, у существующих юрлиц
   разрядность 3 и префикс чека `RC` (как выпущено); новые юрлица — `REC`,
   разрядность 4 (`REC-2026-0001`). Переключить на `REC`/4 можно с 2027.
6. Старые документы — как есть: `cancelled`/`void` без кредит-ноты, чеки без
   инвойса и аннулированные остаются историей (ограничения «чек только с
   инвойсом», «void только через кредит-ноту» — для новых строк). Деньги
   старых документов переводятся в центы точно (`round(x*100)`); их VAT
   остаётся «на итог» (`vat_scheme = 'document'`), новые — `'line'`.

**Вариант Б (по твоим словам 30.09: «всё это тестовое»).** Стираем все
инвойсы, кредит-ноты, позиции и чеки; 4 оплаты остаются в журнале обычным
доходом; все серии начинаются с 0001. Проще и чище — без «старого» режима
VAT и исключений в ограничениях.

## Схема

```sql
alter table public.companies rename to legal_entities;
alter table public.legal_entities
  add column default_vat_rate_bp int not null default 1900,   -- 19%
  add column vat_registered boolean not null default true,
  add column invoice_prefix text not null default 'INV',
  add column receipt_prefix text not null default 'REC',
  add column credit_note_prefix text not null default 'CN',
  add column number_padding int not null default 4 check (number_padding between 3 and 8),
  drop column invoice_next_number, drop column invoice_next_year;
-- уникальность префиксов не нужна: у юрлиц разные VAT, серия по ключу юрлица.

alter table public.teams
  add column legal_entity_id uuid references public.legal_entities(id);  -- NOT NULL после переноса

create table public.document_sequences (
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  legal_entity_id uuid not null references public.legal_entities(id),
  doc_type        text not null check (doc_type in ('invoice','receipt','credit_note')),
  year            int  not null check (year between 2000 and 2999),
  last_number     int  not null default 0 check (last_number >= 0),
  primary key (tenant_id, legal_entity_id, doc_type, year)
);
alter table public.document_sequences enable row level security;  -- без политик

alter table public.invoices rename column company_id to legal_entity_id;
alter table public.invoices
  alter column number drop not null, alter column year drop not null,
  alter column seq drop not null, alter column issued_on drop not null,
  add column service_date date,                    -- tax point
  add column subtotal_net_cents bigint, add column vat_cents bigint,
  add column total_cents bigint,
  add column paid_cents bigint not null default 0,
  add column credited_cents bigint not null default 0,
  add column vat_scheme text not null default 'line' check (vat_scheme in ('line','document')),
  add column issued_at timestamptz, add column issued_by uuid;
-- status: draft | issued | partially_paid | paid | void (+ legacy cancelled)
-- check: status = 'draft' ⇔ number is null; черновик обязан иметь legal_entity_id
-- unique (tenant_id, legal_entity_id, kind, year, seq) where seq is not null

alter table public.invoice_lines
  add column unit_price_cents bigint, add column net_cents bigint,
  add column vat_rate_bp int, add column vat_cents bigint, add column gross_cents bigint;

alter table public.receipts rename column company_id to legal_entity_id;
alter table public.receipts
  add column amount_cents bigint, add column balance_after_cents bigint;
-- payment_method cash | card | bank_transfer; новые чеки — с invoice_id; UPDATE/DELETE запрещены
```

## SQL-функции (definer; клиенту — только двери)

- `next_document_number(tenant, legal_entity, doc_type, year) → (seq,
  number)` — `insert … on conflict (…) do update set last_number =
  last_number + 1 returning`. Строка серии блокируется до конца транзакции:
  одновременные выпуски идут по очереди; откат выпуска откатывает и +1 —
  номер не сгорает. Клиентам не исполнима.
- `format_document_number(prefix, year, seq, padding)` — без обрезки
  (`greatest(padding, length(seq))`).
- `legal_entity_for_team(team)` → юрлицо бригады.
- `create_invoice_draft` / `update_invoice_draft` / `delete_invoice_draft` —
  черновик без номера; юрлицо по умолчанию — от бригады записи; суммы в
  центах считает сервер (`invoice_line_amounts`, зеркало TS).
- `issue_invoice(id)` — `draft → issued`: позиции ≥ 1, итог > 0; юрлицо —
  плательщик VAT с номером; B2B → VAT клиента; номер из серии юрлица;
  **снимок юрлица и клиента замораживается здесь**.
- `record_invoice_payment(id, amount_cents, method, account, paid_on,
  request_id)` — в одной транзакции: доход в журнале → чек (серия юрлица
  инвойса, `balance_after_cents`) → статус `partially_paid | paid`.
  Сумма ≤ `total − paid − credited`.
- `issue_and_settle_on_spot(id, method, account, request_id)` — «Оплачено на
  месте»: выпуск + полная оплата + чек одной транзакцией; только физлицо.
- `issue_credit_note(invoice, lines | full, reason, request_id)` — серия CN
  того же юрлица, позиции копируются, сумма ≤ `total − credited`; погашен
  полностью → `void`. После оплаты — вместе с возвратом (D7).
- `set_document_series_start(legal_entity, doc_type, year, last_number)` —
  владелец, только пустая серия (D6).
- Удаляются: `void_invoice`, `cancel_invoice`, `next_company_invoice_number`,
  `next_invoice_number`, `set_company_invoice_next_number`, `issue_receipt`,
  `void_receipt_on_refund`, `_issue_credit_note`, `resolve_company_id` →
  `resolve_legal_entity_id`.

## Неизменяемость (в базе)

- `invoices` UPDATE у не-черновика: только `status` по разрешённым
  переходам и кэши `paid/credited_cents` — из definer-функций. DELETE —
  только черновик. Язык документа выбирается до выпуска.
- `invoice_lines` — меняются только у черновика.
- `receipts` и кредит-ноты — UPDATE/DELETE запрещены.
- Стирание календаря документы не трогает.
- RLS по `tenant_id` (владелец); `document_sequences` без политик.

## Деньги и VAT (`packages/shared/src/local/finance/documents/`)

- Позиция: `net = round(qty × unit_price_cents)`, `vat =
  round_half_away(net × rate_bp / 10000)`, `gross = net + vat`; цена «с
  VAT»: `vat = round_half_away(gross × rate / (10000 + rate))`,
  `net = gross − vat`.
- Итог = сумма позиций. Ставка по умолчанию — `default_vat_rate_bp`
  юрлица, хранится на каждой позиции.
- То же в SQL; одинаковость — общий набор примеров (TS-тест + прогон в
  базе), как у материалов 30.09.

## Экран

- **Настройки → «Юрлица»** (бывшие «Реквизиты»): список по канону (свайпы,
  порядок, «Добавить юрлицо»); лист юрлица — реквизиты, логотип, «Плательщик
  VAT», ставка по умолчанию, префиксы INV/REC/CN и разрядность, старт
  серии (D6). **Бригада** (шестерёнка календаря) — строка «Юрлицо».
- **Запись → «Создать инвойс»** — черновик: юрлицо от бригады (видно и
  меняется), услуги строками, дата записи = tax point, клиент/реквизиты,
  ставка юрлица.
- **Страница инвойса по статусу:** черновик — правка, «Выпустить», «Оплачено
  на месте» (физлицо), «Удалить черновик», плашка «прошло больше 30 дней с
  даты оказания услуги»; выпущен/частично — «Принять оплату» (сумма =
  остаток, способ cash/card/bank transfer) → чек, «Кредит-нота»; оплачен —
  чеки блоком, «Кредит-нота» (возврат); аннулирован — ссылка на кредит-ноту.
- **Документы** на «Финансах» — фильтр по юрлицу, раздел «Черновики»,
  статусы «Черновик / Выставлен / Частично оплачен / Оплачен / Аннулирован».
- **PDF:** инвойс (юрлицо с VAT и HE, номер, дата выпуска, tax point,
  срок, клиент с адресом и VAT у B2B, позиции qty/цена/net/ставка/VAT,
  итоги net/VAT/gross), чек (юрлицо, номер, дата оплаты, «к инвойсу INV-…»,
  сумма, способ, остаток), кредит-нота (заголовок «CREDIT NOTE», ссылка на
  инвойс, позиции, итоги, причина).
- Составитель отдельного чека (`/documents/receipt-new`) удаляется.

## Этапы (каждый — своя история)

1. **101a — юрлица и серии в базе (8):** переименование, поля юрлица,
   `teams.legal_entity_id`, `document_sequences`, `next_document_number`,
   перенос (вариант А или Б), черновики и выпуск, неизменяемость, тесты базы
   и гонки.
2. **101b — деньги и VAT по позициям (5):** центы, ставка на позиции, TS +
   SQL-зеркало, редактор черновика.
3. **101c — оплаты, чеки, кредит-ноты, страница инвойса (8).**
4. **101d — «Юрлица» в настройках, юрлицо бригады, фильтр документов (5).**
5. **101e — PDF трёх документов (5).**

## 101a — как сделано (2026-09-30)

Миграция `20261001001000_legal_entities_document_series.sql`, прогон в откате
на боевой базе — 33 из 33 (серии Giliuta и AirFix продолжают выданные номера;
второе юрлицо — своя серия с 0001 и стартом 50; юрлицо команды; VAT без
VAT-номера — отказ без траты номера; откат возвращает номер; прямые
INSERT/UPDATE документов и строк — 42501; «void» запросом — отказ; язык
бумаги пишется; кредит-ноты и чек — в серии юрлица инвойса, повтор чека
номер не тратит; юрлицо с документами не удаляется; новая компания получает
юрлицо; стирание компании с документами проходит). Снимки сторон всех
выданных документов не изменились (отпечаток md5 до и после).

Отступления от плана — решены по ходу, одной строкой каждое:
- **D4 упрощено:** флажка «плательщик VAT» нет — плательщик = юрлицо с
  VAT-номером. Инвойс с VAT у юрлица без номера сервер не выпускает.
- **Имена колонок:** `company_id` в инвойсах и чеках пока прежние;
  переименование в `legal_entity_id` — вместе с черновиками (101c).
- **Черновики** (номер только при «Выпустить») — в 101c, вместе с
  переписыванием выпуска. До них документ, как и раньше, выпускается сразу.
- **`default_vat_rate_bp`** — в 101b (ставка на позиции).
- **Отмена:** «Аннулировать» снято с экрана, `void_invoice` отвечает отказом
  словами, прямой «void» сторож не пропускает. Исключение — стирание
  календаря (прежнее поведение; пересмотр в 101c).
- **Неизменяемость правами:** клиенту закрыты INSERT/UPDATE/DELETE
  инвойсов, строк и чеков; открыты статус (переходы сторожит триггер по
  журналу), язык и PDF. `issue_invoice` стал definer — серия клиенту закрыта.
- **Блок «Номер» бланка** (буквы, знаки, «заново каждый год») снят: префиксы
  и разрядность — у юрлица (экран — 101d), год в номере всегда. Строка
  «Следующий номер» в реквизитах правится, только пока серия года пуста.
- **Дата выпуска** пока приходит с экрана (редактор даёт её менять); в 101c
  выпуск ставит дату сервера, а дата работ становится tax point.
- **Гонка 50 выпусков** не прогнана: одно подключение MCP её не воспроизводит.
  Очередь обеспечена замком строки серии (`insert … on conflict do update`);
  скрипт гонки — на ветке Supabase или локальной базе, когда будет решено,
  где её гонять.
- AirFix VAT `CY60184450X` — правка данных (не миграция, без хардкода
  компании): ставится вместе с накатом.

## Acceptance criteria

1. У каждого юрлица аккаунта три независимые серии; номера идут подряд без
   дыр; серии двух юрлиц не пересекаются.
2. Черновик без номера и удаляется; номер — только при «Выпустить»;
   упавший выпуск номер не сжигает.
3. 50 одновременных выпусков у одного юрлица → 50 номеров подряд без
   повторов (тест гонки); выпуски у двух юрлиц не мешают друг другу.
4. Юрлицо документа подставляется от бригады, меняется в черновике,
   фиксируется при выпуске; реквизиты продавца на бумаге — из снимка юрлица.
5. Выпущенный документ нельзя изменить или удалить ни экраном, ни прямым
   запросом; отмена — только кредит-нотой.
6. Оплата рождает чек в серии юрлица с остатком после оплаты; статусы идут
   сами; переплата отклоняется; полная кредит-нота → `void`.
7. «Оплачено на месте» — INV и REC одной транзакцией.
8. Юрлицо-плательщик без VAT и B2B-клиент без VAT — не выпускаются.
9. VAT по позициям в центах; итог = сумма позиций; TS = SQL.
10. PDF каждого типа содержит все обязательные поля.

## Тесты

- **TS (node:test):** расчёт позиции (exclusive/inclusive, скидка, ставка 0,
  дробное количество, округление), итоги, остаток и статус, формат номера
  (включая ≥ 1000), «прошло 30 дней», юрлицо по умолчанию от бригады.
- **База, прогон в откате** от лица владельца и сотрудника: два юрлица в
  одном аккаунте — независимые серии; черновик без номера; выпуск → 0001,
  0002; упавший выпуск не сжигает номер; плательщик без VAT и B2B без VAT —
  отказ; оплаты частями → статусы; переплата — отказ; «на месте» → INV+REC;
  кредит-нота → void; UPDATE/DELETE выпущенного и чека — отказ; перенос
  (вариант А): счётчики = максимумы, следующий номер `INV-2026-106`.
- **Гонка:** скрипт на нескольких подключениях к копии базы (ветка Supabase
  или локальная): 50 параллельных выпусков → 1…50; подключение A берёт номер
  и откатывается — B получает тот же номер.
- **Контракты:** нет `create sequence` и `max(seq)+1` для номеров; новые
  двери в `write-requests.ts`; экран не зовёт удалённые функции.

## Files touched (по разбору кода)

| Файл | Действие |
|---|---|
| `supabase/migrations/…_legal_entities_documents_core.sql` | Create |
| `supabase/migrations/…_documents_money_vat_lines.sql` | Create |
| `supabase/migrations/…_documents_payments_credit_notes.sql` | Create |
| `packages/shared/src/local/finance/documents/{money,numbering,status}.ts` + тесты | Create |
| `packages/shared/src/local/finance/{invoice-ledger,receipt,vat}.ts` | Modify |
| `packages/shared/src/db/repositories/{invoices,invoice-payments}.ts`, `database.types.ts` | Modify |
| `apps/mobile/src/features/companies/*` → `legal-entities/*` (список, лист юрлица) | Modify/Rename |
| `apps/mobile/src/features/invoices/{InvoiceEditor,InvoiceBlocks,InvoicePaymentSheet,InvoiceRequisitesBlock,InvoiceNumberRow,InvoiceSettingsBlocks,queries,document,pdf,InvoicePaper,dictionary}.ts(x)` | Modify |
| `apps/mobile/app/invoices/[id].tsx`, `app/invoices/new.tsx` | Modify |
| `apps/mobile/src/features/invoices/CreditNoteSheet.tsx` | Create |
| `apps/mobile/src/features/documents/{ReceiptSheet,ReceiptPaper,receipt-document,receipt-pdf,receipts-queries}.ts(x)` | Modify |
| `apps/mobile/src/features/finances/{DocumentsPanel,documents,use-period-documents}.ts(x)` | Modify |
| `apps/mobile/src/features/appointments/PaymentBlock.tsx` (дверь «Инвойс») | Modify |
| бригада: страница команды в шестерёнке календаря (строка «Юрлицо») | Modify |
| `apps/mobile/src/lib/write-requests.ts` | Modify |
| `apps/mobile/app/documents/receipt-new.tsx`, `features/documents/ReceiptComposer.tsx` | Delete |
| `scripts/document-sequence-race.ts` | Create |

## Out of scope

Акт выполненных работ; журнал операций в центах; доступ сотрудников к
документам; e-invoicing и передача в налоговую; мультивалютность.

## Risks

- Переименование `companies` задевает все места, где читаются реквизиты
  (инвойс, чек, лист реквизитов) — делается одной волной с документами.
- Вариант А оставляет «старый» режим VAT и исключения в ограничениях для
  исторических строк; вариант Б — нет.
- Удаление `issue_receipt`/`cancel_invoice` ломает старые сборки TestFlight
  (сервер ответит понятным текстом).
- Гонку нельзя проверить через одно подключение MCP — нужна ветка Supabase
  (платная) или локальная база.
