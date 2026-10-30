import type { Location } from "@babun/shared/local/clients";
import { isLikelyUrl } from "@babun/shared/common/utils/map-links";
import type { ObjectFieldsValue } from "@/features/clients/ObjectFields";
import { objectPlacePatch } from "@/features/clients/object-address";
import { coordsOf } from "@/features/clients/object-fields/object-geo";
import { googleMapsSearchUrl } from "@/features/clients/location-request-form";

// ОБЪЕКТ СОБЫТИЯ БЕЗ КЛИЕНТА ЖИВЁТ В САМОМ СОБЫТИИ: адрес — `address` (или
// `event_url`, когда это одна ссылка), точка — `address_lat/lng`, заметка —
// `address_note`; `location_id` пуст. В базу клиентов он не пишется: у
// события может не быть человека, а объект «ничей» в чужой карточке — это
// утечка между календарями. Здесь — переводы между полями события, формой
// объекта (`PlaceSheet`) и строкой `ObjectRow`. Лист без React.

/** Id строки объекта события — не id объекта клиента и в базу не уходит. */
export const EVENT_PLACE_ID = "event-place";

export interface EventPlace {
  /** Адрес словами или одна ссылка (старые события). */
  address: string;
  /** Точка на карте ссылкой Google Maps; пусто — точки нет. */
  pin: string;
  note: string;
}

/** Есть ли у события свой объект: адрес или точка. */
export function hasEventPlace(place: EventPlace): boolean {
  return place.address.trim().length > 0 || place.pin.trim().length > 0;
}

/** Точка события ссылкой — из координат записи. */
export function pinOfCoords(lat: number | null | undefined, lng: number | null | undefined): string {
  return lat != null && lng != null ? googleMapsSearchUrl({ lat, lng }) : "";
}

/** Координаты точки — то, что пишется в `address_lat/lng`. */
export function placeCoords(pin: string): { lat: number | null; lng: number | null } {
  const coords = coordsOf(pin);
  return coords ? { lat: coords.lat, lng: coords.lng } : { lat: null, lng: null };
}

/** Строка `ObjectRow` для объекта события: та же строка, что у объекта
 *  клиента; тип — по имени из справочника команды (`ObjectRow` найдёт его
 *  вид по `label`). */
export function placeAsLocation(place: EventPlace, typeName = ""): Location {
  const address = place.address.trim();
  const addressIsLink = isLikelyUrl(address);
  const pin = place.pin.trim();
  return {
    id: EVENT_PLACE_ID,
    label: typeName,
    address: addressIsLink ? "" : address,
    mapUrl: pin || (addressIsLink ? address : undefined),
    note: place.note.trim() || undefined,
    isPrimary: false,
  };
}

/** Форма объекта, открытая на объекте события. */
export function placeFormValue(place: EventPlace, typeName = ""): ObjectFieldsValue {
  return {
    type: typeName,
    target: place.address,
    parts: {},
    partsOpen: false,
    pin: place.pin,
    note: place.note,
  };
}

/** Что форма отдала событию: одна строка адреса (уточнение складывается в
 *  неё же — частей у события нет), точка и заметка. Ссылка без адреса
 *  остаётся адресом-ссылкой: так её и хранили старые события. */
export function placeFromForm(value: ObjectFieldsValue): EventPlace {
  const { address, mapUrl } = objectPlacePatch(value.target, value.parts, value.pin);
  const pin = (mapUrl ?? "").trim();
  const text = address.trim();
  if (!text && pin && !coordsOf(pin)) return { address: pin, pin: "", note: value.note.trim() };
  return { address: text, pin, note: value.note.trim() };
}

/** Тип объекта события: id из справочника команды по имени, выбранному в
 *  форме. Нет такого имени в справочнике (удалили) — без типа. */
export function placeTypeId(
  presets: readonly { id: string; name: string }[],
  typeName: string,
): string | null {
  const key = typeName.trim().toLowerCase();
  if (!key) return null;
  return presets.find((p) => p.name.trim().toLowerCase() === key)?.id ?? null;
}

/** Имя типа объекта события по id — для строки и формы. */
export function placeTypeName(
  presets: readonly { id: string; name: string }[],
  typeId: string | null | undefined,
): string {
  return (typeId && presets.find((p) => p.id === typeId)?.name) || "";
}

/** Нет колонки на сервере: PostgREST её не знает (PGRST204 / 42703). */
export function isMissingTypeColumn(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /address_object_type_id/i.test(error.message ?? "")
  );
}
