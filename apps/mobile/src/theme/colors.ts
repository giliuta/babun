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
  /** ОПИСЫВАЮЩЕЕ: ярлык строки, капс-заголовок группы, подпись под именем.
   *  Полный чёрный на денежных экранах остаётся только у ИМЁН и ЧИСЕЛ. */
  caption: string;
  /** ЧИСЛО, КОТОРОЕ НИЧЕГО НЕ ГОВОРИТ: нулевое движение за период, нулевой
   *  остаток. Тише собственного ярлыка — глаз ищет живые деньги. */
  muted: string;
  // semantic = meaning
  success: string;
  successInk: string;
  danger: string;
  warning: string;
  // seams + depth
  fill: string; // idle chip / segmented track / inset input fill
  separator: string;
  /** ЧЕРТА ПОДВЕДЕНИЯ, а не шов: линия над итогом колонки. Плотнее обычного
   *  разделителя ровно настолько, чтобы читаться как «здесь складывают». */
  separatorStrong: string;
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
  brandShadowPressed: string;
  disabledFill: string;
  haloOpacity: number;
  // auth social chips
  // radii (scheme-invariant — colocated so one import drives a screen)
  radius: { card: number; input: number; cta: number; pill: number };
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
// ОДИН РАДИУС НА ВСЁ, И ОН БОЛЕЕ КВАДРАТНЫЙ (владелец 2026-08-22: «скругления
// углов должно быть нормальным, везде должен быть стандарт… более квадратная и
// лёгкая округление, и неважно, не зависит это от размера — любое скругление
// должно быть полностью одинаковым во всём продукте»).
//
// Было 14 и «один радиус» существовал только на словах: сквозная проверка
// 2026-08-22 нашла ВОСЕМЬ разных значений в классах (`rounded-xl/2xl/3xl/md/lg`
// и произвольные 12/13/20/22) и одиннадцать числом (8…28) — всего около 150
// мест. Теперь значение ровно одно и живёт здесь.
//
// `card` и `input` СОВПАДАЮТ намеренно: два имени называют РОЛЬ поверхности,
// а не разные числа. Круглые по смыслу вещи (аватар, точка, чип-пилюля,
// круглая кнопка) берут `pill`: круг не может стать прямоугольником.
// СКРУГЛЕНИЯ. Прямоугольные поверхности — 10 (LOCKED 2026-08-22). Главная
// кнопка — 16, ОТДЕЛЬНОЕ РЕШЕНИЕ ВЛАДЕЛЬЦА 2026-08-27.
//
// Числа спорили, и спор проигран честно. Расчёт был против 16:
// `borderCurve: "continuous"` — суперэллипс, кривая уходит от угла вдоль
// ребра на ~1.53·R, значит прямой участок короткой стороны = 52 − 3.06·R.
// При 16 это 3.1pt (6% ребра) — форма ещё близка к капсуле; при 10 — 21.4pt
// (41%). Плюс нижний лист скругляется на 10, и кнопка 16 внутри него —
// ребёнок круглее родителя.
//
// Владелец посмотрел обе формы вживую на симуляторе (сравнение шести
// радиусов на одном экране) и выбрал 16: «с скруглением 16 я думаю лучше
// будет». Живой глаз старше расчёта — расчёт описывает геометрию, а не то,
// как форма читается на конкретном экране конкретного продукта.
//
// Следствие, которое надо помнить: «одно скругление на всё» снова обещание
// с исключением, а не факт. Исключение РОВНО ОДНО и только у главной
// кнопки; заводить третье число нельзя.
//
// Круглые ПО СМЫСЛУ вещи (аватар, точка, чип-пилюля, Spinner) — `pill`.
const RADIUS = { card: 10, input: 10, cta: 16, pill: 999 } as const;

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
  // ЧТО ОПИСЫВАЕТ — ТИШЕ ТОГО, ЧТО НАЗЫВАЕТ (2026-08-12). Измерено на экране
  // счетов: капс-подпись «КОМАНДА 1 НА СЧЕТАХ» полным чёрным несла 431 pt²
  // чернил, а число «€5» под ней — 269 pt². Подпись была в 1.6 раза тяжелее
  // числа, которое подписывает, и глазу не за что было зацепиться. Значит:
  // имена и числа — полный ink, всё описывающее — эта краска.
  caption: "rgba(11,18,32,0.62)",
  // Ноль печатается тише живых денег: «€0» у брошенной кассы и «€5» на карте
  // были набраны одинаково громко, и список читался как ровный шаблон.
  muted: "rgba(11,18,32,0.40)",
  success: "#087a52",
  // Чернила поверх СВОЕЙ ЖЕ 20-% заливки: сам `success` на ней даёт 4.03:1 и
  // AA не проходит (подпись времени на зелёном кубике 11pt). Тон темнее —
  // 5.8:1, и это по-прежнему один зелёный продукта, а не шестой оттенок.
  successInk: "#065f40",
  danger: "#c9372c",
  // Also clears AA on its own 10% semantic tint (used by warning cards).
  warning: "#955f00",
  fill: "#eef1f5",
  // ШВА ДОЛЖНО БЫТЬ ВИДНО (2026-08-12). `#e7ebf0` на белом даёт контраст
  // 1.067:1 — у iOS-разделителя 1.70:1, то есть линии в продукте физически не
  // существовало: карточка выглядела сплошным белым полем, а строки в ней —
  // не отделёнными друг от друга. Те же чернила, что у текста, на 20% дают
  // ~1.9:1 — линия читается и остаётся волосяной.
  separator: "rgba(11,18,32,0.20)",
  separatorStrong: "rgba(11,18,32,0.32)",
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
  // ТЕНЬ КОРОТКАЯ И ПЛОТНАЯ, А НЕ ДЛИННАЯ И СЛАБАЯ (2026-08-12). Прежние
  // `0 8px 24px rgba(…,0.06)` у самой кромки карточки давали около 2% —
  // размазанное пятно, которое глаз не читает как поднятую бумагу вовсе, и
  // белая карточка на светлой канве выглядела дырой в фоне. Контактная тень
  // (0.5/1) плюс короткая мягкая (4/12) — так лежит лист на столе.
  cardShadow:
    "0px 0.5px 1px rgba(11,18,32,0.05), 0px 4px 12px rgba(11,18,32,0.10)",
  brandShadow: "0px 8px 28px rgba(44,91,224,0.28)",
  // Контактная тень нажатия: плита села на страницу, зазор 8 → 2. Ближе И
  // ПЛОТНЕЕ — альфа обязана расти при падении высоты, иначе нажатие читается
  // как «кнопка выцветает», а не «кнопка опустилась».
  brandShadowPressed: "0px 2px 8px rgba(44,91,224,0.34)",
  // Light enough that a `sub`-colored disabled label reads at ≥4.5:1.
  disabledFill: "#e2e7ee",
  haloOpacity: 0.12,
  radius: RADIUS,
};

export function useThemeColors(): ThemeColors {
  return light;
}
