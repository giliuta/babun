type RGB = readonly [red: number, green: number, blue: number];

function parseHex(value: string): RGB | null {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) {
    return [
      Number.parseInt(short[1] + short[1], 16),
      Number.parseInt(short[2] + short[2], 16),
      Number.parseInt(short[3] + short[3], 16),
    ];
  }
  // ВОСЬМИЗНАЧНЫЙ HEX ПОНИМАЕТСЯ ТОЖЕ. Календарь красит блок строками вида
  // `${hue}2e` — то есть цветом с альфой, — и без этой ветки собственные
  // помощники продукта не могли измерить то, что рисуют: `parseHex` возвращал
  // null, `contrastRatio` — 1, а тест на контраст заливки был бы зелёным
  // впустую. Альфа отбрасывается: контраст меряется по КОМПОЗИТУ, который
  // собирает `tintOver`, а не по прозрачному цвету.
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i.exec(
    value,
  );
  if (!full) return null;
  return [
    Number.parseInt(full[1], 16),
    Number.parseInt(full[2], 16),
    Number.parseInt(full[3], 16),
  ];
}


function linear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: RGB): number {
  return (
    0.2126 * linear(rgb[0]) +
    0.7152 * linear(rgb[1]) +
    0.0722 * linear(rgb[2])
  );
}

function composite(foreground: RGB, background: RGB, alpha: number): RGB {
  const clamped = Math.max(0, Math.min(1, alpha));
  return foreground.map((channel, index) =>
    Math.round(channel * clamped + background[index] * (1 - clamped)),
  ) as unknown as RGB;
}

/** `rgba(r,g,b,a)` — тиры текста теперь чернила с прозрачностью, а не серые
 *  пигменты, и проверять их контраст надо ПОСЛЕ наложения на фон. */
function parseRgba(value: string): { rgb: RGB; alpha: number } | null {
  const m =
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([0-9.]+)\s*)?\)$/i.exec(
      value.trim(),
    );
  if (!m) return null;
  const rgb: RGB = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (rgb.some((c) => c > 255)) return null;
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  if (!Number.isFinite(alpha)) return null;
  return { rgb, alpha };
}

/** Цвет как он ВЫГЛЯДИТ на этом фоне: полупрозрачный складывается с ним. */
function resolve(value: string, background: RGB | null): RGB | null {
  const hex = parseHex(value);
  if (hex) return hex;
  const rgba = parseRgba(value);
  if (!rgba) return null;
  if (rgba.alpha >= 1 || !background) return rgba.rgb;
  return composite(rgba.rgb, background, rgba.alpha);
}

