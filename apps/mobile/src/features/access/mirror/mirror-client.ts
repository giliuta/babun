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

// ─── КАКИЕ КЛИЕНТЫ В ЕГО НАБОРЕ (проверка глазами 30.09) ─────────────────────
//
// Маска выше гасит поля, но строк не убирает: по токену владельца сервер
// отдаёт всю базу, и «Около записи» в зеркале показывало десять клиентов, а
// настоящий сотрудник получал двух. Набор считается тем же правилом, что
// `access_client_ids_in` на сервере, по командам, где открыты «Карточки
// клиентов»:
//   · «Вся база» хоть в одной — вся база;
//   · «Своей команды» — клиенты команды и её записей за всё время;
//   · «Около записи» — запись команды от недели назад до завтра, отменённая
//     окна не открывает;
//   · кого завёл сам — видит всегда.

export interface MirrorScopeTeams {
  /** Команды с открытыми «Карточками клиентов». */
  open: string[];
  /** «Своей команды» и «Вся база». */
  teamWide: string[];
  /** «Около записи» (и неизвестное — как на сервере). */
  near: string[];
  whole: boolean;
}

export function mirrorScopeTeams(map: MemberAccessMap): MirrorScopeTeams {
  const open = Object.entries(map.calendars).filter(([, levels]) => (RANK[levels.clients ?? "off"] ?? 0) >= 1);
  const out: MirrorScopeTeams = { open: [], teamWide: [], near: [], whole: false };
  for (const [teamId, levels] of open) {
    const scope = levels["clients.scope"];
    out.open.push(teamId);
    if (scope === "own" || scope === "all") out.teamWide.push(teamId);
    else out.near.push(teamId);
    if (scope === "all") out.whole = true;
  }
  return out;
}

export interface MirrorClientScope {
  whole: boolean;
  /** Команды, чьи клиенты видны целиком. */
  teamWide: ReadonlySet<string>;
  /** Открытые записью или авторством. */
  ids: ReadonlySet<string>;
}

export interface MirrorScopeAppointment {
  client_id: string | null;
  team_id: string | null;
  date: string | null;
  status: string | null;
}

/** День `YYYY-MM-DD` со сдвигом — календарной арифметикой, без часовых поясов. */
export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function mirrorClientScope(
  teams: MirrorScopeTeams,
  input: {
    appointments: readonly MirrorScopeAppointment[];
    /** Клиенты, которых он завёл сам (пусто, пока человек не в компании). */
    createdBy: readonly string[];
    /** Рабочий день компании (`tenant_business_date`). */
    today: string;
  },
): MirrorClientScope {
  const empty: MirrorClientScope = { whole: false, teamWide: new Set(), ids: new Set() };
  if (teams.open.length === 0) return empty;
  if (teams.whole) return { ...empty, whole: true };
  const teamWide = new Set(teams.teamWide);
  const near = new Set(teams.near);
  const from = shiftDay(input.today, -7);
  const to = shiftDay(input.today, 1);
  const ids = new Set(input.createdBy);
  for (const a of input.appointments) {
    if (!a.client_id || !a.team_id) continue;
    if (teamWide.has(a.team_id)) {
      ids.add(a.client_id);
      continue;
    }
    if (!near.has(a.team_id) || a.status === "cancelled" || !a.date) continue;
    if (a.date >= from && a.date <= to) ids.add(a.client_id);
  }
  return { whole: false, teamWide, ids };
}

export function inMirrorScope(client: Pick<Client, "id" | "team_id">, scope: MirrorClientScope): boolean {
  if (scope.whole) return true;
  if (client.team_id && scope.teamWide.has(client.team_id)) return true;
  return scope.ids.has(client.id);
}
