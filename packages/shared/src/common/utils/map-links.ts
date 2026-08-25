// Map link helpers for the appointment address field.
//
// Users can type a plain address OR paste a link from any navigation
// service (Google Maps, Waze, Apple Maps, including the short forms
// like goo.gl/maps and maps.app.goo.gl). The address field keeps the
// raw input; the three "open in" buttons route that input through the
// appropriate deep link.

export type MapService = "google" | "apple" | "waze" | "yandex";

export interface ParsedAddress {
  raw: string;
  coords: { lat: number; lng: number } | null;
  isUrl: boolean;
}

function valid(lat: number, lng: number): boolean {
  return (
    !isNaN(lat) &&
    !isNaN(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

// Pulls a lat/lng pair out of arbitrary text. Tries many patterns used
// across Google / Apple / Waze / generic providers before falling back
// to a raw "DD.DDDD,DD.DDDD" regex.
export function extractCoords(
  input: string
): { lat: number; lng: number } | null {
  if (!input) return null;

  const tryMatch = (re: RegExp) => {
    const m = input.match(re);
    if (!m) return null;
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    return valid(lat, lng) ? { lat, lng } : null;
  };

  let hit = tryMatch(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)(?:,-?\d+(?:\.\d+)?z?)/);
  if (hit) return hit;
  hit = tryMatch(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (hit) return hit;
  hit = tryMatch(/[?&#]ll=(-?\d+\.\d+)[,%2C ]+(-?\d+\.\d+)/i);
  if (hit) return hit;
  hit = tryMatch(/[?&#]latlng=(-?\d+\.\d+)[,%2C ]+(-?\d+\.\d+)/i);
  if (hit) return hit;
  hit = tryMatch(/[?&#]center=(-?\d+\.\d+)[,%2C ]+(-?\d+\.\d+)/i);
  if (hit) return hit;
  hit = tryMatch(/[?&#]q=(-?\d+\.\d+)[,%2C ]+(-?\d+\.\d+)/i);
  if (hit) return hit;
  hit = tryMatch(/[?&#]query=(-?\d+\.\d+)[,%2C ]+(-?\d+\.\d+)/i);
  if (hit) return hit;
  hit = tryMatch(/[?&#]destination=(-?\d+\.\d+)[,%2C ]+(-?\d+\.\d+)/i);
  if (hit) return hit;
  hit = tryMatch(/ll[.=](-?\d+\.\d+)[,%2C ]+(-?\d+\.\d+)/i);
  if (hit) return hit;
  hit = tryMatch(/(-?\d{1,3}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
  if (hit) return hit;

  return null;
}

export function isLikelyUrl(input: string): boolean {
  const trimmed = input.trim();
  return (
    /^https?:\/\//i.test(trimmed) ||
    /^(www\.)?(maps\.google|google\.com\/maps|goo\.gl|maps\.app\.goo\.gl|waze\.com|maps\.apple)/i.test(
      trimmed
    )
  );
}

export function parseAddress(input: string): ParsedAddress {
  const raw = input.trim();
  return {
    raw,
    coords: extractCoords(raw),
    isUrl: isLikelyUrl(raw),
  };
}

function encode(input: string): string {
  return encodeURIComponent(input);
}

// Build a deep link URL for the given service. If `overrideCoords` is
// supplied (e.g. resolved via the /api/resolve-map-link endpoint) it
// takes precedence over whatever could be parsed from the input text.
export function buildMapUrl(
  service: MapService,
  input: string,
  overrideCoords?: { lat: number; lng: number } | null
): string | null {
  if (!input && !overrideCoords) return null;
  const parsed = input ? parseAddress(input) : null;
  const coords = overrideCoords ?? parsed?.coords ?? null;

  if (coords) {
    const { lat, lng } = coords;
    if (service === "google") {
      return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    }
    if (service === "apple") {
      return `https://maps.apple.com/?ll=${lat},${lng}&q=${lat},${lng}`;
    }
    if (service === "yandex") {
      return `https://yandex.ru/maps/?rtext=~${lat}%2C${lng}&rtt=auto`;
    }
    return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  }

  // No coordinates — if it's a URL the Google button opens the link
  // as-is (Google's apps resolve short URLs themselves). Apple and
  // Waze fall back to a text query.
  if (parsed?.isUrl && service === "google") {
    return parsed.raw.startsWith("http") ? parsed.raw : `https://${parsed.raw}`;
  }

  const q = encode(parsed?.raw ?? "");
  if (service === "google") {
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }
  if (service === "apple") {
    return `https://maps.apple.com/?q=${q}`;
  }
  if (service === "yandex") {
    return `https://yandex.ru/maps/?text=${q}`;
  }
  return `https://waze.com/ul?q=${q}&navigate=yes`;
}

// Pulls a human-readable address out of a Google Maps URL.
// Handles:
//   https://www.google.com/maps/place/Agios+Tychonas+21,+Limassol/@34.706,33.089,...
//   https://maps.google.com/?q=Agios+Tychonas+21,+Limassol
//   https://maps.app.goo.gl/xxxx (short URL — nothing to extract, returns null)
// Used by LocationsBlock to autofill the address field when the
// dispatcher pastes a link. Does NOT touch fields that already have
// content — caller checks first.
export function extractAddressFromMapUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  // /place/<Address>/@... or /place/<Address>/ or /place/<Address>?...
  const placeMatch = trimmed.match(/\/place\/([^/@?#]+)/);
  if (placeMatch) {
    try {
      const decoded = decodeURIComponent(placeMatch[1]).replace(/\+/g, " ").trim();
      if (decoded.length > 1) return decoded;
    } catch {
      // malformed URI sequence — fall through
    }
  }

  // ?q=<Address> / ?query=<Address> — but only if it's not already a
  // coordinate pair (those are handled by extractCoords).
  try {
    const u = new URL(trimmed);
    const q = u.searchParams.get("q") ?? u.searchParams.get("query");
    if (q && !/^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(q.trim())) {
      return q.replace(/\+/g, " ").trim();
    }
  } catch {
    // not a parseable URL — that's OK, caller stays with the map URL only
  }

  return null;
}

// Client-side helper that calls our /api/resolve-map-link endpoint to
// follow short URLs and extract coordinates server-side.
export async function resolveMapLink(
  url: string
): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `/api/resolve-map-link?url=${encodeURIComponent(url)}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      coords: { lat: number; lng: number } | null;
    };
    return data.coords;
  } catch {
    return null;
  }
}
