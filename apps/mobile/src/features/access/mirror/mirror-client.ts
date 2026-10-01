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
  "clients.history",
  "clients.money",
] as const;

/** Блоки, которые есть только НА СТРАНИЦЕ клиента: без «Открывает карточку»
 *  сервер отдаёт их пустыми (`access_client_blocks`, 01.10). */
const PAGE_ONLY_KEYS: ReadonlySet<string> = new Set([
  "clients.note",
  "clients.people",
  "clients.objects",
  "clients.personal",
  "clients.files",
  "clients.requisites",
]);

const RANK: Partial<Record<AccessLevel, number>> = { off: 0, read: 1, write: 2 };
const CONTACTS_RANK: Partial<Record<AccessLevel, number>> = { off: 0, day: 1, read: 2 };

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
  let open = 0;
  for (const levels of teams) open = Math.max(open, levels["clients.open"] === "write" ? 2 : 0);
  out["clients.open"] = word(open);
  for (const key of CARD_KEYS) {
    let best = 0;
    for (const levels of teams) {
      if (PAGE_ONLY_KEYS.has(key) && levels["clients.open"] !== "write") continue;
      const own = RANK[levels[key] ?? "off"] ?? 0;
      const rank = own === 2 && levels.clients !== "write" ? 1 : own;
      best = Math.max(best, rank);
    }
    out[key] = word(best);
  }
  return out;
}

function mirrorContactsHidden(
  client: Pick<Client, "id" | "team_id">,
  map: MemberAccessMap,
  view?: MirrorView,
): "day" | "right" | null {
  let best = 0;
  for (const levels of teamsFor(client, map, view)) {
    best = Math.max(best, CONTACTS_RANK[levels["clients.contacts"] ?? "off"] ?? 0);
  }
  // «В день записи» и запись сегодня — номер открыт, как у сервера.
  if (best === 1 && view?.dayToday.has(client.id)) return null;
  return best >= 2 ? null : best === 1 ? "day" : "right";
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
// виден (`access_client_blocks`), а номер — по «Телефону» тех же команд
// (`access_contact_client_ids`, `access_day_contact_client_ids`). Правило
// команды:
//   · «Вся база» — вся база;
//   · «Своей команды» — клиенты команды и её записей за всё время;
//   · «Около записи» — запись команды от недели назад до завтра, отменённая
//     окна не открывает;
//   · кого завёл сам — видит всегда.

const SCOPE_RANK: Partial<Record<AccessLevel, number>> = { near: 0, own: 1, all: 2 };

export interface MirrorScopeAppointment {
  client_id: string | null;
  team_id: string | null;
  date: string | null;
  status: string | null;
}

export interface MirrorClientData {
  /** Записи команд с открытыми карточками: окно у всех, всё время у «Своей команды». */
  appointments: readonly MirrorScopeAppointment[];
  /** Клиенты, которых он завёл сам (пусто, пока человек не в компании). */
  createdBy: readonly string[];
  /** Рабочий день компании (`tenant_business_date`). */
  today: string;
}

/** Команды с открытыми «Карточками клиентов» и их «Какие клиенты». */
export function mirrorOpenTeams(map: MemberAccessMap): { teamId: string; scope: "near" | "own" | "all" }[] {
  return Object.entries(map.calendars)
    .filter(([, levels]) => (RANK[levels.clients ?? "off"] ?? 0) >= 1)
    .map(([teamId, levels]) => {
      // Неизвестное — «Около записи», как на сервере.
      const rank = SCOPE_RANK[levels["clients.scope"] ?? "near"] ?? 0;
      return { teamId, scope: rank === 2 ? "all" : rank === 1 ? "own" : "near" };
    });
}

/** Набор одной команды: `null` — вся база, иначе id клиентов и «своя» команда. */
interface TeamScope {
  whole: boolean;
  ownTeam: string | null;
  ids: ReadonlySet<string>;
}

export interface MirrorView {
  teams: ReadonlyMap<string, TeamScope>;
  /** Запись СЕГОДНЯ в команде с «В день записи» — номер открыт. */
  dayToday: ReadonlySet<string>;
}

/** День `YYYY-MM-DD` со сдвигом — календарной арифметикой, без часовых поясов. */
export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function mirrorView(map: MemberAccessMap, data: MirrorClientData): MirrorView {
  const from = shiftDay(data.today, -7);
  const to = shiftDay(data.today, 1);
  const teams = new Map<string, TeamScope>();
  for (const { teamId, scope } of mirrorOpenTeams(map)) {
    const ids = new Set(data.createdBy);
    if (scope !== "all") {
      for (const a of data.appointments) {
        if (!a.client_id || a.team_id !== teamId) continue;
        if (scope === "own") ids.add(a.client_id);
        else if (a.status !== "cancelled" && a.date && a.date >= from && a.date <= to) ids.add(a.client_id);
      }
    }
    teams.set(teamId, { whole: scope === "all", ownTeam: scope === "near" ? null : teamId, ids });
  }
  const dayTeams = new Set(
    [...teams.keys()].filter((teamId) => map.calendars[teamId]?.["clients.contacts"] === "day"),
  );
  const dayToday = new Set<string>();
  for (const a of data.appointments) {
    if (a.client_id && a.team_id && dayTeams.has(a.team_id) && a.status !== "cancelled" && a.date === data.today) {
      dayToday.add(a.client_id);
    }
  }
  return { teams, dayToday };
}

/** Команды, через которые клиент виден. */
function teamsSeeing(client: Pick<Client, "id" | "team_id">, view: MirrorView): string[] {
  const out: string[] = [];
  for (const [teamId, scope] of view.teams) {
    if (scope.whole || (client.team_id && client.team_id === scope.ownTeam) || scope.ids.has(client.id)) {
      out.push(teamId);
    }
  }
  return out;
}

export function inMirrorView(client: Pick<Client, "id" | "team_id">, view: MirrorView): boolean {
  return teamsSeeing(client, view).length > 0;
}
