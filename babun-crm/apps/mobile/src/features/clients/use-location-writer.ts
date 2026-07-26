import { useCallback, useEffect, useRef } from "react";
import type { ACUnit, Client, Location } from "@babun/shared/local/clients";
import { randomUuid } from "@babun/shared/sync/uuid";

// ЗАПИСЬ ОБЪЕКТОВ — одна очередь и одна свежая правда.
//
// `locations` — это ОДНА jsonb-колонка: патч перезаписывает весь массив, а не
// поле объекта. Пока каждая строка собирала патч из снимка своего рендера,
// две быстрые правки подряд на медленной сети затирали друг друга: вторая
// уходила с ещё старым значением первой, применялась последней — и первая
// правка исчезала навсегда (invalidate подтягивал авторитетную строку и
// подтверждал потерю).
//
// Поэтому: (1) массив всегда берётся из `latest` — сервер, а до его ответа
// наша собственная запись; (2) записи выстроены в цепочку, вторая уходит
// после ответа на первую.

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
  const latest = useRef<Location[]>(locations);
  // Рендер приносит авторитетную строку (в том числе после чужой правки по
  // реалтайму) — она главнее нашего оптимистичного значения.
  useEffect(() => {
    latest.current = locations;
  }, [locations]);

  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const write = useCallback(
    (next: Location[]): Promise<boolean> => {
      // Своё значение — правда до ответа сервера: следующая правка в этом же
      // экране должна видеть предыдущую, даже если PATCH ещё в пути.
      latest.current = next;
      const run = chain.current.then(() => update({ locations: next }));
      chain.current = run.catch(() => false);
      return run;
    },
    [update],
  );

  const patchLocation = useCallback(
    (id: string, patch: Partial<Location>) =>
      write(
        latest.current.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      ),
    [write],
  );

  const addLocation = useCallback(
    (draft: Omit<Location, "id" | "isPrimary">) =>
      write([
        ...latest.current,
        { ...draft, id: randomUuid(), isPrimary: latest.current.length === 0 },
      ]),
    [write],
  );

  const removeLocation = useCallback(
    (id: string) => {
      const next = latest.current.filter((l) => l.id !== id);
      // Основной объект подставляется при записи, поэтому без него нельзя:
      // сносим основной — повышаем первый оставшийся.
      const promoted =
        next.length > 0 && !next.some((l) => l.isPrimary)
          ? next.map((l, i) => ({ ...l, isPrimary: i === 0 }))
          : next;
      return write(promoted);
    },
    [write],
  );

  const makePrimary = useCallback(
    (id: string) =>
      write(latest.current.map((l) => ({ ...l, isPrimary: l.id === id }))),
    [write],
  );

  const saveUnit = useCallback(
    (locationId: string, unit: ACUnit) =>
      write(
        latest.current.map((l) => {
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
    [write],
  );

  const removeUnit = useCallback(
    (locationId: string, unitId: string) =>
      write(
        latest.current.map((l) =>
          l.id === locationId
            ? {
                ...l,
                equipment: (l.equipment ?? []).filter((u) => u.id !== unitId),
              }
            : l,
        ),
      ),
    [write],
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
