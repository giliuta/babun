import type { Client } from "@babun/shared/local/clients";

import type { AccessLevel, MemberAccessMap } from "../access-map";

// ЗЕРКАЛО: СТРОКА КЛИЕНТА ГЛАЗАМИ СОТРУДНИКА (защита базы 30.09).
//
// В «Посмотреть его глазами» строки клиентов приходят с сервера по токену
// ВЛАДЕЛЬЦА — целиком, без `blocks` и `contacts_hidden`. Настоящему сотруднику
// сервер отдаёт другое: контактов нет никогда, поля закрытых блоков пустые,
// `blocks` говорит, что открыто (`client_masked_for_member`). Здесь та же
// маска собирается из карты прав зеркала, иначе предпросмотр показал бы
// владельцу как «видно» то, чего человек не получит.
//
// Положения — по командам, где у человека открыты «Карточки клиентов»:
// команда клиента, если она среди них, иначе самое широкое по ним (сервер
// берёт самое широкое по командам, через которые клиент виден). «В день
// записи» без записей под рукой — как «откроется в день записи».

const CARD_KEYS = [
  "clients.note",
  "clients.people",
  "clients.objects",
  "clients.labels",
  "clients.personal",
  "clients.files",
  "clients.requisites",
  "clients.history",
  "clients.money",
] as const;

const RANK: Partial<Record<AccessLevel, number>> = { off: 0, read: 1, write: 2 };
const CONTACTS_RANK: Partial<Record<AccessLevel, number>> = { off: 0, day: 1, read: 2 };

type TeamLevels = Readonly<Record<string, AccessLevel>>;

function teamsFor(client: Pick<Client, "team_id">, map: MemberAccessMap): TeamLevels[] {
  const open = Object.entries(map.calendars).filter(([, levels]) => (RANK[levels.clients ?? "off"] ?? 0) >= 1);
  const own = open.find(([teamId]) => teamId === client.team_id);
  return own ? [own[1]] : open.map(([, levels]) => levels);
}

/** Положения блоков карточки у клиента — как `access_client_blocks`. */
export function mirrorClientBlocks(
  client: Pick<Client, "team_id">,
  map: MemberAccessMap,
): Record<string, "off" | "read" | "write"> {
  const word = (rank: number) => (rank >= 2 ? "write" : rank === 1 ? "read" : "off");
  const teams = teamsFor(client, map);
  const out: Record<string, "off" | "read" | "write"> = {};
  let card = 0;
  for (const levels of teams) card = Math.max(card, levels.clients === "write" ? 2 : 1);
  out.clients = word(teams.length === 0 ? 0 : card);
  for (const key of CARD_KEYS) {
    let best = 0;
    for (const levels of teams) {
      const own = RANK[levels[key] ?? "off"] ?? 0;
      const rank = own === 2 && levels.clients !== "write" ? 1 : own;
      best = Math.max(best, rank);
    }
    out[key] = word(best);
  }
  return out;
}

function mirrorContactsHidden(client: Pick<Client, "team_id">, map: MemberAccessMap): "day" | "right" | null {
  let best = 0;
  for (const levels of teamsFor(client, map)) {
    best = Math.max(best, CONTACTS_RANK[levels["clients.contacts"] ?? "off"] ?? 0);
  }
  return best >= 2 ? null : best === 1 ? "day" : "right";
}

/** Строка клиента, какой её получил бы сотрудник с этой картой прав. */
export function mirrorMemberClient(client: Client, map: MemberAccessMap): Client {
  const blocks = mirrorClientBlocks(client, map);
  const off = (key: string) => blocks[key] !== "read" && blocks[key] !== "write";
  return {
    ...client,
    // Контактов в строке сотрудника нет никогда — номер открывает дверь.
    phone: "",
    phone_e164: null,
    whatsapp_phone: "",
    email: "",
    telegram_username: "",
    instagram_username: "",
    phones: [],
    ...(off("clients.people") ? { memberships: [] } : {}),
    ...(off("clients.note") ? { comment: "", notes: [] } : {}),
    ...(off("clients.objects") ? { locations: [], equipment: [], address: "", property_type: "" } : {}),
    ...(off("clients.labels") ? { city: "", city_manual: false, tag_ids: [] } : {}),
    ...(off("clients.personal")
      ? { birthday: "", language: null, acquisition_source: "unknown", referred_by_client_id: null, first_contact_date: null }
      : {}),
    ...(off("clients.requisites")
      ? { legal_name: null, vat_number: null, reg_number: null, billing_address: null, requisites: [] }
      : {}),
    ...(off("clients.money") ? { balance: 0, discount: 0 } : {}),
    contacts_hidden: mirrorContactsHidden(client, map),
    blocks,
  } as Client;
}
