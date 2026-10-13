import { useMemo } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import { useLocationRequestActions } from "@/features/clients/location-request-actions";
import { visibleLocationRequests } from "@/features/clients/location-request-link";
import { useLocationRequests } from "@/features/clients/location-requests";
import { useCurrentRole } from "@/features/settings/tenant";
import { useSession } from "@/providers/SessionProvider";
import { useCalendarActions, useEventRights, useRecordBlocks } from "@/features/appointments/useRecordRights";
import { bookRights, readOnlyBookRights } from "@/features/appointments/record-blocks";
import { EMPTY_REQUESTS } from "./book-constants";

export interface BookRightsInput {
  client: Client | null;
  kind: "work" | "event";
  isEdit: boolean;
  editing: Appointment | null;
  teamId: string | null;
  workInPlan: boolean;
}

/** Address requests of the client and which doors this viewer may use. */
export function useBookRights({
  client,
  kind,
  isEdit,
  editing,
  teamId,
  workInPlan,
}: BookRightsInput) {
  // ССЫЛКА КЛИЕНТУ «ОТМЕТЬТЕ АДРЕС» (STORY-077). Пока клиент не ответил, блок
  // объекта показывает строку «Ждём адрес»: диспетчер видит, что адрес уже
  // спрошен, и не спрашивает второй раз. Ответ приезжает объектом сам —
  // useLocationRequests перечитывает клиентов, когда ссылка использована.
  const { data: locationRequests = EMPTY_REQUESTS } = useLocationRequests(
    client?.id ?? null,
  );
  const pendingRequests = useMemo(
    () => visibleLocationRequests(locationRequests),
    [locationRequests],
  );
  const requestActions = useLocationRequestActions();
  const viewerRole = useCurrentRole().data;
  const canRequestAddress = viewerRole === "owner" || viewerRole === "dispatcher";
  // ОДНА СТРАНИЦА ЗАПИСИ ДЛЯ ВСЕХ, ДВЕРИ ПО ПРАВАМ (STORY-088, владелец
  // 21.09: «визуал идентичный… даёшь просто разрешение на блоки»). Владельцу
  // `bookRights` отдаёт всё; сотруднику — по блокам календаря записи. Сервер
  // проверяет то же самое поле за полем, поэтому погашенная дверь здесь —
  // не украшение, а честный ответ заранее.
  const isMemberView = viewerRole === "master";
  const sessionUserId = useSession().session?.user.id ?? null;
  const rightsTeamId = isEdit ? (editing?.team_id ?? null) : teamId;
  const recordRights = useRecordBlocks(rightsTeamId);
  const eventRights = useEventRights(rightsTeamId);
  const calendarRights = useCalendarActions(rightsTeamId);
  const rights = bookRights({
    isMember: isMemberView,
    kind,
    isEdit,
    record: recordRights,
    event: eventRights,
    eventWritable:
      calendarRights.events === "write" &&
      (!isEdit || (editing?.created_by ?? null) === sessionUserId),
  });
  // Без тарифа запись клиента только смотрят: объект, услуги, клиент,
  // время — без дверей (владелец 02.10, `readOnlyBookRights`).
  const can = kind === "work" && !workInPlan ? readOnlyBookRights(rights) : rights;
  return {
    pendingRequests,
    requestActions,
    canRequestAddress,
    isMemberView,
    recordRights,
    can,
  };
}
