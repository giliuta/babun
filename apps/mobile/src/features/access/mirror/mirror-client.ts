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
// Положения — самые широкие по командам, через которые клиент виден
// (`mirrorView` ниже, как сервер). Пока набор не приехал (черновик нового
// клиента, первые кадры) — команда клиента, если она среди открытых, иначе
// самое широкое по ним.

const CARD_KEYS = [
  "clients.note",
  "clients.people",
  "clients.objects",
  "clients.labels",
  "clients.personal",
  "clients.files",
  "clients.requisites",
  "clients.money",
] as const;

const RANK: Partial<Record<AccessLevel, number>> = { off: 0, read: 1, write: 2 };

type TeamLevels = Readonly<Record<string, AccessLevel>>;

function teamsFor(client: Pick<Client, "team_id"> & { id?: string }, map: MemberAccessMap, view?: MirrorView): TeamLevels[] {
  // С набором — ровно команды, через которые клиент виден (как сервер).
  if (view && client.id) {
    return teamsSeeing({ id: client.id, team_id: client.team_id }, view).map((teamId) => map.calendars[teamId] ?? {});
  }
  const open = Object.entries(map.calendars).filter(([, levels]) => (RANK[levels.clients ?? "off"] ?? 0) >= 1);
  const own = open.find(([teamId]) => teamId === client.team_id);
  return own ? [own[1]] : open.map(([, levels]) => levels);
}

/** Положения блоков карточки у клиента — как `access_client_blocks`. */
export function mirrorClientBlocks(
  client: Pick<Client, "team_id"> & { id?: string },
  map: MemberAccessMap,
  view?: MirrorView,
): Record<string, "off" | "read" | "write"> {
  const word = (rank: number) => (rank >= 2 ? "write" : rank === 1 ? "read" : "off");
  const teams = teamsFor(client, map, view);
  const out: Record<string, "off" | "read" | "write"> = {};
  let card = 0;
  for (const levels of teams) card = Math.max(card, levels.clients === "write" ? 2 : 1);
  out.clients = word(teams.length === 0 ? 0 : card);
  for (const key of CARD_KEYS) {
    let best = 0;
    for (const levels of teams) {
      // «Меняет» блока — своим правом, без «Меняет» у базы (02.10).
      best = Math.max(best, RANK[levels[key] ?? "off"] ?? 0);
    }
    out[key] = word(best);
  }
  // История записей — вместе с клиентом (02.10: «История записей» убрано).
  out["clients.history"] = word(teams.length === 0 ? 0 : 1);
  return out;
}

/** Номер открыт у каждого клиента, которого он видит (02.10: «Телефон»
 *  убран — его даёт «База клиентов»), как `access_contact_client_ids`. */
function mirrorContactsHidden(
  client: Pick<Client, "id" | "team_id">,
  map: MemberAccessMap,
  view?: MirrorView,
): "right" | null {
  return teamsFor(client, map, view).length > 0 ? null : "right";
}

/** Строка клиента, какой её получил бы сотрудник с этой картой прав. */
export function mirrorMemberClient(client: Client, map: MemberAccessMap, view?: MirrorView): Client {
  const blocks = mirrorClientBlocks(client, map, view);
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
    contacts_hidden: mirrorContactsHidden(client, map, view),
    blocks,
  } as Client;
}

// ─── КАКИЕ КЛИЕНТЫ В ЕГО НАБОРЕ (проверка глазами 30.09) ─────────────────────
//
// Маска выше гасит поля, но строк не убирает: по токену владельца сервер
// отдаёт всю базу, и «Около записи» в зеркале показывало десять клиентов, а
// настоящий сотрудник получал двух. Набор считается тем же правилом, что
// `access_client_ids_in` на сервере, И ПО КАЖДОЙ КОМАНДЕ ОТДЕЛЬНО: блоки
// клиента сервер берёт самыми широкими по командам, ЧЕРЕЗ КОТОРЫЕ клиент
// виден (`access_client_blocks`), а номер открыт у каждого видимого клиента
// (`access_contact_client_ids`, 02.10). Видны ТОЛЬКО клиенты, закреплённые
// за командой (владелец 02.10: «только база клиентов, которая закреплена за
// командой»), а «Ограничение по времени» сужает их:
//   · «Без ограничения» — все клиенты команды;
//   · «Месяц» / «2 недели» — у клиента есть запись этой команды от месяца /
//     двух недель назад до месяца / двух недель вперёд; отменённая окна не
//     открывает.

