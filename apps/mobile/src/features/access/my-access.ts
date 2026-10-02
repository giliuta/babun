import type { AccessLevel, MemberAccessMap } from "./access-map";

// СВОИ ПРАВА ЧЕЛОВЕКА — ЧИСТЫЙ СЛОЙ (этап 2 доступа, владелец 15.09: «чтоб всё
// сразу менялось в живом времени»).
//
// Экран спрашивает одно: что МНЕ можно в этом блоке (в этом календаре) —
// ждать, скрыть, смотреть или менять. Ответ собирается из роли (владелец
// ограничений не имеет и карты не ждёт) и из карты `my_access_map`. Сигнал
// `access_changed {tenant_id, version}` приходит без уровней: по номеру версии
// решается, перечитывать ли карту, а по разнице старой и новой карты — стирать
// ли с телефона данные блоков, которые у человека только что забрали.
//
// Лист без React и без сети: правила проверяются тестом, а не глазами.

type Role = "owner" | "dispatcher" | "master";

/** Что показывать:
 *   • `loading` — роль или карта ещё едут: ни данных, ни «нет доступа»;
 *   • `gone`    — человека в компании больше нет (решает граница прав);
 *   • `locked`  — блок скрыт: данных нет, страница серая;
 *   • `read`    — смотрит: данные есть, изменения закрыты с причиной;
 *   • `write`   — меняет. */
export type AccessGate = "loading" | "gone" | "locked" | "read" | "write";

/** Порядок положений доступа. «Из его календарей / Все» — охват, а не доступ:
 *  в ворота не идут и считаются как «скрыт». «Правит всё» — выше «Меняет»:
 *  воротам это та же запись, а понижение до «Меняет» — понижение. */
const RANK: Readonly<Partial<Record<AccessLevel, number>>> = { off: 0, read: 1, write: 2, full: 3 };

const rank = (level: AccessLevel | undefined): number =>
  level === undefined ? 0 : (RANK[level] ?? 0);

/** Лучшее положение блока по всем календарям человека. Для экрана без
 *  выбранного календаря («Финансы» открываются, если хоть где-то смотрит). */
export function bestCalendarLevel(
  map: MemberAccessMap,
  blockKey: string,
): AccessLevel | undefined {
  let best: AccessLevel | undefined;
  for (const levels of Object.values(map.calendars)) {
    const level = levels[blockKey];
    if (rank(level) > rank(best)) best = level;
  }
  return best;
}

export interface AccessGateInput {
  /** `undefined` — роль ещё не пришла; `null` — человек не состоит в компании. */
  role: Role | null | undefined;
  /** `undefined` — карта ещё не пришла. */
  map: MemberAccessMap | undefined;
  blockKey: string;
  scope: "calendar" | "company";
  /** Календарь для календарного блока; без него — лучший по всем. */
  teamId?: string | null;
}

export function accessGate({ role, map, blockKey, scope, teamId }: AccessGateInput): AccessGate {
  if (role === null) return "gone";
  // Владелец ограничений не имеет: его экран не ждёт карту и не мигает серым.
  if (role === "owner") return "write";
  if (role === undefined || !map) return "loading";
  if (map.isOwner) return "write";
  const level =
    scope === "company"
      ? map.company[blockKey]
      : teamId
        ? map.calendars[teamId]?.[blockKey]
        : bestCalendarLevel(map, blockKey);
  const r = rank(level);
  if (r >= 2) return "write";
  if (r === 1) return "read";
  return "locked";
}

/** Сигнал новее того, что уже на телефоне? Карты ещё нет — перечитать.
 *  Повтор и запоздавший сигнал (номер не больше) — ничего не делать. */
export function isNewerAccess(eventVersion: unknown, cached: MemberAccessMap | undefined): boolean {
  if (!cached) return true;
  return typeof eventVersion === "number" && eventVersion > cached.version;
}

/** Сменился уровень хоть одного блока ЗАПИСИ хоть в одном календаре?
 *  Окно записей мастера маскирует клиента, адрес, работы, суммы и оплату по
 *  этим уровням (STORY-084), поэтому строки, пришедшие при прежних правах,
 *  несут прежнюю маску: без перечитывания владелец поднял «Сумму», а мастер
 *  видит «Итого €0» вместо настоящих €150. Первая загрузка — не смена. */
