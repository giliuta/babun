# Babun CRM

> ⭐ **ЕДИНСТВЕННЫЙ ИСТОЧНИК ПРАВИЛ.** `CLAUDE.md` — указатель на этот файл, чтобы две копии
> правил больше не расходились. Правки вносим только сюда.
>
> **Вся разработка — в `apps/mobile`.** Ветка проверяется командой
> (`git branch --show-current`), а не памятью: на 2026-08-25 это
> `feat/unified-expo-web`. Хендоффы `docs/HANDOFF-*.md` — записи о прошлых
> сессиях; они содержат отменённые с тех пор решения (в частности, `Fab`),
> поэтому канон правил — этот файл, а не они.
> Правила: команды через `bun`/`bunx`;
> `bun run typecheck` = 0 перед любым «готово»; LOCKED-дизайны и стандарт «Добавить»
> (во всём mobile UI запрещены floating FAB и голый «+»: действия создания всегда подписаны текстом; `+` допустим только как часть телефонного кода; календарная запись создаётся тапом по свободному времени);
> mobile UI всегда светлый — без dark palette, системного переключения или настройки темы; дизайн-канон `apps/mobile/docs/DESIGN-SYSTEM.md`;
> master только через PR. Текущий приоритет — `docs/roadmap.md`.

## Identity
CRM + скоро SaaS для сервисных бизнесов. Первый клиент — **AirFix** (кондиционеры, Кипр). Числа в базе на 2026-08-27: **2 клиента, 2 записи, 1 команда** — тенант `AirFix LTD`, заведён 2026-04-28. Прежняя формулировка «2 бригады, 903+ клиентов» описывала намерение, а не факт, и по ней уже принимались решения о нагрузке. Числа проверяются запросом, а не памятью. В будущем продаём как платформу другим сервисам.

## Stack (LOCKED — не менять без явного запроса)
- **Framework:** Expo SDK 54 / React Native — один код на iOS, Android и Web
- **Web:** React Native Web через `expo export --platform web` (Next.js снесён 2026-08-25)
- **Monorepo:** bun workspaces (`apps/mobile`, `packages/shared`); turbo стоит в devDependencies, но установку и скрипты ведёт bun
- **Language:** TypeScript strict mode
- **Styling:** NativeWind (Tailwind v4 синтаксис поверх RN StyleSheet)
- **DB:** Supabase (PostgreSQL + RLS + Auth + Realtime); SQLite/MMKV — offline-кэш и очередь
- **Deploy:** Vercel — сборка `bun run build:web` из `apps/mobile`
- **Repo:** github.com/giliuta/babun — branch **`master`** (не `main`)

## Operating Mode — AUTONOMOUS-WITH-VERIFY (MUST читать первым, нарушение = откат всей сессии)

Пользователь не хочет «спросить и сделать». Он хочет «сделать без поломок».
Это значит: автономно — да. Без верификации — НЕТ. Каждая задача проходит
через эти 5 шагов, в этом порядке, без сокращений:

1. **DB SCHEMA CHECK.** До любой записи в Supabase — `list_tables` или
   `execute_sql information_schema.columns` для целевой таблицы. Если код
   пишет колонку которой нет — миграция применяется ПЕРВЫМ отдельным
   коммитом до кода клиента. Никаких «graceful-fallback на 42703» в
   качестве замены проверки. Schema-mismatch = баг, не feature.

2. **STATE PRESERVATION.** Перед изменением любого useState default или
   `load*()` функции — проверить что у текущего пользователя НЕ изменится
   видимое поведение. `useState(true)` → `useState(false)` без cache = баг
   на каждый mount. Lazy initializer из сохранённого состояния = норма.

3. **NO DESIGN OPINIONS.** Если пользователь не описал визуально как
   должна выглядеть фича — НЕ ВЫБИРАТЬ. «Современнее» / «cleaner» /
   «mobile-first» — не аргумент для изменения существующего UI. Любая
   правка визуала которую он сейчас видит каждый день = требует
   подтверждения мокапом ДО коммита. Агентские brainstorms — это inputs,
   не decisions.

4. **RUNTIME VERIFICATION.** После каждой правки — открыть экран в
   симуляторе (навык `babun-sim`), прогнать ТОТ ЖЕ user-flow что чинил,
   сделать скриншот. «typecheck зелёный» не равно «работает». «Push прошёл»
   не равно «работает у пользователя». «Я считаю что работает» не равно
   «работает».

5. **SCOPE DISCIPLINE.** Один коммит = одна причина. Никаких комбинированных
   правок, в которых одновременно фикс sync banner + миграция + ещё 3 файла.
   Если задача требует 5 изменений → 5 проверок. Это медленнее, но в 10×
   реже ломает.

