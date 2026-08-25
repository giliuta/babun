# Babun Mobile — Port Specs (recon 2026-06-26)


## Appointment Booking Flow — effort L

The appointment booking flow is the core workflow for creating and editing service visits. The web implementation uses a unified bottom-sheet modal (AppointmentSheet.tsx, 1202 lines) that handles both create/edit modes and work/event kinds. It manages client selection, service multi-selection with qty/price, date+time with live duration recalc, location from client objects, global discount, optional address/notes, photo uploads, SMS reminders, and payment completion. Finance income syncs to Supabase on completion. Offline sync via localStorage. The modal is driven by 18+ state variables coordinating between six sub-pickers (client, service, time, photos, payment, repeat-reminder) and triggers handlers for save/reschedule/cancel.

**Shared fns available:**
- listAppointments(supabase, tenantId) → Promise<Appointment[]>
- getAppointment(supabase, id, tenantId) → Promise<Appointment | null>
- createAppointment(supabase, input: Appointment, tenantId) → Promise<Appointment>
- updateAppointment(supabase, id, patch: Partial<Appointment>, tenantId) → Promise<Appointment>
- deleteAppointment(supabase, id, tenantId) → Promise<void>
- listPhotosForAppointment(supabase, id) → Promise<AppointmentPhotoRecord[]>
- appointmentTotal(services, globalDiscount?) → number
- totalDuration(services) → number
- applyDiscount(base, discount) → number
- getAppointmentColorKind(apt, validation, now?, propertyType?) → AppointmentColorKind
- buildSavedWorkAppointment(input: BuildWorkAppointmentInput) → Appointment
- buildCompletedAppointment(apt, payment) → Appointment


**Data-layer gaps:**
- useAppointments() query hook exists (mobile/features/calendar) but missing useCreateAppointment/useUpdateAppointment/useDeleteAppointment mutations
- useClients, useServices, useTeams, useMasters hooks exist but mobile needs compound hook: useAppointmentContext() wrapping all 4 + cities + active-team selection
- No RN-native date/time picker integration — web uses wheels (TimeWheels.tsx) but RN needs DatePickerIOS or cross-platform library
- Photo capture + upload to Supabase Storage — web path uses AppointmentPhotoRecord + repos/appointment-photos, mobile needs camera integration + RN File handling
- No SMS reminder template preview/edit in mobile stub (web has renderReminderPreview helper)
- Validation layer: web uses loadRequiredFields + validateAppointment, mobile needs same config loading from localStorage


**UI sections:**
- Header: mode badge (create/edit) + close(X) button + color-picker accent override (optional)
- Team/city chip row (read-only, mirrors web caption)
- Time picker row: date · time_start–time_end chip, all-day toggle
- Client selection: card with name+phone, recent chips strip, +new button, tap opens ClientPickerSheet
- Location (object) selection: grouped under client, pulls from client.locations, shows label+address
- Services list: add row (opens ServicePickerSheet), per-line qty spinner + price override (long-press), total duration+price summary
- Global discount editor: fixed|percent radio, amount input, reason text, calculated subtotal
- Address bar: text input, optional (derives from location OR manual override)
- Address note (crew code): short text, 1-line
- Comment: multi-line text for dispatcher notes (NOT auto-filled service summary per v607)
- Payment block (edit-mode only): shows total_amount, tap to open PaymentSheet (cash/card/split/invoice selector)
- Cancel toggle + reason text (edit-mode only, shows when cancelled)
- Reschedule/repeat-reminder buttons (edit-mode only, bottom actions)
- Save button: sticky footer, shows live preview (date · time · duration · total) when ready, hints missing fields



**Mobile adaptations:**
- Bottom-sheet modal (RN use react-native-bottom-sheet or similar) replacing web's fixed overlay + 92vh dialog
- Date/time pickers: DatePickerIOS for iOS, or cross-platform library (react-native-date-picker); wheel spinners too complex for mobile
- Client picker sub-sheet: modal within modal (nested sheet), not portal-fixed overlay
- Service picker: scrollable list with qty stepper + price override gesture (long-press → edit popup)
- Photo picker: launches camera OR photo library via expo-image-picker; thumbnails in horizontal FlatList
- Payment sheet: bottom sheet variant, payment-method selector, cash/card amount split inputs with numpad
- Address input: text + map-intent (long-press opens Apple Maps / Google Maps with coordinates if available)
- Keyboard: SafeAreaView wrapping sheet body so fields above virtual keyboard stay visible (iOS/Android gesture)
- No swipe-down close gesture (web removed it too per STORY audit); only X button confirms unsaved changes
- Form state: 18 useState setters → consider extracting to useReducer or Zustand slice to avoid prop drilling through sub-pickers
- Offline: leverage expo-sqlite + sync queue for create/update before Supabase available


**Risks:**
- Form state explosion: AppointmentSheet manages 18+ independent state setters (date, time_start, time_end, clientId, locationId, services[], discount, comment, etc.) — without a reducer or context this becomes hard to maintain and pass through sub-picker callbacks. Consider useReducer or Zustand for AppointmentFormState.
- Sub-picker modal nesting: web uses portal-fixed dialogs (ClientPickerSheet, ServicePickerSheet, PaymentSheet) that render outside the main sheet's DOM. RN bottom-sheet libraries may not support nested sheets cleanly — test interaction first (sheet-within-sheet z-order, gesture conflicts, back-button handling).
- Time picker complexity: web's UnifiedTimePopup + TimeWheels + WheelColumn trio (line 180–1197, complex math for minute/hour/day wheels) — mobile needs a simpler DatePickerIOS replacement. Risk: operator confusion if the native picker UX differs (e.g., 30-min slot granularity on wheels must be enforced in the time picker too).
- Live duration recalc: web effect re-calculates time_end on every service-list change (line 516–540). RN must mirror this: when services change, auto-extend end time UNLESS operator touched duration explicitly (durationTouched flag). Easy to break if the flag isn't reset on sheet-open.
- Offline sync: web uses localStorage + a hypothetical sync queue (mentioned but not shown in code). Mobile uses expo-sqlite. The queuing strategy (INSERT→pending→retry) must be designed to handle half-saved sub-documents (photos, services array, payments). Conflict resolution on re-sync is non-trivial.
- Photo storage: web offloads photos to appointment-photos repo + Supabase Storage (STORY-049). Mobile must do the same but with native camera/library access + upload progress feedback. Fallback for offline: store base64 in expo-sqlite, sync blobs later.
- Double-booking detection: web loads all appointments on sheet-open and checks overlap locally (line 466–485). Mobile should do the same, but the sync delay (network+storage) means a stale list could miss a concurrent booking. Consider real-time listener (Supabase subscribe) to update the list live.
- Payment status enum: web added explicit payment_status field (unpaid|partial|paid|refunded) + payment_method (cash|card|transfer|other). Mobile must persist these correctly when syncing — mismatch will break financial reports.
- Address resolution: when client location is picked, address auto-fills from location.address (or falls back to label/mapUrl). If the client has no locations, the form must allow manual address entry. Test the fallback path.
- Service catalog sync: useServices hook pulls is_active=true + order by position. Mobile must handle catalog updates (service rename, price change, deletion). Existing appointments reference service_ids; if a service is deleted, the appointment still has the id but no name. Graceful degradation needed (show id or 'unknown service').


