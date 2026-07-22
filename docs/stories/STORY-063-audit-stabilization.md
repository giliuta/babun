# STORY-063 — Аудит и стабилизация Babun

**Статус:** implementation complete — ожидает PR/deploy и owner-device smoke  
**Дата аудита:** 2026-07-20  
**Ветка:** `feat/mobile-app-port`

**Прогресс 2026-07-20:** W1–W4 реализованы локально. Закрыты deep-link
hydration/team fallback/client dedupe; сохранено создание тапом по свободному
времени без FAB, добавлены скрытие нулевого finance footer и 44 pt/VoiceOver;
приложение возвращено к строгой light-only теме; `/book` разделён
на summary/sheets/pickers; runtime закреплён на Node 24 + Bun 1.3.14; Expo,
Next/Sentry/Supabase/Vitest обновлены; native account deletion вызывает
защищённый web endpoint по Bearer; архитектура/roadmap синхронизированы.

Финальные gates: mobile typecheck = 0, Expo lint = 0 errors (62 historical
warnings), booking tests = 8/8, shared = 48/48, web = 78/78, web typecheck и
Next production build = green, frozen lockfile = green. Expo Doctor = 17/18:
единственное исключение — намеренный React 19.1 (Expo) / 19.2 (web) split с
mobile Metro resolver. `bun audit` сокращён с 43 advisories до 4 upstream
transitive (3 moderate / 1 low); совместимого patch для текущего Expo/tooling
tree пока нет. Simulator smoke пройден на calendar, `/book` и account в
светлой теме; destructive account-delete не запускался на реальном аккаунте.

## Цель

Устранить подтверждённые регрессии текущего мобильного диффа, вернуть
обязательные UX-инварианты Halo Cobalt, восстановить надёжные quality gates
web/mobile и привести документацию к фактической архитектуре Supabase + Expo.

## Подтверждённое состояние

- Mobile: `tsc` = 0, Expo ESLint = 0, shared tests = 48/48.
- Web: `tsc` = 0, production build = успешно, tests = 78/78 на Node 24.
- Web ESLint: 96 errors / 74 warnings (информационный gate, не блокирует CI).
- `bun run test` под локальным Node 26 ломает 16 finance-тестов из-за
  конфликта встроенного Web Storage с jsdom; тот же suite зелёный на Node 24.
- Expo Doctor: 13/18; часть сигналов намеренная (две версии React с Metro
  dedupe, `app.config.js` расширяет `app.json`), реальные — patch Expo и
  неявный выбор package manager.
- `bun audit`: 43 advisory (2 critical / 13 high / 20 moderate / 8 low),
  включая production-ветку Next 16.2.3; обновлять только адресно.
- iOS Simulator: холодный старт успешен, сетевые ответы 200, runtime-crash нет.
- Запрос системной dark theme оставляет приложение светлым: light-only
  принудительно закреплён в `app.json`, `src/bootstrap.ts`, `src/theme/colors.ts`,
  хотя `docs/DESIGN-SYSTEM.md` требует обе темы.

## P0 — сначала

### 1. Новая запись теряет адрес при deep-link с карточки клиента

`apps/mobile/app/book/index.tsx` инициализирует `clientId`/`locationId` из
параметров, но `address`/`addressNote` оставляет пустыми. Гидратация объекта
выполняется только после ручного `pickClient()`. Сохранение затем пишет
`location_id` вместе с пустым snapshot-адресом.

**Исправление:** единая чистая функция выбора клиента/объекта; один раз
гидратировать deep-link после загрузки клиентов, не перетирать ручной ввод.

### 2. Устаревший `teamId` делает создание несохраняемым

Если deep-link содержит удалённую/архивную команду, `teamId` остаётся
невалидным: fallback выполняется только при `teamId == null`. UI показывает
«Бригада», а insert падает на FK.

**Исправление:** после загрузки команд валидировать параметр; fallback на
последнюю живую/первую команду. Перед save валидировать текущую команду.

### 3. Быстрое создание клиента портит данные и допускает дубль

В `ClientPicker.create()` запрос по имени создаёт `{ full_name: q, phone: q }`;
например, «Иван» записывается и в телефон. CTA доступен даже при точном
совпадении существующего телефона.

**Исправление:** различать имя/телефон, нормализовать `phone_e164`, блокировать
дубль с действием «Открыть», добавить unit tests.

### 4. Удаление аккаунта остаётся поддержкой

Mobile показывает «напишите в поддержку», хотя App Store 5.1.1(v) требует
инициируемое из приложения удаление аккаунта.

**Зависимость:** edge-function/production Supabase и подтверждение владельца;
не входит в автономный клиентский коммит.

## P1 — UX, доступность, поддерживаемость

### 5. На корневом календаре FAB запрещён владельцем

Канонический способ создания — тап по свободному времени в сетке либо
подписанное действие в пустой agenda. Floating `+` справа не используется.