## Golden Rules (MUST — нарушение = откат)
1. **НИКОГДА** не удаляй и не перемещай `apps/mobile/app/` — там маршруты expo-router
2. **ВСЕГДА** `bun run typecheck` после серии правок в одной фиче (не обязательно после каждого файла — наш tsc медленный)
3. **ВСЕГДА** проверяй визуальную правку в симуляторе рядом с соседними состояниями и присылай скриншот — «скомпилировалось» не доказательство
4. **НИКОГДА** не заводи вторую дорогу создания сущности — короткая форма это нижний лист, сущность-владелец это страница
5. **ПУШ АВТОМАТИЧЕСКИЙ, PR И ДЕПЛОЙ — НЕТ.** Владелец 2026-08-25 попросил,
   чтобы каждый коммит сам уезжал на GitHub: это делает хук `.githooks/post-commit`.
   Перед отправкой `.githooks/pre-push` гоняет `bun run typecheck` и `bun test` и
   отменяет push, если красное — ветка `master` кормит Vercel, то есть babun.app,
   и сломанный коммит там виден клиенту. Хуки включаются один раз:
   `git config core.hooksPath .githooks`. Обойти осознанно: `git push --no-verify`.
   PR и деплой по-прежнему только по явной просьбе владельца.
5.1 **ВЫБОР ГЛАЗАМИ, А НЕ СЛОВАМИ (LOCKED 2026-08-27).** Владелец: «прикольная идея, что ты сразу в приложении мне показываешь — так вот и делай». Когда решение визуальное и вариантов больше одного (радиус, кегль, оттенок, плотность, порядок блоков), НЕ описывай их словами и не проси представить. Собери варианты РЯДОМ на одном экране в симуляторе, подпиши каждый его числом и пришли скриншот. Причина: словами «менее круглое» описывается любое число от 4 до 24, и стоимость промаха — целый заход работы; сравнение вживую стоит одну минуту. Строительные леса (временный проп, экран-сравнение) сносятся тем же заходом и в коммит не уходят — если решение не принято сразу, они живут в рабочем дереве, а не в истории.
6. **НИКОГДА** не используй `any` — если TypeScript ругается, разбирайся с типами, а не обходи
7. **Максимум 400 строк** на компонент — если больше, разбивай на sub-components
8. **RU в UI, EN в коде.** Переменные, функции, комментарии — только английский
9. **Один логический коммит = одно сообщение.** Не меняй 10 несвязанных файлов в один commit
10. **НИКОГДА** не ставь хуки, которые запускают `tsc` на каждую правку — наш tsc медленный, это убьёт сессию. Живут такие хуки в `.claude/settings.local.json` — файл локальный, в git его нет (`.gitignore`), правит его только владелец
11. **НИКОГДА** не «улучшайзь» существующий UI без явного запроса. Refactor — да (если не виден пользователю). Redesign — нет.
12. **НИКОГДА** не говори «готово» / «работает», если не открыл экран в симуляторе и не прошёл сценарий руками

## Architecture

```
Babun/
├── AGENTS.md                    # Этот файл — единственный источник правил
├── CLAUDE.md                    # Указатель на AGENTS.md, своих правил не содержит
├── package.json                 # Корень workspace: ios / android / web / build:web / typecheck / test / lint
├── vercel.json                  # Сборка веба: bun run build:web → apps/mobile/dist, SPA-rewrite на /index.html
├── apps/
│   └── mobile/                  # Expo SDK 54 / React Native — ЕДИНСТВЕННОЕ приложение
│       ├── app/                 # expo-router: экраны и маршруты
│       ├── src/components/      # UI-примитивы (BottomSheet, PickerSheet, SwipeRow …)
│       ├── src/features/        # calendar, clients, finances, services, invoices …
│       ├── docs/DESIGN-SYSTEM.md# Дизайн-канон «Halo Cobalt»
│       ├── .env.example         # Шаблон EXPO_PUBLIC_* → копировать в .env.local
│       └── ios/  android/       # Генерируются `expo prebuild` — в git НЕ лежат
├── packages/
│   └── shared/                  # Типы БД, доменные хелперы, offline cache/sync
├── supabase/
│   ├── migrations/              # 121 SQL-миграция — единственный источник схемы
│   ├── functions/               # Edge-функции (7 шт)
│   └── config.toml
├── docs/                        # architecture, stories, adr, audit, plans
├── mockups/                     # HTML-прототипы экранов
└── .github/workflows/ci.yml     # Должен гонять `bun install --frozen-lockfile` + typecheck / test / lint / build:web
```

CI обязан повторять те же гейты, что и локальный `/test`: bun, а не npm;
`bun test`, а не vitest; `bun run build:web`, а не `next build`. **Пока файл не
переписан владельцем, он остался от Next.js-эпохи и в этом дереве не работает —
проверь `head .github/workflows/ci.yml` прежде чем на него полагаться, и в любом
случае гоняй гейты локально: зелёный CI не отменяет правило 12.**

