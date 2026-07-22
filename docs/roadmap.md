# Babun Roadmap

> Краткий фактический приоритет на 2026-07-20. Исторические планы не считаются
> текущим состоянием продукта.

## Сейчас

Web и mobile работают на Supabase с Auth, tenant isolation/RLS, Realtime и
offline cache/sync. Основные поверхности: календарь, записи, клиенты, команды,
услуги, финансы, настройки и кабинет. Активная ветка мобильной стабилизации —
`feat/mobile-app-port`.

### STORY-063 — аудит и стабилизация (active)

- Безопасная гидратация `/book`, проверка команды, защита от дублей клиентов.
- Создание записи тапом по свободному времени без FAB, менее шумный financial footer и HIG/VoiceOver; тема строго светлая.
- Node 24 + Bun 1.3.14, единый lockfile и синхронизированный CI.
- Адресные dependency upgrades и документированные Expo исключения.
- Native self-service account deletion через защищённый web API.
- Полный typecheck/tests/build и simulator smoke в обеих темах.

## Следующие задачи

1. Провести owner smoke-test на физическом iPhone и пройти release checklist.
2. Выпустить изменения через PR; после deploy проверить production user flows,
   включая авторизацию и открытие модального окна удаления аккаунта. Само
   удаление тестировать только на специально созданном tenant/user.
3. Сократить web ESLint debt (сейчас исторический backlog), начиная с React
   Compiler purity/refs и stale-closure групп.
4. Продолжить декомпозицию legacy-компонентов >400 строк без визуального
   редизайна и изменения domain behavior.
5. Перепроверять оставшиеся транзитивные advisories после Expo/ESLint/Babel
   upstream patches; не форсировать несовместимые major overrides.

## После стабилизации

- Public online booking и управление доступностью.
- Надёжная messaging/inbox интеграция (WhatsApp сначала, остальные каналы
  после подтверждённого MVP).
- Route optimization и operational day view для команд.
- SaaS billing только после стабильного production pilot.

## Правила выпуска

- Schema/migrations → shared types/domain → API → clients/UI.
- Production schema проверяется до любой новой записи.
- Каждая волна проходит mobile/web/shared gates и runtime smoke.
- Не удалять production data и не проверять account deletion на реальном
  пользовательском аккаунте.
- Push, PR и deploy выполняются только по явному разрешению владельца.
