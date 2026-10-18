import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { Client } from "@babun/shared/local/clients";
import { EMPTY_LOCATIONS } from "./book-constants";
import {
  eventLocationRows,
  withAddedLocation,
  type AddedLocation,
} from "./event-locations";

export interface ClientLocationsInput {
  client: Client | null;
  clients: Client[];
  locationId: string | null;
  setLocationId: Dispatch<SetStateAction<string | null>>;
  setAddress: Dispatch<SetStateAction<string>>;
}

/** Objects the record (its client's) and the event (anyone's) choose from. */
export function useClientLocations({
  client,
  clients,
  locationId,
  setLocationId,
  setAddress,
}: ClientLocationsInput) {
  // ОБЪЕКТ, ДОБАВЛЕННЫЙ ОТСЮДА, ВИДЕН СРАЗУ. Список клиентов после записи
  // только инвалидируется, и с полсекунды `client.locations` не знает о новом
  // объекте: блок мигал «Выбрать объект», а сохранение в эту щель писало
  // location_id: null. Держим добавленный при себе, пока сервер его не
  // отдаст; ключ по клиенту — чужому клиенту он не достанется.
  const [addedLocation, setAddedLocation] = useState<AddedLocation | null>(null);
  const serverLocations = client?.locations ?? EMPTY_LOCATIONS;
  const clientLocations = useMemo(
    () => withAddedLocation(client, serverLocations, addedLocation),
    [client, serverLocations, addedLocation],
  );
  const selectedLocation =
    clientLocations.find((l) => l.id === locationId) ?? null;

  // ОБЪЕКТ СОБЫТИЯ — КАК У ЗАПИСИ: СНАЧАЛА КЛИЕНТ, ПОТОМ ЕГО ОБЪЕКТ.
  // Объект в базе принадлежит клиенту — он лежит в его `locations`, своей
  // таблицы у него нет. Событие без клиента выбирало из объектов всех
  // клиентов, и объект вставал в событие ничьим: в записи так нельзя, а в
  // событии было можно. Теперь выбор — только объекты клиента события.
  //
  // Общий пул остаётся для СТАРЫХ событий: объект чужого клиента, выбранный
  // раньше, не пропадает и подписан, чей он.
  const eventLocationPool = useMemo(
    () => eventLocationRows(clients, client, clientLocations),
    [clients, client, clientLocations],
  );
  const eventPickPool = useMemo(
    () => (client ? eventLocationPool.filter((row) => row.ownerId === client.id) : []),
    [client, eventLocationPool],
  );
  const eventLocationEntry =
    eventLocationPool.find((row) => row.loc.id === locationId) ?? null;
  const eventLocationOwner = eventLocationEntry
    ? clients.find((c) => c.id === eventLocationEntry.ownerId) ?? null
    : null;
  // Объект удалили листом правки или убрали «✕» сразу после добавления —
  // выбор снимается, адрес-снимок пустеет: id удалённого в запись не едет.
  const forgetLocation = (id: string) => {
    setAddedLocation((cur) => (cur?.loc.id === id ? null : cur));
    if (locationId === id) {
      setLocationId(null);
      setAddress("");
    }
  };
  return {
    setAddedLocation,
    serverLocations,
    clientLocations,
    selectedLocation,
    eventLocationPool,
    eventPickPool,
    eventLocationEntry,
    eventLocationOwner,
    forgetLocation,
  };
}
