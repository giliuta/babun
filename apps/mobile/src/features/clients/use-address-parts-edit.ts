import { useEffect, useState } from "react";
import type { AddressParts, Location } from "@babun/shared/local/clients";
import { isLikelyUrl } from "@babun/shared/common/utils/map-links";
import { haptics } from "@/lib/haptics";
import {
  addressPartsPatch,
  hasAddressPlace,
  partsFromLine,
  sameAddressParts,
} from "./object-address";

// РЕЖИМ УТОЧНЕНИЯ АДРЕСА В ЛИСТЕ ПРАВКИ ОБЪЕКТА (2026-09-06). Части и пин
// живут отдельно от строки «адрес или ссылка»; режим включён, пока у объекта
// есть «где» в частях или пока не нажали «Уточнить адрес». Пишется на уходе
// с поля и на закрытии — как всё в листе; собранная строка `address` уезжает
// вместе с частями, чтобы список и SMS увидели уточнение сразу.

export function useAddressPartsEdit(
  visible: boolean,
  locationId: string | null,
  locations: Location[],
  /** Свежий объект (после каждого ответа сервера) — сравнение и id патча. */
  loc: Location | null,
  patchLocation: (id: string, patch: Partial<Location>) => void,
) {
  const [parts, setParts] = useState<AddressParts>({});
  const [partsOpen, setPartsOpen] = useState(false);
  const [pin, setPin] = useState("");

  // Только на открытии (по locationId, не по объекту): `loc` — новая ссылка
  // после каждого ответа сервера, и эффект по нему перезаписывал бы набранное.
  useEffect(() => {
    if (!visible || !locationId) return;
    const current = locations.find((l) => l.id === locationId);
    const currentParts = current?.addressParts ?? {};
    setParts(currentParts);
    setPartsOpen(hasAddressPlace(currentParts));
    setPin(current?.mapUrl ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только на открытии
  }, [visible, locationId]);

  const commitParts = () => {
    if (!partsOpen || !loc) return;
    const next = addressPartsPatch(parts);
    const sameAddress = next.address === undefined || next.address === loc.address;
    if (sameAddressParts(loc.addressParts, next.addressParts) && sameAddress) return;
    patchLocation(loc.id, next);
  };

  /** Не ссылка — не пишем: поле вернётся к прежнему пину. */
  const commitPin = () => {
    if (!partsOpen || !loc) return;
    const value = pin.trim();
    const current = (loc.mapUrl ?? "").trim();
    if (value === current) return;
    if (!value) patchLocation(loc.id, { mapUrl: undefined });
    else if (isLikelyUrl(value)) patchLocation(loc.id, { mapUrl: value });
    else setPin(current);
  };

  /** Набранная строка не пропадает: адрес — в «Улица и дом», ссылка — в пин. */
  const openParts = (line: string) => {
    haptics.tap();
    const next = partsFromLine(parts, line, pin);
    setParts(next.parts);
    setPin(next.pin);
    setPartsOpen(true);
  };

  return { parts, setParts, partsOpen, pin, setPin, openParts, commitParts, commitPin };
}
