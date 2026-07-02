# Babun Design System — «Halo Cobalt» (LOCKED v1)

A calm, premium, iOS-26-native system for an all-day HVAC field-service CRM. One decisive cobalt accent, a cool-grey ground that lifts white surfaces for free, honest faux-glass (no expo-blur), and color that always means something. Built on `react-native-svg + reanimated + boxShadow + NativeWind` only.

## 0. Principles
1. **Color = meaning.** Cobalt = brand/action. Green = money in / profit. Red = money out / debt / destructive. Amber = caution. Never decorate with semantic color.
2. **Hierarchy by weight + color, not size.** Max 3 type sizes per screen.
3. **«Неналяписто».** Apple-Settings restraint: one hero + one list region per viewport, generous top-of-screen breathing collapsing into efficient rows below.
4. **One signature gesture.** The cobalt gradient + halo sheen appears ONLY on brand surfaces (logo, primary CTA, FAB, active states). Everything else is restraint.
5. **Honest depth.** We don't fake a blur we can't render. Translucency + cool ground + tinted shadow do the work.

## 1. Palette
| Token | Light | Role |
|---|---|---|
| appBg | `#F4F6F9` | cool ground; lifts white for free |
| surface | `#FFFFFF` | cards, rows |
| surfaceElevated | `rgba(255,255,255,0.72)` | glass panels (toolbars, sheets, login hero) |
| accent | `#2C5BE0` | brand / action |
| accentGradientFrom→To | `#3E84FF` → `#1F4FCC` | the only gradient |
| onAccent | `#FFFFFF` | text/icon on accent |
| textPrimary / Secondary / Tertiary | `#0B1220` / `#5B6678` / `#66707E` | tertiary lightened only to `#66707E` — `#97A0AE` failed WCAG AA on canvas |
| separator | `#E7EBF0` | color, never a 1px border |
| fill | `#EEF1F5` | the ONE inset fill: idle chip, segmented track, inset input, search field (`t.fill`) |
| success / danger / warning | `#1FB47A` / `#F0473C` / `#F5A623` | money-in/profit · money-out/debt/destructive · caution |

**Dark:** appBg `#0B0E14`, surface `#161B24`, elevated `rgba(22,27,36,0.72)`, accent `#5A86FF`, separator `rgba(255,255,255,0.10)`, fill `rgba(255,255,255,0.07)`, text `#F2F5F9 / #9BA6B6 / #6B7686`, success `#2FD39A`, danger `#FF6B68`. Pure token inversion — no component rebuild. Runtime source of truth: `src/theme/colors.ts` (`useThemeColors()`); this table is the spec mirror.

## 2. Type scale (System SF, tracking tightens with size)
| Name | Size/LH | Weight | Track | Use |
|---|---|---|---|---|
| Display | 34/40 | 800 | -0.6 | root (tab) titles — Клиенты·Чаты·Финансы·Кабинет (`TYPE.display` in ui/tokens.ts), login brand, profit hero. Exception: the calendar root keeps its compact web-parity control bar |
| Title | 26/32 | 700 | -0.4 | sheet titles, secondary heroes |
| Headline | 17/22 | 600 | -0.2 | card titles, client name, row primary |
| Body | 15/20 | 400 | -0.1 | inputs, row secondary |
| Callout | 15/20 | 600 | — | money rows, buttons |
| Subhead | 13/18 | 500 | 0 | labels, helper, period pill |
| Caption | 11/14 | 700 | +0.6 | UPPERCASE eyebrows, day dividers |

`tabular-nums` on every money/count/€ value. Map: `text-2xl→Headline · text-base→Body · money→Callout+tabular · text-xs→Caption`.

## 3. Spacing & radii
8pt base, 4pt half-step for dense rows. Screen gutter 16 (28 on login). Card inner padding 16 (20 on hero cards). Inter-card gap 12. List row min-height 56 (input/chip 52/32). Section eyebrow: 24 top / 8 bottom. Separators left-inset 16 (68 on avatar rows). FAB 56×56 inset 20 bottom-right. **Radii:** card 20 · input 14 · pill 999 · logo 18.