Тесты гоняет `bun test` из корня (раннер `bun:test`; файлы `*.test.ts` лежат
рядом с кодом). Числа здесь не записаны — они устаревают за день; их печатает
сам раннер последней строкой («Ran N tests across M files»). Отдельного конфига
нет — vitest в проекте не используется.

## Workflow — Plan-then-Code

### Фаза 1: Планирование (ОБЯЗАТЕЛЬНО перед кодом)
1. Прочитай `docs/architecture.md` и `docs/coding-patterns.md`
2. Прочитай актуальный `docs/roadmap.md`
3. Создай `docs/stories/STORY-NNN.md` через `/plan {feature}`
4. **НЕ ПИШИ КОД пока план не записан.** Показываем план — ждём «ок».

### Фаза 2: Реализация
1. Если фича > 5 файлов — создай ветку `feature/STORY-NNN`
2. Порядок: **миграции → types → shared → repositories → components → UI**
3. `bun run typecheck` после основных изменений
4. Коммит по смыслу (не «10 файлов за раз если они не связаны»)
5. Push/PR/deploy только по явной просьбе владельца

### Фаза 3: Верификация
1. `bun run typecheck` зелёный
2. `bun test` зелёный
3. `bun run lint` без новых ошибок
4. Экран пройден руками в симуляторе, скриншот отправлен
5. Обновить статус story на `done`

## Context Management
- **Новая большая фича → новая сессия** с `/clear`
- Перед `/clear` — сохрани прогресс в соответствующую `STORY-NNN.md`
- При возврате к проекту: прочитай AGENTS.md → docs/roadmap.md → текущую STORY → `git log --oneline -5`

## Critical Known Issues
- **Пинч-зум сетки календаря** живёт в `apps/mobile/src/features/calendar/zoom.tsx`
  (gesture-handler + reanimated). Высота часа `hourHSv` мутируется на UI-потоке в
  границах `HOUR_H_MIN=28` … `HOUR_H_MAX=200` (дефолт 64). НЕ переводить её в
  React-state внутри жеста — зум начнёт дёргаться.
- **Горизонтальный пейджинг периода** — `apps/mobile/src/features/calendar/pager.tsx`:
  «бесконечная ось», смонтированы ровно три слота `idx−1 / idx / idx+1`, key = номер
  страницы. Не монтировать больше и не менять key на дату — потеряется бесшовный коммит.

## Commands (см. `.claude/commands/`)
- `/plan {feature}` — план новой фичи → `docs/stories/STORY-NNN.md`
- `/implement {story-id}` — реализация story по плану
- `/test` — `bun run typecheck` + `bun test` + `bun run lint`
- `/review` — анализ `git diff master`
- `/status` — dashboard состояния проекта
- `/debug {описание}` — диагностика бага
- `/setup` — проверка окружения
- `/clarify {идея}` — сократический разбор до планирования
- `/walkthrough` — проход экрана глазами живого пользователя
- `/second-opinion` — независимый разбор текущего диффа
- `/full-pipeline` — вся цепочка агентов на одной задаче

## Agents (см. `.claude/agents/`)
- **architect** (opus) — архитектурные решения, ADR, без кода
- **developer** (sonnet) — реализация по story, один коммит = одна причина
- **tester** (sonnet) — тесты `bun:test` рядом с кодом (`*.test.ts`)
- **reviewer** (opus) — code review через git diff

Полный индекс доменных агентов — `docs/agents.md`.

## Dev Workflow Tools
- `bun run web` → React Native Web на localhost:8081, тот же код что и на телефоне
- Симулятор iPhone — основной способ проверки (см. навык `babun-sim`)
- Живой цикл на физическом iPhone владельца: Metro на :8081, `expo-dev-client` в сборке

## Quick Reference
```bash
# Разработка
bun run ios          # запустить на iOS (expo prebuild + run)
bun run android      # запустить на Android
bun run web          # React Native Web в браузере (localhost:8081)
bun run start        # Metro, выбор платформы вручную

# Гейты перед «готово»
bun run typecheck    # tsc --noEmit, должен быть 0
bun run test         # bun test (раннер bun:test)
bun run lint

# Сборка веба ровно так же, как это делает Vercel
bun run build:web

# Git: коммит уезжает на GitHub сам (хук post-commit), гейты в pre-push.
# PR и деплой — только по явной просьбе владельца.
```

## Working with element-context MCP

When element context arrives from the browser bridge:
1. Always read the linked component file fully before editing
2. Respect existing patterns:
   - Colours come from `apps/mobile/docs/DESIGN-SYSTEM.md` and the tokens in
     `apps/mobile/global.css` (brand `#2c5be0`) — never hardcode a new hue
   - Components max 400 lines, split if needed
   - RU strings in UI, EN in code/comments
   - TypeScript strict, no `any`
   - Named exports (route files under `apps/mobile/app/**` are the one exception —
     expo-router requires a default export)
   - handle{Event} naming convention
3. Show diff before applying changes
4. Don't change unrelated code in the same file
