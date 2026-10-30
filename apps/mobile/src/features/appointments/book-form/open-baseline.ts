import type { Appointment } from "@babun/shared/local/appointments";
import type { Client, Location } from "@babun/shared/local/clients";
import type { Service } from "@/features/services/queries";
import type { BookDraftSnapshot } from "./book-draft-store";
import { buildBookPatch } from "./book-patch";
import { bookTotalsMath } from "./book-totals-math";

// ЭТАЛОН «КАК БЫЛО» У ПРАВКИ — ВИД ЗАПИСИ ПРИ ОТКРЫТИИ НА СЕГОДНЯШНИХ
// СПРАВОЧНИКАХ.
//
// «Есть несохранённое» у правки — патч формы против эталона. Эталон снимался
// один раз, в кадр загрузки записи, а часть входов патча доезжает позже:
// каталог (буферы услуг → `total_duration`), клиент (телефон →
// `reminder_enabled`), ставка VAT команды. Доехали — патч сдвинулся, эталон
// нет, и нетронутая запись считалась изменённой: «назад» спрашивал «Сохранить
// изменения?», а «Сохранить» записал бы пересчитанное (№17 владельца).
//
// Теперь у формы запоминается только ЕЁ СОСТОЯНИЕ при открытии (поля, которые
// правит человек), а патч из него собирается на каждом кадре на тех же
// справочниках, что и патч формы. Справочник доехал — сдвинулись обе стороны;
// разница остаётся только там, где человек правда что-то поменял.

/** Состояние формы при открытии записи — то, что правит человек. */
export type OpenRecord = Omit<BookDraftSnapshot, "v" | "savedAt" | "newRecordId"> & {
  /** Причина скидки (старые записи): в снимок черновика не входит. */
  discountReason: string | null;
};

/** Справочники, на которых собран патч формы прямо сейчас. */
export interface OpenRefs {
  isEdit: boolean;
  catalog: Map<string, Service>;
  rememberedRate: number;
  /** Клиент записи при открытии, найденный в текущем списке. */
  client: Client | null;
  /** Имя типа события при открытии (`eventTypeId`), если тип узнан. */
  eventTypeLabel: string | null;
  /** Объект события при открытии (`locationId`), если он в списке. */
  eventLoc: Location | null;
  clientLocations: readonly Location[];
  /** Есть ли на сервере колонка типа объекта события — как у формы. */
  eventPlaceTypeLive?: boolean;
}

/** Патч записи, какой она открылась, — на справочниках `refs`. */
export function openRecordPatch(open: OpenRecord, refs: OpenRefs): Partial<Appointment> {
  const math = bookTotalsMath({ ...open, catalog: refs.catalog, rememberedRate: refs.rememberedRate });
  return buildBookPatch({
    ...open,
    ...math,
    isEdit: refs.isEdit,
    eventLoc: refs.eventLoc,
    eventPlaceTypeLive: refs.eventPlaceTypeLive,
    eventTypeLabel: refs.eventTypeLabel,
    clientLocations: refs.clientLocations,
    client: refs.client,
  });
}

/** Прерванная правка, равная записи при открытии, — не правка. Её писала
 *  форма, считавшая себя изменённой без рук (№17); такой снимок не
 *  поднимается. `totalDraft` у расчётного итога — не ввод: его пересчитывает
 *  сама форма. */
export function sameAsOpen(
  saved: Omit<BookDraftSnapshot, "v" | "savedAt">,
  open: Omit<BookDraftSnapshot, "v" | "savedAt">,
): boolean {
  const strip = (s: Omit<BookDraftSnapshot, "v" | "savedAt">) => {
    const { newRecordId: _id, ...rest } = s;
    return rest.customTotal ? rest : { ...rest, totalDraft: "" };
  };
  return JSON.stringify(strip(saved)) === JSON.stringify(strip(open));
}