export function recordLevelsChanged(
  before: MemberAccessMap | undefined,
  next: MemberAccessMap,
): boolean {
  if (!before) return false;
  const teams = new Set([...Object.keys(before.calendars), ...Object.keys(next.calendars)]);
  for (const team of teams) {
    const was = before.calendars[team] ?? {};
    const now = next.calendars[team] ?? {};
    const keys = new Set([...Object.keys(was), ...Object.keys(now)]);
    for (const key of keys) {
      if (key.startsWith("record.") && was[key] !== now[key]) return true;
    }
  }
  return false;
}

// КЛИЕНТЫ УХОДЯТ С ТЕЛЕФОНА ПРИ СУЖЕНИИ ПРАВ (защита базы, владелец 30.09:
// «чтоб не пришёл на неделю, не выгрузил базу и не ушёл»). У прав клиентов
// своя шкала: «Какие клиенты» — 2 недели < Месяц < Своей команды < Вся база
// («Телефон» с 02.10 идёт вместе с базой). Сузили хоть одно
// хоть в одной команде (или команду сняли) — клиенты и открытые номера этой
// компании стираются с телефона сразу; поменяли иначе — перечитываются: маска
// строк и `contacts_hidden` пришли при прежних правах.

const BLOCK_RANK: Readonly<Partial<Record<AccessLevel, number>>> = { off: 0, read: 1, write: 2 };

const CLIENT_RANKS: Readonly<Record<string, Readonly<Partial<Record<AccessLevel, number>>>>> = {
  clients: BLOCK_RANK,
  "clients.scope": { near: 0, month: 1, own: 2, all: 3 },
  // Блоки карточки (30.09): закрыли блок — его поля уходят с телефона вместе
  // со строками, перечитанными уже без них.
  "clients.note": BLOCK_RANK,
  "clients.people": BLOCK_RANK,
  "clients.objects": BLOCK_RANK,
  "clients.labels": BLOCK_RANK,
  "clients.personal": BLOCK_RANK,
  "clients.files": BLOCK_RANK,
  "clients.requisites": BLOCK_RANK,
  "clients.money": BLOCK_RANK,
};

export type ClientLevelsChange = "same" | "changed" | "narrowed";

function compareClientLevels(
  was: Readonly<Record<string, AccessLevel>>,
  now: Readonly<Record<string, AccessLevel>>,
): ClientLevelsChange {
  let changed = false;
  for (const [key, ranks] of Object.entries(CLIENT_RANKS)) {
    const a = was[key];
    const b = now[key];
    if (a === b) continue;
    changed = true;
    const r = (level: AccessLevel | undefined) => (level === undefined ? -1 : (ranks[level] ?? -1));
    if (r(b) < r(a)) return "narrowed";
  }
  return changed ? "changed" : "same";
}

export function clientLevelsChange(
  before: MemberAccessMap | undefined,
  next: MemberAccessMap,
): ClientLevelsChange {
  if (!before) return "same";
  if (before.isOwner && !next.isOwner) return "narrowed";
  if (before.isOwner || next.isOwner) return before.isOwner === next.isOwner ? "same" : "changed";
  let result = compareClientLevels(before.company, next.company);
  if (result === "narrowed") return result;
  const teams = new Set([...Object.keys(before.calendars), ...Object.keys(next.calendars)]);
  for (const team of teams) {
    const step = compareClientLevels(before.calendars[team] ?? {}, next.calendars[team] ?? {});
    if (step === "narrowed") return step;
    if (step === "changed") result = "changed";
  }
  return result;
}

/** Первые сегменты ключей, под которыми на телефоне лежат клиенты компании.
 *  Компания — вторым сегментом; у карточки (`["client", id, tenant, view]`) —
 *  третьим. `client-contacts` — номера, открытые дверью по одному. */
export const CLIENT_DATA_HEADS: readonly string[] = [
  "clients",
  "client-tags",
  "client-members",
  "client-attachments",
  "client-visit-photos",
  "client-contacts",
];

export function isClientDataKey(queryKey: readonly unknown[], tenantId: string): boolean {
  if (queryKey[0] === "client") return queryKey[2] === tenantId;
  return CLIENT_DATA_HEADS.includes(String(queryKey[0])) && queryKey[1] === tenantId;
}

