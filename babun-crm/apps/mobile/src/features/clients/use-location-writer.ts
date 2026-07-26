import { useCallback } from "react";
import type { ACUnit, Client, Location } from "@babun/shared/local/clients";
import { randomUuid } from "@babun/shared/sync/uuid";
import { useJsonArrayWriter } from "@/features/clients/use-json-writer";

// ЗАПИСЬ ОБЪЕКТОВ. Механика «свежайший массив + очередь» общая для всех
// jsonb-массивов клиента и живёт в useJsonArrayWriter; здесь — только правила
// самих объектов: кто основной, что делать при удалении, где живут юниты.

export interface LocationWriter {
  /** Правка полей объекта. */
  patchLocation: (id: string, patch: Partial<Location>) => Promise<boolean>;
  /** Новый объект в хвост. Первый созданный — основной. */
  addLocation: (draft: Omit<Location, "id" | "isPrimary">) => Promise<boolean>;
  /** Удаление с повышением основного, если снесли основной. */
  removeLocation: (id: string) => Promise<boolean>;
  makePrimary: (id: string) => Promise<boolean>;
  /** Правка/добавление юнита: id из черновика или новый. */
  saveUnit: (locationId: string, unit: ACUnit) => Promise<boolean>;
  removeUnit: (locationId: string, unitId: string) => Promise<boolean>;
  newId: () => string;
}

export function useLocationWriter(
  locations: Location[],
  update: (patch: Partial<Client>) => Promise<boolean>,
): LocationWriter {
  const write = useCallback(
    (next: Location[]) => update({ locations: next }),
    [update],
  );
  const { apply } = useJsonArrayWriter<Location>(locations, write);

  const patchLocation = useCallback(
    (id: string, patch: Partial<Location>) =>
      apply((all) => all.map((l) => (l.id === id ? { ...l, ...patch } : l))),
    [apply],
  );

  const addLocation = useCallback(
    (draft: Omit<Location, "id" | "isPrimary">) =>
      apply((all) => [
        ...all,
        { ...draft, id: randomUuid(), isPrimary: all.length === 0 },
      ]),
    [apply],
  );

  const removeLocation = useCallback(
    (id: string) =>
      apply((all) => {
        const next = all.filter((l) => l.id !== id);
        // Основной объект подставляется при записи, поэтому без него нельзя:
        // сносим основной — повышаем первый оставшийся.
        return next.length > 0 && !next.some((l) => l.isPrimary)
          ? next.map((l, i) => ({ ...l, isPrimary: i === 0 }))
          : next;
      }),
    [apply],
  );

  const makePrimary = useCallback(
    (id: string) =>
      apply((all) => all.map((l) => ({ ...l, isPrimary: l.id === id }))),
    [apply],
  );

  const saveUnit = useCallback(
    (locationId: string, unit: ACUnit) =>
      apply((all) =>
        all.map((l) => {
          if (l.id !== locationId) return l;
          const units = l.equipment ?? [];
          return {
            ...l,
            equipment: units.some((u) => u.id === unit.id)
              ? units.map((u) => (u.id === unit.id ? unit : u))
              : [...units, unit],
          };
        }),
      ),
    [apply],
  );

  const removeUnit = useCallback(
    (locationId: string, unitId: string) =>
      apply((all) =>
        all.map((l) =>
          l.id === locationId
            ? {
                ...l,
                equipment: (l.equipment ?? []).filter((u) => u.id !== unitId),
              }
            : l,
        ),
      ),
    [apply],
  );

  return {
    patchLocation,
    addLocation,
    removeLocation,
    makePrimary,
    saveUnit,
    removeUnit,
    newId: randomUuid,
  };
}
