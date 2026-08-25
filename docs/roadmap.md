# Babun Roadmap

> Краткий фактический приоритет на 2026-08-25. Исторические планы не считаются
> текущим состоянием продукта.

## Сейчас

Приложение работает на iOS, Android и Web из одного кода (Expo RN + RN Web)
поверх Supabase: Auth, tenant isolation/RLS, Realtime и offline cache/sync.
Основные поверхности: календарь, записи, клиенты, команды, услуги, финансы,
настройки и кабинет. Активная ветка на 2026-08-25 — `feat/unified-expo-web`
(проверять `git branch --show-current`, а не этот абзац).

### STORY-063 — аудит и стабилизация (active)

- Безопасная гидратация `/book`, проверка команды, защита от дублей клиентов.
- Создание записи тапом по свободному времени без FAB, менее шумный financial footer и HIG/VoiceOver; тема строго светлая.
- Bun как единственный рантайм команд, один lockfile `bun.lock`.
- Адресные dependency upgrades и документированные Expo исключения.
- Native self-service account deletion через edge-функцию `account-delete`.
- Полный `bun run typecheck` / `bun test` / `bun run build:web` и simulator smoke.

## Следующие задачи

1. Провести owner smoke-test на физическом iPhone и пройти release checklist.
2. Выпустить изменения через PR; после deploy проверить production user flows,
   включая авторизацию и открытие модального окна удаления аккаунта. Само
   удаление тестировать только на специально созданном tenant/user.
3. Довести `.github/workflows/ci.yml` до bun-гейтов: `bun install
   --frozen-lockfile` → `typecheck` → `test` → `lint` → `build:web`. Задача
   закрыта в тот момент, когда workflow в `master` гоняет именно их; до этого в
   дереве лежит версия Next.js-эпохи (`npm ci`, `vitest`, `next build`), которая
   не работает. Пуш workflow — за владельцем.
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
- Каждая волна проходит гейты `bun run typecheck` / `bun test` / `bun run lint`
  и runtime smoke в симуляторе.
- Не удалять production data и не проверять account deletion на реальном
  пользовательском аккаунте.
- Push, PR и deploy выполняются только по явному разрешению владельца.
