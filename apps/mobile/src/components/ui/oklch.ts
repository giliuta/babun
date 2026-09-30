// OKLCH — ПЕРЦЕПТИВНОЕ ПРОСТРАНСТВО ДЛЯ «ТЕМНЕЕ, НО ТЕМ ЖЕ ЦВЕТОМ».
//
// Затемнять цвет умножением каналов к чёрному (как `deepen`) нельзя, когда
// результат — ЗАЛИВКА: янтарный #FDAA1B так уходит в коричневый #a36e00, а
// лавандовый — в грязно-серый. В OKLCH светлота L отделена от сочности C и тона
// H: опускаем только L, а тон и сочность держим, и янтарь остаётся оранжевым.
// Цвет, не влезающий в sRGB, теряет сочность, а не тон и не светлоту.

export type Oklch = [l: number, c: number, h: number];

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toGamma = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

export function hexToOklch(hex: string): Oklch | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    toLinear(v / 255),
  );
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

function oklchToLinearRgb([L, C, H]: Oklch): [number, number, number] {
  const A = C * Math.cos(H);
  const B = C * Math.sin(H);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH → hex. Вне sRGB цвет сбрасывает СОЧНОСТЬ шагами по 5 %, пока не
 *  влезет: тон и светлота — то, что узнаёт глаз, — остаются. */
export function oklchToHex([L, C0, H]: Oklch): string {
  let C = C0;
  for (let i = 0; i < 60; i++) {
    const lin = oklchToLinearRgb([L, C, H]);
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005)) {
      return `#${lin
        .map((v) =>
          Math.round(toGamma(Math.min(1, Math.max(0, v))) * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")}`;
    }
    C *= 0.95;
  }
  const g = Math.round(toGamma(Math.min(1, Math.max(0, L ** 3))) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${g}${g}${g}`;
}
