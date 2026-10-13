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

  // ОБЪЕКТ СОБЫТИЯ ВЫБИРАЕТСЯ БЕЗ КЛИЕНТА (владелец 2026-09-08: «в записи мы
  // сначала должны выбрать клиента, потом объект; в событии мы можем
  // выбирать отдельно объект, отдельно клиента»).
  //
  // Объект в базе принадлежит клиенту — он лежит в его `locations`, своей
  // таблицы у него нет. Поэтому «без клиента» здесь значит не «объект-сирота»,
  // а «не спрашиваем клиента, чтобы показать объекты»: событие выбирает из
  // объектов ВСЕХ клиентов, а чей объект — говорит подписью в листе. Клиент
  // события при этом остаётся своим полем и может быть пустым или другим.
  const eventLocationPool = useMemo(
    () => eventLocationRows(clients, client, clientLocations),
    [clients, client, clientLocations],
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
    eventLocationEntry,
    eventLocationOwner,
    forgetLocation,
  };
}