**Proposed files:**
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/appointments/queries.ts (create/update/delete mutations + useAppointmentForm context hook)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/appointments/AppointmentSheet.tsx (main modal, ~400 lines, unify state logic)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/appointments/ClientPickerSheet.tsx (sub-modal for client+location selection)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/appointments/ServicePickerSheet.tsx (service list + qty/price editor)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/appointments/TimePickerSheet.tsx (date + time_start/time_end, all-day toggle)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/appointments/PaymentSheet.tsx (cash/card/split/invoice, amount split)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/appointments/PhotoPickerSheet.tsx (camera + library, upload to Storage)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/appointments/DiscountEditor.tsx (fixed|percent radio, amount, reason)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/appointments/CancelReasonSheet.tsx (toggle + reason text)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/components/AppointmentCards.tsx (reusable info cards: client, location, services, total, nav, notes)


## Chats: Thread + Composer (Message rendering, reply, composer input, quick replies, persistence) — effort M

The web chats page (ChatDetailView, 400+ lines) renders a thread with grouped messages, reply quoting, star/delete context menus, multiline composer with photo/quick-reply buttons, and language-aware quick-reply templates. The data model (Chat/ChatMessage) is fully shared and portable. The only blocker is that loadChats/saveChats call window.localStorage directly instead of the getStorage() abstraction already in place; once refactored, persistence works on mobile via MMKV. The thread UI is straightforward FlatList (inverted) + bubble components + composer at bottom—follows established RN patterns in the codebase.

**Shared fns available:**
- Chat, ChatMessage, ChatChannel types from packages/shared/src/local/chats.ts
- loadChats(), saveChats(), getTotalUnread(), seedDemoChats(), createBlankChat() from chats.ts
- CHANNEL_LABELS, CHANNEL_COLORS enums from chats.ts
- QUICK_REPLIES array, detectLanguage(), Lang type from packages/shared/src/common/utils/quick-replies.ts
- getStorage(), setStorage() from packages/shared/src/storage/index.ts
- generateId('msg'), generateId('chat') from packages/shared/src/local/masters.ts
- formatTimeAgo(), formatDateLabel() helpers (pure JS, must be ported or exported)


**Data-layer gaps:**
- Refactor chats.ts loadChats/saveChats: replace window.localStorage with getStorage().getRaw/setRaw (~15 lines, shared file)
- Photo attachment handler: expo-image-picker wrapper (Phase 8; stub with permission prompt for MVP)
- Message grouping & time formatting helpers: extract or ensure exported from chats.ts


**UI sections:**
- Chat thread header: channel avatar + contact name + last_seen time + ⋮ menu (pin/create-client/book/close/archive)
- Client link banner: green (linked) or blue (unlinked) with card CTA
- Messages area: FlatList (inverted), grouped by date, date-separator chips, message bubbles (in/out asymmetric radius)
- Message bubble types: text + photo (base64 img tag) + reply (quoted parent truncated) + star (⭐) + timestamp (HH:MM ru-RU) + status-checks (double tick)
- Context menu: long-press modal with Reply/Copy/Star/Delete options
- Reply bar: compact preview of parent message, close button
- Quick reply sheet: modal (not bottom-sheet, needs space), search input, 3 lang tabs (RU/EN/EL), template list with emoji/title/preview
- Composer: flex-row with photo button (camera) + quick-reply button (lightning, orange) + multiline TextInput + conditional send/mic button, Enter sends (no Shift+Enter)



**Mobile adaptations:**
- FlatList instead of overflow-y-auto, use inverted={true} to avoid scroll jank; render messages in reverse order
- expo-image-picker instead of file input; Phase 8 stub: Pressable → permission prompt, no actual picker
- Bottom-sheet or Modal for context menu (long-press on bubble) instead of fixed position
- Modal (fullscreen) for quick-reply sheet instead of centered div; adjust padding for phone viewport
- Swipeable (gesture-handler) instead of SwipeableRow web lib for pin/archive swipe actions
- KeyboardAvoidingView wrapper to lift composer above soft keyboard
- Pressable onLongPress for context menu instead of onContextMenu + preventDefault
- Router params [id] deep linking instead of query strings (?chat_id=X)
- BlurView (expo-blur) optional for header backdrop (can skip for MVP, use solid bg)
- BottomSheetModal or Modal for client panel (bottom sheet, 90vh height) vs side panel (web-only)
- onSubmitEditing + custom key handling for Enter → send, test Android IME separately



**Proposed files:**
- apps/mobile/app/(dashboard)/chats/_layout.tsx
- apps/mobile/app/(dashboard)/chats/index.tsx
- apps/mobile/app/(dashboard)/chats/[id].tsx
- apps/mobile/src/components/ui/ChatBubble.tsx
- apps/mobile/src/components/ChatComposer.tsx
- apps/mobile/src/components/QuickReplySheet.tsx
- apps/mobile/src/hooks/useChats.ts


## Finances — effort L

The Finances module provides a comprehensive ledger of income, expense, transfer, and refund transactions scoped per-brigade (team). The web implementation has a locked v5 design (per-team scope bar, period picker with presets/custom range, overview cards showing accounts/income/expense/debt/profit, and a scrollable transaction feed). Mobile currently has a minimal year-long view with static totals. The port requires building parity controls: period selection (presets + date range picker), team scope switcher, overview metrics (accounts balance, income/expense/profit totals, debt), transaction grouping by day, and a 3-tap entry form (Доход/Расход/Перевод). Core compute logic is portable; data layer already supports brigade filtering and date ranges.

**Shared fns available:**
- computePeriodTotals(transactions, appointments, brigadeFilter, fromDate, toDate) → PeriodTotals: income, expense, profit, expectedProfit, debt
- computeFinancials(input: ComputeFinancialsInput) → ComputeFinancialsResult: incomeLines[], expenseLines[], totals, payment methods
- breakdownByBrigade(transactions, brigadeIds) → BrigadeRow[]: per-team income/expense/profit
- groupByDay(transactions) → DayGroup[]: date, transactions[], net
- filterTypes(transactions, types) → FinanceTransaction[]
- signedAmount(tx) → number: sign-aware balance impact
- isIncomeLike(tx), isExpense(tx): type guards
- computeAccountBalance(account, transactions) → number
- getPeriodRange(selection: PeriodSelection) → PeriodRange: from/to YYYY-MM-DD
- PERIOD_LABELS, PERIOD_BLOCKS, PERIOD_ORDER: constants for UI
- accountDisplayName(account, brigadeName?) → string
- formatEUR(cents) → string: money formatting
- centsToEur(cents) → number


**Data-layer gaps:**
- useFinanceTransactions(tenantId, range, opts): React Query hook wrapping listTransactionsForRange(supabase, tenantId, from, to, {brigadeIds?, accountIds?, categoryIds?, clientIds?, types?})
- useAccounts(tenantId): hook for listAccounts(supabase, tenantId, {includeInactive?})
- useAccountBalances(tenantId): hook for listAccountBalanceDeltas(supabase, tenantId) → Map<accountId, delta>
- useFinanceCategories(tenantId): hook for listFinanceCategories(supabase, tenantId)
- useFinanceTemplates(tenantId): hook for listFinanceTemplates(supabase, tenantId)
- Transaction mutations: insertTransaction(supabase, tenantId, draft) / updateTransaction / deleteTransaction
- Transfer mutations: createTransfer(supabase, tenantId, draft) → {source, destination} / deleteTransfer(groupId)
- Account mutations: insertAccount / updateAccount / softCloseAccount(supabase, id)
- Period picker component (React Native): modal with preset buttons (today/yesterday/week/month/year + last*) + custom from/to date inputs
- Overview summary cards (RN): accounts balance, income, expense, debt, profit with per-team scope chip
- Day-grouped transaction list (RN): groupByDay + flatlist render
- Operation sheet (RN): segment picker (income/expense/transfer), amount input, category/account selector, date, notes, payment method
- Template quick-entry: chips for pre-defined amounts/categories at top of operation sheet