## 4. Materials & depth (the three honest layers)
- **Ambient:** cool appBg + one SVG RadialGradient halo (accent 8–12%) — login + headers only.
- **Glass:** surfaceElevated View over SVG white→appBg gradient + 1px top highlight `rgba(255,255,255,0.9)` + 0.5px outer separator.
- **Elevation (boxShadow, two tiers + brand):**
  - Card: `0 1px 2px rgba(11,18,32,0.04), 0 8px 24px rgba(11,18,32,0.06)`
  - Floating/brand: `0 8px 28px rgba(44,91,224,0.28)` (accent-tinted — FAB, CTA, logo, active sheet)
- **Motion (Reanimated, intent only):** Pressable scale 0.97 + opacity 0.9 / 120ms; sheets spring damping 22; brand sheen 2.6s drift on login + FAB; nothing else loops.

## 5. Component recipes (implementations live in `src/components/ui/`)
- **Primary pill button** (`GradientButton`; auth `PillButton` is a thin alias): 52h min, radius 999, cobalt gradient fill, Callout 17 onAccent, floating shadow + two-sweep sheen. Disabled → flat `disabledFill`, no shadow. Loading → spinner. The ONE gradient CTA app-wide.
- **Grouped input card:** white, radius 20, card shadow; 52h rows, inset hairline divider, focused 1.5px accent inset ring (180ms).
- **List card/row** (`Card` / `SectionCard`): surface radius 20; 56h rows; primary Headline, secondary Body; trailing money Callout tabular tinted by sign; 44 avatar tile; separators left-inset 68.
- **Header** (`ScreenHeader large` / custom root rows): Display title flush-left, grey gear right (44 tap), optional team-chip strip (32h pills, selected accent fill).
- **Tab bar:** glass panel, top hairline, active accent / inactive textTertiary.
- **FAB** (`Fab`): 56×56, inset 20 bottom-right, cobalt gradient + brandShadow, mandatory `accessibilityLabel`.
- **Chips** (`Chip`): 32h pill + hitSlop to 44pt, `filled` selected → hue fill / idle → `fill`+sub; `outline` idle → surface + 1px hue border; `tint` selected → 8–16% hue tint. Radio semantics for single-choice groups; optional count badge.
- **Segmented control** (`SegmentedControl`): `fill` track (radius 12, 4pt inset), surface thumb, semibold labels — per-option active hue (e.g. danger «Расход»).
- **Colour picker** (`ColorPicker`): the ONE swatch grid — shared `PRESET_COLORS` (= web `TEAM_COLORS`), 36pt swatches, radio semantics with Russian colour names.
- **Toast** (`Toast`, single provider): top pill, success/danger/inverse-ink; every show is announced via `AccessibilityInfo.announceForAccessibility`.
- **Form sheets:** `Modal` + `KeyboardAvoidingView` (`behavior="padding"` on iOS) wrapping scrim + in-flow bottom sheet — every sheet with a TextInput.
- **Badges:** 20h pill, Caption, semantic tint at 12% over matching text — status only.

## 6. Per-screen application
- **Login:** the hero — see loginSpec. Single halo bloom, gradient logo + CTA, glass input card.
- **Finances:** Display «Финансы» + period control; profit hero in Display tabular cobalt; grouped-iOS overview (Счета as its own card; Доход green / Расход red tinted; Долги | Прибыль row); operations list with day eyebrows; team-chip scope strip in header.
- **Clients:** Display «Клиенты» + gear; list rows = avatar + name (Headline) + meta (Body) + money/status badge; filter summary bar with removable accent chips → centered «Фильтры» panel.

## 7. Dos / Don'ts
- DO use the cobalt gradient on logo, primary CTA, FAB, active states — nowhere else.
- DO let green/red carry money sign; keep cobalt for action.
- DO keep shadows accent-tinted on brand surfaces, neutral on plain cards.
- DO take messenger hues from shared `CHANNEL_COLORS` (WhatsApp/Telegram/Instagram/SMS) and picker palettes from shared `PRESET_COLORS` — never hardcode either.
- DON'T add a second accent or a violet/teal brand hue.
- DON'T use 1px borders where a separator color works.
- DON'T loop any animation except the single CTA/FAB sheen.
- DON'T exceed 3 type sizes or stack two competing heroes per viewport.