import type { Json } from "@babun/shared/db/database.types";

// ПРАВА СОТРУДНИКА ПО БЛОКАМ — ЧИСТЫЙ СЛОЙ ЭКРАНА (STORY-081).
//
// Форма данных — ТОЛЬКО «Контракт v1.1» сессии 006
// (`docs/PLAN-ACCESS-BLOCKS-2026-09-14.md`): реестр `access_blocks`, карта
// `list_member_access`, изменения для `set_member_access`. Ключи блоков и их
// подписи экран берёт из реестра и строками в коде не пишет; здесь живут
// только слова ПОЛОЖЕНИЙ и подписи ОБЛАСТЕЙ — их пять, и они не меняются.
//
// Лист без React и без сети: разбор ответа сервера и правила «какое положение
// у блока» проверяются тестом, а не глазами.

export type AccessLevel = "off" | "read" | "write" | "own" | "all";
export type AccessArea = "calendar" | "finance" | "clients" | "company" | "owner";
export type AccessScope = "calendar" | "company";

const LEVELS: readonly AccessLevel[] = ["off", "read", "write", "own", "all"];
const AREAS: readonly AccessArea[] = ["calendar", "finance", "clients", "company", "owner"];

export interface AccessBlock {
  key: string;
  area: AccessArea;
  scope: AccessScope;
  /** Допустимые положения; первое — умолчание («нет строки»). */
  levels: readonly AccessLevel[];
  title: string;
  ownerOnly: boolean;
  /** Сервер уже проверяет этот блок. До этого менять положение нельзя. */
  live: boolean;
  position: number;
}

export interface MemberAccessMap {
  tenantId: string;
  isOwner: boolean;
  version: number;
  company: Record<string, AccessLevel>;
  calendars: Record<string, Record<string, AccessLevel>>;
  attachedCalendars: string[];
}

/** Слово положения на переключателе. Выключенный блок у сотрудника СКРЫТ
 *  (решение владельца 14.09), поэтому «Скрыт», а не «Нет». */
export const LEVEL_WORD: Record<AccessLevel, string> = {
  // СЛОВА ПРО ЧЕЛОВЕКА, А НЕ ПРО БЛОК (владелец 14.09 назвал уровни «не видит /
  // видит / меняет»; 23.09: «вот это „Скрыт / Смотрит / Меняет" можешь
  // улучшить — это один из самых важных блоков»).
  off: "Не видит",
  read: "Видит",
  write: "Меняет",
  own: "Из его календарей",
  all: "Все",
};

export const AREA_TITLE: Record<Exclude<AccessArea, "owner">, string> = {
  calendar: "Календарь",
  finance: "Финансы",
  clients: "Клиенты",
  company: "Компания",
};

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isLevel = (value: unknown): value is AccessLevel =>
  typeof value === "string" && (LEVELS as readonly string[]).includes(value);

const isArea = (value: unknown): value is AccessArea =>
  typeof value === "string" && (AREAS as readonly string[]).includes(value);

const BAD_BLOCKS = "Сервер вернул некорректный список прав";
const BAD_MAP = "Сервер вернул некорректные права сотрудника";

/** Строки `access_blocks` → блоки по порядку `position`. Блок с незнакомой
 *  областью или положением — ошибка сервера, а не «пропустить молча»: иначе
 *  экран спрятал бы право, которое сервер уже проверяет. */
export function parseAccessBlocks(rows: readonly unknown[]): AccessBlock[] {
  return rows
    .map((row): AccessBlock => {
      if (!isRow(row)) throw new Error(BAD_BLOCKS);
      const { key, area, scope, levels, title_ru, owner_only, live, position } = row;
      if (
        typeof key !== "string" ||
        !isArea(area) ||
        (scope !== "calendar" && scope !== "company") ||
        !Array.isArray(levels) ||
        levels.length === 0 ||
        !levels.every(isLevel) ||
        typeof title_ru !== "string" ||
        typeof owner_only !== "boolean" ||
        typeof live !== "boolean" ||
        typeof position !== "number"
      ) {
        throw new Error(BAD_BLOCKS);
      }
      return {
        key,
        area,
        scope,
        levels,
        title: title_ru,
        ownerOnly: owner_only,
        live,
        position,
      };
    })
    .sort((a, b) => a.position - b.position);
}

