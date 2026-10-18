import type { AddressParts } from "@babun/shared/local/clients";
import { isLikelyUrl, parseAddress } from "@babun/shared/common/utils/map-links";
import type { Coords } from "@/features/clients/location-request-form";
import { composeAddress, hasAddressPlace } from "@/features/clients/object-address";

// Pure map helpers of the object form (`ObjectFields.tsx`).

/** Координаты из строки-ссылки, если они в ней есть: с них открывается карта,
 *  когда точку ставят повторно. */
export function coordsOf(value: string): Coords | null {
  const raw = value.trim();
  if (!raw) return null;
  return parseAddress(raw).coords ?? null;
}

/** What the open map geocodes: the exact address when it has a place, else
 *  the main line — but never a link, whose coordinates are already inside. */
export function objectGeoQuery(value: { parts: AddressParts; target: string }): string {
  return hasAddressPlace(value.parts)
    ? composeAddress(value.parts, { forRoute: true })
    : isLikelyUrl(value.target.trim())
      ? ""
      : value.target.trim();
}
