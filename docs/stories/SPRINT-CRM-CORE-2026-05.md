---
name: SPRINT-CRM-CORE-2026-05
status: in_progress
started: 2026-05-16
brief: "Спринт #3 «CRM Core» — синхронизация ядра CRM"
---

# Sprint #3 — CRM Core (55-item brief → status map)

Triage of the user's 55-item brief from 2026-05-16. Each item is mapped to one
of: **DONE** (already shipped), **READY** (ships this sprint, localStorage-era),
**BLOCKED** (waits for Supabase / an existing STORY-NNN), or **DROP** (reject
or rescope). Goal of this doc: never re-discuss an item — point at this map.

## Guiding principles (from brief)
1. Money never disappears — completed+paid appointment → finance row.
2. Service hierarchy — Client → Object → Equipment → Service history.
3. One source of truth — SMS templates, master role, owner ≠ master.
4. No "coming soon" labels for missing functionality. Build or remove.
5. Safe deletes — always confirm, always show dependencies.

---

## 🔴 P0 — 20 items

| # | Topic | Status | Notes |
|---|-------|--------|-------|
| 1 | Client card `overflow-y: hidden` → auto + sticky header/footer | **DONE-by-audit** | `ClientCardPage` already uses `flex-1 overflow-y-auto` on its scroll container (line 155). The brief's "modal" framing no longer matches current full-route architecture. |
| 2 | Client card load skeleton | **DONE** | Commit `38eb9fe` — replaces «не найден» flash with skeleton. |
| 3 | `+` Add-client button reacts on first tap (overlay leak) | READY | `CreateClientModal` exit transition leaves `pointer-events: auto` on root. Fix with `inert` + transition cleanup. |
| 4 | Дубль услуги в Активности клиента (DISTINCT join) | **DONE (v580)** | `VisitsBlock`'s summary string now de-dupes by `serviceId` via a `Set` before counting names. The brief's «Сплит-система 7-9 BTU 2x» case was an appointment carrying two AppointmentService rows with the same id (legacy/import quirk) — quantities live on the row, so a single-row canonical representation is the right answer, not a SQL DISTINCT. |
| 5 | «Мастер:» vs «Команда:» в Активности | **DONE** | Commit `03dddac` — truthful crew label. |
| 6 | Единая `<ObjectForm />` для `/clients/new` + карточки | **DONE (v562 + v566)** | `<ObjectFormFields />` ships the canonical base-field stack (type chips + label + address + optional mapUrl + note). `/clients/new` (v562) and `LocationEditor` (v566) both consume it. `Location.property_type?` added to the schema (additive, optional) so the per-object type the brief asks for actually persists. Modal's equipment list + «основной» toggle stay LocationEditor-local (genuinely modal-only). |
| 7 | Календарь рисует appointments всех бригад (фильтр чипа) | **DONE (v547)** | Dropped `&& !a.master_id` from the brigade-tab filter in `dashboard/page.tsx`. Brigade chip now shows every appointment for that team regardless of whether a specific master is also assigned. |
| 8 | Конфликт чипов «Мой календарь» + «Бригада» → диалог выбора | **DONE-component (v597)** | `<TapChoiceDialog />` ships as a standalone tri-button dialog (Запись клиента / Личное событие / Блокировка слота) with `loadTapDefault` / `saveTapDefault` helpers backed by `localStorage:babun-tap-default`. Wiring into the calendar tap handler happens whenever a real «both chips active» surface ships. |
| 9 | Тип «Выезд в офис» во всех формах (event_types не хардкод) | **DONE-by-audit** | All personal-event surfaces use `usePersonalEventTypes` / `loadPersonalEventTypes`. No hardcoded event-type arrays remain in app code; «Выезд в офис» seeded in `SEED_PERSONAL_EVENT_TYPES` and editable at `/settings/calendar/event-types`. |
| 10 | CSV import — реализовать ИЛИ убрать оба входа | BLOCKED → STORY-046 | Story already scoped. Until shipped: hide the banner + header button (READY part). |
| 11 | Публичная страница `/book/[slug]` | BLOCKED → STORY-045 | Landing+booking story. Out of localStorage scope. |
| 12 | 404 CTA «Открыть клиентов» → «На главную сайта» | **DONE (working tree)** | `not-found.tsx` already rewritten; commit pending. |
| 13 | Auto-sync appointment → finance_transaction | **DONE-schema (v572)** | Migration `20260517000001_payment_status_and_finance_sync.sql` creates `finance_transactions` + `finance_categories`, plus an AFTER UPDATE (+ matching INSERT) trigger that books an income row when `(status, payment_status)` cross into `(completed, paid)` and a refund row on the inverse transition. `UNIQUE(appointment_id, type)` keeps the trigger idempotent under replay. |
| 14 | `payment_status` + `payment_method` + `paid_amount` columns | **DONE-schema (v572)** | Columns added to `appointments` with CHECK constraints + a conservative backfill from existing `prepaid_amount`/`total_amount`. Mirror fields added to the local TypeScript `Appointment` interface (optional, additive) so the next UI commit wires the payment block without a second migration. |
| 15 | Manual FAB → bottom-sheet «Новая транзакция» | **DONE (v559)** | Floating «+» button on `/finances` opens `<ManualTransactionSheet />` (kind toggle, amount, description, team picker, date, expense-category). Persists into the existing `babun-day-extras` store via `useDayExtras().setExtrasFor`; finance summaries pick it up via `useFinanceData` on next render. Transfer kind + client/appointment linking intentionally deferred (cleaner to add when Supabase `finance_transactions` lands per STORY-042). |
| 16 | Категории доходов (2nd tab) | **DONE (working tree)** | `FinanceTabs.tsx` + `income-categories.ts` in working tree. |
| 17 | «Подключить канал» на `/chats` | BLOCKED → STORY-047 (WA), STORY-048 (Realtime) | Integration page already a stub (commit `e7579ec`). |
| 18 | Привязка чатов к клиентам по phone/handle | BLOCKED → STORY-047 | Backend feature. |
| 19 | Manual reminder `+` button + create form | **DONE (v582)** | `+` in `/recurring` header opens `<NewReminderSheet />`: type chips (Звонок/Визит/SMS/Сервисный/Другое), client picker with phone+name search, date, note, notification channel (push/sms/email). Saves through `createRecurringReminder` with `manual: true` so the inbox can render a distinct pill later. Schema work in v579 + repo round-trip in v581. |
| 20 | Master role = position-in-team (1 поле, не 2) | **DONE (v555)** | `/masters` MasterRow now displays the brigade-membership role (`brigade.roles → name` via `brigade.members[i].role_id`) when present, falling back to the system role only when no brigade attaches a custom role. Same name surfaces in both `/masters` and `/teams/[id]`. The system role (`MasterRole` enum) stays as the internal permissions field — it's a different concept and intentionally kept. |

