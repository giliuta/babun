import { ZONE_GROUPS, type ZoneGroup } from "@babun/shared/local/timezones";

// ПОДПИСЬ ЧАСОВОГО ПОЯСА — ОДНА НА ВЕСЬ ПРОДУКТ.
//
// Барабан в листе и строка в настройках обязаны называть пояс ОДНИМИ И ТЕМИ
// ЖЕ словами: человек выбрал «Kyiv, Nicosia, Helsinki» — он и должен потом
// прочитать «Kyiv, Nicosia, Helsinki», а не «Kyiv». Пока логика лежала
// внутри листа, строка настроек печатала один город и выглядела так, будто
// выбран он один (владелец 2026-08-27: «внизу должно писаться не Киев, а
// перечислять города, часовой пояс и время»).

/** Сколько городов помещается в подпись, не обрезаясь. */
export const NAMES_IN_LABEL = 3;

/** Номер группы в списке — барабану нужен именно он. */
export function zoneGroupIndexOf(zone: string): number {
  const byZone = ZONE_GROUPS.findIndex((g) =>
    g.cities.some((c) => c.zone === zone),
  );
  if (byZone >= 0) return byZone;
  const city = zone.split("/").pop()?.replace(/_/g, " ");
  const byCity = ZONE_GROUPS.findIndex((g) =>
    g.cities.some((c) => c.name === city),
  );
  return byCity >= 0 ? byCity : 0;
}

/** Группа, в которой лежит эта зона. Ищем по ГОРОДАМ, а не по представителю:
 *  сохранено может быть `Europe/Kyiv`, а группа названа `Europe/Helsinki`. */
export function zoneGroupOf(zone: string): ZoneGroup {
  return ZONE_GROUPS[zoneGroupIndexOf(zone)];
}

/** «Kyiv, Nicosia, Helsinki» — свой город первым.
 *
 *  Первым он стоит не из вежливости: группа названа одним городом из сорока,
 *  и киевлянин, увидев «Nicosia, Helsinki, Athens», своей строки не узнаёт. */
export function zoneCities(zone: string, limit = NAMES_IN_LABEL): string {
  const group = zoneGroupOf(zone);
  const names = group.cities.map((c) => c.name);
  const own = zone.split("/").pop()?.replace(/_/g, " ");
  const head = own && names.includes(own)
    ? [own, ...names.filter((n) => n !== own)]
    : names;
  return head.slice(0, limit).join(", ");
}