/** ДОХОДЫ И РАСХОДЫ — ДВА ПРАВА С ЭТАПА 2 (владелец 29.09: «только доходы, но
 *  видел все расходы»). До наката их вела одна строка `finance.operations`.
 *  Карта сервера несёт все живые блоки с умолчаниями, поэтому новый ключ либо
 *  есть в каждом календаре, либо ни в одном: по нему и видно, какая карта
 *  пришла. Экран спрашивает сторону денег этим ключом — и работает до наката,
 *  после него и на телефоне, который карту ещё не перечитал. */
export function moneyKey(map: MemberAccessMap | undefined, side: "income" | "expense"): string {
  const key = side === "income" ? "finance.income" : "finance.expense";
  for (const levels of Object.values(map?.calendars ?? {})) {
    if (key in levels) return key;
    if ("finance.operations" in levels) return "finance.operations";
  }
  return key;
}

/** Можно ли человеку править и удалять эту ручную операцию команды (срез 2а)
 *  — ровно то, что пустит сервер (политики `finance_transactions_*_income` /
 *  `_expense`): владелец — любую; сотрудник по стороне денег: «Правит всё» —
 *  любую строку команды, «Добавляет» — только свою. На старой карте (общий
 *  `finance.operations`) — как было: «Меняет» правит любой расход, доход —
 *  никогда. Оплату записи, инвойс, возврат и долг вызывающий отсекает сам:
 *  их ведут свои двери. */
export function canEditMoneyRow(input: {
  role: Role | null | undefined;
  map: MemberAccessMap | undefined;
  teamId: string | null | undefined;
  side: "income" | "expense";
  createdBy: string | null | undefined;
  me: string | null | undefined;
}): boolean {
  const { role, map, teamId, side, createdBy, me } = input;
  if (role === "owner" || map?.isOwner) return true;
  if (!map || !teamId) return false;
  const key = moneyKey(map, side);
  const level = map.calendars[teamId]?.[key];
  if (key === "finance.operations") return side === "expense" && level === "write";
  if (level === "full") return true;
  return level === "write" && !!me && createdBy === me;
}

/** Блоки финансов: понижение любого из них стирает деньги с телефона. */
export const FINANCE_BLOCK_KEYS: readonly string[] = [
  "finance.income",
  "finance.expense",
  "finance.operations",
  "finance.accounts",
  "finance.debts",
  "finance.documents",
  "finance.categories",
  "finance.templates",
  "finance.vat",
];

/** Первые сегменты ключей, под которыми на телефоне лежат деньги компании. */
export const FINANCE_DATA_HEADS: readonly string[] = [
  "transactions",
  "debts",
  "accounts",
  "payment-accounts",
  "invoices",
  "receipts",
  "finance-categories",
  "finance-templates",
  "vat-settings",
  "vat-team-overrides",
  "day-extras",
  // Вторая нога перевода и журнал одной записи: тот же деньги, но своими
  // ключами (витрина операции и блок оплаты в записи).
  "transfer-counterpart",
  "appointment-ledger",
];

/** Ключ несёт деньги ЭТОЙ компании? Компания во втором сегменте у всех
 *  денежных ключей; деньги другой компании понижение здесь не трогает. */
export function isFinanceDataKey(queryKey: readonly unknown[], tenantId: string): boolean {
  return FINANCE_DATA_HEADS.includes(String(queryKey[0])) && queryKey[1] === tenantId;
}

/** У человека забрали доступ хоть к одному из этих блоков — в любом календаре
 *  или на всю компанию? Тогда данные этих блоков стираются с телефона сразу,
 *  а не ждут, пока экран перечитает сервер: скрытое не должно оставаться
 *  видным ни кадра. Владелец, ставший сотрудником, — тоже понижение. */
export function lostAccess(
  before: MemberAccessMap | undefined,
  after: MemberAccessMap,
  blockKeys: readonly string[],
): boolean {
  if (!before) return false;
  if (before.isOwner && !after.isOwner) return true;
  if (after.isOwner) return false;
  for (const key of blockKeys) {
    if (rank(after.company[key]) < rank(before.company[key])) return true;
    for (const [teamId, levels] of Object.entries(before.calendars)) {
      if (rank(after.calendars[teamId]?.[key]) < rank(levels[key])) return true;
    }
  }
  return false;
}
