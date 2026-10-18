# ADR — Cities vs Labels terminology unification

**Status:** `proposed` — awaiting decision
**Date:** 2026-05-21
**Deciders:** Dima (CEO/owner)
**Related:** `docs/audit/2026-05-21.md` items P1-31 (Pass 2) and P0-14 (Pass 3); glossary `docs/glossary.md`.

---

## 1. Is this ONE entity or TWO?

**It is ONE entity (the global "city/label library") consumed by THREE distinct subsets.**

A code-level audit found a single source of truth and three name-keyed consumer scopes built on top of it:

- **Library (1 table, 1 storage key).** `City { id, name, country, isActive, color? }` lives in `babun-crm/packages/shared/src/local/cities.ts` and is persisted under `localStorage["babun2:settings:cities"]`. CRUD page: `/dashboard/settings/cities` (title **"Города"**). Every label everywhere in the app resolves through this list by **name** (not by id) — see `CityPickerModal` lines 50-67 and `LabelRow.tsx`.

- **Brigade subset.** `team.cities: string[]` + `team.default_city: string` on each `team` row. CRUD page: `/dashboard/teams/[id]/cities` (URL slug `cities`, title **"Метки"**). The page imports `LabelRow as CityRow` and shares `AddLabelModal` with the personal page (`teams/[id]/cities/page.tsx:44-45`).

- **Personal-calendar subset.** `CalendarSettings.personalLabels: string[]` + `personalDefaultLabel` (Supabase columns `personal_labels jsonb`, `personal_default_label text` from migration `20260513000001_calendar_settings_personal_labels.sql`). CRUD page: `/dashboard/settings/calendar/labels` (URL slug `labels`, title **"Метки"**). Uses the **same** `LabelRow` + `AddLabelModal` components as the brigade page.

- **Per-day override** (sub-resource of brigade subset). `day_cities` table `(tenant, team, date) -> city_name`. Drives the chip under each weekday in `DayColumn.tsx:397-418` (icon: `MapPin`, fallback text: lowercase `"метка"`).

Note: the user's brief says the entity is `appointment.address_city` — that column does not exist. `appointments.address` is a free-text address string; city context is **never persisted on the appointment**, only resolved at render through `day_cities → team.default_city`. This actually strengthens the unification case because there is no schema migration to do on the appointments table.

So three UI labels are pointing at the same conceptual thing — a tag that paints a colour stripe on a calendar day and narrows the CityPickerModal — with two distinguished **scopes** (brigade-wide / personal). The library is shared.

## 2. Recommendation: which word everywhere?

**Use "Метка" (label) everywhere in RU UI. Keep `city` / `cities` in code, URLs, and DB column names (no migration).**

Why "Метка" wins:

1. **Generalization for SaaS.** The library already supports "Германия", "День ног", "Айя-Напа" as values (per the comment in `CityPickerModal.tsx:17-19` and `AddLabelModal.tsx:126`). A photo studio tenant labelling days "Студия / Выезд / Монтаж" is the killer SaaS case — "Города" reads as a hard contradiction. "Метка" is geography-agnostic by design.
2. **Density.** "Метка" is shorter (5 chars vs "Город" 5 chars / "Города" 6 chars — same in many forms, but "Метка" fits the 18px-tall day chip on a 375px iPhone better in oblique cases like "Без метки" vs "Без города").
3. **Already the dominant UI choice.** Of four user-facing surfaces, three already say "Метки" (brigade page, personal page, day chip placeholder + modal). Only `/settings/cities` is the outlier. Changing one page is cheaper than changing three.
4. **Glossary alignment.** `docs/glossary.md` doesn't currently fix this term (line 14 onward has no row for "город / метка"). Adding "Метка → label (concept) / city (legacy code)" to "История ключевых переименований" mirrors the same pattern already accepted for "бригада → команда" (v510) and "напоминания → возвраты" (v518).
5. **No DB migration needed.** Code stays on `city` / `cities` / `team.cities` / `personal_labels`. Glossary already establishes the "RU in UI, EN in code, can diverge" pattern.

## 3. Concrete change list (samples — not exhaustive)

Page titles + nav rows (4 spots):

