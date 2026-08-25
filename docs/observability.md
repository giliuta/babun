# Observability — что есть сейчас и как включить Sentry

> Состояние на 2026-08-25. Предыдущая редакция описывала telemetry-фасад
> Next.js-приложения (`apps/web/src/lib/observability/*`, `global-error.tsx`,
> `@sentry/nextjs`) — этого кода в дереве нет с момента сноса веба.

## Что есть в дереве

Телеметрия сведена к одному шву:

- **`apps/mobile/src/lib/sentry.ts`** — экспортирует `initSentry()`. Сейчас это
  no-op: нативный `@sentry/react-native` не установлен, чтобы сборка не тащила
  его build phase и `sentry-cli`.
- **`apps/mobile/src/bootstrap.ts`** вызывает `initSentry()` один раз при старте
  (там же биндится storage seam). Другой точки входа нет.
- **`apps/mobile/.env.example`** уже держит слот `EXPO_PUBLIC_SENTRY_DSN=` —
  пустой означает «телеметрия выключена».
- **`packages/shared/src/sync/sync-error-bus.ts`** — единственный агрегатор
  ошибок записи в Supabase. Телеметрия туда **инжектится**, а не импортируется:
  `setSyncErrorTelemetry(capture)`. По умолчанию — no-op, поэтому ошибки видны
  только в красной плашке «Ошибка синхронизации».

## Как включить Sentry, когда дойдут руки

Меняется ровно два места, приложение об этом знать не должно:

1. Поставить `@sentry/react-native`, в `initSentry()` вызвать `Sentry.init({...})`
   под условием `process.env.EXPO_PUBLIC_SENTRY_DSN`. Пустой DSN = ранний
   `return`, как сейчас.
2. Из того же `initSentry()` отдать capture в шину:
   `setSyncErrorTelemetry((e, extras) => Sentry.captureException(e, { extra: extras }))`.
   После этого каждая отвергнутая RLS/сетью запись поедет в Sentry с тем же
   контекстом, что показывает плашка.

Рекомендованные значения при включении: `release = BUILD_VERSION`
(`packages/shared/src/common/utils/version.ts`) — тогда issues группируются по
сборке; `sendDefaultPii: false`; session replay выключен.

`EXPO_PUBLIC_*` инлайнится в бандл, поэтому DSN туда класть можно, а любой
секрет — нет (см. `docs/SETUP.md`).

## Приватность

- Не передавать email в `setUser`. Идентификатора пользователя достаточно,
  чтобы дедуплицировать; email — отдельный opt-in, которого сейчас нет.
- Собственных breadcrumb'ов с пользовательским вводом не заводить: то, что
  человек набрал в форме перед падением, в отчёт попадать не должно.

## Не сделано

- Нативная сборка с Sentry ни разу не собиралась — включение потребует
  `expo prebuild` и проверки, что build phase не ломает iOS-сборку.
- Загрузки source maps и релизных тегов в CI нет: сам workflow ещё ждёт
  переписывания под bun (`docs/roadmap.md`).
- Метрик производительности и бюджета нет; это отдельная задача, не этот шов.
