import { useCallback, useMemo } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import { isCalendarEvent } from "@/features/calendar/event-access";
import { useAllServices } from "@/features/services/queries";
import { serviceSummary } from "./record-text";
import type { CalendarSources } from "./use-calendar-sources";
import type { GridModes } from "./use-grid-modes";
import type { ReminderReconcile } from "./use-reminder-reconcile";
import { eventTitleIsNote } from "@/features/calendar/record-title";
import { useDeletedClientNames } from "@/features/clients/queries";

type UseRecordNamingDeps =
  Pick<CalendarSources, "clients" | "teams" | "calSettings">
  & Pick<ReminderReconcile, "clientNameRef">
  & Pick<GridModes, "pickClientId">;

/** How a record is named on the grid and in the list: client, address,
 *  services, team colour and time zone. */
export function useRecordNaming(deps: UseRecordNamingDeps) {
  const { clients, teams, calSettings, clientNameRef, pickClientId } = deps;
  /** Часовой пояс записи: её команды, иначе бизнеса. Дата и время записи —
   *  «настенные» поля бизнеса, а не устройства диспетчера. */
  const appointmentTimeZone = (apt: Appointment): string =>
    (apt.team_id
      ? teams.find((candidate) => candidate.id === apt.team_id)?.timezone
      : null) ??
    calSettings?.timezone ??
    "Europe/Nicosia";

  // УДАЛЁННЫЙ КЛИЕНТ ОСТАЁТСЯ В СВОИХ ЗАПИСЯХ — именем с пометкой: рабочий
  // список его не знает, и блок подписывался «Запись», будто клиента не было
  // (`useDeletedClientNames`). Живой с тем же id не бывает, но он главнее.
  const deletedNames = useDeletedClientNames();
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, name] of deletedNames) map.set(id, [name, "удалён"].join(" · "));
    for (const c of clients) map.set(c.id, c.full_name);
    return map;
  }, [clients, deletedNames]);
  // Адрес клиента — тоже картой: `addressFor` зовут на КАЖДЫЙ блок сетки, а в
  // неделе их полторы сотни. Линейный поиск по всем клиентам на каждый блок
  // стоил бы кадра на большой базе.
  const addressById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.address])),
    [clients],
  );
  // СОБЫТИЕ НАЗЫВАЕТСЯ СВОИМ ТИПОМ и с клиентом тоже (клиент у события
  // необязателен): имя человека идёт второй строкой блока
  // (см. serviceLabel), а не вместо «Обед».
  // useCallback, а не обёртка «свежей функции»: колонка зовёт имя ВО ВРЕМЯ
  // отрисовки, и смена ссылки — единственный сигнал memo сетки, что имена
  // стали другими.
  const clientName = useCallback(
    (a: Appointment) =>
      a.client_id && !isCalendarEvent(a) ? nameById.get(a.client_id) ?? "" : "",
    [nameById],
  );
  clientNameRef.current = clientName;
  // КУДА ЕХАТЬ — ЧЕТВЁРТАЯ СТРОКА БЛОКА. То же правило, по которому «Маршрут»
  // в контекстном меню собирает ссылку на карты: снимок адреса записи, иначе
  // адрес клиента. Разовый выезд по звонку объекта в справочнике не имеет, и
  // клиентский адрес для него — единственная правда.
  const addressFor = useCallback(
    (a: Appointment) => {
      const own = (a.address ?? "").trim();
      if (own) return own;
      const client = a.client_id ? addressById.get(a.client_id) : null;
      return (client ?? "").trim() || null;
    },
    [addressById],
  );

  // Лента дня называет услуги ПРОШЕДШИХ записей — по полному справочнику.
  const { data: allServices = [] } = useAllServices();
  // ЦВЕТ УСЛУГИ ЧИТАЕТСЯ ПО ПОЛНОМУ СПРАВОЧНИКУ, как и имя: услуга, убранная
  // из прайса, обязана продолжать красить прошлые дни.
  const serviceColorById = useMemo(
    () => new Map(allServices.map((s) => [s.id, s.color])),
    [allServices],
  );
  const serviceNameById = useMemo(
    () => new Map(allServices.map((s) => [s.id, s.name])),
    [allServices],
  );
  // «Чистка, x2 Диагностика» — web AgendaView service summary.
  const serviceSummaryFor = useCallback(
    (a: Appointment) => serviceSummary(a, serviceNameById),
    [serviceNameById],
  );
  const serviceLabel = useCallback(
    (a: Appointment) => {
      if (isCalendarEvent(a)) {
        // Заголовок блока уже печатает тип события — третья строка не
        // повторяет слово, а называет клиента или первую строку заметки.
        const who = a.client_id ? nameById.get(a.client_id) ?? "" : "";
        // Заметка уже стала заголовком — второй раз её не печатаем.
        const note = eventTitleIsNote(a)
          ? ""
          : (a.event_notes ?? "").trim().split("\n")[0]?.trim() ?? "";
        return who || note || null;
      }
      return serviceSummaryFor(a) || a.comment || null;
    },
    [serviceSummaryFor, nameById],
  );

  const teamColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const tm of teams as { id: string; color?: string | null }[]) {
      if (tm.color) m.set(tm.id, tm.color);
    }
    return m;
  }, [teams]);

  const pickClientName = pickClientId
    ? clients.find((c) => c.id === pickClientId)?.full_name ?? ""
    : "";

  return {
    appointmentTimeZone, clientName, addressFor, serviceColorById, serviceSummaryFor,
    serviceLabel, teamColor, pickClientName,
  };
}

export type RecordNaming = ReturnType<typeof useRecordNaming>;
