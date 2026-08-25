import type { Client } from "@babun/shared/local/clients";
import { tryToE164 } from "../clients/phone";

export type BookingClientRef = Pick<
  Client,
  | "id"
  | "locations"
  | "favorite_master_id"
  | "phone"
  | "phone_e164"
  | "deleted_at"
>;

export interface BookingClientPrefill {
  clientId: string;
  locationId: string | null;
  address: string;
  addressNote: string;
  masterId: string | null;
}

export interface QuickClientDraft {
  kind: "name" | "phone";
  full_name: string;
  phone: string;
  phone_e164: string | null;
  canCreate: boolean;
}

/** Resolve a deep-linked client/object into the same snapshot fields that a
 * manual picker selection fills. The requested object wins when it still
 * exists; otherwise the primary/first object is the safe fallback. */
export function resolveBookingClientPrefill(
  client: BookingClientRef,
  requestedLocationId?: string | null,
): BookingClientPrefill {
  const locations = client.locations ?? [];
  const location =
    locations.find((item) => item.id === requestedLocationId) ??
    locations.find((item) => item.isPrimary) ??
    locations[0] ??
    null;

  return {
    clientId: client.id,
    locationId: location?.id ?? null,
    address: location
      ? location.address.trim() || location.label.trim()
      : "",
    addressNote: location?.note?.trim() ?? "",
    masterId: client.favorite_master_id ?? null,
  };
}

/** Keep only a live team id. A stale deep link must never reach an insert and
 * fail on the appointments.team_id foreign key. */
export function resolveBookingTeamId(
  requestedTeamId: string | null | undefined,
  teams: readonly { id: string }[],
  lastTeamId: string | null,
): string | null {
  const liveIds = new Set(teams.map((team) => team.id));
  if (requestedTeamId && liveIds.has(requestedTeamId)) return requestedTeamId;
  if (lastTeamId && liveIds.has(lastTeamId)) return lastTeamId;
  return teams[0]?.id ?? null;
}

/** Turn the single quick-create query into honest client fields. Text becomes
 * a name with an empty phone; phone-shaped input must be valid E.164 before
 * it can be created. */
export function buildQuickClientDraft(raw: string): QuickClientDraft {
  const trimmed = raw.trim();
  const phoneShaped =
    trimmed.length > 0 &&
    /\d/.test(trimmed) &&
    /^[+\d\s().-]+$/.test(trimmed);

  if (!phoneShaped) {
    return {
      kind: "name",
      full_name: trimmed,
      phone: "",
      phone_e164: null,
      canCreate: trimmed.length > 0,
    };
  }

  const e164 = tryToE164(trimmed);
  return {
    kind: "phone",
    full_name: "",
    phone: trimmed,
    phone_e164: e164,
    canCreate: e164 !== null,
  };
}

/** Cache guard for instant UI. Callers still perform the repository lookup
 * immediately before insert because the cache can be stale. */
export function findQuickClientDuplicate<T extends BookingClientRef>(
  clients: readonly T[],
  phoneE164: string | null,
): T | null {
  if (!phoneE164) return null;
  return (
    clients.find((client) => {
      if (client.deleted_at) return false;
      const canonical =
        client.phone_e164?.trim() || tryToE164(client.phone ?? "");
      return canonical === phoneE164;
    }) ?? null
  );
}
