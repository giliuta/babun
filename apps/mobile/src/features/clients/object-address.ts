import {
  extractAddressFromMapUrl,
  isLikelyUrl,
} from "@babun/shared/common/utils/map-links";

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
