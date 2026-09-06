import {
  extractAddressFromMapUrl,
  isLikelyUrl,
} from "@babun/shared/common/utils/map-links";
import type { AddressParts } from "@babun/shared/local/clients";

// «АДРЕС ИЛИ ССЫЛКА» — ОДНО поле на два хранилища.
//
// Владелец 2026-07-26: «адрес — это и есть ссылка на объект, ссылка на карту;
// по сути одно и то же». В модели их два поля, и не зря: `mapUrl` — присланный
// клиентом пин (на кипрских виллах текстовый адрес не прокладывается),
// `address` — то, что человек читает в списке и в SMS. Поле одно, поэтому
// разбор ввода живёт здесь, а не в каждом экране.
//
// Что было: экраны писали ввод целиком в `address`. Вставленная ссылка
// становилась «адресом» — в строке объекта на карточке вместо адреса тянулся
// `https://maps.app.goo.gl/…`, а ветка «ссылка на карту» в списке была
// недостижима. Обратно: у объекта, заведённого в вебе с одним лишь пином,
// поле адреса открывалось ПУСТЫМ, и казалось, что «куда ехать» не заполнено.

/** Что показать в поле «Адрес или ссылка»: адрес, а если его нет — пин.
 *  Пусто только когда не заполнено ни то, ни другое. */
export function objectTarget(
  loc: { address?: string | null; mapUrl?: string | null } | null | undefined,
): string {
  return (loc?.address ?? "").trim() || (loc?.mapUrl ?? "").trim();
}

/**
 * Разбор ввода в патч объекта.
 *
 * - пусто → стираем оба поля (последнее «куда ехать» защищает вызывающая
 *   сторона: без него объект перестаёт быть объектом);
 * - ссылка → в `mapUrl`, а адрес вытаскиваем из неё (Google `/place/…`, `?q=`);
 *   ссылка без адреса (короткая `maps.app.goo.gl`) — адрес остаётся прежним,
 *   маршрут всё равно пойдёт по пину, который точнее;
 * - текст → в `address`. Пин при этом СОХРАНЯЕМ: человек уточнил, как
 *   называется место, а не отменил присланную точку. Но если поле показывало
 *   именно ссылку (адреса не было), то текст её ЗАМЕНИЛ — тогда пин снимаем.
 */
export function addressOrLinkPatch(
  raw: string,
  prev: { address?: string | null; mapUrl?: string | null } = {},
): { address: string; mapUrl?: string } {
  // Перевод строки в адресе — мусор: у multiline-поля Return не сохраняет, а
  // вставляет «\n», и «Ленина 5\nкв 12» уезжало в базу как есть (в списке и в
  // SMS такой адрес рвётся). Схлопываем в пробел.
  const value = (raw ?? "").replace(/\s*[\n\r]+\s*/g, " ").trim();
  const prevAddress = (prev.address ?? "").trim();
  if (!value) return { address: "", mapUrl: undefined };

  if (isLikelyUrl(value)) {
    return {
      mapUrl: value,
      address: extractAddressFromMapUrl(value) ?? prevAddress,
    };
  }

  return prevAddress
    ? { address: value, mapUrl: (prev.mapUrl ?? "").trim() || undefined }
    : { address: value, mapUrl: undefined };
}

// ─── УТОЧНЕНИЕ АДРЕСА (2026-09-06) ──────────────────────────────────────────
// Части живут в `addressParts`, строка `address` собирается из них: всё, что
// показывает или шлёт адрес, читает одну строку и о частях не знает. Пин
// остаётся главным для маршрута; из частей в карту уходит только то, что
// геокодер найдёт, — без подъезда, этажа и квартиры.

export const ADDRESS_PART_KEYS = [
  "street",
  "complex",
  "entrance",
  "floor",
  "apartment",
  "city",
  "zip",
] as const satisfies readonly (keyof AddressParts)[];

/** Обрезанные части без пустых; `undefined`, если не осталось ничего. */
export function cleanAddressParts(
  parts: AddressParts | null | undefined,
): AddressParts | undefined {
  if (!parts) return undefined;
  const out: AddressParts = {};
  for (const key of ADDRESS_PART_KEYS) {
    const value = (parts[key] ?? "").replace(/\s+/g, " ").trim();
    if (value) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Есть «где» — улица, комплекс или город. Без него строка адреса из частей
 *  не собирается: «эт. 3, кв. 5» само по себе никуда не ведёт. */
export function hasAddressPlace(parts: AddressParts | null | undefined): boolean {
  const clean = cleanAddressParts(parts);
  return Boolean(clean?.street || clean?.complex || clean?.city);
}

/** «Makariou 12, Sunny Court, подъезд 2, эт. 3, кв. 5, Лимасол 4000».
 *  `forRoute` — только то, что найдёт карта: улица, комплекс, город, индекс. */
export function composeAddress(
  parts: AddressParts | null | undefined,
  opts?: { forRoute?: boolean },
): string {
  const clean = cleanAddressParts(parts);
  if (!clean) return "";
  const out: string[] = [];
  if (clean.street) out.push(clean.street);
  if (clean.complex) out.push(clean.complex);
  if (!opts?.forRoute) {
    if (clean.entrance) out.push(`подъезд ${clean.entrance}`);
    if (clean.floor) out.push(`эт. ${clean.floor}`);
    if (clean.apartment) out.push(`кв. ${clean.apartment}`);
  }
  const place = [clean.city, clean.zip].filter(Boolean).join(" ");
  if (place) out.push(place);
  return out.join(", ");
}

/** Адрес для маршрута по тексту: у объекта с частями — геокодируемая часть,
 *  иначе строка как есть. Пин (`mapUrl`) выбирает вызывающая сторона. */
export function routeAddress(
  loc: { address?: string | null; addressParts?: AddressParts | null } | null | undefined,
): string {
  if (!loc) return "";
  return hasAddressPlace(loc.addressParts)
    ? composeAddress(loc.addressParts, { forRoute: true })
    : (loc.address ?? "").trim();
}

/** Патч объекта из частей: чистые части и собранная строка. Части без «где»
 *  хранятся, но строку не трогают; пустые части снимаются, строка остаётся
 *  прежней — человек ничего не терял, он лишь убрал уточнение. */
export function addressPartsPatch(
  parts: AddressParts | null | undefined,
): { addressParts: AddressParts | undefined; address?: string } {
  const clean = cleanAddressParts(parts);
  if (!clean) return { addressParts: undefined };
  return hasAddressPlace(clean)
    ? { addressParts: clean, address: composeAddress(clean) }
    : { addressParts: clean };
}

/** Открытие уточнения поверх набранной строки: адрес становится «Улица и дом»,
 *  ссылка — пином. Набранное не пропадает, а уже заполненные части не трогаем. */
export function partsFromLine(
  parts: AddressParts,
  line: string,
  pin: string,
): { parts: AddressParts; pin: string } {
  const value = line.trim();
  if (!value) return { parts, pin };
  if (isLikelyUrl(value)) return { parts, pin: pin || value };
  return {
    parts: hasAddressPlace(parts) ? parts : { ...parts, street: parts.street || value },
    pin,
  };
}

/** Одни и те же части после чистки — писать нечего. */
export function sameAddressParts(
  a: AddressParts | null | undefined,
  b: AddressParts | null | undefined,
): boolean {
  return JSON.stringify(cleanAddressParts(a) ?? null) === JSON.stringify(cleanAddressParts(b) ?? null);
}
