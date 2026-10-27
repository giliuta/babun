import { getStorage } from "@babun/shared/storage";
import { devicePrefKey } from "@/lib/tenant-prefs";
import {
  HOUR_H_DEFAULT,
  HOUR_H_MAX,
  maxScroll,
  minHourH,
  PAD_BOTTOM,
  PAD_TOP,
} from "./zoom-math";

// ПАМЯТЬ СЕТКИ: МАСШТАБ И ВРЕМЯ, НА КОТОРОМ КАЛЕНДАРЬ ОТКРЫТ.
//
// При смене вида и свайпе на день с другим графиком календарь остаётся там же,
// где человек был, а не прыгает к началу работы.
//
// Масштаб хранится не в пикселях, а в том, КАК ЕГО ВИДИТ ЧЕЛОВЕК: «весь день на
// экране» или «N часов на экране». Пиксели зависят от высоты экрана (Неделя и
// День — разные вьюпорты, у телефонов разные экраны), а «8 часов на экране»
// одинаково читается везде. «Весь день» — отдельное значение, а не число:
// окно часов календаря меняется (настройка, записи за краем), и сетка обязана
// заполнять экран при любом окне.
//
// Время — абсолютное (часы от полуночи у верхнего края), а не offset: у команд
// разные окна, и «я смотрел на 14:00» обязано пережить переход между ними.
//
// Масштаб — на устройстве и один на все компании: это про глаза человека и
// его экран, а не про данные фирмы (ключ `device:` переход переживает).
//
// Время у верха живёт ТОЛЬКО ДО ВЫХОДА ИЗ ПРИЛОЖЕНИЯ. Новый запуск — новый
// вопрос «что сейчас»: календарь открывается на линии «сейчас» или на начале
// работы (`deriveOpenHour`), а не на часе, где его бросили вчера.

/** «Весь день» или сколько часов помещается на экране. */
export type GridZoom = "fit" | number;

const ZOOM_KEY = devicePrefKey("calendar.zoom");

const usable = (vh: number) => Math.max(1, vh - PAD_TOP - PAD_BOTTOM);

/** Высота часа для масштаба. Без выбора — прежние 64 px (у тех, кто ничего
 *  не настраивал, календарь не меняется). */
export function hourHForZoom(
  zoom: GridZoom | null,
  span: number,
  vh: number,
): number {
  const floor = minHourH(span, vh);
  if (zoom === "fit") return floor;
  const raw = zoom == null ? HOUR_H_DEFAULT : Math.round(usable(vh) / zoom);
  return Math.min(HOUR_H_MAX, Math.max(floor, raw));
}

/** Масштаб, который запоминает щипок: упёрся в пол — «весь день». Часы — до
 *  сотой, чтобы круг «записал → прочёл» не гулял на пиксель. */
export function zoomForHourH(h: number, span: number, vh: number): GridZoom {
  if (h <= minHourH(span, vh)) return "fit";
  return Math.round((usable(vh) / h) * 100) / 100;
}

/** Прокрутка, при которой у верхнего края стоит `topHour`. */
export function scrollYForTopHour(
  topHour: number,
  startHour: number,
  endHour: number,
  h: number,
  vh: number,
): number {
  const y = (topHour - startHour) * h;
  return Math.min(maxScroll(endHour - startHour, h, vh), Math.max(0, y));
}

/** Время у верхнего края при прокрутке `scrollY`. */
export function topHourForScrollY(
  scrollY: number,
  startHour: number,
  h: number,
): number {
  return startHour + scrollY / h;
}

function read<T>(key: string): T | null {
  try {
    return getStorage().get<T>(key) ?? null;
  } catch {
    // MMKV может бросить, пока Keychain заперт: память — удобство, не данные.
    return null;
  }
}
function write<T>(key: string, value: T): void {
  try {
    getStorage().set(key, value);
  } catch {
    // см. `read`
  }
}

const zoomListeners = new Set<(zoom: GridZoom) => void>();

/** МАСШТАБ ПРИ ОТКРЫТИИ — НАСТРОЙКА, А НЕ ПОСЛЕДНИЙ ЩИПОК. Щипок писал тот
 *  же ключ, и настройка «Масштаб при открытии» молча становилась тем, чем
 *  кончился последний жест. Теперь щипок живёт до конца сессии (`noteGridZoom`),
 *  а на диск масштаб пишет только выбор в настройках. */
