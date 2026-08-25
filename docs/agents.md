# Babun Agents — когда и кого звать

Специализированные Claude-агенты для Babun. Каждый знает доменную область, правила проекта, invariants, и возвращает целевой output-формат.

Вызываются через `Agent({ subagent_type: "<name>" })`. В UI Claude Code доступны как subagent.

> Это индекс. Сами инструкции агентов лежат в `.claude/agents/*.md`; адреса в них
> приведены к RN-дереву (сверка 2026-08-25). Здесь — те же адреса; заводя нового
> агента, бери пути отсюда.
>
> Утверждать «битых путей нет» бессмысленно — дерево меняется. Проверяй сам:
>
> ```bash
> grep -rn 'apps/web' .claude/agents/            # должно быть пусто
> # а дальше — выдёргивай пути из ``…`` и прогоняй через test -e
> ```

## Экранные эксперты

| Имя | Когда звать |
|-----|-------------|
| `babun-calendar-expert` | Любые правки в `apps/mobile/app/(dashboard)/(home)/calendar/**` и `apps/mobile/src/features/calendar/**`. Знает пинч-зум (`zoom.tsx`), горизонтальный пейджинг (`pager.tsx`), gesture conflicts, TimeColumn invariants |
| `babun-appointment-form-expert` | `apps/mobile/app/book/**` + `src/features/appointments/**`: время, клиент, объект, услуги, деньги и все листы. Знает правило «создание — нижний лист, сущность — страница» |
| `babun-client-domain-expert` | `apps/mobile/app/(dashboard)/clients/**` + `src/features/clients/**`: теги, заметки, техника, поиск по 903 клиентам, слияние дублей |
| `babun-finance-expert` | `src/features/finances/**` + счета, расходы, зарплаты, отчёты, разбивка по бригадам. Один источник правды для прибыли — его работа |
| `babun-brigades-expert` | Brigades vs Teams (два разных концепта!), графики, строки зарплаты, каскад при удалении команды |
| `babun-settings-expert` | Кабинет и настройки (`app/(dashboard)/cabinet/**`, `clients/settings`, `calendar` settings). Следит чтобы каждая настройка реально персистилась |

## Cross-cutting эксперты (знают всё приложение)

| Имя | Когда звать |
|-----|-------------|
| `babun-design-system-keeper` | Перед любой UI-правкой. Канон — `apps/mobile/docs/DESIGN-SYSTEM.md`: бренд `#2c5be0` (`--color-brand` в `apps/mobile/global.css`), радиус только 10px / полный круг, тема строго светлая |
| `babun-data-loss-guardian` | Любой код работы с close/dismiss/delete/backdrop/cascade. Ищет silent data loss и предлагает undo-toast или confirm |
| `babun-mobile-ux-auditor` | Перед каждым merge UI-изменения. 44×44 тап, thumb zone, iOS safe-area, клавиатура, контраст под солнцем |
| `babun-copy-keeper` | Любой user-visible текст. RU в UI / EN в коде, tone, empty states, SMS templates, destructive confirms |
| `babun-hvac-domain-expert` | Проектирование фич про A/C units, recurring cleaning, crew workflow, Cyprus specifics |
| `babun-release-captain` | В конце каждой фичи: bump `BUILD_VERSION` (`packages/shared/src/common/utils/version.ts`) + `bun run typecheck` + `bun test` + `bun run lint` + чистый коммит. Push/PR — только по просьбе владельца |

## Существующие универсальные

| Имя | Назначение |
|-----|-----------|
| `architect` | Architecture decisions, ADRs, без кода |
| `strategist` | План до кода, разбор результата после `developer`, корректирующие промпты. Код не пишет |
| `developer` | Implementation по story |
| `tester` | Тесты на `bun:test` (`*.test.ts` рядом с кодом; сколько их — печатает `bun test`) |
| `reviewer` | Diff review перед PR |
| `designer` | UI/UX-разбор по скриншотам из симулятора, рекомендации сниппетами RN/NativeWind |
| `ux-tester` | Проходит юзер-флоу на симуляторе как живой человек, ищет неудобства и edge cases |
| `security-auditor` | Multi-tenant изоляция: утечки `tenant_id`, RLS, хардкоды AirFix |

## Пример workflow для одной фичи

```
/clarify <идея>                   → понять что хочет пользователь
Agent(babun-hvac-domain-expert)   → проверить что фича имеет смысл
/plan <feature>                   → STORY-NNN.md
Agent(babun-design-system-keeper) → валидация UI до написания
Agent(babun-<screen>-expert)      → реализация
Agent(babun-data-loss-guardian)   → проверка delete/close путей
Agent(babun-copy-keeper)          → вычитка копирайта
Agent(babun-mobile-ux-auditor)    → аудит на мобилке
/second-opinion                   → независимое мнение
Agent(babun-release-captain)      → bump + гейты + коммит
```

## Правило использования

**Не зови агента ради агента.** Если изменение — 10 строк в одном месте, делай сам. Агенты экономят твой контекст только когда:
- Задача big-picture и нужен широкий аудит
- Нужна специализация (HVAC, design system, mobile)
- Требуется independent opinion

**Параллельный запуск** — когда нужно 5-6 аудитов по разным экранам разом, запускай в одном сообщении с `run_in_background: true`, потом собирай в итоговый документ.
