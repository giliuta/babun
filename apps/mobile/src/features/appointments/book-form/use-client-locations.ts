import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { Client } from "@babun/shared/local/clients";
import { EMPTY_LOCATIONS } from "./book-constants";
import {
  eventLocationRows,
  withAddedLocation,
  type AddedLocation,
} from "./event-locations";

interface ClientLocationsInput {
  client: Client | null;
  clients: Client[];
  locationId: string | null;
  setLocationId: Dispatch<SetStateAction<string | null>>;
  setAddress: Dispatch<SetStateAction<string>>;
}

/** Objects the record and the event choose from — only their client's. */
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

  // ОБЪЕКТ СОБЫТИЯ: С КЛИЕНТОМ — ТОЛЬКО ЕГО ОБЪЕКТЫ, БЕЗ КЛИЕНТА — НИЧЬИ.
  // Список «объекты всех клиентов» открывал событию чужие адреса — те же
  // карточки других календарей, что изоляция клиентов прячет везде. Без
  // клиента объект заводится в самом событии (`event-place.ts`), а не
  // выбирается из чужих карточек.
  //
  // Общий пул остаётся только для ЧТЕНИЯ старых событий: где уже стоит
  // объект чужого клиента, он показывается как есть, а не теряется.
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