**UI sections:**
- Team scope selector (horizontal chip bar, one active, reusable across all finance screens)
- Period picker header (split: preset name tap → popup modal, dates tap → custom range modal with from/to pickers)
- Overview metrics section (sticky): accounts card (balance), income/expense tinted cards (green/red), debt/profit row (orange/blue), all with tap-to-filter behavior
- Transaction feed (scrollable list below overview): grouped by occurred_on date, day header with net (±), transaction rows with icon/label/amount
- Operation entry sheet (modal/slide-up): segmented income/expense/transfer selector, amount input (numeric keyboard), category picker (expense) or appointment picker (income), account selector, payment method (cash/card/transfer/other), date picker (default today), notes field, receipt upload placeholder, submit button
- Template quick-chips: inline row of pre-curated one-tap amounts (e.g. Бензин €20, €30, €40)
- Account cards list: per-brigade accounts with balance, kind icon, edit/delete actions (for settings flow)
- Debt list: overdue appointments with outstanding balance (when homeView === 'debt')
- Profit breakdown: category/service breakdown of profit by expense source (when homeView === 'profit')



**Mobile adaptations:**
- Period picker: use RN native DatePickerIOS (iOS) for date inputs instead of HTML <input type=date>; wrap in ActionSheetModal for modal presentation
- Team scope bar: horizontal ScrollView instead of overflow-x-auto; reuse team color chip from existing Clients scope bar
- Overview cards: FlatList section headers (sticky) instead of position:sticky; cards as full-width rows instead of max-w-3xl grid
- Transaction feed: FlatList with SectionList grouping by date; swipe actions (delete/refund) via Reanimated instead of right-click menu
- Operation sheet: BottomSheetModal (reanimated-bottom-sheet) instead of fixed overlay; keyboard-aware view (KeyboardAvoidingView); segmented control for type selector
- Amount input: numeric keyboard (keyboardType='decimal-pad'); custom input component enforcing 2 decimals (EUR cents)
- Category/account pickers: Picker/Select modal (like existing clients filter) instead of nested dropdown menus
- Receipt upload: use react-native-image-picker or document picker; show thumbnail preview instead of file input
- Date picker: reuse DatePicker component from appointments if available; fallback to DatePickerIOS modal
- Payment method: horizontal pill chips (reusable PaymentMethodPicker)
- Refund flow: action-sheet menu from transaction row swipe or long-press instead of popup dialog
- Search/filter: not in v1 MVP; period + team scope sufficient initial slicing


**Risks:**
- Period range logic: ensure getPeriodRange(kind, custom?) is stable and matches web exactly for date arithmetic (Monday-based weeks, month boundaries, leap years)
- Brigade filtering: page uses transactions filtered by team_id AFTER querying; must ensure listTransactionsForRange brigadeIds opt is efficient and RLS scopes correctly
- Account balance: must be all-time (all transactions, not period-scoped); avoid re-querying on every period change
- Transaction mutations on mobile require tenant scoping; ensure insertTransaction defaults occurred_on to today if omitted (web does this)
- Date inputs: React Native has no native date picker; DatePickerIOS (iOS-only) means Android needs fallback (custom modal or react-native-date-picker)
- Layout shift: sticky overview cards must not cause layout flicker when list scrolls; use FlatList ListHeaderComponent for true stickiness
- Category list: finance_categories returns globals + tenant-owned (isNull vs tenant_id match); ensure filter for income vs expense type at UI render
- Template quick-amounts: EXPENSE_CATEGORIES hardcoded in shared; runtime doesn't know fuel/food/supplies preset buttons — only curated FinanceTemplate list is available at runtime
- Refund ceiling: page computes refundedByTx from all tx in range; mobile must query same scope (all-time, not period-scoped) to validate refund <= original
- Transfer atomicity: createTransfer inserts pair; if one fails, must roll back both (Supabase trigger handles, but error handling must not assume partial success)


**Proposed files:**
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/finances/hooks.ts (useTransactions, useAccounts, useAccountBalances, useFinanceCategories, useFinanceTemplates)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/finances/compute.ts (export computePeriodTotals, groupByDay, filterByType from shared; local selection logic)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/components/PeriodPicker.tsx (RN modal; preset + custom range)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/components/TeamScopeBar.tsx (horizontal chips, reusable)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/finances/FinanceOverview.tsx (summary cards: accounts, income, expense, debt, profit)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/finances/TransactionsFeed.tsx (FlatList with day grouping, tx row render)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/finances/OperationSheet.tsx (BottomSheetModal; segment/amount/category/account/date/notes/method)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/components/TemplateChips.tsx (quick-entry chip row)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/app/(dashboard)/finances.tsx (refactored: hook everything up, state mgmt, sheet open/close)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/finances/queries.ts (TanStack Query hooks for all finance repos)


## SETTINGS (Кабинет) — Babun CRM Web to Expo/RN Port Specification — effort L

The Babun CRM settings area comprises 11 subscreens organized in 4 thematic groups: Личный кабинет (account/security/billing), Записи (calendar/SMS/online-booking/loyalty), Справочники (cities/booking types), and Компания (team/integrations). Most data is in Supabase (tenants, finance_categories, personal_event_types, client_tags, tenant_loyalty_settings, tenant_sms_config); some settings (calendar display, company invoice data, loyalty tiers, integrations) still use localStorage with dual write-through patterns. The web version uses auto-save with optimistic updates and haptic feedback. Port prioritizes DB-backed features first (quick wins with no migration), then hybrid localStorage+Supabase patterns, deferring advanced integrations (SMS management, Stripe billing).

**Shared fns available:**
- packages/shared/src/db/repositories/finance-templates.ts — FinanceTemplate CRUD
- packages/shared/src/db/repositories/finance-categories.ts — Category list/edit
- packages/shared/src/local/calendar-settings.ts — loadCalendarSettings/saveCalendarSettings
- packages/shared/src/local/personal-event-types.ts — loadPersonalEventTypes/savePersonalEventTypes
- packages/shared/src/local/loyalty.ts — loadLoyalty/saveLoyalty
- packages/shared/src/local/finance/company.ts — loadCompany/saveCompany (dual localStorage+Supabase)
- packages/shared/src/local/cities.ts — generateCityId, City type
- packages/shared/src/local/location-labels.ts — LocationLabel type
- packages/shared/src/local/tenant-integrations.ts — loadChannelIntegrations/saveChannelIntegrations


