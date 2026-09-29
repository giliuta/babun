import type { AccessLevel, MemberAccessMap } from "@/features/access/access-map";

// ПРАВА КЛИЕНТОВ ЧЕЛОВЕКА В КОМПАНИИ — ИЗ ЕГО КОМАНД (владелец 29.09: «в
// команде один он может видеть клиентов, в команде три — нет»). С миграции
// `clients_rights_per_team` «Клиенты», «Какие клиенты» и «Телефоны» лежат в
// карте по календарям, а вкладка «Клиенты» одна на компанию — поэтому её
// права собираются так же, как сервер собирает набор клиентов:
//   • «Клиенты» — самое сильное положение среди его команд;
//   • «Все клиенты» — если так хоть в одной команде, где он клиентов видит;
//   • «Телефоны» — если открыты хоть в одной такой команде.
// Карта со старого сервера (права на компанию) читается как прежде.

const RANK: Partial<Record<AccessLevel, number>> = { off: 0, read: 1, write: 2 };

export interface ClientsAccessLevels {
  clients?: AccessLevel;
  scope?: AccessLevel;
  contacts?: AccessLevel;
}

export function clientsAccessOf(map: MemberAccessMap): ClientsAccessLevels {
  if (map.company["clients"] !== undefined) {
    return {
      clients: map.company["clients"],
      scope: map.company["clients.scope"],
      contacts: map.company["clients.contacts"],
    };
  }
  let clients: AccessLevel | undefined;
  let whole = false;
  let contacts = false;
  let seen = false;
  for (const levels of Object.values(map.calendars)) {
    const level = levels["clients"];
    if (level === undefined) continue;
    seen = true;
    const rank = RANK[level] ?? 0;
    if (clients === undefined || rank > (RANK[clients] ?? 0)) clients = level;
    if (rank < 1) continue;
    if (levels["clients.scope"] === "all") whole = true;
    if (levels["clients.contacts"] === "read") contacts = true;
  }
  if (!seen) return {};
  return {
    clients,
    scope: whole ? "all" : "own",
    contacts: contacts ? "read" : "off",
  };
}
