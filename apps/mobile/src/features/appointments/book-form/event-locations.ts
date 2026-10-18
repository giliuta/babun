import type { Client, Location } from "@babun/shared/local/clients";
import { EMPTY_LOCATIONS } from "./book-constants";

export interface AddedLocation {
  clientId: string;
  loc: Location;
}

export interface EventLocationRow {
  loc: Location;
  ownerId: string;
  ownerName: string;
}

/** The client's objects plus the one just added here, until the server
 *  returns it (see `addedLocation` in `use-client-locations.ts`). */
export function withAddedLocation(
  client: Client | null,
  serverLocations: Location[],
  addedLocation: AddedLocation | null,
): Location[] {
  if (!client || !addedLocation || addedLocation.clientId !== client.id) {
    return serverLocations;
  }
  return serverLocations.some((l) => l.id === addedLocation.loc.id)
    ? serverLocations
    : [...serverLocations, addedLocation.loc];
}

/** Objects of ALL clients, each with its owner — the event's object list. */
export function eventLocationRows(
  clients: readonly Client[],
  client: Client | null,
  clientLocations: Location[],
): EventLocationRow[] {
  const rows: EventLocationRow[] = [];
  for (const candidate of clients) {
    // У клиента, выбранного в форме, берём список с только что добавленным
    // объектом — он ещё не приехал с сервера (см. `addedLocation`).
    const list =
      client && candidate.id === client.id
        ? clientLocations
        : candidate.locations ?? EMPTY_LOCATIONS;
    for (const loc of list) {
      rows.push({
        loc,
        ownerId: candidate.id,
        ownerName: candidate.full_name || "Без имени",
      });
    }
  }
  return rows;
}
