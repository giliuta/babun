# Babun CRM — Design Language (iOS + Telegram)

> ⛔ **АРХИВ. НЕ КАНОН.** Это дизайн-язык Next.js-веба, снесённого 2026-08-25:
> фиолетовый акцент, `SheetShell` вместо нижних листов, токены из
> `apps/web/src/app/globals.css`. Ни одного из этих файлов в дереве нет, и
> половина правил ниже прямо противоречит действующим.
>
> **Действующий канон — [`apps/mobile/docs/DESIGN-SYSTEM.md`](../apps/mobile/docs/DESIGN-SYSTEM.md)**
> («Halo Cobalt»: бренд `#2c5be0`, радиус только 10 px / полный круг, тема строго
> светлая, короткая форма = нижний лист). Файл оставлен как запись о прошлом —
> сверяться с ним нельзя, ссылаться в новых документах тоже.

Спека веб-интерфейса на момент **Sprint 029 Phase 0** (2026-04-21). Тогда она
была канонической: «не совпадает экран — правь экран, не документ». Сегодня —
описание того, чего больше нет.

> **Mental model**: iOS Settings app layout and typography, with Babun's violet accent wherever iOS uses system-blue. Telegram-style warmth in dense views (chat list, client list). Nothing is decorative for its own sake.

---

## 1. Tokens

Всё лежало CSS-переменными в `apps/web/src/app/globals.css` и дублировалось типами в `apps/web/src/lib/design-tokens.ts` (оба файла удалены вместе с вебом). Tailwind v4 surfaces them as utility classes via `@theme inline`.

### 1.1 Surfaces

| Token | Hex | Used for |
|---|---|---|
| `--surface-grouped` | `#F2F2F7` | Screen background (canvas behind grouped lists) |
| `--surface-card` | `#FFFFFF` | Cards on top of grouped surface |
| `--surface-card-secondary` | `#F2F2F7` | Nested inputs inside cards |
| `--surface-overlay` | `rgba(0,0,0,0.4)` | Modal backdrop |
| `--surface-nav-blur` | `rgba(255,255,255,0.8)` | BottomTabBar / nav bars |

### 1.2 Separators

| Token | Value | Used for |
|---|---|---|
| `--separator` | `rgba(60,60,67,0.12)` | Hairlines between rows in a list |
| `--separator-opaque` | `#C6C6C8` | Opaque separator (table headers) |

### 1.3 Labels

| Token | Value | Used for |
|---|---|---|
| `--label` | `#000000` | Primary text |
| `--label-secondary` | `rgba(60,60,67,0.6)` | Subtitles, captions |
| `--label-tertiary` | `rgba(60,60,67,0.3)` | Placeholders, disabled text |
| `--label-quaternary` | `rgba(60,60,67,0.18)` | Chevron tint, tiny glyphs |

### 1.4 Fills (interactive idle states)

| Token | Value | Used for |
|---|---|---|
| `--fill-primary` | `rgba(120,120,128,0.2)` | Buttons at rest |
| `--fill-secondary` | `rgba(120,120,128,0.16)` | Hover/press state |
| `--fill-tertiary` | `rgba(118,118,128,0.12)` | Input backgrounds |
| `--fill-quaternary` | `rgba(116,116,128,0.08)` | Row press state |

### 1.5 Accent + system semantics

| Token | Hex | Used for |
|---|---|---|
| `--accent` | `#7C3AED` (violet-600) | Primary fills, active nav, links |
| `--accent-pressed` | `#6D28D9` | Pressed state of primary buttons |
| `--accent-tint` | `#EDE9FE` | Tinted pill backgrounds |
| `--system-red` | `#FF3B30` | Destructive actions |
| `--system-green` | `#34C759` | iOS switch on-state |
| `--system-orange` | `#FF9500` | Warnings |
| `--system-blue` | `#007AFF` | iOS default link (rarely used — we prefer accent) |

---

## 2. Typography

### 2.1 Font stack

```css
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
             var(--font-inter), "Segoe UI", Roboto, Helvetica, Arial,
             system-ui, sans-serif;
```

