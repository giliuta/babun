import { useEffect, useState } from "react";
import type { AddressParts, Location } from "@babun/shared/local/clients";
import { haptics } from "@/lib/haptics";
import {
  composeDetails,
  objectPlacePatch,
  withoutStreet,
} from "./object-address";

// УТОЧНЕНИЕ АДРЕСА В ЛИСТЕ ПРАВКИ ОБЪЕКТА (владелец 2026-09-06: «основное —
// адрес или ссылка; уточнение можно раскрыть и свернуть обратно — мини-доп»).
// Главная строка живёт в листе; здесь — остальные части (комплекс, подъезд/
// этаж/квартира, город, индекс), пин и флаг «раскрыто». Пишется ОДНИМ патчем
// из строки и уточнения на уходе с любого поля и на закрытии — как всё в
// листе; собранная строка `address` уезжает вместе с частями, чтобы список и
// SMS увидели уточнение сразу. Открывается всегда свёрнутым: свёрнутая строка
// сама говорит, что в ней есть.

export function useAddressPartsEdit(
  visible: boolean,
  locationId: string | null,
  locations: Location[],
  /** Свежий объект (после каждого ответа сервера) — сравнение и id патча. */
  loc: Location | null,
  patchLocation: (id: string, patch: Partial<Location>) => void,
) {
  const [details, setDetails] = useState<AddressParts>({});
  const [pin, setPin] = useState("");
  const [open, setOpen] = useState(false);

  // Только на открытии (по locationId, не по объекту): `loc` — новая ссылка
  // после каждого ответа сервера, и эффект по нему перезаписывал бы набранное.
  useEffect(() => {
    if (!visible || !locationId) return;
    const current = locations.find((l) => l.id === locationId);
    setDetails(withoutStreet(current?.addressParts));
    setPin(current?.mapUrl ?? "");
    setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только на открытии
  }, [visible, locationId]);

  /** Записать место целиком из главной строки и уточнения; без изменений —
   *  писать нечего. */
  const commit = (line: string) => {
    if (!loc) return;
    const next = objectPlacePatch(line, details, pin, {
      address: loc.address,
      mapUrl: loc.mapUrl,
    });
    // Улица живёт внутри собранной строки, поэтому сравниваем строку, пин и
    // уточнение: прежний объект без частей не переписывается от одного
    // открытия листа.
    const same =
      next.address === (loc.address ?? "").trim() &&
      (next.mapUrl ?? "") === (loc.mapUrl ?? "").trim() &&
      composeDetails(next.addressParts) === composeDetails(loc.addressParts);
    if (same) return;
    patchLocation(loc.id, next);
  };

  const toggle = () => {
    haptics.tap();
    setOpen((v) => !v);
  };

  return {
    details,
    setDetails,
    pin,
    setPin,
    open,
    toggle,
    commit,
    summary: composeDetails(details),
  };
}
