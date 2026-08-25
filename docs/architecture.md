# Babun Architecture — current state

> Фактическое состояние на 2026-08-25. Обновлять вместе с архитектурными изменениями.

## Обзор

Babun — multi-tenant CRM для выездного сервиса. Монорепозиторий содержит один
клиент поверх Supabase backend:

- `apps/mobile` — Expo SDK 54 / React Native 0.81: iOS, Android и Web из одного
  кода (веб — React Native Web через `expo export --platform web`);
- `packages/shared` — типы БД, domain helpers, offline cache и sync queue.

```text
Mobile / Web (Expo RN + RN Web) ── Supabase Auth + PostgreSQL/RLS + Realtime + Storage
       │
       └── SQLite/MMKV cache + offline mutation queue
```

Supabase — источник истины. Локальное хранилище не является primary database:
это кэш последнего снимка, очередь синхронизации и device preferences.

## Структура

```text

├── apps/
│   └── mobile/
│       ├── app/                     # Expo Router routes
│       ├── src/features/            # calendar, appointments, clients, cabinet
│       ├── src/components/ui/       # canonical mobile primitives
│       ├── src/theme/               # light-only semantic tokens
│       └── docs/DESIGN-SYSTEM.md    # visual canon
├── packages/shared/src/
│   ├── db/                          # generated Database types + repositories
│   ├── local/                       # синхронные KV-хранилища справочников и настроек
│   ├── storage/                     # KVStorage seam (MMKV на нативе, localStorage на вебе) + SQLite
│   └── sync/                        # realtime and replay machinery
├── supabase/
│   ├── migrations/                  # схема, RLS, триггеры, RPC (счёт: ls supabase/migrations/*.sql | wc -l)
│   └── functions/                   # edge-функции (счёт: ls supabase/functions | wc -l)
├── vercel.json                      # bun run build:web → apps/mobile/dist
└── bun.lock                         # единственный lockfile
```

## Данные и изоляция tenant

- Каждая бизнес-сущность принадлежит `tenant_id`.
- Доступ ограничивают PostgreSQL RLS policies и membership пользователя.
- `tenant_members` связывает auth user, tenant и роль.
- Серверных роутов у приложения нет: клиент ходит в Supabase напрямую, сессия
  живёт в supabase-js (Keychain/Keystore на нативе, `localStorage` на вебе).
- Привилегированные операции вынесены в edge-функции на service-ключе. Удаление
  аккаунта — функция `account-delete`, авторизация Supabase access token'ом в
  `Authorization: Bearer …` (см. `docs/EDGE-FUNCTIONS-CUTOVER.md`).
- Миграции находятся в `supabase/migrations`; production schema
  всегда проверяется перед записью или применением миграции.

## Mobile runtime

Expo Router делит приложение на auth и dashboard route groups. Dashboard
содержит календарь, клиентов, создание записи `/book` и кабинет. Данные
загружаются из Supabase через TanStack Query; shared cache позволяет читать
последний snapshot offline, а mutation queue повторяет изменения после
восстановления сети. Realtime invalidation синхронизирует tenant tables.

Приложение намеренно работает только в светлой теме
(`userInterfaceStyle: light`) и игнорирует системное переключение темы.
Светлая палитра определена semantic tokens в `src/theme/colors.ts`.
UI должен соответствовать `apps/mobile/docs/DESIGN-SYSTEM.md`, HIG и правилам
44 pt minimum target / VoiceOver labels.

Веб-таргет — тот же код: `expo export --platform web` собирает статический
бандл в `apps/mobile/dist`, Vercel отдаёт его с SPA-rewrite на `/index.html`.
Отдельного веб-приложения, server components и API routes в проекте нет —
Next.js снесён 2026-08-25.

## Toolchain и quality gates

Канонический package manager — Bun. Используется только `bun.lock`;
npm lockfile удалён.

```bash
bun install --frozen-lockfile

# гейты — из корня репозитория
bun run typecheck    # tsc --noEmit в apps/mobile, должен быть 0
bun test             # bun:test — файлы *.test.ts в apps/mobile и packages/shared
                     # (сколько их — печатает сам раннер: «Ran N tests across M files»)
bun run lint
bun run build:web    # ровно то, что запускает Vercel

# точечный прогон одного теста
bun test apps/mobile/src/features/appointments/booking-prefill.test.ts

# состояние Expo-зависимостей
bun run --cwd apps/mobile doctor
```

Целевой `.github/workflows/ci.yml` повторяет ровно этот список: один job на
`ubuntu-latest`, `oven-sh/setup-bun` → `bun install --frozen-lockfile` →
`typecheck` → `test` → `lint` → `build:web`. Ни npm, ни vitest, ни `next build`
в нём быть не должно: lockfile один (`bun.lock`), раннер один (`bun:test`),
сборка веба одна (`expo export --platform web`).

**Состояние временное:** пока владелец не запушил переписанный workflow, в дереве
лежит версия Next.js-эпохи (`babun-crm/apps/web`, `npm ci`, `vitest`,
`next build`) — она в текущем дереве неработоспособна. Проверять состояние
файлом, а не этим абзацем; независимо от цвета CI гейты прогоняются локально
перед словом «готово».

## Известные ограничения

- Production deployment и migrations выполняются только через обычный
  review/deploy flow; локальная готовность не означает, что код уже на prod.
- Supply-chain audit может содержать транзитивные advisories, для которых ещё
  нет совместимого upstream patch; адресные overrides допустимы только после
  полного typecheck/tests/build.
- Часть справочников в `packages/shared/src/local/*` до сих пор ходит в
  `window.localStorage` напрямую вместо seam'а `getStorage()` — на нативе такие
  функции молча ничего не сохраняют. Переводить при касании файла.
- Старые крупные mobile-компоненты постепенно декомпозируются; новое UI не
  должно увеличивать этот долг.
