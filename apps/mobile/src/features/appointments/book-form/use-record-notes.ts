import type { Client, Location } from "@babun/shared/local/clients";
import { useInlineNote } from "@/features/appointments/use-inline-note";
import { useClientNoteField } from "@/features/appointments/use-client-note-field";
import { useLocationWriter } from "@/features/clients/use-location-writer";
import { useClientFunctionOn } from "@/features/clients/client-functions";
import { useClientCardWritable, type useUpdateClientById } from "@/features/clients/queries";
import { EMPTY_LOCATIONS } from "./book-constants";
import type { EventLocationRow } from "./event-locations";

export interface RecordNotesInput {
  client: Client | null;
  clientId: string | null;
  teamId: string | null;
  locationId: string | null;
  selectedLocation: Location | null;
  eventLocationEntry: EventLocationRow | null;
  eventLocationOwner: Client | null;
  updateClient: ReturnType<typeof useUpdateClientById>;
}

/** Object writers and the client / object notes typed right in the form. */
export function useRecordNotes({
  client,
  clientId,
  teamId,
  locationId,
  selectedLocation,
  eventLocationEntry,
  eventLocationOwner,
  updateClient,
}: RecordNotesInput) {
  // Объект пишется ТОЛЬКО каноническим листом (ObjectSheet) — тем же, что на
  // карточке клиента. Своя форма здесь собирала массив locations снимком
  // рендера (взаимное затирание одной jsonb-колонки), знала свой список меток
  // и в крайнем случае писала мусорный тип «Объект».
  const updateClientPatch = async (patch: Partial<Client>) => {
    if (!clientId) return false;
    try {
      await updateClient.mutateAsync({ id: clientId, patch });
      return true;
    } catch {
      // useUpdateClientById показывает причину; правку не считаем записанной.
      return false;
    }
  };

  // Писатель объектов для листа добавления: на этом экране он единственный,
  // но живёт снаружи листа — как на карточке, где писатель общий для всех
  // листов сразу.
  const locationWriter = useLocationWriter(
    client?.locations ?? EMPTY_LOCATIONS,
    updateClientPatch,
    clientId,
  );

  // Писатель объектов ВЛАДЕЛЬЦА выбранного объекта. У события объект может
  // принадлежать не тому клиенту, что стоит в форме (или клиента нет вовсе),
  // а заметка объекта («код ворот») обязана лечь в его собственную карточку —
  // не в карточку случайного клиента этого события.
  const updateOwnerPatch = async (patch: Partial<Client>) => {
    const ownerId = eventLocationOwner?.id;
    if (!ownerId) return false;
    try {
      await updateClient.mutateAsync({ id: ownerId, patch });
      return true;
    } catch {
      return false;
    }
  };
  const eventLocationWriter = useLocationWriter(
    eventLocationOwner?.locations ?? EMPTY_LOCATIONS,
    updateOwnerPatch,
    eventLocationOwner?.id ?? null,
  );

  // ═══ ЗАМЕТКА КЛИЕНТА И ЗАМЕТКА ОБЪЕКТА — ПОЛЯМИ ПРЯМО В ФОРМЕ ═══
  //
  // Владелец 2026-09-04: «не надо тапать „добавить заметку“ — мини-блок, куда
  // можно вписывать сразу, как в самом низу: заметка объекта, заметка
  // клиента, внизу заметка записи». Это то, что бригаде надо знать до
  // выезда и что живёт не в записи, а в клиенте («звонить после 18») и в
  // объекте («код ворот 1234»).
  //
  // ЗАМЕТКА КЛИЕНТА — ПОСЛЕДНЯЯ ЗАПИСЬ ЖУРНАЛА. На карточке заметки — датированный
  // журнал; поле здесь правит его последнюю запись на месте, а пустому
  // журналу заводит первую. Стёрли поле — последняя запись уходит. Журнал
  // пишется тем же писателем «свежайший массив + очередь», что и на карточке.
  // Импортированная заметка (`comment` из CSV) при первой правке переезжает
  // в журнал — ОДНИМ патчем вместе с журналом, как на карточке чистит её «✕».
  // Два патча подряд (журнал и отдельно comment) в офлайн-кэше затирали друг
  // другу колонку (ревью 2026-09-04).
  const writeObjectNote = (next: string, boundId: string | null) => {
    if (!boundId) return;
    void locationWriter.patchLocation(boundId, { note: next || undefined });
  };
  // Логика поля — общий хук: тот же блок «Клиент» ставят инвойс и чек.
  const clientNote = useClientNoteField(client);
  // ЗАМЕТКА КЛИЕНТА — ЗА ВЫКЛЮЧАТЕЛЕМ «БЛОКОВ КЛИЕНТОВ» (владелец 03.10:
  // «убрать заметку — она убирается и на карточке клиента, и в записи»).
  // Команда — та же, что у карточки: клиента; без неё — команда записи.
  const clientNoteOn = useClientFunctionOn("client_note", client?.team_id ?? teamId);
  // КАРТОЧКУ КЛИЕНТА ОТСЮДА МОЖНО ПРАВИТЬ? (аудит прав 03.10). Мастер вне
  // вкладки «Клиенты» видит «клиента записи» — заметка клиента, заметка и
  // правка объекта, «Добавить объект» пишут в карточку и всегда получали
  // отказ «ведёт владелец». Такие поля здесь только читаются.
  const clientCan = useClientCardWritable(client);
  const clientNoteWritable = clientCan("clients.note");
  const clientObjectsWritable = clientCan("clients.objects");
  const objectNote = useInlineNote<string | null>(
    selectedLocation?.note ?? "",
    locationId,
    writeObjectNote,
    locationId,
  );
  const writeEventObjectNote = (next: string, boundId: string | null) => {
    if (!boundId) return;
    void eventLocationWriter.patchLocation(boundId, { note: next || undefined });
  };
  const eventObjectNote = useInlineNote<string | null>(
    eventLocationEntry?.loc.note ?? "",
    locationId,
    writeEventObjectNote,
    locationId,
  );
  return {
    locationWriter,
    eventLocationWriter,
    clientNote,
    clientNoteOn,
    clientNoteWritable,
    clientObjectsWritable,
    objectNote,
    eventObjectNote,
  };
}