function parseLevels(value: unknown): Record<string, AccessLevel> {
  if (!isRow(value)) throw new Error(BAD_MAP);
  const out: Record<string, AccessLevel> = {};
  for (const [block, level] of Object.entries(value)) {
    if (!isLevel(level)) throw new Error(BAD_MAP);
    out[block] = level;
  }
  return out;
}

/** Ответ `list_member_access` / `set_member_access` → карта сотрудника. */
export function parseMemberAccessMap(value: Json | null): MemberAccessMap {
  if (!isRow(value)) throw new Error(BAD_MAP);
  const { tenant_id, is_owner, version, company, calendars, attached_calendars } = value;
  if (
    typeof tenant_id !== "string" ||
    typeof is_owner !== "boolean" ||
    typeof version !== "number" ||
    !isRow(calendars)
  ) {
    throw new Error(BAD_MAP);
  }
  const attached = attached_calendars ?? [];
  if (!Array.isArray(attached) || !attached.every((id) => typeof id === "string")) {
    throw new Error(BAD_MAP);
  }
  const byCalendar: Record<string, Record<string, AccessLevel>> = {};
  for (const [teamId, levels] of Object.entries(calendars)) {
    byCalendar[teamId] = parseLevels(levels);
  }
  return {
    tenantId: tenant_id,
    isOwner: is_owner,
    version,
    company: company == null ? {} : parseLevels(company),
    calendars: byCalendar,
    attachedCalendars: attached,
  };
}

/** Положение блока у сотрудника. Нет строки — первое из `levels`. Календарный
 *  блок читается по календарю, из которого открыли человека. */
export function levelOf(
  block: AccessBlock,
  map: MemberAccessMap,
  teamId: string,
): AccessLevel {
  const stored =
    block.scope === "calendar" ? map.calendars[teamId]?.[block.key] : map.company[block.key];
  const fallback = block.levels[0] ?? "off";
  return stored && block.levels.includes(stored) ? stored : fallback;
}

export interface AccessSection {
  area: Exclude<AccessArea, "owner">;
  title: string;
  blocks: AccessBlock[];
}

/** Разделы экрана: по областям в порядке реестра. Блоки «только владелец»
 *  сотруднику не выдаются — на экране их нет. */
export function sectionsFor(blocks: readonly AccessBlock[]): AccessSection[] {
  const sections: AccessSection[] = [];
  for (const block of blocks) {
    if (block.ownerOnly || block.area === "owner") continue;
    const area = block.area;
    let section = sections.find((s) => s.area === area);
    if (!section) {
      section = { area, title: AREA_TITLE[area], blocks: [] };
      sections.push(section);
    }
    section.blocks.push(block);
  }
  return sections;
}

export interface AccessChange {
  block: string;
  team_id: string | null;
  level: AccessLevel;
}

/** Одно изменение для `set_member_access`: у блока компании `team_id` пустой. */
export function accessChange(
  block: AccessBlock,
  teamId: string,
  level: AccessLevel,
): AccessChange {
  return {
    block: block.key,
    team_id: block.scope === "calendar" ? teamId : null,
    level,
  };
}

export type AccessRefusal =
  | "not_live"
  | "not_owner"
  | "target_owner"
  | "not_attached"
  | "not_member"
  | "other";

/** Отказ сервера по `hint` контракта (`access:*`). */
export function refusalOf(error: { hint?: string | null } | null | undefined): AccessRefusal {
  switch (error?.hint) {
    case "access:not_live":
      return "not_live";
    case "access:not_owner":
      return "not_owner";
    case "access:target_owner":
      return "target_owner";
    case "access:not_attached":
      return "not_attached";
    case "access:not_member":
      return "not_member";
    default:
      return "other";
  }
}
