import type { MemberAccessMap } from "../access/access-map";
import { accessGate } from "../access/my-access";

// «НАСТРОЙКИ КЛИЕНТОВ» ПО ПРАВАМ (владелец 01.10: «в настройках он может
// редактировать или не может редактировать… поблочно, как форма записи»).
//
// Шестерёнка вкладки — одна страница для всех. Владелец своей компании правит
// всё; партнёру строки открываются по команде, ровно как «Настройки команды»
// в календаре: «Скрыты» — строки нет, «Только видит» — страница без правки,
// «Видит и меняет» — правит. Правку пускает сервер (`team_design`, теги,
// типы объектов — миграция 20261001145000), здесь — только вид.
//
// Лист без React: правило читают страница, её подстраницы и тест.

/** Строки шестерёнки клиентов, у которых есть своё право, — в её порядке
 *  (03.10): «Клиент» · «Объекты» · «Справочники». */
export const CLIENT_SETTING_BLOCKS = {
  card: "clients.settings_card",
  ways: "clients.settings_ways",
  objects: "clients.settings_objects",
  maps: "clients.settings_maps",
  tags: "clients.settings_tags",
  // «Источники» (03.10) — своё право, как у каждой строки шестерёнки.
  sources: "clients.settings_sources",
} as const;

export type ClientSettingRow = keyof typeof CLIENT_SETTING_BLOCKS;
export type ClientSettingLevel = "hidden" | "read" | "write";
export type ClientSettingLevels = Record<ClientSettingRow, ClientSettingLevel>;

const ROWS = Object.keys(CLIENT_SETTING_BLOCKS) as ClientSettingRow[];

const ALL = (level: ClientSettingLevel): ClientSettingLevels =>
  Object.fromEntries(ROWS.map((row) => [row, level])) as ClientSettingLevels;

export interface ClientSettingsInput {
  /** Источник вкладки — СВОЯ компания: хозяйство целиком. */
  own: boolean;
  /** Источник — компания, где человек партнёр. Открыта ли она в календаре,
   *  не важно: экран читает и пишет её привязанным клиентом (01.10). */
  member: boolean;
  role: "owner" | "dispatcher" | "master" | null | undefined;
  map: MemberAccessMap | undefined;
  teamId: string | null;
}

/** Положение каждой строки шестерёнки в этой команде. */
export function clientSettingLevels(input: ClientSettingsInput): ClientSettingLevels {
  if (input.own) return ALL("write");
  // Права по блокам — у партнёра (роль `master`); прочим ролям, как и в
  // «Настройках команды», строк нет.
  if (!input.member || input.role !== "master" || !input.teamId) return ALL("hidden");
  const levels = ALL("hidden");
  for (const row of ROWS) {
    const gate = accessGate({
      role: input.role,
      map: input.map,
      blockKey: CLIENT_SETTING_BLOCKS[row],
      scope: "calendar",
      teamId: input.teamId,
    });
    levels[row] = gate === "write" ? "write" : gate === "read" ? "read" : "hidden";
  }
  return levels;
}

/** Есть ли у команды хоть одна строка — иначе её нет и в ленте. */
export function anyClientSetting(levels: ClientSettingLevels): boolean {
  return ROWS.some((row) => levels[row] !== "hidden");
}