export function contrastRatio(foreground: string, background: string): number {
  const bg = resolve(background, null);
  const fg = resolve(foreground, bg);
  if (!fg || !bg) return 0;
  const lighter = Math.max(luminance(fg), luminance(bg));
  const darker = Math.min(luminance(fg), luminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

function toHex(rgb: RGB): string {
  return `#${rgb
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Pick the higher-contrast light/dark label for a solid user-selected hue. */
export function readableTextOnColor(
  background: string,
  dark: string,
  light: string,
): string {
  return contrastRatio(dark, background) >= contrastRatio(light, background)
    ? dark
    : light;
}

/** Keep a user hue for text only while it remains WCAG AA on its tint. */
export function readableColorOnTint(
  hue: string,
  surface: string,
  fallback: string,
  tintAlpha: number,
): string {
  const hueRgb = parseHex(hue);
  const surfaceRgb = parseHex(surface);
  if (!hueRgb || !surfaceRgb) return fallback;
  const tintedBackground = toHex(composite(hueRgb, surfaceRgb, tintAlpha));
  return contrastRatio(hue, tintedBackground) >= 4.5 ? hue : fallback;
}

// ── identity-tint helpers (booking «цвет записи» → whole-screen wash) ──
// A user-picked appointment colour is not a semantic hue and not a second
// brand accent — it is «this record's identity colour», the same value that
// becomes the calendar block. That meaning may own the screen CHROME (ground
// wash, header bloom, CTA gradient) but never the semantic tokens or the white
// card surfaces. These two helpers derive every wash/gradient from a single
// hex so the effect stays consistent and, when no colour is chosen (hue =
// cobalt accent), collapses to today's neutral values — a pure no-op.

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

/** Flatten `hue` at `alpha` over an opaque `base` into a solid hex. Used for
 *  the canvas (6%) / header (10%) washes and hairline separators so the tint
 *  needs no colour-mix support and lifts white cards for free. */
export function tintOver(hue: string, base: string, alpha: number): string {
  const hueRgb = parseHex(hue);
  const baseRgb = parseHex(base);
  if (!hueRgb || !baseRgb) return base;
  return toHex(composite(hueRgb, baseRgb, alpha));
}

// ═══ ЦВЕТ ЗАПИСИ НА СЕТКЕ КАЛЕНДАРЯ ═══
//
// Блок записи — это заливка цветом на 18 % и кант тем же цветом в полную силу
// (DESIGN-SYSTEM: «цвет записи отвечает на вопрос, а не украшает»). Сырой цвет
// палитры кантом не годится: Ванильный #FFF0BC даёт к подложке сетки 1.2 : 1 —
// канта попросту не видно. Поэтому цвет ЗАТЕМНЯЕТСЯ ровно настолько, чтобы
// взять порог 3 : 1, и ни на шаг больше: выбранный оттенок обязан остаться
// узнаваемым.

/** Распознаётся ли строка как цвет. Нужен гейтам: цвет, пришедший из токена
 *  с прозрачностью, нельзя ни затемнить, ни залить. */
export function parseHexOk(value: string): boolean {
  return parseHex(value) != null;
}

/** Худшая реальная подложка блока: белый лист → плёнка метки дня 5 % →
 *  нерабочие часы 12 % → затемнение прошлого 5 %. Пороги меряются об неё, а не
 *  о белый: гейт по белому был бы зелёным в CI и врал на экране. */
export const GRID_WORST = "#cfced5";

/** ЗАЛИВКА БЛОКА ЗАПИСИ — ОДНО ЧИСЛО НА ПРОДУКТ. Сетка, лента и образец в
 *  настройке обязаны говорить одной альфой: три копии восемнадцати процентов
 *  (число здесь, хвост `2e` в ленте, литерал в сетке) разошлись бы на первой
 *  же правке тонирования, и образец начал бы врать тише, чем врал. */
export const BLOCK_FILL = 0.1804;

/** Кант отменённой записи: она теряет цвет записи и говорит нейтралью. Живёт
 *  рядом с `edgeColor`, а не в календаре: этим кантом красят сетка, лента И
 *  образец в настройке, а `components/ui` не имеет права тянуть из `features`. */
export const CANCELLED_EDGE = "#5e6169";

/** РАЗОМКНУТЫЙ КАНТ = РАБОТЫ НЕ БУДЕТ. Закон и его обоснование — там же, где
 *  им пользуется сетка (`features/calendar/status-colors`). */
export const CANCELLED_BORDER = "dashed" as const;

/** Заливка блока: тот же цвет на 18 % поверх подложки. */
export function fillOver(hue: string, backdrop: string = GRID_WORST): string {
  return tintOver(hue, backdrop, BLOCK_FILL);
}

const deepenCache = new Map<string, string>();

/** Затемнить цвет к чёрному, пока он не возьмёт `target` ко ВСЕМ подложкам.
 *  Шаг 0.04, потолок 0.72 — дальше цвет перестаёт быть собой. */
export function deepen(
  hue: string,
  backdrops: readonly string[],
  target = 3,
): string {
  const key = `${hue}|${backdrops.join(",")}|${target}`;
  const cached = deepenCache.get(key);
  if (cached) return cached;
  const rgb = parseHex(hue);
  if (!rgb) {
    deepenCache.set(key, hue);
    return hue;
  }
  let out = toHex(rgb);
  for (let d = 0; d <= 0.72; d += 0.04) {
    const candidate = toHex(
      rgb.map((c) => Math.round(c * (1 - d))) as unknown as RGB,
    );
    if (backdrops.every((b) => contrastRatio(candidate, b) >= target)) {
      out = candidate;
      break;
    }
    out = candidate;
  }
  deepenCache.set(key, out);
  return out;
}

/** Кант блока: цвет записи, взявший 3 : 1 и к подложке сетки, и к своей
 *  заливке. Кант — единственный канал КАТЕГОРИИ: заливка на 18 % различает
 *  оттенки слишком слабо (максимум попарного ΔE по палитре — 6.7). */
export function edgeColor(hue: string): string {
  return deepen(hue, [GRID_WORST, fillOver(hue)]);
}

/** Цвет углового знака (галка «выполнено»): семантический токен,
 *  затемнённый против самой тёмной заливки палитры. */
export function markColor(token: string): string {
  return deepen(token, [GRID_WORST, fillOver("#4B1D82")]);
}

/** `rgba()`-строка для анимации заливки: восьмизначный hex Reanimated
 *  разбирает не везде, а `interpolateColor` по rgba работает всегда. */
export function fillRgba(hue: string, alpha: number): string {
  const rgb = parseHex(hue);
  if (!rgb) return `rgba(0,0,0,${alpha})`;
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

export interface CtaGradient {
  from: string;
  to: string;
  label: string;
  shadow: string;
  /** Контактная тень нажатия: ближе к странице и ПЛОТНЕЕ парящей. */
  shadowPressed: string;
  /** false for pale hues carrying an ink label — the white sheen/edge would
   *  read dirty over a near-white fill, so the CTA gates them off. */
  sheen: boolean;
}

const COBALT_CTA: CtaGradient = {
  from: "#2f6fd6",
  to: "#1f4fcc",
  label: "#ffffff",
  shadow: "0px 8px 28px rgba(44,91,224,0.28)",
  shadowPressed: "0px 2px 8px rgba(44,91,224,0.34)",
  sheen: true,
};

/** Derive the single CTA gradient from an identity hue while guaranteeing a
 *  WCAG-AA label for every one of the 14 palette colours. Prefer a white label
 *  (DS norm): darken the base until white clears AA; if a pale hue (Жёлтый,
 *  Мята…) can't reach it, flip to an ink label on a bright fill. */
export function ctaGradient(hue: string): CtaGradient {
  const rgb = parseHex(hue);
  if (!rgb) return { ...COBALT_CTA };
  const darken = (amount: number) => composite(BLACK, rgb, amount);
  const lighten = (amount: number) => composite(WHITE, rgb, amount);
  const ratio = (fg: string, bg: RGB) => contrastRatio(fg, toHex(bg));
  const shadow = `0px 8px 28px ${hue}47`; // hue at ~28% — matches brand shadow
  // Нажатая: зазор 8 → 2, альфа 28% → 34%. Плотнее, а не бледнее.
  const shadowPressed = `0px 2px 8px ${hue}57`;

  // Prefer white: step the base toward black until white clears AA on it.
  let d = 0;
  while (d <= 0.4 && ratio("#ffffff", darken(d)) < 4.6) d += 0.04;
  if (ratio("#ffffff", darken(d)) >= 4.6) {
    return {
      from: toHex(darken(d)),
      to: toHex(darken(Math.min(0.6, d + 0.14))),
      label: "#ffffff",
      shadow,
      shadowPressed,
      sheen: true,
    };
  }

  // Pale hue — ink label on a bright fill; ink is worst at the darker stop,
  // so lift the base toward white until ink clears AA there.
  let l = 0;
  while (l <= 0.5 && ratio("#0b1220", lighten(l)) < 4.6) l += 0.05;
  return {
    from: toHex(lighten(Math.min(0.62, l + 0.14))),
    to: toHex(lighten(l)),
    label: "#0b1220",
    shadow,
    shadowPressed,
    sheen: false,
  };
}