let sessionZoom: GridZoom | null = null;

/** Масштаб, с которым сетка открывается: выбор в настройках. */
export function readOpeningZoom(): GridZoom | null {
  const v = read<GridZoom>(ZOOM_KEY);
  return v === "fit" || (typeof v === "number" && v > 0) ? v : null;
}

/** Масштаб сетки сейчас: щипок этой сессии, иначе — при открытии. */
export function readGridZoom(): GridZoom | null {
  return sessionZoom ?? readOpeningZoom();
}

/** Выбор в настройках: пишется на диск, сбрасывает щипок сессии и (с
 *  `announce`) перестраивает открытую сетку сразу. */
export function writeGridZoom(zoom: GridZoom, announce = false): void {
  write(ZOOM_KEY, zoom);
  sessionZoom = null;
  if (announce) for (const cb of zoomListeners) cb(zoom);
}

/** Щипок: масштаб держится до конца сессии, настройку не трогает. Сам себе
 *  не объявляет — он уже на экране. */
export function noteGridZoom(zoom: GridZoom): void {
  sessionZoom = zoom;
}

export function subscribeGridZoom(cb: (zoom: GridZoom) => void): () => void {
  zoomListeners.add(cb);
  return () => {
    zoomListeners.delete(cb);
  };
}

let runTopHour: number | null = null;

export function readTopHour(): number | null {
  return runTopHour;
}
export function writeTopHour(hour: number): void {
  if (hour >= 0 && hour < 24) runTopHour = Math.round(hour * 100) / 100;
}

/** Последняя замеренная высота сетки — чтобы первый кадр открылся уже в
 *  нужном масштабе и на нужном времени, не дожидаясь замера. У Недели и Дня
 *  над сеткой разные шапки, поэтому замер у каждого вида свой. */
const viewportKey = (view: string) => devicePrefKey(`calendar.viewportH.${view}`);
export function readViewportH(view: string): number | null {
  const v = read<number>(viewportKey(view));
  return typeof v === "number" && v > 0 ? v : null;
}
export function writeViewportH(view: string, vh: number): void {
  write(viewportKey(view), Math.round(vh * 100) / 100);
}

// МАСШТАБ В ПРОЦЕНТАХ (ползунок — на сколько открывать при заходе). 0 % — весь день на экране
// (самый мелкий), 100 % — самый крупный (`HOUR_H_MAX`), между ними — ровно по
// высоте часа. Хранится по-прежнему как «весь день» / «часы на экране»:
// проценты — только язык ползунка.

export const ZOOM_PCT_STEP = 5;
/** Вьюпорт, пока экран ни разу не мерили (средний iPhone, неделя). */
const FALLBACK_VH = 600;

function pctRange(span: number, vh: number | null): { lo: number; hi: number; v: number } {
  const v = vh ?? FALLBACK_VH;
  return { lo: minHourH(span, v), hi: HOUR_H_MAX, v };
}

/** Сколько процентов показывает сохранённый масштаб (0…100). */
export function zoomToPct(zoom: GridZoom | null, span: number, vh: number | null): number {
  const { lo, hi, v } = pctRange(span, vh);
  if (hi <= lo) return 0;
  const h = hourHForZoom(zoom, span, v);
  const pct = ((h - lo) / (hi - lo)) * 100;
  return Math.min(100, Math.max(0, Math.round(pct / ZOOM_PCT_STEP) * ZOOM_PCT_STEP));
}

/** Масштаб из процентов ползунка: 0 % — «весь день». */
export function zoomFromPct(pct: number, span: number, vh: number | null): GridZoom {
  const { lo, hi, v } = pctRange(span, vh);
  if (pct <= 0 || hi <= lo) return "fit";
  const h = lo + (Math.min(100, pct) / 100) * (hi - lo);
  return Math.round((usable(v) / h) * 100) / 100;
}

/** Подпись под ползунком: сколько часов видно сразу. */
export function zoomPctHint(pct: number, span: number, vh: number | null): string {
  if (pct <= 0) return "Весь день на экране";
  const { lo, hi, v } = pctRange(span, vh);
  const h = lo + (Math.min(100, pct) / 100) * (hi - lo);
  return `≈ ${Math.max(1, Math.round(usable(v) / h))} ч на экране`;
}