**Data-layer gaps:**
- Supabase tenant_calendar_settings table — Calendar display (startHour, endHour, gridStep, workStartHour, timezone, bufferMinutes, etc.) currently localStorage-only; needs backfill from localStorage on first sync
- Supabase tenant_locations table — Cities (name, country, isActive) currently localStorage-only; needs RLS policy by tenant_id
- Supabase tenant_location_labels table — Booking address types currently localStorage-only; needs RLS policy
- Supabase tenant_integrations table — Full implementation for Telegram/WhatsApp/Instagram webhook receiver (STORY-094 future); currently MVP uses localStorage
- RLS policies — All new tables must be scoped by tenant_id; Team members can read settings but only owner can write
- Auth integration — 2FA/TOTP enrollment uses Supabase GoThrough Auth API (not custom DB tables); RN must use @supabase/supabase-js auth module
- Stripe integration — Billing requires live Stripe webhook infrastructure on backend; RN redirects to Stripe Checkout/Portal URLs (likely WebView)
- SMS config RLS — owner-gate RLS policy on tenant_sms_config must exist; only owner can edit sender, templates, toggle enabled
- Locale-specific strings — All 60+ settings labels/errors are hardcoded Russian; no i18n abstraction


**UI sections:**
- Personal Info (Личная информация) — Edit tenant identity: name, business type, region, currency, brand contacts (logo, phone, email, social). Supabase tenants table. Effort: M
- Business Profile (Бизнес) — Editable business name + vertical category (beauty, HVAC, auto, cleaning, other). Supabase tenants.name + tenants.vertical. Effort: S
- Region & Currency (Регион) — Select country + currency for invoices and display. Supabase tenants.country + tenants.currency. Effort: S
- Calendar Settings (Календарь) — Work hours, grid step (15/30/60 min), timezone, buffer time, visibility toggles. localStorage CalendarSettings, NO Supabase yet. Effort: M
- Calendar Event Types (Типы событий) — Manage personal calendar event types (Обед, Встреча, etc.): icon, color, duration, all-day flag. Supabase personal_event_types table. Effort: M
- Finance Templates (Шаблоны операций) — Quick-entry shortcuts for recurring transactions (Rent EUR1500, Payroll EUR800). Supabase finance_templates table. Effort: M
- Finance Categories (Категории) — Income/expense category library with icon, color, slug for transaction grouping. Supabase finance_categories table. Effort: S
- Company Invoice Details (Счёт компании) — Legal name, VAT, address, IBAN, bank, email, phone, invoice prefix. Dual: Supabase tenants + localStorage CompanyInfo. Effort: M
- Loyalty Program (Программа лояльности) — Define visit-based discount tiers; master toggle. Dual: Supabase tenant_loyalty_settings + localStorage loadLoyalty(). Effort: M
- Cities (Города) — Manage service locations (Limassol, Paphos, Nicosia) with active/inactive toggle. localStorage only, will move to Supabase. Effort: S
- Location Types (Типы объектов) — Booking/appointment address labels (Office, Home, Warehouse, Cafe). localStorage only, will move to Supabase. Effort: S
- SMS Settings (Автоматические SMS) — Twilio managed SMS config: sender approval, balance, templates for 24h/2h reminders. Supabase tenant_sms_config table (owner-only). Effort: L
- SMS Templates (Шаблоны SMS) — Pre-written message templates for appointment reminders and confirmations. Supabase SMS config. Effort: M
- Online Booking (Онлайн запись) — Public booking page config: slug, working hours, deposit toggle, confirmation message. Supabase tenants.booking_slug. Effort: M
- Team (Команда) — Manage members, roles (owner/member), pending invitations; RLS-gated. Supabase tenant_members + auth.users. Effort: L
- Integrations (Интеграции) — Connect Telegram, WhatsApp, Instagram. localStorage tenant-integrations (MVP); future Supabase table. Effort: L
- Account Info (Аккаунт) — Read-only: email, registration date, user ID for support. Supabase auth.users. Effort: S
- Security (Вход и безопасность) — Password, 2FA/TOTP enrollment, trusted devices list, sign-out. Supabase auth (GoTrue API). Effort: L
- Billing (Тариф и оплата) — Plan display, usage quotas, Stripe checkout, subscription status, payment history (owner-only). Supabase tenants.plan + Stripe API. Effort: XL



**Mobile adaptations:**
- Flatten navigation hierarchy from 11 subscreens to tab-based or collapsible sections
- Implement offline-first update queue for settings changes
- Use expo-haptics for iOS Taptic Engine and react-native-haptic-feedback for Android
- Add color picker sheet component with preset swatch grid
- Integrate expo-image-picker for logo upload to Supabase Storage
- Handle keyboard focus with FlatList keyboardShouldPersistTaps
- Implement multi-select UI for cities and team member selections
- Add wheel/searchable pickers for hours and timezones (long list)
- Apply iOS-styled Switch component; accept platform differences on Android
- Wrap Stripe Customer Portal links in WebView for OAuth redirects
- Gate SMS, Billing, Team, Security screens to owner role only
- Use toast notifications for save feedback instead of modals
- Consider Supabase real-time subscriptions for multi-device sync


**Risks:**
- Offline sync backlog — Settings changes in offline mode must be queued and retried on reconnect. Without robust sync queue, users may lose edits or see inconsistent state. Manual implementation required
- localStorage→Supabase migration — Cities, location types, calendar settings are localStorage-only. Requires backward-compat: on first app load, read localStorage, upsert to Supabase, delete localStorage. Risk of race conditions if multiple devices sync simultaneously
- Multi-device consistency — RN app could be installed on multiple family members' phones sharing the same tenant. Settings changes on phone A must reflect on phone B via real-time subscriptions. Current web code does NOT use Supabase real-time listeners for most tables
- Stripe billing redirect — Web uses Stripe Checkout Session. RN has no standard way to open Stripe's web portal from native. WebView wrapper is heavy; Stripe RN SDK is immature. May require deferral or browser fallback
- 2FA/TOTP on mobile — GoTrue handles TOTP secret & verification. RN must add authenticator QR scanning (expo-barcode-scanner) + backup code UX. NOT a simple port; requires UX design & testing
- Large settings hierarchy — Web has 11 subscreens in 4 groups. RN must avoid deep nesting; tab-based vs. collapsible section decision is critical for UX
- Locale hard-coding — All 60+ settings labels/errors are Russian. If i18n is planned, settings is a heavyweight target. For MVP, accept Russian-only or plan i18n upfront
- Validator absence — Web forms have minimal validation. RN should add client-side validators (empty check, VAT format, IBAN checksum) before Supabase save to improve UX
- Haptics parity — Web defaults ON (vibration + audio click). iOS Taptic Engine inconsistent with Android vibration. Platform-specific UX
- SMS Twilio integration — Full SMS panel is complex: sender approval workflow, balance tracking, webhook receiver, template preview. Deferring (L/XL effort) is wise for MVP


