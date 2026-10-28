import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import type { Appointment } from "@babun/shared/local/appointments";

// ВОПРОС ПЕРЕД УДАЛЕНИЕМ ОБЪЕКТА НАЗЫВАЕТ ЕГО ВИЗИТЫ. Объект живёт в
// `clients.locations` и уходит насовсем, вместе с техникой и заметкой, а
// визиты на нём остаются со ссылкой в пустоту. Человек должен знать, сколько
// их, ДО «Удалить», а не узнать по пустому блоку «Объект» в записи.

/** Сколько визитов клиента стоит на объекте. `null` — визиты не загрузились:
 *  неизвестное не значит «визитов нет». */
export function visitsOnObject(
  visits: readonly Pick<Appointment, "location_id">[] | undefined,
  locationId: string,
): number | null {
  if (!visits) return null;
  return visits.filter((visit) => visit.location_id === locationId).length;
}

/** Заголовок вопроса: с числом, когда визиты есть. */
export function objectDeleteTitle(visits: number | null): string {
  if (!visits) return "Удалить объект?";
  return `На объекте ${formatCountRu(visits, ["запись", "записи", "записей"])} — удалить?`;
}