const SCOPE_RANK: Partial<Record<AccessLevel, number>> = { near: 0, month: 1, own: 2, all: 3 };
const SCOPES = ["near", "month", "own", "all"] as const;
type MirrorScope = (typeof SCOPES)[number];

export interface MirrorScopeAppointment {
  client_id: string | null;
  team_id: string | null;
  date: string | null;
  status: string | null;
}

export interface MirrorClientData {
  /** Записи команд с «Ограничением по времени» — в пределах месяца от сегодня. */
  appointments: readonly MirrorScopeAppointment[];
  /** Рабочий день компании (`tenant_business_date`). */
  today: string;
}

/** Команды с открытой «Базой клиентов» и их «Ограничение по времени». */
export function mirrorOpenTeams(map: MemberAccessMap): { teamId: string; scope: MirrorScope }[] {
  return Object.entries(map.calendars)
    .filter(([, levels]) => (RANK[levels.clients ?? "off"] ?? 0) >= 1)
    .map(([teamId, levels]) => {
      // Неизвестное — «2 недели», как на сервере.
      const rank = SCOPE_RANK[levels["clients.scope"] ?? "near"] ?? 0;
      return { teamId, scope: SCOPES[rank] ?? "near" };
    });
}

/** Набор одной команды: её клиенты; `ids` — те, у кого запись в окне, `null` —
 *  без ограничения по времени. */
interface TeamScope {
  ids: ReadonlySet<string> | null;
}

export interface MirrorView {
  teams: ReadonlyMap<string, TeamScope>;
}

/** Сдвиг на месяцы — как `date ± interval '1 month'` в Postgres: 31 марта
 *  минус месяц — 28 (29) февраля, а не 3 марта. */
export function shiftMonth(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
}

/** День `YYYY-MM-DD` со сдвигом — календарной арифметикой, без часовых поясов. */
export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function mirrorView(map: MemberAccessMap, data: MirrorClientData): MirrorView {
  // Окно едет вместе с днём (02.10): «2 недели» и «Месяц» до и после записи.
  const windows: Partial<Record<MirrorScope, readonly [string, string]>> = {
    near: [shiftDay(data.today, -14), shiftDay(data.today, 14)],
    month: [shiftMonth(data.today, -1), shiftMonth(data.today, 1)],
  };
  const teams = new Map<string, TeamScope>();
  for (const { teamId, scope } of mirrorOpenTeams(map)) {
    const window = windows[scope];
    if (!window) {
      teams.set(teamId, { ids: null });
      continue;
    }
    const ids = new Set<string>();
    for (const a of data.appointments) {
      if (!a.client_id || a.team_id !== teamId || a.status === "cancelled" || !a.date) continue;
      if (a.date >= window[0] && a.date <= window[1]) ids.add(a.client_id);
    }
    teams.set(teamId, { ids });
  }
  return { teams };
}

/** Команда, через которую клиент виден: его собственная, если она открыта и
 *  клиент проходит её «Ограничение по времени». */
function teamsSeeing(client: Pick<Client, "id" | "team_id">, view: MirrorView): string[] {
  const scope = client.team_id ? view.teams.get(client.team_id) : undefined;
  if (!scope || !client.team_id) return [];
  return scope.ids === null || scope.ids.has(client.id) ? [client.team_id] : [];
}

export function inMirrorView(client: Pick<Client, "id" | "team_id">, view: MirrorView): boolean {
  return teamsSeeing(client, view).length > 0;
}
