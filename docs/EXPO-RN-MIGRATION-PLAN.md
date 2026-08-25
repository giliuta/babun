# Babun CRM → Expo + React Native: план полной миграции

> ✅ **ВЫПОЛНЕНО.** Миграция закрыта 2026-08-25: `apps/web` удалён, iOS/Android/Web
> идут из `apps/mobile`. Ниже — исходный план (июнь 2026) со всеми его путями
> `apps/web/**`, которых в дереве больше нет. Читать как запись о прошлом;
> текущее состояние — `docs/architecture.md`.

> Цель: **полный перенос операторского продукта в Expo/RN (iOS, Xcode)**. Web-стек
> Next.js удаляется после миграции; остаётся тонкая «остаточная» web/серверная
> поверхность только для того, что физически не может жить в нативном приложении
> (вебхуки, публичные SMS/ссылочные страницы клиентов, админка SaaS-владельца).
>
> Источник: многоагентный аудит кодовой базы (6 измерений + синтез), июнь 2026.
> Подтверждено чтением диска, не только отчётами.

---

## Главный приз и центральная стратегия

`packages/shared` (@babun/shared) — **почти полностью переносимый**:
- Репозитории Supabase **инжектируют `SupabaseClient` параметром** (клиент НЕ создаётся
  внутри shared) → `db/repositories/*` едут как есть.
- `common/utils/*`, `local/selectors/*`, `local/finance/{compute,vat,transaction,day-summary,...}`,
  весь `db/types` — чистый TS без DOM → port-as-is.
- Уже есть storage-seam: `storage/provider.ts` (`getStorage()`/`setStorage()`),
  спроектированный **синхронным** под `react-native-mmkv`.

### Подтверждено на диске
- `storage/provider.ts` дефолтит `new WebKVStorage()` на import-time → на RN это no-op
  до `setStorage()`. **Сделать default ленивым / бросать при неинициализированном storage.**
- **28 файлов `local/*`** зовут `window.localStorage` напрямую; только 1
  (`event-recent-places`) использует `getStorage()`. Главный механический долг —
  «тихая потеря данных» на RN.
- `dispatchEvent` живёт в `local/clients.ts`, `local/loyalty.ts`, `local/finance/company.ts` —
  DOM-шина событий, которой на RN нет → заменить на `mitt`.
- `apps/mobile` = дефолтный скелет Expo 54 / RN 0.81, зависимостей ещё нет.

---

## Целевая архитектура монорепо

```
babun-crm/
  apps/
    web/            ← УДАЛЯЕТСЯ после миграции (кроме residual ниже)
    web-residual/   ← (опц.) минимальный Next на Vercel: /book /feedback /b /privacy /terms /admin + ВСЕ /api/**  ИЛИ  → Supabase Edge Functions
    mobile/         ← новый продукт (Expo Router)
  packages/
    shared/         ← ПРИЗ. Сюда переезжает вся доменная логика + sync-стек
      src/
        common/     (port-as-is: utils, icons→lucide-react-native)
        local/      (port-as-is логика; storage-shim на getStorage())
        db/         (repositories port-as-is; db/cache ПЕРЕПИСАТЬ на sqlite)
        storage/    (+ mmkv.ts новый)
        sync/       ← ПЕРЕЕХАЛ из apps/web/src/lib/sync (адаптеры storage+network инжектируются)
        finance/pdf ← HTML-шаблон (expo-print) вместо jsPDF
```

**Что выезжает ИЗ `apps/web/src` В `packages/shared`:**
- `lib/sync/*` (replayer, cached-wrappers, network, queue-events, tenant-state-backup,
  auth-clear, format) — лучший актив, но web-привязан (idb + `navigator.onLine`).
  Переехать с инжектируемыми адаптерами `StorageAdapter` (sqlite) + `NetworkAdapter` (NetInfo).
- `lib/phone/normalize.ts`, `lib/finance/{breakdown,ledger-compute,period}.ts`,
  `lib/clients/{ltv,booking-link}.ts` — чистые, port-as-is.
- `lib/observability/telemetry.ts` фасад (только `sentry-adapter.ts` меняет import на `@sentry/react-native`).

