# docs — оглавление

Правила работы — не здесь, а в [`../AGENTS.md`](../AGENTS.md). Эта папка —
справка и история. Документ, которого нет в разделе «Живые», правилом не
является: решения в нём могли быть отменены позже.

## Живые — описывают продукт, каким он есть сейчас

| Документ | О чём |
|---|---|
| [`architecture.md`](architecture.md) | Как устроены приложение, общий пакет, офлайн-синхронизация и слои кода |
| [`db/README.md`](db/README.md) + [`db/schema/`](db/schema/) | Карта базы и снимок живой схемы (таблицы, политики, функции) |
| [`SKELETON.md`](SKELETON.md) | Как собирается экран: шапка, загрузка, пустое состояние |
| [`../apps/mobile/docs/DESIGN-SYSTEM.md`](../apps/mobile/docs/DESIGN-SYSTEM.md) | Дизайн-канон «Halo Cobalt» |
| [`../apps/mobile/docs/BLOCKS.md`](../apps/mobile/docs/BLOCKS.md) | Готовый код каждого блока и его шторки (сторожит тест) |
| [`SETUP.md`](SETUP.md) | Как поднять проект локально |
| [`APPLE-RELEASE.md`](APPLE-RELEASE.md), [`LAUNCH-CHECKLIST.md`](LAUNCH-CHECKLIST.md), [`STORE-LISTING.md`](STORE-LISTING.md) | Выпуск в магазины и по воздуху |
| [`BRAND.md`](BRAND.md) | Знак и бренд |
| [`observability.md`](observability.md) | Sentry и журналы |
| [`agents.md`](agents.md) | Доменные агенты Claude Code |

Не обновлялись с 2026-08-25 и местами отстали от продукта — сверять с кодом:
`roadmap.md` и `backlog.md` (приоритеты сейчас задаёт владелец в разговоре),
`finance-model.md` (ещё описывает расходы «компании», которых больше нет),
`glossary.md`, `coding-patterns.md`, `design-language.md`.

## Планы и разборы — почему что-то сделано так

`PLAN-*.md`, [`plans/`](plans/), [`adr/`](adr/) — решения с обоснованием на дату
в имени. `PLAN-COMPANIES-2026-10-11.md` описывает модель компаний, которую
откатили 12.10.

## История — не правила

| Где | Что |
|---|---|
| `HANDOFF-*.md` | Записи о прошлых сессиях; содержат отменённые решения |
| [`stories/`](stories/) | Истории задач STORY-NNN |
| [`sprints/`](sprints/) | Спринты весны 2026 |
| [`audit/`](audit/) | Аудиты и снимки экранов до 2026-09-10 |
| `EXPO-RN-MIGRATION-PLAN.md`, `MIGRATION-WEB-TO-EXPO.md`, `EDGE-FUNCTIONS-CUTOVER.md`, `IOS-ALIGNMENT.md`, `PRICING-ANALYSIS-2026-08-27.md` | Завершённые переезды и разборы |
| [`ideas/`](ideas/), [`corporation/`](corporation/) | Ранние заметки апреля 2026 |