**Proposed files:**
- apps/mobile/src/screens/CabinetScreen.tsx — Main Кабинет tab root (TabView or Stack navigator)
- apps/mobile/src/screens/cabinet/PersonalInfoScreen.tsx — Personal & Brand info editor
- apps/mobile/src/screens/cabinet/CalendarSettingsScreen.tsx — Work hours, grid step, timezone, buffer toggles
- apps/mobile/src/screens/cabinet/PersonalEventTypesScreen.tsx — Event type list + icon/color/duration editor
- apps/mobile/src/screens/cabinet/FinanceTemplatesScreen.tsx — Template CRUD with category, method, amount pickers
- apps/mobile/src/screens/cabinet/FinanceCategoriesScreen.tsx — Category read-only list (may inherit from web)
- apps/mobile/src/screens/cabinet/CompanyInvoiceScreen.tsx — Legal details, VAT mode, IBAN, bank info editor
- apps/mobile/src/screens/cabinet/LoyaltyScreen.tsx — Master toggle + tier editor (threshold, percent, label)
- apps/mobile/src/screens/cabinet/CitiesScreen.tsx — Location list, active/inactive toggle, add/edit/delete
- apps/mobile/src/screens/cabinet/LocationTypesScreen.tsx — Booking address labels editor (office, home, warehouse)
- apps/mobile/src/screens/cabinet/SmsSettingsScreen.tsx — Twilio config, sender status, templates (owner-only, deferred MVP)
- apps/mobile/src/screens/cabinet/OnlineBookingScreen.tsx — Booking slug, working hours, deposit, confirmation message
- apps/mobile/src/screens/cabinet/TeamScreen.tsx — Member list, roles, invitations (owner-only, deferred MVP)
- apps/mobile/src/screens/cabinet/IntegrationsScreen.tsx — Telegram token input, WhatsApp/Instagram subscribe links
- apps/mobile/src/screens/cabinet/SecurityScreen.tsx — Password change, 2FA/TOTP enrollment, sign-out (deferred MVP)
- apps/mobile/src/screens/cabinet/BillingScreen.tsx — Plan display, usage, Stripe portal link (owner-only, WebView, deferred MVP)
- apps/mobile/src/components/CabinetSection.tsx — Reusable section header + divider card (iOS Settings style)
- apps/mobile/src/components/CabinetRow.tsx — Reusable settings row (label + value/control + chevron)
- apps/mobile/src/components/ColorPickerSheet.tsx — Preset color swatch grid modal
- apps/mobile/src/components/TimePickerSheet.tsx — Hour/minute wheel picker modal
- apps/mobile/src/components/TimezonePickerSheet.tsx — Searchable timezone list picker modal
- apps/mobile/src/hooks/useCabinetSettings.ts — Unified settings context (auto-save, error handling, offline queue)
- apps/mobile/src/hooks/useCabinetSync.ts — Background sync service for offline update queue


## Babun Expo/RN Mobile App — Design Consistency Audit — effort L

The Babun mobile app (Expo/React Native with NativeWind + Tailwind v4) is in Phase 4-7 early-access state with functional core screens (auth, calendar, clients list/detail, finances, cabinet, chats) but lacks systematic design polish. The app uses a flat iOS aesthetic (grey icons, brand-indigo chips, emerald success, red danger, amber warning) matching the web app, but critical inconsistencies plague spacing, typography, component states, and behavioral feedback. Key gaps: (1) no shared screen-level header/chrome component; (2) list separators and dividers hand-coded in each screen; (3) empty/loading/error states inconsistent; (4) button/input/badge styling scattered; (5) status pills use hardcoded hues; (6) safe-area and tab-bar handling ad-hoc; (7) no reusable card/block wrappers. The design needs systematic primitives (ScreenHeader, ListItem, SectionCard, EmptyState, Badge, ColorTokens) unified under one foundation.

**Shared fns available:**
- @babun/shared/local/clients (Client, ClientTag, ClientNote types, ACQUISITION_LABELS)
- @babun/shared/local/appointments (Appointment type, getPaidAmount helper)
- @babun/shared/local/selectors/client-stats (buildStats, ClientStats type)
- @babun/shared/local/selectors/service-due (buildServiceDue, ServiceDueSummary type)
- @babun/shared/common/utils/money (formatEUR)
- @babun/shared/local/chats (Chat, CHANNEL_COLORS, CHANNEL_LABELS, seedDemoChats)
- @babun/shared/common/utils/map-links (buildMapUrl)
- @babun/shared/common/utils/messenger-links (telegramUrl, instagramUrl, whatsappUrl)



**UI sections:**
- Screen chrome & headers: No unified ScreenHeader component. Back + title + action buttons implemented inline in [id].tsx, new.tsx, RefListScreen. Border-b styling inconsistent. Padding varies (px-2 py-2 vs px-4 py-2). Title font size and weight scatter.
- List items & separators: Hardcoded flex-row + px-4 py-3 + active:bg-neutral-100 in every list. Separator is <View className="h-px bg-neutral-100" /> duplicated 15+ times. Variant spacing buried in caller code (ml-[68px] for avatar offset). No ListItem component.
- Card/section wrappers: All 8 detail blocks use mx-3 mt-2 rounded-2xl bg-white p-3 shadow-sm identically. Pattern duplicated 20+ times with no abstraction. No SectionCard component.
- Empty/loading/error states: Inconsistent layout. Loading uses centered ActivityIndicator but padding varies (pt-20, flex-1). Error messages shown as text without consistent container. Empty states rendered inline. No unified EmptyState component.
- Typography scale: No type system. Headings use text-2xl/text-base scattered. Labels use text-xs or text-[12px]. Font weights vary (font-semibold, font-bold, font-medium). No design tokens.
- Spacing & padding: Inconsistent grid. Horizontal padding varies (px-3, px-4, px-5, px-6). Vertical spacing uses mt-2 through mt-5 ad-hoc. Gap values scatter. No rhythm or base unit.
- Status pills & badges: Hardcoded className for every status (bg-brand/10, bg-success/15, bg-warning/15). No Badge component. Tones vary (opacity inconsistency).
- Button styling: Only primary/secondary variants. No icon button, no size variants, no rounded-lg option for compact buttons. Loading state animation lacks color management.
- Input fields: Field.tsx basic wrapper only. Inline TextInputs scatter throughout blocks. No consistent focus ring, no variant library (inline vs full-width).
- Badges and chips: Tag pills in MetaBlock use dynamic inline style; meta chips hardcode className per variant. No unified Badge or ChipGroup.
- Safe area handling: Inconsistently applied edges prop. Calendar tab omits safe area. Client detail uses edges=["top"] selectively. Risk of unsafe content on notch devices.
- Tab bar: Hardcoded colors in _layout.tsx. No configurable theme or label styling rules.
- Action menu: Client detail's MenuItem is one-off implementation. No shared Menu/Popover.
- Keyboard behavior: TextInputs lack returnKeyType, returnKeyLabel, blurOnSubmit settings. No keyboard-aware scroll in most screens.
- Button tap target: Sizes vary (h-9, h-8, h-7) without min-width guidance. No tap-target audit (Apple HIG 44px minimum).



**Mobile adaptations:**
- Keyboard avoidance: Login screen uses KeyboardAvoidingView. Other screens with inputs (new client, reference list, client blocks) do not. Add consistent KeyboardAvoidingView or useKeyboardInset.
- Gesture handling: No swipe-to-dismiss, no long-press actions, no multi-select. All interactions tap-only. Future: pull-to-refresh (partial on clients list), swipe-to-delete.
- Bottom sheet modals: RefListScreen uses Modal (transparent, animationType="slide"). Custom overlays used in client detail. No bottom-sheet library. Inconsistent presentation.
- Back gesture: iOS swipe-back via expo-router default should work; test for gesture conflicts inside ScrollView.
- Safe-area insets: Hard-coded white background. Notch devices may show black inset. Use useSafeAreaInsets for dynamic spacing (e.g., action menu position).
- Icon color accessibility: Lucide colors hardcoded (no a11y theme or high-contrast mode). Consider OS accessibility settings.
- Platform-specific styling: Web/mobile no platform-specific appearance differences. No web vs iOS button style variants.
- Haptic feedback: No haptic.notificationAsync on tap/toggle/submit. Requires expo-haptics; iOS polish improvement.
- Loading skeletons: All loading states show bare ActivityIndicator. Skeleton screens improve perceived performance; not implemented.
- Dark mode: No useColorScheme or Appearance listener. All surfaces hardcoded white. No system theme support.