**Платформенные шимы (новые):**
1. `storage/mmkv.ts` — `MMKVStorage implements KVStorage` (~40 строк, зеркало `memory.ts`).
2. `db/cache` на `expo-sqlite` с **тем же публичным API** (`cacheRead/cacheUpsert/enqueueOp/dequeueAll/...`),
   чтобы replayer/wrappers не менялись.
3. Единый `supabase`-клиент для RN: `@supabase/supabase-js` + `react-native-url-polyfill` +
   auth-storage на `expo-secure-store`, `autoRefreshToken`. Заменяет `lib/supabase/{client,server}.ts`
   (`@supabase/ssr` дропается).
4. `icons` barrel → `lucide-react-native` (+ `react-native-svg`), один import-свап (`@babun/shared/icons`).
5. `mitt`-эмиттер вместо `window.dispatchEvent`.
6. randomUUID-полифилл (`react-native-get-random-values`) для репо.

**apps/mobile (Expo Router), зеркалит операторские экраны:**
```
app/
  (auth)/        login, register, forgot-password, reset-password, onboarding
  (dashboard)/
    _layout.tsx           ← Tabs (Календарь/Клиенты/Чаты/Финансы/Кабинет) + provider-дерево
    index.tsx             ← Календарь (TAB 1)
    clients/[index,[id],new,import]
    chats/index
    finances/[index,income,close-day]
    cabinet/              ← бывший Sidebar drawer: insights, recurring, unclosed, audit, teams, masters, sms-templates, settings/*
  +not-found.tsx
  _layout.tsx             ← root: route-guard сессии Supabase
```

---

## Фазы

### Phase 0 — Каркас и shared-extraction (de-risk «бежит на устройстве») — XL
**Цель:** приложение запускается на iOS, проходит auth, показывает пустой таб-навигатор.
- Установить стек в `apps/mobile`: `expo-router`, `nativewind@4` + `tailwindcss`,
  `react-native-reanimated`, `react-native-gesture-handler`, `@supabase/supabase-js` +
  `react-native-url-polyfill` + `expo-secure-store`, `@tanstack/react-query`,
  `react-native-mmkv`, `@react-native-community/netinfo`, `@sentry/react-native`,
  `lucide-react-native` + `react-native-svg`. EAS-проект + Apple Developer.
- **Storage seam:** `packages/shared/src/storage/mmkv.ts`; в entry `apps/mobile` вызвать
  `setStorage(new MMKVStorage())` ПЕРВЫМ; сделать `provider.ts` default ленивым.
- **Supabase RN client** + `react-query` provider. Перенести `lib/supabase/tenant-context.ts`
  (читает `app_metadata.tenant_id` из JWT) — port-as-is.
- **Auth shell:** `(auth)/login` (port логики `LoginForm`, `signInWithPassword`); root
  `_layout.tsx` = client route-guard (заменяет RSC-гейты `dashboard/layout.tsx`).
- File-map: `app/login/page.tsx`→`app/(auth)/login.tsx`; `app/dashboard/layout.tsx`→`app/(dashboard)/_layout.tsx`;
  `components/layout/DashboardClientLayout.tsx` → provider-дерево (port) + `<Tabs>` (rewrite) +
  **дроп** EdgeGuard/SplashScreen-web/SW/PWA.
- **Verify:** на устройстве — логин реальным аккаунтом, сессия переживает рестарт (SecureStore),
  переключение 5 пустых табов, Sentry ловит тестовую ошибку.

### Phase 1 — Дизайн-система и примитивы — L
**Цель:** все экраны имеют общий набор примитивов (гейтит каждый экран — делать раньше фич).
- `tokens.ts` (зеркало `app/globals.css`: indigo-700/emerald-500/red-500/amber-400, type-scale).
  NativeWind v4 config.
- Переписать `components/ui/*` (23 примитива): `Pressable`/`TextInput`/`Modal`;
  bottom-sheet через `@gorhom/bottom-sheet`; `createPortal`→RN Modal.
- Лейаут-хром: `BottomTabBar`/`Header`→ expo-router `Tabs` + `expo-blur`; распутать import `@dnd-kit` из `Header`.
- **Verify:** экран-витрина примитивов; светлая/тёмная тема; токены совпадают с web.