- iOS + macOS get **SF Pro** natively.
- Android / Windows fall back to **Inter** (shipped via Next/font with cyrillic subset).
- Latin-only OSes drop to Segoe / Roboto.

### 2.2 Type scale (Apple HIG 1:1)

| Style | Size/LH | Weight | Used for |
|---|---|---|---|
| Large Title | 34/41 | 700 | Never used in Babun (too loud for CRM) |
| Title 1 | 28/34 | 700 | Hero numbers in finances |
| Title 2 | 22/28 | 600 | Page titles when no nav bar |
| Title 3 | 20/25 | 600 | Sheet section headers |
| Headline | 17/22 | 600 | PageHeader title |
| Body | 17/22 | 400 | Default text |
| Callout | 16/21 | 400 | Secondary body |
| Subhead | 15/20 | 400 | List row labels (iOS default) |
| Footnote | 13/18 | 400 | Row subtitles |
| Caption 1 | 12/16 | 500 | Chips, small captions |
| Caption 2 | 11/13 | 600 | Section headers (uppercase, tracking-wider) |

Letter-spacing: `-0.02em` on titles, `-0.01em` on body, `0.05em` on caption-2 uppercase.

Tabular numerals applied globally on `body` — no per-element class needed.

---

## 3. Icons

- **Library**: [`lucide-react`](https://lucide.dev). No emoji in chrome.
- **Stroke**: 2 default, 2.5 for emphasis (close buttons, primary CTAs).
- **Sizes**: 14 (inline chips), 16 (list row accessory), 18 (section icons), 20 (sheet actions).
- **Tiled presentation** (iOS Settings style): icon sits inside a 28×28 `rounded-lg` coloured tile with a white glyph. Tones exposed as `IconTone` in design-tokens.ts.

Emojis that survive: user-entered data (tag names, category labels the admin types in). Everywhere else — lucide.

---

## 4. Spacing

Apple's 8-pt grid, applied 1:1 on web.

| Token | Value |
|---|---|
| `xs` | 4 |
| `sm` | 8 |
| `md` | 12 |
| `lg` | 16 |
| `xl` | 20 |
| `xxl` | 24 |

- Outer page padding: `px-4 py-4` mobile, `px-6 py-6` desktop.
- Between groups on a screen: `space-y-5` (20 px).
- Inside a row: `px-4 py-3 min-h-[48px]`.

---

## 5. Radii

| Token | Value | Used for |
|---|---|---|
| `sm` | 6 | Small chips |
| `md` | 10 | Buttons, inputs |
| `lg` | 14 | Smaller cards |
| `xl` | 16 | Standard cards |
| `xxl` | 20 | Modal sheets |

iOS buttons are fills + radius, never `border-2`.

---

## 6. Primitive kit

Жили в `apps/web/src/components/ui/` (удалено). Импортировались из barrel:

```tsx
import {
  ListGroup, ListRow, ToggleRow, IOSSwitch,
  SegmentedControl, SheetShell,
  Button, Chip, Input, SectionHeader,
} from "@/components/ui";
```

### 6.1 `<ListGroup>`

iOS grouped-list section — caption · card · footnote.

```tsx
<ListGroup title="РАЗДЕЛЫ" footer="Пояснение под карточкой">
  <ListRow icon={CalendarDays} iconTone="violet" label="Календарь" href="/dashboard/settings/calendar" />
  <ListRow icon={MapPin} iconTone="rose" label="Города" href="/dashboard/settings/cities" />
</ListGroup>
```

Children of `ListGroup` are divided by a 1 px hairline automatically (card has `divide-y divide-[var(--separator)]` via `rounded-2xl overflow-hidden` + your own divider class if needed). Dividers are always the CSS variable, never slate-100.

### 6.2 `<ListRow>`

Single row. Three variants: `href` (Link), `onClick` (button), neither (display-only div).

Props: `icon`, `iconTone`, `label`, `subtitle`, `accessory`, `chevron`, `destructive`.

### 6.3 `<ToggleRow>`

Sugar over `ListRow` with a trailing `IOSSwitch`. Use in `<ListGroup>`:

```tsx
<ToggleRow label="Клиент обязателен" checked={v} onChange={setV} />
```

### 6.4 `<IOSSwitch>`

46×28 px, emerald-500 on-state. Never violet.

### 6.5 `<SegmentedControl>`

iOS segmented pill group.

```tsx
<SegmentedControl
  options={[
    { value: "day", label: "День" },
    { value: "week", label: "Неделя" },
  ]}
  value={viewMode}
  onChange={setViewMode}
/>
```

### 6.6 `<SheetShell>`

Centered modal shell with sticky header + scrollable body + optional footer. Escape + backdrop tap close.

```tsx
<SheetShell open={open} onClose={close} title="Новый клиент" footer={<Button>Сохранить</Button>}>
  <div className="p-4 space-y-4">…</div>
</SheetShell>
```

### 6.7 `<Button>`

Variants: `primary` (violet fill, max 1 per row), `secondary` (neutral fill, for "Отмена"), `tinted` (translucent accent), `ghost` (label-only), `destructive` (rose label).

Sizes: `sm` (32 px), `md` (44 px — default), `lg` (50 px).

### 6.8 `<Chip>`

Filter pill. `active` prop drives accent fill vs white+border.

### 6.9 `<Input>`

iOS-inset text input with optional `label`, `hint`, `trailing` slot. `forwardRef` — compatible with any form library or native DOM handler.

### 6.10 `<SectionHeader>`

Standalone 11-px uppercase caption above non-grouped blocks. Optional right-aligned action link ("Все →").

---

## 7. Page layouts

### 7.1 Settings-style screen (the canonical one)

```tsx
<PageHeader title="Настройки" />
<div className="flex-1 overflow-y-auto bg-[var(--surface-grouped)]">
  <div className="max-w-3xl mx-auto px-4 py-4 space-y-5">
    <ListGroup title="РАЗДЕЛЫ">…</ListGroup>
    <ListGroup title="ПОЛЯ" footer="Что показывать в форме">…</ListGroup>
  </div>
</div>
```

### 7.2 Modal sheet screen

```tsx
<SheetShell
  open
  onClose={…}
  title="Сотрудник"
  footer={<div className="flex gap-2">…</div>}
>
  <div className="px-4 py-4 space-y-3">
    <ListGroup title="ЛИЧНЫЕ ДАННЫЕ">…</ListGroup>
    <ListGroup title="РАБОТА">…</ListGroup>
  </div>
</SheetShell>
```

### 7.3 Calendar / dense view

Retains its custom grid, but uses the same tokens (separators, label colours, accent). No grouped-list pattern — this surface is its own thing.

---

## 8. Anti-patterns

- `border-2 border-slate-*` anywhere. Use hairlines or fills.
- `bg-slate-50` / `bg-slate-100` hard-coded. Use `bg-[var(--surface-grouped)]` / `bg-[var(--fill-tertiary)]`.
- Violet iOS switches. The switch is always `--system-green`.
- Mixing Inter-bold with SF Pro-regular in the same line. Let the system pick one family; never force `font-inter` explicitly.
- `text-xs` / `text-sm` / etc. for chrome — use token pixel sizes so we don't drift.
- Decorative emojis in UI strings.
- Bottom-sheet modals (they collide with the tab bar). Always `SheetShell` centered.

---

## 9. Rollout schedule

Планировался спринт SPRINT-028-visual — он так и не был заведён, а сам rollout отменён вместе с веб-приложением.

- [x] Phase 0 — Foundation tokens + kit
- [ ] Phase 1 — Chrome (Header, Sidebar, BottomTabBar, PageHeader, global modals)
- [ ] Phase 2 — Calendar + Clients
- [ ] Phase 3 — Finances + Chats
- [ ] Phase 4 — Setup (services, teams, masters list, recurring, sms-templates, settings sub-pages)
- [ ] Phase 5 — AppointmentSheet body + picker sheets
- [ ] Phase 6 — Auth + edges (login, signup, share, 404)