**Risks:**
- Tailwind class duplication: Repeated mx-3 mt-2 rounded-2xl bg-white p-3 shadow-sm in 20+ places makes bulk changes fragile. Extraction to components mandatory.
- NativeWind limitations: ClassNames don't apply to wrapper components (SafeAreaView, ScrollView, FlatList); inline styles required. Constrains refactoring.
- Type safety for dynamic colors: MetaBlock uses inline style={{backgroundColor}} for tag colors. No validation; hex string errors possible.
- Shadow rendering differences: iOS/Android render shadows differently. shadow-sm may be invisible on Android. Test on both platforms.
- Safe-area inconsistency: Notch + bottom-sheet modals create overlap if edges prop inconsistent. Audit all Pressable overlays (action menus).
- Icon sizing: Lucide icons use sizes 24/22/18/14/11 scattered. No size constants; pixel misalignment risk.
- Focus management: TextInputs in blocks lack autoFocus and returnKeyType. Form UX degrades; no field-to-field navigation.
- Status pill opacity: bg-brand/10 + bg-success/15 + bg-warning/15 + bg-danger/10 use different opacity. Unified scale needed.
- Loading state animation: ActivityIndicator lacks fallback color in dark mode or Android.
- Bottom padding: contentContainerStyle={{paddingBottom}} used inconsistently. Keyboard overlap risk when scrolling to end.


