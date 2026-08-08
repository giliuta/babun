import { useCallback } from "react";
import type { Client, Location } from "@babun/shared/local/clients";
import { randomUuid } from "@babun/shared/sync/uuid";
import { useJsonArrayWriter } from "@/features/clients/use-json-writer";

// ЗАПИСЬ ОБЪЕКТОВ. Механика «свежайший массив + очередь» общая для всех
// jsonb-массивов клиента и живёт в useJsonArrayWriter; здесь — только правила
// самих объектов: кто основной, что делать при удалении, где живут юниты.

export interface LocationWriter {
  /** Правка полей объекта. Патч можно задать ФУНКЦИЕЙ от свежего объекта —
   *  тогда значение не берётся из снимка рендера (вставка ссылки, считающая
   *  адрес, иначе возвращала старый адрес поверх только что введённого). */
  patchLocation: (
    id: string,
    patch: Partial<Location> | ((loc: Location) => Partial<Location>),
  ) => Promise<boolean>;
  /** Новый объект в хвост. Первый созданный — основной. Возвращает id
   *  созданного объекта (null — не записалось): лист добавления по нему
   *  различает «только что добавил я» и «было раньше». */
  addLocation: (
    draft: Omit<Location, "id" | "isPrimary">,
  ) => Promise<string | null>;
  /** Удаление с повышением основного, если снесли основной. */
  removeLocation: (id: string) => Promise<boolean>;
  makePrimary: (id: string) => Promise<boolean>;
  /** Правка СУЩЕСТВУЮЩЕГО юнита по id. Отдельно от добавления: слитый
   *  «сохрани — а если id нет, добавь» воскрешал только что удалённый юнит и
   *  терял правку, если два поля тронули подряд. */
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
    (
      id: string,
      patch: Partial<Location> | ((loc: Location) => Partial<Location>),
    ) =>
      apply((all) =>
        all.map((l) =>
          l.id === id
            ? { ...l, ...(typeof patch === "function" ? patch(l) : patch) }
            : l,
        ),
      ),
    [apply],
  );

  const addLocation = useCallback(
    async (draft: Omit<Location, "id" | "isPrimary">) => {
      const id = randomUuid();
      const ok = await apply((all) => [
        ...all,
        { ...draft, id, isPrimary: all.length === 0 },
      ]);
      return ok ? id : null;
    },
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




  return {
    patchLocation,
    addLocation,
    removeLocation,
    makePrimary,
    newId: randomUuid,
  };
}
