# Babun Architecture — current state

> Фактическое состояние на 2026-07-20. Обновлять вместе с архитектурными изменениями.

## Обзор

Babun — multi-tenant CRM для выездного сервиса. Монорепозиторий содержит два
рабочих клиента поверх одного Supabase backend:

- `apps/web` — Next.js 16 App Router, PWA и server/API routes;
- `apps/mobile` — Expo SDK 54 / React Native 0.81, iOS-first интерфейс;
- `packages/shared` — типы БД, domain helpers, offline cache и sync queue.

```text
Web (Next.js) ───────┐
                    ├── Supabase Auth + PostgreSQL/RLS + Realtime + Storage
Mobile (Expo/RN) ───┘
       │
       └── SQLite/MMKV cache + offline mutation queue
```

Supabase — источник истины. Локальное хранилище больше не является primary
database: web использует его только для отдельных UI-настроек, mobile — для
кэша, очереди синхронизации и device preferences.

## Структура

```text
babun-crm/
├── apps/
│   ├── web/
│   │   ├── src/app/                 # pages, layouts, API routes
│   │   ├── src/components/          # calendar, clients, finance, settings
│   │   ├── src/lib/supabase/        # browser/server/admin clients
│   │   └── supabase/migrations/     # schema, RLS, triggers, RPC
│   └── mobile/
│       ├── app/                     # Expo Router routes
│       ├── src/features/            # calendar, appointments, clients, cabinet
│       ├── src/components/ui/       # canonical mobile primitives
│       ├── src/theme/               # light-only semantic tokens
│       └── docs/DESIGN-SYSTEM.md     # visual canon
├── packages/shared/src/
│   ├── db/                          # generated Database types + repositories
│   ├── local/                       # SQLite cache, queue, settings
│   └── sync/                        # realtime and replay machinery
├── bun.lock                         # единственный lockfile
└── .node-version                    # Node 24 for CI/tooling compatibility
```

## Данные и изоляция tenant

- Каждая бизнес-сущность принадлежит `tenant_id`.
- Доступ ограничивают PostgreSQL RLS policies и membership пользователя.
- `tenant_members` связывает auth user, tenant и роль.
- Web server routes используют cookie session; privileged administrative
  операции используют service role только на сервере.
- Native self-service deletion передаёт Supabase access token в
  `Authorization: Bearer …` на `/api/account/delete`; web-вызов сохраняет
  same-origin CSRF check.
- Миграции находятся в `apps/web/supabase/migrations`; production schema
  всегда проверяется перед записью или применением миграции.

## Mobile runtime

Expo Router делит приложение на auth и dashboard route groups. Dashboard
содержит календарь, клиентов, создание записи `/book` и кабинет. Данные
загружаются из Supabase через TanStack Query; shared cache позволяет читать
последний snapshot offline, а mutation queue повторяет изменения после
восстановления сети. Realtime invalidation синхронизирует tenant tables.

Мобильное приложение намеренно работает только в светлой теме
(`userInterfaceStyle: light`) и игнорирует системное переключение темы.
Светлая палитра определена semantic tokens в `src/theme/colors.ts`.
UI должен соответствовать `apps/mobile/docs/DESIGN-SYSTEM.md`, HIG и правилам
44 pt minimum target / VoiceOver labels.

React намеренно разделён: Expo SDK 54 работает на React 19.1, web — на React
19.2. Metro resolver закрепляет mobile imports за локальной React 19.1. Поэтому
Expo Doctor сообщает один известный duplicate-dependency warning; объединять
версии до поддержки Expo нельзя.

## Web runtime

Next.js App Router разделяет server и client components. Browser Supabase
client обслуживает интерактивные запросы/realtime, server client читает cookie
session, API routes выполняют доверенные операции. PWA service worker работает
только в production; в development регистрации и кэши очищаются защитным
механизмом `ServiceWorkerRegister`.

## Toolchain и quality gates

Канонический package manager — Bun 1.3.14, runtime CI — Node 24. Используется
только `bun.lock`; npm lockfile удалён.

```bash
cd babun-crm
/Users/artem/.bun/bin/bun install --frozen-lockfile

cd apps/mobile
bun run typecheck
bun run lint
bun test src/features/appointments/booking-prefill.test.ts
bunx expo-doctor

cd ../web
bunx tsc --noEmit
bun test
bun run build

cd ../../packages/shared
bun test
```

CI повторяет эти проверки на Node 24/Bun. Web ESLint имеет исторический debt и
пока является информационным gate; новые изменения не должны добавлять ошибок.

## Известные ограничения

- Production deployment и migrations выполняются только через обычный
  review/deploy flow; локальная готовность не означает, что код уже на prod.
- Expo Doctor: 17/18 из-за намеренного React 19.1/19.2 split.
- Supply-chain audit может содержать транзитивные advisories, для которых ещё
  нет совместимого upstream patch; адресные overrides допустимы только после
  полного typecheck/tests/build.
- Старые крупные web/mobile компоненты постепенно декомпозируются; новое UI не
  должно увеличивать этот долг.
