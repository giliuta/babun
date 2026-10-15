import type { Dispatch, SetStateAction } from "react";
import type { AppointmentService } from "@babun/shared/local/appointments";
import { isCustomServiceId, newCustomServiceId } from "@babun/shared/local/appointments";
import type { Service } from "@/features/services/queries";
import {
  overrideWithQuantity,
  type ServiceOverride,
} from "@/features/appointments/helpers";
import { haptics } from "@/lib/haptics";

export interface ServiceLineActionsInput {
  setServiceIds: Dispatch<SetStateAction<string[]>>;
  setOverrides: Dispatch<SetStateAction<Record<string, ServiceOverride>>>;
  setTotalSheetOpen: Dispatch<SetStateAction<boolean>>;
  selectedServices: AppointmentService[];
  catalog: Map<string, Service>;
}

/** Edits of the record's service lines (block «Услуги» and sheet «Итого»). */
export function serviceLineActions({
  setServiceIds,
  setOverrides,
  setTotalSheetOpen,
  selectedServices,
  catalog,
}: ServiceLineActionsInput) {
  const toggleService = (id: string) => {
    setServiceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    haptics.tap();
  };
  // ЦЕНА УСЛУГИ В ЭТОЙ ЗАПИСИ. Ноль законен: бывает «сделали бесплатно».
  const setLinePrice = (id: string, price: number) => {
    setOverrides((p) => ({ ...p, [id]: { ...p[id], price: Math.max(0, price) } }));
  };
  // СВОЯ СТРОКА ЗАПИСИ (в «Итого» справа — добавить ещё одну услугу). Не из прайса: имя, цена и время 0 держит замок
  // снимка (`locked`), как у сохранённой строки, — `buildServices` читает
  // их оттуда, каталог ей не нужен.
  const addCustomLine = () => {
    const id = newCustomServiceId();
    setServiceIds((p) => [...p, id]);
    setOverrides((p) => ({
      ...p,
      [id]: {
        qty: 1,
        price: 0,
        locked: { pricePerUnit: 0, originalPrice: 0, duration: 0, serviceName: "", unit: null },
      },
    }));
  };
  const setLineName = (id: string, name: string) => {
    setOverrides((p) => {
      const current = p[id];
      if (!current?.locked) return p;
      return { ...p, [id]: { ...current, locked: { ...current.locked, serviceName: name } } };
    });
  };
  /** Убрать свою строку — свайпом в «Итого». */
  const removeCustomLine = (id: string) => {
    setServiceIds((p) => p.filter((x) => x !== id));
  };
  // СВОЯ СТРОКА БЕЗ НАЗВАНИЯ УХОДИТ САМА (стёрли имя услуги — строка удаляется).
  const closeTotalSheet = () => {
    const empty = new Set(
      selectedServices
        .filter(
          (line) => isCustomServiceId(line.serviceId) && !(line.serviceName ?? "").trim(),
        )
        .map((line) => line.serviceId),
    );
    if (empty.size > 0) setServiceIds((p) => p.filter((id) => !empty.has(id)));
    setTotalSheetOpen(false);
  };
  const setQty = (id: string, qty: number) => {
    if (qty < 1) {
      setServiceIds((p) => p.filter((x) => x !== id));
      return;
    }
    // Правка количества снимает замок сохранённой строки — строка считается
    // по действующему прайсу (`overrideWithQuantity`); своя строка и услуга,
    // убранная из прайса, держат свои числа.
    const repriceable = catalog.has(id) && !isCustomServiceId(id);
    setOverrides((p) => ({
      ...p,
      [id]: overrideWithQuantity(p[id], qty, repriceable, catalog.get(id)),
    }));
  };
  return {
    toggleService,
    setLinePrice,
    addCustomLine,
    setLineName,
    removeCustomLine,
    closeTotalSheet,
    setQty,
  };
}
