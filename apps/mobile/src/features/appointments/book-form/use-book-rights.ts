import { useMemo } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import { useLocationRequestActions } from "@/features/clients/location-request-actions";
import { visibleLocationRequests } from "@/features/clients/location-request-link";
import { useLocationRequests } from "@/features/clients/location-requests";
import { useCurrentRole } from "@/session/tenant";
import { useSession } from "@/providers/SessionProvider";
import { useMirror } from "@/session/mirror-state";
import { useCalendarActions, useEventRights, useRecordBlocks } from "@/features/appointments/useRecordRights";
import { bookIsReadOnly, bookRights, readOnlyBookRights } from "@/features/appointments/record-blocks";
import { EMPTY_REQUESTS } from "./book-constants";

interface BookRightsInput {
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
  // ОДНА СТРАНИЦА ЗАПИСИ ДЛЯ ВСЕХ, ДВЕРИ ПО ПРАВАМ (STORY-088; визуал
  // идентичный, меняется только разрешение на блоки). Владельцу
  // `bookRights` отдаёт всё; сотруднику — по блокам календаря записи. Сервер
  // проверяет то же самое поле за полем, поэтому погашенная дверь здесь —
  // не украшение, а честный ответ заранее.
  const isMemberView = viewerRole === "master";
  // ЧЬЁ СОБЫТИЕ — ГЛАЗАМИ ТОГО, КОГО ПОКАЗЫВАЕМ: в зеркале автор сверяется с
  // сотрудником, а не с вошедшим владельцем (как в сетке календаря).
  const mirror = useMirror();
  const sessionUserId = useSession().session?.user.id ?? null;
  const actorId = mirror ? mirror.userId : sessionUserId;
  const rightsTeamId = isEdit ? (editing?.team_id ?? null) : teamId;
  const recordRights = useRecordBlocks(rightsTeamId);
  const eventRights = useEventRights(rightsTeamId);
  const calendarRights = useCalendarActions(rightsTeamId);
  const ownEvent = !isEdit || (!!actorId && (editing?.created_by ?? null) === actorId);
  const rights = bookRights({
    isMember: isMemberView,
    kind,
    isEdit,
    record: recordRights,
    event: eventRights,
    eventWritable: calendarRights.events === "write" && ownEvent,
  });
  // Без тарифа запись клиента и чужое событие только смотрят: блоки на
  // месте, дверей нет (`bookIsReadOnly`).
  const readOnly = bookIsReadOnly({ isMember: isMemberView, kind, workInPlan, ownEvent });
  const can = readOnly ? readOnlyBookRights(rights) : rights;
  return {
    pendingRequests,
    requestActions,
    canRequestAddress,
    isMemberView,
    recordRights,
    can,
  };
}
