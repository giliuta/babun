import type { AddressParts } from "@babun/shared/local/clients";
import {
  extractAddressFromMapUrl,
  isLikelyUrl,
} from "@babun/shared/common/utils/map-links";
import {
  ADDRESS_PART_KEYS,
  cleanAddressParts,
  hasAddressPlace,
} from "@/features/clients/object-address";

// ФОРМА КЛИЕНТА «КУДА ПРИЕХАТЬ МАСТЕРУ» — чистая часть (STORY-077).
//
// Клиент отвечает тремя способами, и все три сходятся в один объект:
//   · «Я сейчас здесь» — точка GPS: пин для маршрута (mapUrl) и, если
//     геокодер узнал улицу, текст адреса;
//   · улица и дом текстом + точный адрес (комплекс, подъезд, этаж, кв.);
//   · ссылка на карту — в главной строке или в поле пина.
// Разбор повторяет objectPlacePatch в приложении: ссылка → пин, текст → улица,
// пин из точного адреса главнее ссылки в строке. Сервер (RPC
// location_request_submit) собирает строку адреса и дописывает объект.

export interface Coords {
  lat: number;
  lng: number;
}

export interface LocationForm {
  /** Улица и дом либо ссылка на карту — главная строка. */
  line: string;
  /** Точный адрес без улицы (см. withoutStreet). */
  parts: AddressParts;
  /** Ссылка на карту из точного адреса. */
  pin: string;
  /** «Я сейчас здесь». */
  coords: Coords | null;
  label: string;
  note: string;
}

export const EMPTY_LOCATION_FORM: LocationForm = {
  line: "",
  parts: {},
  pin: "",
  coords: null,
  label: "",
  note: "",
};

/** Типы, если бизнес не завёл своих. */
export const DEFAULT_LOCATION_LABELS = ["Дом", "Квартира", "Офис"] as const;

/** Отправлять есть что: точка, строка, ссылка-пин или «где» в точном адресе. */
export function locationFormReady(form: LocationForm): boolean {
  return (
    !!form.coords ||
    form.line.trim().length > 0 ||
    isLikelyUrl(form.pin.trim()) ||
    hasAddressPlace(form.parts)
  );
}

/** Тело RPC location_request_submit: только заполненные ключи. */
export function buildLocationPayload(form: LocationForm): Record<string, string> {
  const line = form.line.replace(/\s*[\n\r]+\s*/g, " ").trim();
  const pin = form.pin.trim();
  let mapUrl = "";
  let street = "";
  if (line) {
    if (isLikelyUrl(line)) {
      mapUrl = line;
      street = extractAddressFromMapUrl(line) ?? "";
    } else {
      street = line;
    }
  }
  if (isLikelyUrl(pin)) mapUrl = pin;

  const parts = cleanAddressParts({ ...form.parts, street: street || undefined }) ?? {};
  const out: Record<string, string> = {};
  for (const key of ADDRESS_PART_KEYS) {
    const value = parts[key];
    if (value) out[key] = value;
  }
  if (mapUrl) out.map_url = mapUrl;
  if (form.coords) {
    out.lat = String(form.coords.lat);
    out.lng = String(form.coords.lng);
  }
  const label = form.label.trim();
  if (label) out.label = label;
  const note = form.note.trim();
  if (note) out.note = note;
  return out;
}

/** «34.7071» — шесть знаков без хвоста нулей. */
function trimCoord(value: number): string {
  return String(Number(value.toFixed(6)));
}

export function formatCoords(c: Coords): string {
  return `${trimCoord(c.lat)}, ${trimCoord(c.lng)}`;
}

export function googleMapsSearchUrl(c: Coords): string {
  return `https://www.google.com/maps/search/?api=1&query=${trimCoord(c.lat)},${trimCoord(c.lng)}`;
}

/** Врезка OpenStreetMap с маркером — без ключей и без скриптов; ±200 м. */
export function osmEmbedUrl(c: Coords): string {
  const dLng = 0.004;
  const dLat = 0.002;
  const bbox = [c.lng - dLng, c.lat - dLat, c.lng + dLng, c.lat + dLat]
    .map((v) => v.toFixed(6))
    .join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${trimCoord(c.lat)},${trimCoord(c.lng)}`;
}

// ─── Ответы сервера ──────────────────────────────────────────────────────────

export type LookupState = "pending" | "used" | "expired" | "missing";

export interface LocationRequestLookup {
  state: LookupState;
  businessName: string;
  logoUrl: string | null;
  clientFirstName: string;
  labels: string[];
  expiresAt: string | null;
}

function asRecord(json: unknown): Record<string, unknown> {
  return json && typeof json === "object" && !Array.isArray(json)
    ? (json as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseLookup(json: unknown): LocationRequestLookup {
  const o = asRecord(json);
  const state = o.state;
  const labels = Array.isArray(o.labels)
    ? o.labels.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  return {
    state:
      state === "pending" || state === "used" || state === "expired"
        ? state
        : "missing",
    businessName: str(o.business_name),
    logoUrl: str(o.logo_url) || null,
    clientFirstName: str(o.client_first_name),
    labels,
    expiresAt: str(o.expires_at) || null,
  };
}

export type SubmitResult =
  | { ok: true; address: string }
  | { ok: false; state: "used" | "expired" | "missing" };

export function parseSubmit(json: unknown): SubmitResult {
  const o = asRecord(json);
  if (o.ok === true) return { ok: true, address: str(o.address) };
  const state = o.state;
  return { ok: false, state: state === "used" || state === "expired" ? state : "missing" };
}

/** Улица, город и индекс из ответа Nominatim (reverse). Подъезд, этаж и
 *  квартиру геокодер не знает — их клиент пишет сам. */
export function partsFromNominatim(json: unknown): {
  street?: string;
  city?: string;
  zip?: string;
} {
  const a = asRecord(asRecord(json).address);
  const road = str(a.road) || str(a.pedestrian) || str(a.residential) || str(a.footway);
  const house = str(a.house_number);
  const street = [road, house].filter(Boolean).join(" ");
  const city =
    str(a.city) || str(a.town) || str(a.village) || str(a.municipality) || str(a.county);
  const zip = str(a.postcode);
  const out: { street?: string; city?: string; zip?: string } = {};
  if (street) out.street = street;
  if (city) out.city = city;
  if (zip) out.zip = zip;
  return out;
}
