import { useCallback } from "react";
import type { Client, ClientRequisites } from "@babun/shared/local/clients";
import {
  makeDefaultRequisites,
  removeRequisites,
  requisitesPatch,
  upsertRequisites,
  type RequisitesFields,
} from "@babun/shared/local/client-requisites";
import { randomUuid } from "@babun/shared/sync/uuid";
import { useJsonArrayWriter } from "@/features/clients/use-json-writer";

// ЗАПИСЬ НАБОРОВ РЕКВИЗИТОВ — по образцу объектов (`use-location-writer.ts`).
// `clients.requisites` — одна jsonb-колонка, патч перезаписывает её целиком,
// поэтому механика «свежайший массив + очередь + откат» та же, что у объектов
// и телефонов (`useJsonArrayWriter`); здесь — только правила самих наборов,
// и те — чистыми функциями из `client-requisites.ts` (их проверяет тест).
//
// Патч везёт массив И четыре колонки-зеркало: сервер положит в зеркало то же
// самое, а оптимистичная строка на устройстве сразу показывает новое юр. имя
// в поиске и в «Поделиться».

export interface RequisitesWriter {
  /** Правка набора по id или новый набор (id нет). Возвращает id набора,
   *  null — не записалось. */
  saveRequisites: (
    draft: Partial<RequisitesFields> & { id?: string | null },
  ) => Promise<string | null>;
  removeRequisites: (id: string) => Promise<boolean>;
  makeDefault: (id: string) => Promise<boolean>;
}

export function useRequisitesWriter(
  sets: ClientRequisites[],
  update: (patch: Partial<Client>) => Promise<boolean>,
  ownerKey?: string | null,
): RequisitesWriter {
  const write = useCallback(
    (next: ClientRequisites[]) => update(requisitesPatch(next)),
    [update],
  );
  // Поле — чтобы карточка и страница «Все реквизиты» писали ОДНОЙ очередью.
  const { apply } = useJsonArrayWriter<ClientRequisites>(sets, write, ownerKey, "requisites");

  const saveRequisites = useCallback(
    async (draft: Partial<RequisitesFields> & { id?: string | null }) => {
      const id = draft.id ?? randomUuid();
      const ok = await apply((all) => upsertRequisites(all, { ...draft, id }, randomUuid));
      return ok ? id : null;
    },
    [apply],
  );

  const remove = useCallback(
    (id: string) => apply((all) => removeRequisites(all, id, randomUuid)),
    [apply],
  );

  const makeDefault = useCallback(
    (id: string) => apply((all) => makeDefaultRequisites(all, id, randomUuid)),
    [apply],
  );

  return { saveRequisites, removeRequisites: remove, makeDefault };
}