**Proposed files:**
- src/components/ui/ScreenHeader.tsx — Unified screen chrome: back button + title + optional action button. Props: title (string), onBack (() => void), action? ({label: string, onPress: () => void, icon?: React.ReactNode, color?: string}). Used by [id].tsx, new.tsx, RefListScreen, cabinet/* screens.
- src/components/ui/ListItem.tsx — Reusable list row: avatar/icon + main content + optional detail/amount. Props: onPress, children, separator (bool). Variants for avatar size.
- src/components/ui/SectionCard.tsx — Unified card wrapper replacing mx-3 mt-2 rounded-2xl bg-white p-3 shadow-sm duplicates. Props: title (string), children, action? ({label, onPress}). Optional header divider.
- src/components/ui/EmptyState.tsx — Consistent empty/error/loading surface. Props: state ('empty' | 'loading' | 'error'), icon?, title (string), subtitle?, action? ({label, onPress}). Replaces scattered <View className="items-center pt-20"> code.
- src/components/ui/Badge.tsx — Status pills, tags, chip variants. Props: label (string), variant ('status-scheduled' | 'status-completed' | 'status-cancelled' | 'status-in-progress' | 'payment-paid' | 'payment-partial' | 'tag-meta' | etc.), size ('sm' | 'md'). Centralized className map.
- src/constants/colors.ts — Color token exports (brand, success, danger, warning, neutral shades + opacities). Imported by all components.
- src/constants/spacing.ts — Tailwind-friendly spacing guide: 4px, 8px, 12px, 16px, 24px, 32px. Used in component prop defaults.
- src/components/ui/TextInput.tsx — Extended Field component. Props: label, value, onChangeText, error, placeholder, keyboardType, variant ('labeled' | 'inline' | 'compact'). Handles focus ring consistency.
- src/components/ui/Divider.tsx — Reusable separator. Props: axis ('horizontal' | 'vertical'), offset? (left margin for list variant), color. Replaces <View className="h-px bg-neutral-100" />.
- src/components/ui/Menu.tsx — Portable action menu (iOS popover style). Props: visible (bool), onClose, items ([] {label, onPress, icon?, danger?}), position ({x, y}). Replaces custom MenuItem.
- src/features/ui/StatusBadge.tsx — Dedicated status badge component using enum-to-class map. Props: status (Appointment['status'] | PaymentStatus), size?.
- src/features/clients/ClientCard.tsx — Wrapper combining ClientHeader + ClientNextJob common spacing. Props: client, appointments, stats, serviceDue, update.
- src/features/clients/ClientBlockWrapper.tsx — Replaces mt-2 mx-3 rounded-2xl pattern. Props: title (string), subtitle?, children, onAction?.
- src/hooks/useScreenHeader.ts — Custom hook wrapping useRouter() + title/back behavior. Returns {title, onBack, headerProps}.
- src/constants/typography.ts — Text scale: heading1 (text-2xl font-bold), heading2 (text-base font-semibold), body (text-sm), caption (text-xs). Exported as className strings.
- src/constants/shadows.ts — Shadow tokens (none, sm, md, lg) matching native RN. Applied to cards consistently.


## Calendar/Agenda Screen Mobile Port Specification — effort XL

The web calendar is a multi-view system (week, day, 3-day, month, agenda) with full gesture support (swipe-between-dates, pinch-zoom hour-height), drag-to-reschedule appointments via dnd-kit, and rich navigation (team/brigade tabs, date pickers, time-based auto-scroll). The mobile app currently implements a read-only agenda (SectionList grouped by date with tap-to-client routing). The port must add: date navigation controls, tap-to-edit/create interactions, team/master filters, and view-toggle capability. Gesture interactions (swipe-dates, pinch-zoom) can land in phase 2 since react-native-gesture-handler (v2.28) and react-native-reanimated (v4.1) are already installed.

**Shared fns available:**
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/calendar/queries.ts — useAppointments() via react-query + Supabase RLS
- /Users/artem/Documents/babun2/babun-crm/packages/shared/local/appointments.ts — Appointment, status labels, validation, duplicateAppointment, createBlankAppointment
- /Users/artem/Documents/babun2/babun-crm/packages/shared/local/clients.ts — Client type
- /Users/artem/Documents/babun2/babun-crm/packages/shared/common/utils/date-utils.ts — getMonday, getWeekDates, formatDateKey, getCurrentCyprusTime, getCurrentTimeInZone, addDays, addWeeks
- /Users/artem/Documents/babun2/babun-crm/packages/shared/local/schedule.ts — TeamSchedule, getTeamSchedule, getDayScheduleForDate, timeToMinutes, DEFAULT_SCHEDULE
- /Users/artem/Documents/babun2/babun-crm/packages/shared/common/utils/money.ts — formatEUR (shown in web agenda)
- /Users/artem/Documents/babun2/babun-crm/packages/shared/local/services.ts — Service type, service lookup by id
- /Users/artem/Documents/babun2/babun-crm/packages/shared/local/day-cities.ts — getCityConfig, cityConfigFromColor (city color tinting)
- /Users/artem/Documents/babun2/babun-crm/packages/shared/local/finance/day-summary.ts — computeDayFinance, DayFinanceTotals (per-day income/expense shown in month cell)
- /Users/artem/Documents/babun2/babun-crm/packages/shared/common/utils/expand-repeat.ts — expandRepeat (recurring appointments)


**Data-layer gaps:**
- RN navigation flow: tap appointment → edit sheet (currently routes to /clients/[id]; need AppointmentSheet or bottom-sheet modal instead)
- Tap empty time slot → create-appointment picker/confirm (web has SlotConfirmPopup + AppointmentSheet; mobile needs RN equivalent, ideally bottom-sheet)
- Date picker/navigator: date header tap for day-mode toggle (web toggles week ↔ day); need a date-navigation modal or wheel-picker
- Team/master filter: brigade tab strip (web: Header chip strip + activeTeamId state); mobile needs segmented-control or bottom-sheet facet picker
- View-mode toggle: week/day/month/agenda picker (web: Header buttons + localStorage state) → mobile: bottom-sheet or segmented-control
- Time navigation: 'today' button, prev/next (web: Header pagination + getMonday/addWeeks logic); mobile: prev/next arrows or swipe
- Appointment upsert flow: after create/edit, navigate to new appointment's date so user sees it (web: navigateToAppointmentDate callback); mobile equivalent needed
- Day finance totals: footer showing income/expense/debt per day (web: DayFinanceFooter + computeDayFinance); RN: summarize and display as row above/below day section
- Now-line (current time indicator) for day/week view (web: WeekView renders a colored stripe; RN day-grid will need the same)
- Drag-to-reschedule on RN (phase 2): pan-gesture handlers via react-native-gesture-handler + reanimated worklets for smooth animation


**UI sections:**
- Header with date navigation: «Календарь» title + current-date display + prev/next buttons + 'today' button (match web PageHeader + Header pattern)
- Team/master filter strip or dropdown (toggles activeTeamId; on personal calendar show 'Мой календарь', on brigade show brigade name with color chip)
- View-mode toggle: buttons for Agenda/Day/Week/Month or a pill-style selector (web defaults to 'week' on desktop, 'day' on mobile; persist in localStorage)
- Appointment list (agenda view): SectionList grouped by date (YYYY-MM-DD → formatDayHeader) with sticky headers. Each row: time + client-name + status-badge + total-amount
- Appointment row actions: tap to open edit sheet (not route to client card); long-press or swipe to show quick-actions (status-change, delete, reschedule)
- Empty-slot creation: tap an empty time-cell in day/week grid → time-confirm popup (start/end time) → kind picker (Клиент/Событие) → AppointmentSheet
- Day-view grid: TimeColumn (fixed left, hour labels) + day-column (scrollable) with appointments positioned by time. Tap empty space to create; tap apt to edit.
- Month-view grid: 6×7 day cells showing date + appointment count + financial totals (planned/earned/spent/profit like web MonthView). Tap cell to jump to day view.
- Day/week header with city chip and optional label (city tinting; toggleable per-brigade via web settings)
- Financial summary row per-day (optional in phase 1, priority in phase 2): shows income/expense/debt row-by-row beneath day's appointments or in a collapsible footer
- Undo toast (delete/status-change) with restore callback (web: UndoToast component; RN: ToastProvider or Alert)



**Mobile adaptations:**
- SectionList vs FlatList: web agenda is infinite-scroll; RN SectionList groups by date with sticky headers (already in current mobile index.tsx). Extend to include day-grid.
- Bottom-sheet for appointment editor: web AppointmentSheet is a full-page modal; RN needs Bottom-Sheet-Go or similar (installed? check mobile/package.json) to slide up from bottom (preferred over full-screen for quick-edits on calendar context).
- Swipe gestures: web SwipeableCalendar uses touchstart/touchmove/touchend for horizontal swipe (commit on >25% screen width). RN: use Gesture from react-native-gesture-handler (already installed) with Animated.Value from reanimated for smooth pan-snap.
- Pinch-zoom: web useCalendarGestures tracks two-finger distance + applies --hh CSS variable. RN: Pinch gesture from react-native-gesture-handler + worklet to update a shared value + reanimated to drive FlatList height recalculation (phase 2, complex).
- Tap-to-create: web DayColumn has onEmptySlotClick handler. RN: add pressable areas to a time-grid (phase 2); phase 1 can use a simple 'create' button in the header that opens the sheet without pre-filled time.
- Date picker: web uses setCurrentMonday in a state setter (arrow buttons). RN: can use react-native-date-picker (third-party) or custom wheel-picker (aligned with Babun's iOS-Settings aesthetic per memory). Phase 1: simple header buttons.
- Team filter: web Header.tsx has a chip strip with drag-reorder. RN: segmented-control or bottom-sheet. Phase 1: bottom-sheet with team checkboxes or radio (simpler, matches web filter-bar redesign from memory #101).
- Status quick-actions: web AppointmentBlock long-press (550ms timer) opens ActionMenuModal. RN: swipe actions via react-native-swipe-list-view (third-party, if not installed need to add) or use contextMenuAwaitable on long-press.
- Recurring appointments: web expandRepeat() in a useMemo (expensive). RN: same logic applies, but avoid re-computing on every render; cache via react-query or a custom hook.
- Timezone handling: web getCurrentTimeInZone(timeZone) for brigade calendars. RN: same Date/Intl APIs available; pass activeTeamId to useMemo to pick the right tz from teams array.
- Off-hours wash (grey background): web DayColumn paints workStart/workEnd schedule. RN: conditional View background on each time-slot in day-grid (phase 2).
- Master avatar/color: web uses team.color for accent stripe on appointment blocks. RN: same color data available; pass teamColorFor callback to appointment row renderer.


**Risks:**
- React-query cache invalidation: web appointments upsertAppointment/deleteAppointment directly mutate state (Zustand/Jotai); RN relies on react-query. Must ensure mutations invalidate 'appointments' query key or use optimistic updates. Supabase RLS will auto-filter per-tenant, but local-cache sync is critical.
- Recurring appointment expansion at render-time is expensive (expandRepeat on every render in web). RN must memoize or paginate the expansion window (current 30-days-back, 60-days-forward). If not cached, list scrolling will lag.
- Timezone handling: web team.timezone is IANA string; RN Date API should handle it, but Intl.DateTimeFormat behavior differs across Android/iOS versions. Test carefully.
- Gesture handler library versions: package.json shows react-native-gesture-handler 2.28.0 and react-native-reanimated 4.1.0. Both are stable, but pinch-zoom + reanimated worklets require careful integration. Phase 2 risk: worklet performance on older Android devices.
- Bottom-sheet library not listed in package.json. Will need to add (gorhom/bottom-sheet or alternative). Check if it supports Expo / managed Expo Prebuild.
- Day-grid time-cell pressable areas (phase 2): computing which time-slot was tapped requires hit-testing based on hour-height. Pinch-zoom changes hour-height dynamically (via reanimated shared value), so pressable hit-boxes must be derived from the same shared-value computation.
- Persisting view-state (currentDate, viewMode, activeTeamId): web uses localStorage + AsyncStorage equivalent on RN (expo-sqlite or AsyncStorage). MMKV is installed; ensure all keys are prefixed to avoid collisions.
- Master/currentMasterId on personal calendar: web assumes 'Мой календарь' is always bound to currentMasterId. RN must load masters from Supabase or pass via context. If master is deleted, personal events become orphaned — handle gracefully (show all personal events regardless of master_id, like web v499 does).
- Undo toast: web UndoToast uses a Toast provider. RN will need a similar toast/snackbar provider (probably already exists in the app). Ensure undo callbacks can run in the background after user leaves the calendar screen.
- No infinite-scroll pagination for appointments in phase 1: query fetches ALL appointments (RLS-scoped to tenant). For tenants with 10K+ appointments, this will be slow. Phase 2: implement cursor-based pagination or a server-side filter (date-range window).


**Proposed files:**
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/app/(dashboard)/calendar.tsx — main calendar screen with view-mode toggle and header navigation (DATE NAVIGATION + TEAM FILTER + VIEW TOGGLE)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/calendar/useCalendarState.ts — centralizes calendar view-state (currentDate, viewMode, activeTeamId, windowBounds). Persists to AsyncStorage equivalent.
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/calendar/AgendaListView.tsx — RN SectionList agenda (current index.tsx refactored). Renders appointment rows with tap-to-edit + swipe quick-actions.
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/calendar/DayGridView.tsx — time-column + day-column grid for day/week modes (phase 2 priority). Tap empty slot to create; pressable time-cells for interactions.
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/calendar/MonthGridView.tsx — 6×7 month grid matching web MonthView (phase 2). Tap cell to jump to day mode.
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/calendar/AppointmentRow.tsx — reusable row component: time + client/event name + status badge + amount. Exports STATUS color map.
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/calendar/CalendarDateHeader.tsx — header with date label, prev/next buttons, 'today' button, team/view picker triggers
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/components/bottom-sheets/AppointmentEditSheet.tsx — bottom-sheet modal for edit/create (wraps AppointmentSheet logic or uses a dedicated RN form)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/components/bottom-sheets/TimeConfirmSheet.tsx — 'confirm time' sheet for empty-slot taps (start/end time pickers + kind selector)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/components/bottom-sheets/TeamFilterSheet.tsx — team/master filter with radio/checkbox list (one-tap active team change)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/components/bottom-sheets/ViewModeSheet.tsx — picker for Agenda/Day/Week/Month (phase 2)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/calendar/useNavigateToAppointment.ts — callback hook to navigate to appointment date after create/edit (analogous to web navigateToAppointmentDate)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/calendar/useCalendarGestures.ts — RN pan/pinch handlers via react-native-gesture-handler (phase 2). Swipe between dates, pinch-zoom hour-height.


## Reference Data EDIT/DELETE for Mobile (Services, Teams, Masters, Cities) — effort M

Mobile reference screens (teams, masters, services, cities) currently support list+create only. This spec extends them to tap-to-edit and swipe/context-delete, aligning with the web editors. The web shows full field sets: services (name, category, duration, price, bulk pricing tiers, cost_per_unit, color, weekday availability, online_enabled, material_costs, brigade assignment, sort_order); teams (name, region, color, default_city, cities, members, payout_percentage); masters (full_name, phone, role, team_id, color, is_active, account_status); cities (name, country, color). Mobile will surface the "daily-useful" subset per design memory (no vanity, only actionable fields).

**Shared fns available:**
- Database.types.ts — Row/Insert/Update types for services, teams, masters, cities (already defined with all fields)
- Mobile queries.ts — useTeams(), useMasters(), useCities() already fetch active records; useCreateTeam/Master/City already exist and pattern-model the mutation structure


**Data-layer gaps:**
- useUpdateTeam(id, patch) mutation — Supabase UPDATE teams WHERE tenant_id & id
- useDeleteTeam(id) mutation — Supabase UPDATE teams SET is_active=false
- useUpdateMaster(id, patch) mutation — Supabase UPDATE masters WHERE tenant_id & id
- useDeleteMaster(id) mutation — Supabase UPDATE masters SET is_active=false
- useUpdateService(id, patch) mutation — Supabase UPDATE services WHERE tenant_id & id
- useDeleteService(id) mutation — Supabase UPDATE services SET is_active=false (or DELETE if not used in appointments)
- useUpdateCity(id, patch) mutation — Supabase UPDATE cities WHERE tenant_id & id
- useDeleteCity(id) mutation — Supabase UPDATE cities SET is_active=false
- Typed Supabase helper functions in queries.ts wrapping UPDATEs/logical deletes, with proper error handling and query invalidation


**UI sections:**
- Edit Modal/BottomSheet — triggered by tap on list item; pre-fills all editable fields from the selected record; shows back/close button + title (e.g. 'Редактировать услугу')
- Save Button — active only if required fields have values; calls update mutation; closes on success
- Delete Trigger — long-press or context menu (Android-style ⋯ icon, iOS swipe-left red action); shows confirmation; calls delete (logical: set is_active=false)
- Per-entity field subsets (minimal-but-useful per memory):
-   Services: name (required), category (dropdown), duration_minutes (spinner), price (number), color (picker), online_enabled (toggle)
-   Teams: name (required), region (text), color (picker), payout_percentage (number, optional)
-   Masters: full_name (required), phone (tel), team_id (dropdown), role (dropdown: helper/lead/master)
-   Cities: name (required), country (text), color (picker)



**Mobile adaptations:**
- Bottom-sheet modal instead of web overlay — standard React Native navigation pattern (Modal component from RN)
- Swipe-to-delete or long-press context menu — use React Native Gesture Handler (already in dependencies per /mobile package.json) for Swipeable; or fallback to iOS-style swipe via Pressable + animated pan
- Color picker — either native RN color picker (if available via expo) or simplified swatch grid (same as web: palette + custom input if needed)
- Spinners/Steppers — RN TextInput with keyboardType='number-pad' + manual +/- buttons (no native spinner)
- Dropdowns — React Native Picker or custom FlatList-based selector sheet
- Phone field — keyboardType='phone-pad' on TextInput
- Toggle — React Native Switch component
- Confirmation alert — React Native Alert.alert() for destructive actions


**Risks:**
- Color field on teams/masters/cities — web shows color input, but mobile has limited native color picker; recommend swatch grid + optional custom hex input (can defer custom to web only)
- Bulk pricing on services — web has full PriceTier/DurationTier arrays. Mobile MVP should skip tier management (defer to web); surface only base price + bulk_threshold + bulk_price if time permits
- Material costs on services — web shows array of {name, amount} costs. Mobile MVP should skip; flag in design as web-only for now
- Brigade assignment for services — web shows multi-select checkboxes per team. Mobile MVP: skip (leave brigade_ids untouched on edit); only allow edit name + price + duration
- Permission boundaries — update/delete assume user has edit access to reference data. No per-field RBAC on mobile (assume owner or admin); web enforces via permissions matrix
- Logical delete vs hard delete — spec uses is_active=false (soft delete); confirm this aligns with backend RLS policies and Supabase functions if any


**Proposed files:**
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/reference/queries.ts — add useUpdate/DeleteTeam/Master/Service/City mutations (following useCreate pattern)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/features/reference/RefListScreen.tsx — extend to accept onEdit callback + onDelete; show list as tappable rows, emit edit(item) or delete(item) to parent
- /Users/artem/Documents/babun2/babun-crm/app/(dashboard)/cabinet/services.tsx — add useUpdateService/useDeleteService; add edit mode state; render EditModal (BottomSheet) with form fields + delete button
- /Users/artem/Documents/babun2/babun-crm/app/(dashboard)/cabinet/teams.tsx — same pattern: add edit mode, EditModal with name + region + color fields
- /Users/artem/Documents/babun2/babun-crm/app/(dashboard)/cabinet/masters.tsx — same pattern: add edit mode, EditModal with full_name + phone + team_id + role + color
- /Users/artem/Documents/babun2/babun-crm/app/(dashboard)/cabinet/cities.tsx — same pattern: add edit mode, EditModal with name + country + color
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/components/ui/ColorPicker.tsx (new) — reusable color swatch selector (6–10 presets + custom input)
- /Users/artem/Documents/babun2/babun-crm/apps/mobile/src/components/ui/EditModal.tsx (new, optional) — generic BottomSheet wrapper with title + close + save buttons; children render fields
