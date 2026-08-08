// «Halo Cobalt» — single app-wide light palette. Babun intentionally ignores
// the system appearance; components read these semantic tokens everywhere.
// This is the SINGLE source of truth for COLOR. Components call
// useThemeColors() and read t.* into inline styles, so the «no component
// rebuild» promise in DESIGN-SYSTEM.md holds app-wide; the auth screens read
// this via the useAuthTheme alias in components/auth/theme.ts.
export type ThemeColors = {
  statusBar: "dark" | "light";
  // surfaces
  canvas: string;
  surface: string;
  surfaceElevated: string;
  // brand + the ONLY gradient
  accent: string;
  accentFrom: string;
  accentTo: string;
  onAccent: string;
  brandAccent: string; // finance / profit accent — kept as a token but
  // aliased to the cobalt accent (DS: single accent, no second teal hue).
  // text tiers
  ink: string;
  body: string;
  sub: string;
  faint: string;
  placeholder: string;
  // semantic = meaning
  success: string;
  successInk: string;
  danger: string;
  warning: string;
  // seams + depth
  fill: string; // idle chip / segmented track / inset input fill
  separator: string;
  chevron: string;
  highlight: string;
  pressed: string; // row/button pressed fill
  /** Материал строки-фасета и оттиск-ряда в покое (ink 4%). */
  rowFill: string;
  /** Он же под пальцем — углубление, а не прозрачность (ink 8%). */
  rowFillPressed: string;
  scrim: string; // modal backdrop
  cardShadow?: string;
  brandShadow: string;
  disabledFill: string;
  haloOpacity: number;
  // auth social chips
  googleBg: string;
  googleBorder: string;
  googleText: string;
  // radii (scheme-invariant — colocated so one import drives a screen)
  radius: { card: number; input: number; pill: number };
};

// ОДИН РАДИУС НА ВСЁ (владелец 2026-07-27: «закругление краёв должно быть
// везде одинаковое — не надо, если блок больше, делать больше закругление;
// это хрень полная, должен быть стандарт везде»).
//
// Поэтому `card` и `input` — ОДНО число. Разными они и были той самой
// «зависимостью радиуса от размера блока»: белая карточка 20, поле внутри 14.
// Остаются ровно два геометрических исключения: `pill` — круг (аватар,
// пилюля-кнопка, точка: круг не может стать прямоугольником) и верхние углы
// нижнего листа (24, это край экрана, а не поверхность).
//
// `logo` удалён: мёртвый токен, ни одного чтения в продукте.
const RADIUS = { card: 14, input: 14, pill: 999 } as const;

export const light: ThemeColors = {
  statusBar: "dark",
  canvas: "#f4f6f9",
  surface: "#ffffff",
  surfaceElevated: "rgba(255,255,255,0.72)",
  accent: "#2c5be0",
  // White primary-button text remains AA-readable across the entire
  // gradient, including its lightest endpoint (4.81:1).
  accentFrom: "#2f6fd6",
  accentTo: "#1f4fcc",
  onAccent: "#ffffff",
  brandAccent: "#2c5be0",
  ink: "#0b1220",
  // ТЕКСТ — ЭТО ЧЁРНЫЙ С АЛЬФОЙ, А НЕ СЕРЫЙ ПИГМЕНТ (владелец 2026-07-27:
  // «убираем вообще серый, используем чёрный — оно в глаза мне не нравится»).
  // Раньше тиры были самостоятельными серыми (#39414e / #5b6678 / #626c79):
  // они уводили в холодную грязь и на светлом фоне читались как выключенные.
  // Теперь тир = ПРОЗРАЧНОСТЬ ЧЕРНИЛ: одна краска, разная громкость —
  // «прикрываем, не скрываем». Все четыре темнее прежних серых, поэтому
  // контраст только вырос (≥5:1 на surface и на canvas).
  body: "rgba(11,18,32,0.86)",
  sub: "rgba(11,18,32,0.74)",
  faint: "rgba(11,18,32,0.64)",
  placeholder: "rgba(11,18,32,0.62)",
  success: "#087a52",
  // Чернила поверх СВОЕЙ ЖЕ 20-% заливки: сам `success` на ней даёт 4.03:1 и
  // AA не проходит (подпись времени на зелёном кубике 11pt). Тон темнее —
  // 5.8:1, и это по-прежнему один зелёный продукта, а не шестой оттенок.
  successInk: "#065f40",
  danger: "#c9372c",
  // Also clears AA on its own 10% semantic tint (used by warning cards).
  warning: "#955f00",
  fill: "#eef1f5",
  separator: "#e7ebf0",
  // Navigation chevrons are meaningful controls, not decoration. At 50%
  // ink they clear the 3:1 non-text contrast threshold on canvas while
  // remaining quieter than labels.
  chevron: "rgba(11,18,32,0.50)",
  highlight: "rgba(255,255,255,0.9)",
  pressed: "rgba(11,18,32,0.04)",
  // Строки-фасеты и оттиск-ряды: нажатие УГЛУБЛЯЕТ материал (4%→8%), а не
  // делает его прозрачным — `pressed` совпадает с idle-заливкой и на них
  // не читается вовсе.
  rowFill: "rgba(11,18,32,0.04)",
  rowFillPressed: "rgba(11,18,32,0.08)",
  scrim: "rgba(11,18,32,0.30)",
  cardShadow:
    "0px 1px 2px rgba(11,18,32,0.04), 0px 8px 24px rgba(11,18,32,0.06)",
  brandShadow: "0px 8px 28px rgba(44,91,224,0.28)",
  // Light enough that a `sub`-colored disabled label reads at ≥4.5:1.
  disabledFill: "#e2e7ee",
  haloOpacity: 0.12,
  googleBg: "#ffffff",
  googleBorder: "#d9dee5",
  googleText: "#1f1f1f",
  radius: RADIUS,
};

export function useThemeColors(): ThemeColors {
  return light;
}