**Решение владельца:** удалить shared `Fab`; не возвращать floating `+` на
корневые экраны.

### 6. Финансовый футер недели остаётся слишком плотным

На живом скриншоте две строки по семи дням плохо сканируются; нулевые значения
создают шум. Текущие 11 pt формально читаемы, но иерархия слабая.

**Исправление после мокапа:** варианты — сворачивать полностью нулевой футер
или показывать агрегат недели с раскрытием по тапу. LOCKED-финансовую математику
не менять.

### 7. Новый `/book` не проходит базовую HIG-доступность

- 23 `Pressable`, только 3 явных accessibility-сигнала.
- Stepper и цветовые swatch — 30×30 pt (минимум HIG 44×44).
- Цветовые swatch не имеют русских accessibility labels/radio state.
- Экран 1863 строки; всего 42 TS/TSX-файла превышают правило 400 строк.
- Создан параллельный `ColorSheet` вместо канонического `ColorPicker`.

**Исправление:** 44 pt hit area, labels/hints/state, shared ColorPicker,
разделение `/book` на модель формы + секции + picker-компоненты без изменения
видимого дизайна.

### 8. Light-only — зафиксированное решение владельца

`app.json`, bootstrap и `useThemeColors()` принудительно используют светлую
тему. Системная dark theme и пользовательский переключатель не поддерживаются;
DESIGN-SYSTEM.md синхронизирован с этим решением.

## P1 — качество и supply chain

### 9. Runtime проекта не закреплён

CI использует Node 22/npm, handoff требует bun, локальный Node 26 ломает jsdom,
Expo Doctor видит `package-lock.json` + игнорируемый `bun.lock`.

**Исправление:** выбрать один канонический install/runtime путь, закрепить
`engines`/`packageManager`, синхронизировать CI и документацию. Не удалять
lock-файл до решения владельца.

### 10. Web lint debt вырос до 96 ошибок

Основные группы: `set-state-in-effect`, purity/refs React Compiler,
memo dependencies и один `@ts-ignore` в edge-function.

**Исправление:** отдельные маленькие коммиты по группам; сначала ошибки с
риском stale closure (`useRealtimeTenantSync`, календарь), затем механические.

### 11. Уязвимые зависимости

**Исправление:** patch/minor upgrades по одному стеку с build/tests после
каждого: Next/Sentry → Expo/RN transitive → Vitest/Vite dev-only. Не делать
`update --latest` и не смешивать с UI.

### 12. Expo Doctor

- Expo `54.0.35` ожидает `~54.0.36`.
- Metro `watchFolders` перезаписывает default list.
- Doctor не понимает намеренное React dedupe и динамический config.

**Исправление:** обновить безопасный patch, объединять default watchFolders,
а намеренные исключения документировать в Expo config, если поддерживается.

## P2 — документация

`AGENTS.md`, `docs/architecture.md`, `docs/roadmap.md` всё ещё описывают
single-tenant localStorage-прототип и Expo-stub. Фактически работают Supabase,
RLS/Auth, offline SQLite/MMKV, realtime и полноценный mobile client.

**Исправление:** обновить только фактическое состояние и команды; handoff
оставить историческим снимком.

## Волны реализации

1. **W1 data safety:** deep-link hydration, team validation, client dedupe +
   tests; mobile tsc/lint/shared tests, simulator flow.
2. **W2 discoverability/accessibility:** создание без FAB + footer mockup,
   44 pt/VoiceOver, split `/book`; повторная HIG/Halo проверка.
3. **W3 quality gates:** runtime pin, web lint risk group, Expo Doctor patch.
4. **W4 dependencies/docs/compliance:** адресные upgrades, актуализация docs,
   отдельный backend-план удаления аккаунта.

Каждая волна — отдельные логические коммиты. Push/PR только по явной просьбе.

## Release handoff

- Код не закоммичен, не отправлен и не задеплоен в рамках аудита.
- Native account deletion начнёт работать через default production URL только
  после deploy обновлённого `/api/account/delete`; до этого production route
  остаётся cookie-only версией прошлого релиза.
- После deploy нужен test tenant/user: открыть подтверждение в mobile, удалить
  только тестовый аккаунт, проверить auth user + tenant cascade и локальный wipe.
- Owner iPhone smoke остаётся обязательным release gate; simulator не заменяет
  проверку на физическом устройстве.

## Приёмка

- Mobile `bunx tsc --noEmit`, `bunx expo lint`, 48+ shared tests — зелёные.
- Web `tsc`, 78 tests на закреплённом runtime, `next build` — зелёные.
- Deep-link из карточки сохраняет корректные client/location/address/team.
- Нельзя создать дубль клиента по нормализованному телефону.
- Root calendar создаёт запись без floating FAB, через тап по свободному слоту.
- Все новые интерактивные цели ≥44 pt и озвучиваются VoiceOver.
- Light-only решение явно закреплено и документация ему не противоречит.
- Проверка на iPhone владельца по фото; при отключённом телефоне — simulator.
