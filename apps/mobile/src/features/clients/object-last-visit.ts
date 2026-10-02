import type { Appointment } from "@babun/shared/local/appointments";
import { isVisit } from "@babun/shared/local/selectors/client-stats";

// «БЫЛ 12 АВГ» У ОБЪЕКТА — когда на этот адрес приезжали в последний раз.
//
// Визит — тем же правилом, что «был 30 мая» в сводке под номером (`isVisit`
// из client-stats): иначе объект говорил бы «был 12 авг», а сводка —
// «был 30 мая» про тот же единственный приезд, и одному из двух чисел
// перестали бы верить. Прошедшая незакрытая запись визитом не считается ни
// там, ни здесь: работу по ней никто не подтвердил.
//
// Отличие от срока обслуживания (`client-stats` → `lastByLocation`): тот
// считает любую неотменённую прошедшую запись, потому что отвечает на
// вопрос «пора ли звать снова», а не «когда мы там точно были».

/** Последняя дата визита (YYYY-MM-DD) на каждый объект клиента. Записи без
 *  объекта и без даты пропускаются; объекта без визитов в ответе нет. */
export function lastVisitByObject(
  appointments: readonly Pick<Appointment, "status" | "date" | "location_id">[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of appointments) {
    if (!isVisit(a) || !a.date || !a.location_id) continue;
    const prev = out.get(a.location_id);
    if (!prev || a.date > prev) out.set(a.location_id, a.date);
  }
  return out;
}

/** ОБЪЕКТ ДЛЯ КАРТОЧКИ КЛИЕНТА — ОДИН (владелец 03.10: «видно только
 *  последний объект — который был обслужен или добавлен»). Обслуженный
 *  последним (по `lastVisitByObject`); ни одного визита — последний
 *  добавленный (в конце массива). Объектов нет — `null`. */
export function cardObjectId(
  locations: readonly { id: string }[],
  lastVisits: ReadonlyMap<string, string>,
): string | null {
  let best: string | null = null;
  let bestDate = "";
  for (const loc of locations) {
    const date = lastVisits.get(loc.id);
    if (date && date > bestDate) {
      best = loc.id;
      bestDate = date;
    }
  }
  return best ?? locations[locations.length - 1]?.id ?? null;
}