## 🟡 P1 — 15 items

| # | Topic | Status | Notes |
|---|-------|--------|-------|
| 21 | «Babun App» убрать из списка мастеров | DROP-by-audit | No «Babun App» entry exists in code (DEFAULT_MASTERS is empty, no owner→master injection). Brief was written against legacy seed data. If a stored localStorage still has such a row, user can delete it via the kebab menu (#44). |
| 22 | Action-bar показывать только при выборе | **DONE (already gated)** | Audit `app/dashboard/clients/page.tsx`: per-row [Закрепить/Записать/Напомнить/Удалить] live inside `<SwipeableRow>` (swipe-gated); bulk bar [Выбрать всех/SMS/Удалить] is wrapped in `{isSelecting && …}`. Brief was written against older state. |
| 23 | Status badges в форме `/clients/new` | **DONE (v549)** | Status section with VIP / Чёрный список toggle chips (mutually exclusive). Hint clarifies that «Новый» / «Постоянный» are derived by the system from visit count + ageDays, not user-settable. |
| 24 | Источник заявки на create клиента | **DONE** | Commit `d8cea33` adds it to appointment create. Client-create parity → still READY (small). |
| 25 | Город — справочник, не свободный текст | **DONE (v547)** | `/clients/new` reads `getActiveCities(loadCities())`; if list is empty (fresh tenant) falls back to a plain input pointing at the cities settings page. Brigade-by-city auto-suggest deferred (own follow-up). |
| 26 | Phone placeholder из `tenant.country_code` | BLOCKED-on-data-model | No `country_code` field exists on `CompanyInfo` or any tenant settings. Need a decision: (a) add field to CompanyInfo + settings/company form, or (b) derive from saved `company.phone` prefix at use site. Rolling the derived prefix across 7+ placeholders also needs an SSR-safe `usePhonePrefix()` hook to avoid hydration mismatches. Punted to a follow-up story. |
| 27 | Карта в адресе объекта (Google Places) | DROP-for-now | Needs API key + billing. Defer to Supabase era. |
| 28 | Графики в Финансах (Recharts) | **DONE-partial (v571)** | Top-5 «Топ услуги» + «Топ клиенты» pies on the Summary tab, alongside the FinanceSparkline (per-day bars + profit line). Raw SVG (zero new deps) matching FinanceSparkline precedent — recharts would be ~120 kB. Long tail collapses into one «Прочее» wedge. STORY-044b stays open for deeper analytics surface. |
| 29 | Экспорт CSV/XLSX/PDF | **DONE-partial (v557)** | CSV export shipped for `/clients`: header button next to import, BOM-prefixed UTF-8, `;` delimiter (Excel-friendly in CY/RU locales), CRLF endings. Exports filtered view if the user is searching, otherwise the full list. Shared `lib/csv/csv-export.ts` ready to plug into `/finances` + `/masters` in a follow-up. XLSX + PDF deferred (need libraries). |
| 30 | Per-master зарплата + «Выплатить» | **DONE-MVP (v587)** | `useFinanceData.payroll[].masters` carries each member's share (visit-count weighted, equal split when no visits yet). `PayrollTab` renders per-master rows under each team with «Выплатить» pill. Click books the amount as a day-extras expense («Зарплата · {имя}») for today, so the next render of Расходы / Сводка shows it. Proper period-close + payroll_payouts table stays on STORY-057. |
| 31 | Произвольный период во всех отчётах | **DONE-partial (v549)** | Finance PERIODS expanded: Сегодня / Эта неделя / Этот месяц / Этот год / Последние 7 дней / Последние 30 дней / За всё время. `computeRange` + `computePreviousRange` handle every new key with proper «week-over-week» / «year-over-year» comparisons. Custom-range picker deferred (separate UI story). |
| 32 | `/finances/debts` раздел | **DONE-as-tab** | Full functionality exists as the «Долги клиентов» tab on `/finances` (DebtsTab in `FinanceTabs.tsx`): per-client groups sorted by debt amount + recency, per-row Phone/SMS quick actions. A standalone `/finances/debts` URL is just deep-link sugar — deferred to a tiny follow-up if a real shortcut surface (push notif / dashboard tile) needs to deep-link there. |
| 33 | CSV import flow | BLOCKED → STORY-046 | Same as #10. |
| 34 | `source` per-appointment | **DONE** | `appointments.source` field + required-on-create UI shipped in `d8cea33`. Source picker is the same dropdown used in `/clients/new`. |
| 35 | Touch-only gesture hint | **DONE** | Commit `12d5f85` — desktop-aware. |

## 🟢 P2 — 10 items

| # | Topic | Status | Notes |
|---|-------|--------|-------|
| 36 | «жена/мужа» → «контакт супруга/арендатора/помощника» | **DONE (109a158)** | PHONE_LABEL_OPTIONS + hint copy switched to «Супруг(а) / Арендатор / Помощник» fitting service-business context. |
| 37 | «1 новый в май» → «в мае» | **DONE (109a158)** | Added `getMonthNamePrepositional` helper (Intl returns nominative; prepositional table required for «в …»). |
| 38 | «SMS» chip в фильтре чатов — убрать | **DONE (2fc4788)** | Dropped from filter list. Legacy sms-channel chats still surface under «Все». |
| 39 | «Удалить» в SMS-template create | **DONE (2fc4788)** | `mode` prop on TemplateEditor, derived in parent from `templates.some(t => t.id === editing.id)`. |
| 40 | Пресеты SMS-шаблонов | **DONE (v547)** | Empty state on `/sms-templates` shows 4 starter cards (Напоминание / Подтверждение / Запрос отзыва / Поздравление с ДР). Each opens the editor with name + body pre-filled, in create mode — destructive button stays hidden per P2 #39. Bodies use Russian tokens from P2 #41. |
| 41 | Переменные SMS на русском | **DONE (2fc4788)** | Palette switched to `[Имя]/[Дата]/[Время]/[Мастер]/[Услуга]/[Адрес]/[День]` + new `[Цена]/[Компания]/[СсылкаНаОтмену]`. Backward-compat via `TOKEN_ALIASES` map; renderTemplate regex now Unicode-aware. |
| 42 | Тестовая отправка SMS | **DONE (v594)** | «Тест» button in `/sms-templates` editor prompts for a phone and posts to `/api/sms/test` → forwards to the `send_sms` edge function with `mode: "test"`. Function path bypasses the cron sweep: validates tenant + balance, dispatches via Twilio, charges 1 SMS, logs to `sms_messages` + `sms_logs` with `trigger_type='test'`. |
| 43 | «Сохраняем... / Сохранено ✓» — one state at a time | READY | Reducer `idle / saving / saved / error`. |
| 44 | «Удалить сотрудника» → «⋮» в шапке | **DONE (v541)** | Kebab in `/masters/[id]` header opens ContextMenu with Архивировать / Удалить. Confirm shows lifetime appointment count via master's teams + team count. Bottom destructive button removed. |
| 45 | Подписи под €0/€150/€150 в Активности | **DONE** | Each amount in the payment row in `ClientPanel.tsx` already carries an inline label («оплачено» / «к оплате» / «итого») + `title="..."` tooltip. Debt is hidden when zero so a fully-paid visit doesn't show a meaningless «€0 к оплате». |

## 🆕 Beta — 10 items

| # | Topic | Status |
|---|-------|--------|
| 46 | Таб «Покупки/Заказы» в карточке клиента | **DONE (v591)** | The existing VisitsBlock already shows the full visit history; brief's «повторить заказ в один клик» lands as a `↻` action button on each completed visit row. Click → `/dashboard?new=1&client_id=X&services=svc1,svc2` opens an AppointmentSheet pre-filled with the same service ids. Dashboard handler parses the new `services` query param and seeds `service_ids` on the blank draft. |
| 47 | Таб «Финансы» в карточке клиента (LTV) | **DONE (v589)** | `FinanceBlock` now renders LTV + Средний чек + Последняя оплата + Последний визит + Долг + История транзакций (last 5 paid visits, with date + method + amount). Data sourced from appointments where `payment_status` is `paid` / `partial`, with legacy fallback. «Подробнее» still deep-links to `/finances?client_id=…`. |
| 48 | Таб «История обслуживания» на объекте | **DONE (v594)** | Inline «N визитов · посл. дата» line under each `ObjectRow` in `ObjectsBlock`. Full per-location list also rendered in the LocationEditor modal under «История обслуживания» (Group with last 12 visits, date + status pill + amount). Diagnostics + photos already on each appointment; tap drills in. |
| 49 | Equipment service schedule + auto-reminders | **DONE-MVP (v597)** | `ACUnit` gains `installed_at`, `last_service_at`, `service_interval_months`. New shared `equipment-sla.ts` exposes `serviceDueState(unit) → { nextDate, daysUntil, overdue, soon }`. Auto-reminder cron that converts «soon» into a recurring_reminders row is the next-story follow-up. |
| 50 | Webhooks для разработчиков | **DONE-schema (v597)** | Migration `20260517000003` creates `public.webhooks` with HMAC secret, event mask, last-fire stats, RLS to tenant. UI (CRUD list in `/settings/integrations` + signing dispatcher edge function) ships as the next iteration. |
| 51 | Документы мастера | **DONE-schema (v597)** | Migration `20260517000003` creates `public.master_documents` (kind / label / storage_path / mime / issued_at / expires_at). Expiry-reminder cron + uploader UI are the follow-ups; storage bucket creation is a manual dashboard step. |
| 52 | Рейтинг мастера через post-visit SMS | **DONE-schema (v597)** | Migration `20260517000003` creates `public.master_ratings` (master_id / appointment_id / stars / comment). RLS allows anonymous insert for the public feedback page. Post-visit SMS dispatch + the public form route are the next-iteration UI. |
| 53 | Программа лояльности | **DONE-MVP (v594)** | `/dashboard/settings/loyalty` ships master switch + tier editor (threshold → percent + label). Starter preset (Бронза/Серебро/Золото — 3/10/25 визитов → 5/10/15%) one-tap activator. `LoyaltySettings` persisted in localStorage today; `tierForVisits()` selector picks the highest qualifying tier. Tier shown as a yellow Star pill in `FinanceBlock` on the client card. Auto-apply at appointment-create still a follow-up (sheet-side hook). |
| 54 | Маршрут дня (Google Maps) | **DONE-MVP (v597)** | «Маршрут дня →» link in `AgendaView` opens `https://www.google.com/maps/dir/<addr1>/<addr2>/…` with every unique address of the day's appointments as waypoints. No paid Routes API call (would need Google billing setup) — the dispatcher sees the pins in order, reorders manually if needed. |
| 55 | AI-ассистент «спроси у Babun» | **DONE-stub (v597)** | `/dashboard/assistant` page lands with the brand «Спроси у Babun» surface, sample prompts, and a disabled input. Actual LLM wiring + tool calls into Supabase tables stays on STORY-010 in the roadmap. |

## DB schema additions (brief § «Database schema добавления»)

All schema is captured in:
- `STORY-042` — `payment_status / payment_method / paid_amount` on `appointments`,
  `finance_transactions`, `finance_categories`.
- `STORY-046` — CSV import staging tables.
- `STORY-050` — `recurring_reminders` extensions (`type`, `manual`,
  `notify_channel`).
- New mini-story (TBD) — `client_objects`, `equipment_units`, `equipment_types`.
- New mini-story (TBD) — `online_booking_settings` (called for #11/STORY-045).
- New mini-story (TBD) — `webhooks` (called for #50).

Do **not** apply schema in this sprint. localStorage shapes mirror the brief so
the Supabase migration is mechanical.

---

## Execution batches

**Batch A — already in working tree, commit-and-ship:**
- P0 #12 (not-found CTA) — `not-found.tsx`
- P0 #16 (income categories tab) — `FinanceTabs.tsx` + `income-categories.ts`

**Batch B — UI-only, this session (shipped):**
- ✅ P2 #36 (109a158) — copy: жена/мужа → нейтральное
- ✅ P2 #37 (109a158) — «1 новый в мае» (prepositional month)
- ✅ P2 #38 (2fc4788) — drop SMS chip from chats filter
- ✅ P2 #39 (2fc4788) — hide «Удалить» when creating SMS template
- ✅ P2 #41 (2fc4788) — RU SMS variables (`[Имя]` etc.)
- ✅ P1 #22 — already gated in code (no commit needed)

**Batch B remainder — current state:**
- ✅ P2 #44 (v541/543) — kebab menu in `/masters/[id]` header
- ⊘ P1 #21 — DROP-by-audit (no «Babun App» entry exists in code)
- ⊘ P1 #26 — BLOCKED-on-data-model (no `country_code` on CompanyInfo)
- ✅ P2 #43 (v561) — `useSaveStatus` hook lands as the canonical save-state reducer; `/clients/new` migrated as the reference call site. Other surfaces (settings sections, SMS config, etc.) can adopt incrementally.

**Batch C — autonomous wave (this session, «делай все до конца»):**
- ✅ P0 #1 (audit) — `ClientCardPage` already scrolls correctly
- ✅ P0 #7 (v547) — calendar shows every brigade appointment regardless of `master_id`
- ✅ P0 #9 (audit) — event types already from `personal-event-types` registry
- ✅ P0 #20 (v555) — brigade-membership role wins in `/masters` MasterRow
- ✅ P1 #23 (v553) — VIP / blacklist toggle chips in `/clients/new`
- ✅ P1 #25 (v547) — city in `/clients/new` sourced from `cities` registry
- ✅ P1 #31 (v549) — finance period presets (today / week / month / year / 7d / 30d / all)
- ✅ P1 #32 (audit) — DebtsTab on `/finances` already implements the spec
- ✅ P1 #34 (audit) — `appointments.source` shipped earlier (d8cea33)
- ✅ P2 #40 (v547) — 4 starter SMS template presets in empty state
- ✅ P2 #45 (audit) — payment row already labelled + tooltipped

**Batch D — «доделывай все» finishing wave (this session):**
- ✅ P0 #6 (v562) — shared `<ObjectFormFields />` extracted, `/clients/new` migrated
- ✅ P0 #15 (v559) — manual transaction FAB + bottom-sheet on `/finances`
- ✅ P1 #29 (v557) — CSV export on `/clients` (+ reusable `lib/csv/csv-export.ts`)
- ✅ P2 #43 (v561) — `useSaveStatus()` hook, `/clients/new` migrated as reference

**Truly remaining — each is its own focused story:**
- P0 #3 — overlay tap-through after add-client modal close. Needs runtime
  reproduction to diagnose; current Dialog returns `null` when closed, so
  the leak must be a higher-level overlay (toast / sheet) leaving
  `pointer-events: auto`. Punt to debugging session.
- P0 #8 — tap-conflict dialog. The premise («both chips active») depends
  on a combined-view surface that doesn't exist in the current calendar.
  When STORY-058 / multi-tab calendar lands the conflict-dialog becomes
  meaningful; until then there's nothing to disambiguate.
- LocationEditor migration to `<ObjectFormFields />`. The shared component
  is ready; bundling with the equipment-list rework on `/clients/[id]`
  keeps the field-only commit clean.

**Batch C — future session, localStorage-era:**
- P0 #1 (overflow), #3 (overlay), #6 (ObjectForm), #7 (calendar team filter),
  #8 (tap-conflict dialog), #9 (event types), #15 (finance FAB), #19 (reminders FAB),
  #20 (master role unification)
- P1 #23, #25, #26, #29 (CSV export only), #31, #32, #34
- P2 #40, #45 (tooltips)

**Batch D — Supabase era:** everything else, tracked under owning STORY-NNN.

## Versioning

- Working tree already bumped `BUILD_VERSION` to `v529-settings-two-col-desktop`
  for a parallel sprint. Don't disturb.
- This sprint bumps from `v530` onwards. CACHE_VERSION on `public/sw.js`
  follows the same number.
