import type { AccessLevel, MemberAccessMap } from "@/features/access/access-map";

// ПРАВА КЛИЕНТОВ ЧЕЛОВЕКА В КОМПАНИИ — ИЗ ЕГО КОМАНД (владелец 29.09: «в
// команде один он может видеть клиентов, в команде три — нет»). С миграции
// `clients_rights_per_team` «Клиенты», «Какие клиенты» и «Телефоны» лежат в
// карте по календарям, а вкладка «Клиенты» одна на компанию — поэтому её
// права собираются так же, как сервер собирает набор клиентов:
//   • «Клиенты» — самое сильное положение среди его команд;
//   • «Все клиенты» — если так хоть в одной команде, где он клиентов видит;
//   • «Телефоны» — с 02.10 вместе с базой: видит клиентов — открывает номер.
// Карта со старого сервера (права на компанию) читается как прежде.
//
// ЗАЩИТА БАЗЫ (владелец 30.09): «Какие клиенты» — 2 недели · Месяц · Своей
// команды · Вся база. Берётся самое широкое среди команд, где он клиентов
// видит; нет строки — самое узкое, как у сервера-умолчания.

const RANK: Partial<Record<AccessLevel, number>> = { off: 0, read: 1, write: 2 };
const SCOPE_RANK: Partial<Record<AccessLevel, number>> = { near: 0, month: 1, own: 2, all: 3 };
/** Номер — вместе с базой (02.10: «Телефон» убран): видит клиентов — открывает
 *  их номера по одному. */
const contactsOf = (clients: AccessLevel | undefined): AccessLevel =>
  (RANK[clients ?? "off"] ?? 0) >= 1 ? "read" : "off";

const wider = (
  ranks: Partial<Record<AccessLevel, number>>,
  a: AccessLevel,
  b: AccessLevel | undefined,
): AccessLevel => (b !== undefined && (ranks[b] ?? -1) > (ranks[a] ?? -1) ? b : a);

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
      contacts: contactsOf(map.company["clients"]),
    };
  }
  let clients: AccessLevel | undefined;
  let scope: AccessLevel = "near";
  let seen = false;
  for (const levels of Object.values(map.calendars)) {
    const level = levels["clients"];
    if (level === undefined) continue;
    seen = true;
    const rank = RANK[level] ?? 0;
    if (clients === undefined || rank > (RANK[clients] ?? 0)) clients = level;
    if (rank < 1) continue;
    scope = wider(SCOPE_RANK, scope, levels["clients.scope"]);
  }
  if (!seen) return {};
  return { clients, scope, contacts: contactsOf(clients) };
}