### Phase 2 — Данные, оффлайн-sync и realtime (фундамент) — XL, high-risk
**Цель:** clients/appointments читаются/пишутся оффлайн на RN, дрейн очереди при reconnect.
- Переписать `db/cache/index.ts` (idb→`expo-sqlite`), сохранив публичный API. Индексы → SQL.
- Перенести `lib/sync/*` в `packages/shared/src/sync` с инжектируемыми адаптерами;
  `network.ts`: `navigator.onLine`→NetInfo + AppState; `auth-clear.ts`: localStorage-wipe →
  MMKV+SQLite+SecureStore clear (**критично для cross-tenant-leak на logout**).
- Realtime: переписать `useRealtimeTenantSync` под RN (fallback — pull-to-refresh + reconnect-drain).
- randomUUID-полифилл; Blob-upload в репо (`appointment-photos`, `day-extra-receipts`) → FormData/base64.
- **Storage-shim миграция:** кодмод 28 файлов `local/*` `window.localStorage`→`getStorage()`
  (паттерн из `event-recent-places.ts`). `dispatchEvent`→mitt.
- **Verify:** авиарежим — создать клиента/запись, вернуть сеть, проверить дрейн очереди и
  отсутствие дублей (idempotent 23505); logout→login другим аккаунтом не светит чужой кэш.

### Phase 3 — Клиенты (TAB 2) — XL
- `clients/page.tsx`→`clients/index.tsx` на `@shopify/flash-list` (>900 клиентов);
  фильтр-панель (редизайн v809–v812) как `@gorhom/bottom-sheet`.
- `clients/[id]` (карта-диспетчер, дизайн locked); `clients/new` (phone-primary, save-gate);
  `clients/import` через `expo-document-picker` + `papaparse` (port-as-is) + `expo-contacts`.
- Расщепить god-component `ClientPanel` (1930 строк) при порте.
- **Verify:** список 900+ скроллит без джанка; поиск/фильтры; создание пишется в Supabase.

### Phase 4 — Календарь (TAB 1) — XL, САМОЕ СЛОЖНОЕ
- Полный rewrite `dashboard/page.tsx` (~2200 строк) + `components/calendar/*`
  (SwipeableCalendar, DayColumn 680 строк): `@dnd-kit` → `react-native-gesture-handler`
  `Gesture.Pan` (drag-reschedule); pinch-zoom → `Gesture.Pinch`; swipe-between-days →
  `PagerView`/reanimated. `BUILD_TAG` живёт здесь. EdgeGuard — дроп.
- **Verify:** drag записи между слотами/днями, pinch-zoom, swipe смены дня; сверка с web.

### Phase 5 — Записи / AppointmentSheet — XL
- `components/appointment/*` (47 файлов, AppointmentSheet 1202 строки, TimeWheels):
  multi-step через `@gorhom/bottom-sheet`; кастомные колёса → нативный wheel-picker;
  фото через `expo-image-picker` + `expo-image-manipulator` (переписать `local/photos.ts` compress).
- `resolve-map-link` остаётся сервером (CORS/SSRF) — RN зовёт endpoint.
- **Verify:** создание/редактирование записи, фото (compress), адрес, авто-доход по
  триггеру `sync_appointment_finance`.

### Phase 6 — Финансы (TAB 4) — L–XL, ВТОРОЕ ПО СЛОЖНОСТИ
- `finances/page.tsx` (+income, close-day): период-пикер как wheel/bottom-sheet; графики
  `react-native-svg`/victory-native; compute-слой (`local/finance/compute,vat,day-summary`) port-as-is.
- **PDF:** переписать `invoice.ts` + `ledger-invoice-pdf.ts` (jsPDF) в ОДИН HTML-шаблон →
  `expo-print` + `expo-sharing` (бонус: кириллица проще). CSV → `expo-file-system` + share.
- **Дроп:** заброшенная cents-модель (`db/types/finance.ts`, `local/payroll.ts`,
  `local/reconciliations.ts`, `docs/finance-model.md`) — две правды о деньгах = мина.
