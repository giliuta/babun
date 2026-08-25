# «Halo Cobalt» — rollout plan (screen by screen)

How every screen adopts the locked system (`DESIGN-SYSTEM.md`). Primitives:
`ui/Halo` (ambient bloom), `ui/Card` + `SectionHeader`, `ui/GradientButton`
(+ `Button` already routes to it), `auth/AuthCard` (auth only). Each screen:
canvas `#f4f6f9` background, white `Card` surfaces, Display title flush-left,
`SectionHeader` eyebrows, money in success/danger, 20/14/999 radii, accent
gradient ONLY on brand surfaces.

Status legend: ✅ done · 🔜 ready (primitives in place) · ⏳ needs visual verify.

## Global (✅ done)
- Palette in `global.css @theme` + `tokens.ts` (cobalt, semantics, text tiers, canvas, separator).
- Shared `Button` → gradient pill / outline pill. `Field` → separator border + ink/sub.
- Reusable primitives built: `Card`, `SectionHeader`, `Halo`, `GradientButton`.

## Auth (✅ done — visual verify pending)
- `login` / `register` / `forgot-password` on `AuthCard` (ambient halo, gradient BrandMark, glass input card, gradient CTA + sheen, entrance).

## Calendar / home — `(dashboard)/index.tsx` (🔜)
- Root: canvas bg + `Halo` behind the header.
- Header: «Календарь»/date as Display 34 w800; grey gear button right; team-chip strip = pills (selected = accent fill, idle = surface + separator border).
- Список/День/Месяц segmented → pill segmented on a `Card`.
- Agenda rows / day blocks → `Card` tiles; appointment status via left accent bar + status badge (success/danger/warning tint). Money in row = Callout tabular.
- FAB → 56 accent-gradient circle + floating shadow (reuse GradientButton fill in a circle).

## Finances — `(dashboard)/finances.tsx` (⏳ flagship)
- Overview hero = a `Card` with profit as Display tabular (success if +, danger if −); Доход/Расход tinted; Счета link row.
- Period preset + scope chips → pill chips.
- Day-grouped feed → `SectionHeader` day dividers; each tx a row in a `Card`; amount success(income)/danger(expense). OperationSheet = sheet with grouped `Card` inputs + GradientButton CTA.
- ProfitBreakdown bars use accent / success / danger.

## Clients — `(dashboard)/clients/index.tsx` + `[id].tsx` (⏳)
- List: search field (Field style) on canvas; rows in a `Card` with 44 avatar tile, name Headline, phone·city Body sub, trailing balance (success credit / danger debt). Filters sheet = chips.
- Card `[id]`: header tile + money row; blocks (`ClientHeader`, objects, visits, finance, notes) each a `Card` with `SectionHeader`; primary actions = GradientButton / chip row.

## Chats — `(dashboard)/chats/*` (⏳)
- List rows in `Card`: avatar with channel tint, last-msg Body sub, unread = accent badge. Thread: bubbles (outgoing = accent gradient, incoming = surface), date dividers = `SectionHeader`.

## Cabinet (settings hub) — `(dashboard)/cabinet/*` (🔜 low-risk first)
- `cabinet/index.tsx`: canvas bg; grouped menu sections in `Card` with `SectionHeader` eyebrows; rows 56h, icon tile, chevron faint; «Выйти» = danger ghost.
- Sub-screens (services, teams, masters, cities, accounts, categories, templates, loyalty, calendar, event-types, object-types, inventory, recurring, close-day): list rows in `Card`, headers Display, add = GradientButton or accent «+», delete = danger. Bottom-sheets get grouped `Card` inputs.

## Shared chrome (⏳)
- `ScreenHeader` / `Screen`: optional canvas variant + `Halo` slot; large Display titles.
- Tab bar: surfaceElevated panel, top hairline, active = accent icon+label, idle = faint.
- `EmptyState`, `Divider`, `Toast`: separator color, accent for actions, tinted status.

## Deferred (needs native rebuild — do on next `expo run:ios`)
- Real `BlurView` (expo-blur) for true Liquid-Glass toolbars/tab bar/sheets.
- `expo-haptics` on primary actions; `expo-linear-gradient` (svg covers it for now).

## Execution order when device reconnects
1. Visually verify auth (login/register/forgot) → fix any pixel issues.
2. Cabinet hub + one sub-screen (lowest risk, proves the list/Card pattern).
3. Calendar home, then Finances (flagship), then Clients, then Chats.
4. Shared chrome (tab bar, headers) last so the frame matches the screens.
