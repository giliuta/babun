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
 *  в ворота не идут и считаются как «скрыт». */
const RANK: Readonly<Partial<Record<AccessLevel, number>>> = { off: 0, read: 1, write: 2 };

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

/** Блоки финансов: понижение любого из них стирает деньги с телефона. */
export const FINANCE_BLOCK_KEYS: readonly string[] = [
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