- **Verify:** доход/расход/перевод/возврат, прибыль-герой, инвойс PDF на iOS (кириллица), CSV-экспорт.

### Phase 7 — Кабинет / Настройки / справочники — L
- `settings/*` (~15 подэкранов, port-as-is как ListGroup/ToggleRow), `teams/[id]/*` (8 роутов),
  `masters/[id]/{info,schedule,stats,access}`, `services`, `cities`, `sms-templates`, `audit`,
  `insights`, `recurring`, `unclosed`, `close-day`.
- **Schema:** masters/teams/services сейчас localStorage-only, но appointments FK на
  `team_id/master_id/service_ids` → дать им Supabase-таблицы+репо ДО релиза. `master_id` TEXT→uuid (STORY-039b).
- Apple-обязательное: in-app account deletion → `/api/account/delete`. Privacy/Terms через `expo-web-browser`.
- **Verify:** редактирование пишется в Supabase; account-delete работает; legal-ссылки открываются.

### Phase 8 — Push, билинг, deep-links, остаточный сервер — L, high-risk
- **Push:** дроп Web-Push (`sw.js` + `/api/push/*` + VAPID). `expo-notifications` + APNs
  (EAS entitlement); колонка под Expo-токен в `push_subscriptions`; sender → `expo-server-sdk`.
- **Auth deep-links:** `/auth/callback`, `/reset-password`, `/invite/[token]` → `expo-linking` +
  Universal Links + `verifyOtp`/`exchangeCodeForSession`; переконфиг Supabase redirect-allowlist; web-fallback.
- **Билинг (App Store IAP):** `settings/billing` → НЕ нативный чекаут; «управлять на web» через
  `expo-web-browser` → Stripe Portal. Серверный Stripe SDK только в Edge Function.
- **Остаточный сервер:** `stripe/webhook`, `twilio/status`, `calendar/[user_id]` (.ics),
  `resolve-map-link`, `feedback→GitHub`, `account/delete`, `team/switch` → Edge Functions
  (или минимальный Next на Vercel). Атомарность (invoice seq, quota, invite) → SECURITY DEFINER RPC.
- **Verify:** APNs-пуш доходит; письмо сброса открывает app; Stripe portal в браузере; вебхуки бьют по новым URL.

---

## Диспозиция фич