- `babun-crm/apps/web/src/app/dashboard/settings/cities/page.tsx:149` — `title="Города"` → `title="Метки"`.
- `babun-crm/apps/web/src/app/dashboard/settings/page.tsx:162-163` — settings hub tile `title: "Города"` + `desc: "Лимассол, Пафос, Никосия — список и активность"` → `title: "Метки"` + new desc.
- `babun-crm/apps/web/src/app/dashboard/teams/[id]/cities/page.tsx:112, 309` — already "Метки", but add subtitle / confirm-dialog string scrub. Line 103 (city delete confirm copy in `settings/cities/page.tsx`) talks about "Города нельзя восстановить" — rewrite as "Метки нельзя восстановить".

Body copy / aria-labels / hints (samples):

- `babun-crm/apps/web/src/app/dashboard/settings/cities/page.tsx:47` — `placeholder="Город"` → `placeholder="Метка"`.
- `babun-crm/apps/web/src/app/dashboard/settings/cities/page.tsx:229` — "Активные города доступны при выборе…" → reword.
- `babun-crm/apps/web/src/components/calendar/DayColumn.tsx:333` — `aria-label={`${cityShort || "Без города"}, … — сменить город`}` → "Без метки … сменить метку".
- `babun-crm/apps/web/src/components/calendar/CalendarLegend.tsx` (around the "city" entry — verify line) — reword hint.

Code identifiers, hooks, props, DB columns, URLs: **do not change.** This is a pure RU-copy migration. `useCities`, `team.cities`, `personal_labels`, `/dashboard/settings/cities`, `CityPickerModal` all stay.

## 4. Migration plan

URL slug change is **out of scope.** `/dashboard/settings/cities` keeps its slug — three reasons:

1. The slug isn't visible chrome (no breadcrumb renders it), so the user never sees "cities" in the navbar.
2. Keeping the slug avoids a 301 redirect, sidesteps stale push-notification deeplinks, PWA install shortcuts, and `next/link` prefetch caches.
3. Glossary precedent: v510 renamed UI "Бригада → Команда" while keeping `/dashboard/teams` and `team_id` — same playbook applies here.

Migration steps:

1. **Glossary first** (one commit). Add canonical row to `docs/glossary.md` §"Доменные сущности": `| Метка | city (code) | Тэг дня в календаре. Используется на уровне бригады (team.cities) и личного календаря (personalLabels). EN-name "city" сохранён за совместимостью.` Add row to §"История ключевых переименований".
2. **UI copy sweep** (one commit, `chore: rename "Город" → "Метка" in UI`). All four surfaces in one PR — change is small, easy to verify in one Chrome MCP pass.
3. **Bump BUILD_TAG + sw.js CACHE_VERSION** (CLAUDE.md golden rule 3) — minor visual change, user should see it land.
4. **Chrome MCP verify** (CLAUDE.md operating-mode step 4) — open `/dashboard/settings/cities`, `/dashboard/settings/calendar/labels`, `/dashboard/teams/<id>/cities`, day chip on calendar; screenshot each.

Estimated: one developer session, ~25-40 UI strings touched, zero schema changes.

## 5. Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| localStorage keys (`babun2:settings:cities`, `babun-day-cities`) reference "city" in the key name. | None — internal. | Don't rename keys. Migration is text-only. |
| Supabase columns (`teams.cities`, `teams.default_city`, `calendar_settings.personal_labels`, `day_cities` table) reference "city". | None — internal. | Don't rename columns. database.types.ts stays intact. |
| RLS policies reference `day_cities` table by name. | None. | Table name unchanged. |
| Existing user mental model — AirFix dispatcher reads "Города" today, will read "Метки" tomorrow. | Low. | One-time toast or release-note line: "Раздел «Города» теперь называется «Метки» — поведение то же." Optional. |
| Search collision — when the user types "город" in spotlight / docs, they may not find the page. | Low. | Glossary update covers this. Page subtitle can keep "Лимассол, Никосия, Пафос…" to anchor city-as-default-use-case. |
| Push deeplinks / installed PWA shortcuts hardcoded to `/dashboard/settings/cities`. | None — URL unchanged. | No action. |
| Server endpoints / Stripe webhooks / Twilio webhooks. | None — none of them surface "Город" copy to the user. | No action. |
| Future breaking-change creep: someone reads "Метка" and assumes the entity has nothing to do with geography, then ships colour-tag-only logic. | Medium, long-term. | Glossary entry explicitly notes "часто используется как город, но не обязательно" — anchored to the SaaS-generalization story. |

The fail-soft posture: this change is **reversible in 25 strings** if it later turns out tenants prefer "Города". No schema, no URLs, no code identifiers, no migrations to roll back.

---

**Decision required:** Approve "Метка" everywhere in UI, or counter-propose. Author will not start UI sweep until decision is recorded here as `accepted`.