| Фича | Решение | Почему |
|---|---|---|
| shared доменная логика (utils, selectors, finance compute/vat, db/types) | **port-native** | Чистый TS без DOM — главный актив |
| `db/repositories/*` (Supabase) | **port-native** | Клиент инжектируется; supabase-js работает в RN |
| localStorage stores (`local/*` ~28 файлов) | **port-native** | Логика as-is, но localStorage→getStorage()/MMKV (кодмод) |
| Offline sync (`lib/sync` + `db/cache`) | **port-native** | LWW/queue/replayer золотой; меняем idb→sqlite, onLine→NetInfo |
| Календарь (SwipeableCalendar, dnd-kit, pinch/swipe) | **port-native** | Полный rewrite на gesture-handler+reanimated — высший риск |
| Финансы ledger + PDF | **port-native** | compute as-is; jsPDF→expo-print HTML; cents-прототип дропнуть |
| Клиенты/Записи/Настройки/Команды/Мастера UI | **port-native** | FlashList/bottom-sheet/wheel-picker; god-components расщепить |
| Web Push (sw.js, /api/push, VAPID) | **drop** | Нет нативного аналога → expo-notifications + APNs |
| PWA / service worker / install / EdgeGuard | **drop** | Браузерные концепции → expo-splash-screen/expo-updates |
| Cents finance-прототип (payroll, reconciliations) | **drop** | Не шипится; две правды о деньгах = мина |
| Лендинг / legal (privacy, terms) | **server-stays** | SEO/маркетинг; legal через expo-web-browser |
| Публичные страницы (/book, /feedback, /b) | **server-stays** | Цели SMS на телефонах КЛИЕНТОВ, не операторов |
| Админка SaaS-владельца /admin/* | **server-stays** | Внутренний инструмент владельца, не для App Store |
| Серверные API (stripe/twilio webhooks, invoices, ICS, ...) | **server-stays** | Вебхуки/сервис-ключ/SSRF/raw-body подпись — нельзя в бандл |
| i18n (next-intl) | **thin** | Каталоги переиспользуются; API → i18next + expo-localization |
| Билинг / Stripe checkout | **thin** | App Store IAP: подписку вести через web Stripe Portal |

---

## Топ-рисков
1. **Календарь** (`dashboard/page.tsx` ~2200 + `components/calendar/*`): dnd-kit + кастомные DOM TouchEvent pinch/swipe/EdgeGuard — ground-up rewrite. Самый используемый и сложный экран.
2. **Оффлайн-sync субстрат**: idb→expo-sqlite + onLine→NetInfo при сохранении API replayer'а; фоновая приостановка и флаки-reconnect делают LWW сложнее, чем на web. Make-or-break для поля.
3. **Тихая потеря данных**: 28 файлов `local/*` зовут `window.localStorage` (guard `typeof window` → no-op на RN). Кодмод на getStorage()/MMKV обязателен (raw vs JSON, legacy '1'/'0' маркеры).
4. **Auth deep-linking**: cookie-сессии RSC → Universal Links + verifyOtp/exchangeCodeForSession + web-fallback + переконфиг Supabase. Риск редирект-петель `onboarded_at`.
5. **Cross-tenant leak на logout**: `auth-clear.ts` должен вытирать MMKV+SQLite+SecureStore до рендера следующего аккаунта.
6. **Push**: полный свап Web-Push→APNs + схема push_subscriptions + sender; APNs entitlement + Apple Developer Program.
7. **Билинг на iOS**: App Store IAP-политика может отклонить внешний платёж за SaaS-подписку → web Stripe Portal.
8. **Две финансовые модели**: shipped Supabase ledger vs заброшенный cents-прототип. Решить судьбу до порта.
9. **Stripe/Twilio вебхуки при смене хоста**: `twilio/status` считает HMAC над callback-URL → переподпись каждого StatusCallback + repoint Stripe webhook URL.

---

## Финальный стек (LOCKED 2026-06-25)

Одна RN-кодовая база → **iOS + Android + web** (через react-native-web). Бэкенд — Supabase
(не переписываем; самописный сервер заменил бы Auth/RLS/Realtime/Storage = регресс).

- **Front:** Expo + React Native + Expo Router + **NativeWind v5 (Tailwind v4)**
- **Server-state:** **TanStack Query** (уже встроен)
- **Forms:** **TanStack Form** (`@tanstack/react-form`)
- **Хранилище (offline):** MMKV (KV) + expo-sqlite (cache/queue, Phase 2)
- **Data / Auth / Realtime / Storage:** **Supabase** — приложение ходит напрямую через
  `supabase-js`, RLS = API для CRUD (сервер для CRUD НЕ нужен)
- **Server-only слой** (вебхуки Stripe/Twilio, секреты, атомарные операции): начинаем с
  **Supabase Edge Functions** (Deno, zero-ops); при росте выносим в **Hono (TypeScript)** на
  Cloudflare Workers / Bun — даёт типизированный RPC `end-to-end` с RN-приложением. НЕ заменяет
  Supabase, а дополняет его (~10% логики).
- **Платформы:** iOS (есть ✅) · Android (`expo run:android`, тот же код) · web
  (`expo start --web`, react-native-web)

## Рекомендуемый стек (RN/Expo)
- **Навигация:** `expo-router` (file-based, зеркалит `app/`; Tabs + nested stacks; группы `(auth)`/`(dashboard)`)
- **Данные/Auth:** `@supabase/supabase-js` + `react-native-url-polyfill` + `expo-secure-store` (дроп `@supabase/ssr`); `@tanstack/react-query`
- **Хранилище:** `react-native-mmkv` (синхронный KV — удовлетворяет sync-контракт `storage/types.ts`); `expo-sqlite` (offline cache + queue, тот же API)
- **Сеть:** `@react-native-community/netinfo` + AppState (замена `navigator.onLine`)
- **Жесты/анимации:** `react-native-gesture-handler` + `react-native-reanimated` (календарь pan/pinch/swipe, swipeable rows)
- **UI:** `nativewind@4` + `tokens.ts`; `@gorhom/bottom-sheet`; `@shopify/flash-list`; `lucide-react-native` + `react-native-svg`
- **Push:** `expo-notifications` + `expo-server-sdk` (APNs)
- **Deep-links:** `expo-linking` + Universal Links; `expo-web-browser` (legal + Stripe Portal)
- **Файлы:** `expo-print` + `expo-sharing` + `expo-file-system` (PDF из HTML, CSV); `expo-image-picker` + `expo-image-manipulator`; `expo-document-picker` + `expo-contacts`
- **Observability/i18n:** `@sentry/react-native` (за фасадом telemetry); `i18next` + `react-i18next` + `expo-localization`
- **Прочее:** `react-native-get-random-values`/`expo-crypto` (randomUUID), `mitt` (замена dispatchEvent), Supabase Edge Functions + SECURITY DEFINER RPC, EAS Build + `expo-updates` (OTA), `expo-splash-screen`
- **Изоморфны (as-is):** `date-fns`, `libphonenumber-js`, `papaparse`

---

## Зафиксированные решения (LOCKED, 2026-06-24)

Директива пользователя: **максимальное качество, ничего никогда не теряется, всё максимально
безопасно; делаем сразу так, как будет в финале — никаких «сначала так, потом переделаем».**
Выбор стека делегирован мне.

1. **Хранение → offline-first на `expo-sqlite`** с портом проверенного LWW-replayer (идемпотентные
   записи 23505, строгая tenant-изоляция, дрейн очереди при reconnect). НЕ online-only.
   Финансы: транзакционная атомарность (transfer-pair) через SECURITY DEFINER RPC онлайн;
   офлайн-очередь — с осторожной идемпотентностью. Цель — нулевая потеря данных.
2. **Бэкенд → единый Supabase** (Postgres + RLS + Auth + Realtime + Edge Functions) как
   канонический будущий бэкенд. Существующие данные в Supabase — расходный материал
   (пользователь подтвердил: «нам всё равно»). Схема проектируется заново, начисто.
3. **Справочники masters/teams/services → сразу в Supabase** (таблицы + репо + RLS) с первого
   дня. Никакого localStorage-прототипа. **PK = `text` (REVISED по факту с диска, не uuid):** вся
   живая схема ссылается на `team_id/master_id/location_id` через `text` в 8 таблицах — новые
   таблицы с `id text` (композитный PK `(tenant_id, id)`) делают все существующие FK валидными
   без единого изменения и сохраняют репозитории port-as-is. uuid = переделка 8 таблиц = «дважды».
   Миграции написаны: `apps/web/supabase/migrations/20260624_001…004` (001 — 6 таблиц
   teams/masters/services/service_categories/cities/equipment; 002 personal_event_types; 003
   tenant_loyalty_settings; 004 FK-hardening = review-only no-op). Категории/location-labels/
   event-recent-places — уже покрыты (`finance_categories`, `tenant_state`), новых таблиц нет.
4. **Web → операторский Next.js удаляется** после миграции. Expo держим с живым **web-таргетом**,
   чтобы будущая web-поверхность («RN-web» через react-native-web) росла из той же RN-кодовой
   базы. Residual-страницы (/book /feedback /b /privacy /terms /admin) — решим позже, вероятно
   тоже через RN-web.

### Следствия для плана
- **Канонический Supabase-схемный слой выносится в Phase 0/2** (а не localStorage-прототип):
  tenants, teams, masters, services, clients, appointments, finance — проектируем полную схему +
  RLS до фич. Это «делаем сразу как в финале».
- **Все компоненты пишем web-совместимыми** (RN-примитивы + NativeWind), чтобы `expo start --web`
  и будущий RN-web работали без форка UI.
- **Окружение:** dev-box = только `bun` (нет node/Xcode/simctl/cocoapods/watchman/expo-cli).
  Код авторится здесь; сборка/запуск iOS — на Mac пользователя (Node LTS + Xcode + CocoaPods/EAS +
  Apple Developer). Runtime-верификация iOS локально невозможна.
