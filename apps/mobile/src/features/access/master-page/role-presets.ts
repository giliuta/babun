import type { AccessBlock, AccessChange, AccessLevel } from "@/session/access-map";
import { offeredBlocks } from "./rights-copy";
import type { LevelReader } from "./rights-rows";

// ГОТОВЫЕ РОЛИ — ВСЕ ПРАВА КОМАНДЫ ОДНИМ ТАПОМ. Роль — не новое право и не
// хранится на сервере: это набор положений тех же блоков реестра, которые
// владелец ставит руками. Выбрал роль — права команды встали её положениями
// одной пачкой `set_member_access`; поправил строку руками — положения
// разошлись с ролью, и на странице стоит «Своя».
//
// Права аккаунта («Кабинет»: тариф, SMS, история, «Партнёры») одни на все
// команды человека, поэтому роль ставит и их: понизить директора до мастера
// и оставить ему «Партнёров» значило бы оставить директора.
//
// Положения ролей:
//   • «Мастер» — работает по записям команды: видит их, клиента и объект,
//     пишет заметку и фото, принимает оплату на месте. Не создаёт записей,
//     не двигает и не отменяет их, денег команды и базы клиентов не видит.
//   • «Тимлид» — ведёт записи и клиентов команды: создаёт, переносит,
//     отменяет, правит всё в записи; база клиентов за 3 месяца, видит деньги
//     команды без правки; настройки команды и клиентов — только видит.
//   • «Директор» — всё в команде без ограничений, деньги «Правит всё»,
//     приглашает партнёров (право «Партнёры»). Тариф и SMS аккаунта видит, но
//     не платит: деньги аккаунта — владельца.
//
// Блок, которого роль не называет (появился на сервере позже), встаёт
// умолчанием реестра — «скрыт»: новая дверь не открывается сама.

export type RoleKey = "master" | "lead" | "director";

export interface RolePreset {
  key: RoleKey;
  title: string;
  /** Подпись в шторке выбора — что человек сможет. */
  hint: string;
  levels: Readonly<Record<string, AccessLevel>>;
}

/** Слово строки, когда положения не совпали ни с одной ролью. */
export const CUSTOM_ROLE_WORD = "Своя";

const MASTER: Record<string, AccessLevel> = {
  "calendar.records": "read",
  "calendar.window": "week",
  "calendar.events": "read",
  "calendar.day_labels": "read",
  "calendar.schedule": "read",
  "record.team": "read",
  "record.label": "read",
  "record.client": "read",
  "record.object": "read",
  "record.services": "read",
  "record.amount": "read",
  "record.payment": "write",
  "record.note": "write",
  "record.files": "write",
  "record.sms": "read",
  "event.label": "read",
  "event.type": "read",
  "event.client": "read",
  "event.object": "read",
  "event.note": "read",
  "event.files": "read",
  "finance.window": "week",
  "clients.scope": "week",
};

const LEAD: Record<string, AccessLevel> = {
  "calendar.records": "write",
  "calendar.create": "write",
  "calendar.window": "quarter",
  "calendar.events": "write",
  "calendar.move": "write",
  "calendar.cancel": "write",
  "calendar.day_money": "read",
  "calendar.day_labels": "write",
  "calendar.schedule": "write",
  "calendar.identity": "read",
  "calendar.timezone": "read",
  "calendar.hours": "read",
  "calendar.booking_form": "read",
  "calendar.services": "read",
  "calendar.labels": "read",
  "record.team": "write",
  "record.label": "write",
  "record.color": "write",
  "record.client": "write",
  "record.object": "write",
  "record.services": "read",
  "record.amount": "write",
  "record.payment": "write",
  "record.note": "write",
  "record.files": "write",
  "record.sms": "read",
  "event.label": "write",
  "event.type": "write",
  "event.client": "write",
  "event.object": "write",
  "event.note": "write",
  "event.files": "write",
  "finance.documents": "read",
  "finance.income": "read",
  "finance.expense": "read",
  "finance.debts": "read",
  "finance.window": "quarter",
  clients: "read",
  "clients.scope": "quarter",
  "clients.create": "write",
  "clients.menu": "write",
  "clients.labels": "write",
  "clients.tags": "write",
  "clients.client": "write",
  "clients.note": "write",
  "clients.people": "write",
  "clients.history": "read",
  "clients.objects": "write",
  "clients.files": "write",
  "clients.requisites": "read",
  "clients.personal": "read",
  "clients.sms": "write",
  "clients.settings_card": "read",
  "clients.settings_ways": "read",
  "clients.settings_objects": "read",
  "clients.settings_maps": "read",
  "clients.settings_tags": "read",
  "clients.settings_sources": "read",
};

const DIRECTOR: Record<string, AccessLevel> = {
  "calendar.records": "write",
  "calendar.create": "write",
  "calendar.window": "own",
  "calendar.events": "write",
  "calendar.move": "write",
  "calendar.cancel": "write",
  "calendar.day_money": "write",
  "calendar.day_labels": "write",
  "calendar.schedule": "write",
  "calendar.identity": "write",
  "calendar.timezone": "write",
  "calendar.hours": "write",
  "calendar.booking_form": "write",
  "calendar.services": "write",
  "calendar.labels": "write",
  "record.team": "write",
  "record.label": "write",
  "record.color": "write",
  "record.client": "write",
  "record.object": "write",
  "record.services": "read",
  "record.amount": "write",
  "record.payment": "write",
  "record.note": "write",
  "record.files": "write",
  "record.sms": "read",
  "event.label": "write",
  "event.type": "write",
  "event.client": "write",
  "event.object": "write",
  "event.note": "write",
  "event.files": "write",
  "finance.accounts": "write",
  "finance.documents": "write",
  "finance.income": "full",
  "finance.expense": "full",
  "finance.debts": "write",
  "finance.window": "own",
  "finance.settings_accounts": "write",
  "finance.settings_trash": "write",
  "finance.settings_categories_income": "write",
  "finance.settings_categories_expense": "write",
  "finance.settings_categories_debts": "write",
  clients: "read",
  "clients.scope": "own",
  "clients.create": "write",
  "clients.menu": "write",
  "clients.delete": "write",
  "clients.labels": "write",
  "clients.tags": "write",
  "clients.client": "write",
  "clients.note": "write",
  "clients.people": "write",
  "clients.history": "write",
  "clients.objects": "write",
  "clients.files": "write",
  "clients.requisites": "write",
  "clients.personal": "write",
  "clients.sms": "write",
  "clients.settings_card": "write",
  "clients.settings_ways": "write",
  "clients.settings_objects": "write",
  "clients.settings_maps": "write",
  "clients.settings_tags": "write",
  "clients.settings_sources": "write",
  // Права аккаунта.
  "finance.settings_requisites": "read",
  "finance.settings_currency": "read",
  "cabinet.tariff": "read",
  "cabinet.tariff_payments": "read",
  "cabinet.sms": "read",
  "cabinet.history": "read",
  "company.partners": "write",
};

export const ROLE_PRESETS: readonly RolePreset[] = [
  {
    key: "master",
    title: "Мастер",
    hint: "Работает по записям, принимает оплату",
    levels: MASTER,
  },
  {
    key: "lead",
    title: "Тимлид",
    hint: "Ведёт записи и клиентов команды",
    levels: LEAD,
  },
  {
    key: "director",
    title: "Директор",
    hint: "Всё в команде и приглашает партнёров",
    levels: DIRECTOR,
  },
];

export function rolePreset(key: RoleKey): RolePreset {
  const found = ROLE_PRESETS.find((role) => role.key === key);
  if (!found) throw new Error(`unknown role ${key}`);
  return found;
}

/** Положение, которое роль ставит блоку. Не названо или такого положения у
 *  блока уже нет — умолчание реестра. */
export function roleLevel(role: RolePreset, block: AccessBlock): AccessLevel {
  const level = role.levels[block.key];
  return level && block.levels.includes(level) ? level : (block.levels[0] ?? "off");
}

/** Блоки, которые ставит роль: только живые и не владельческие — те же, что
 *  строками стоят на странице. */
function roleBlocks(blocks: readonly AccessBlock[]): AccessBlock[] {
  return offeredBlocks(blocks);
}

/** Какой роли отвечают права человека в команде `teamId`; `null` — «Своя». */
export function matchRole(
  blocks: readonly AccessBlock[],
  levelOf: LevelReader,
  teamId: string | null,
): RoleKey | null {
  if (teamId === null) return null;
  const own = roleBlocks(blocks);
  const role = ROLE_PRESETS.find((preset) =>
    own.every(
      (block) => levelOf(block, block.scope === "calendar" ? teamId : null) === roleLevel(preset, block),
    ),
  );
  return role?.key ?? null;
}

/** Что уйдёт на сервер одной пачкой: только блоки, чьё положение меняется.
 *  `null` — менять нечего (роль уже стоит) или команды нет. */
export function roleChanges(
  blocks: readonly AccessBlock[],
  role: RolePreset,
  teamId: string | null,
  levelOf: LevelReader,
): AccessChange[] | null {
  if (teamId === null) return null;
  const changes = roleBlocks(blocks).flatMap((block): AccessChange[] => {
    const team = block.scope === "calendar" ? teamId : null;
    const level = roleLevel(role, block);
    return levelOf(block, team) === level ? [] : [{ block: block.key, team_id: team, level }];
  });
  return changes.length > 0 ? changes : null;
}

/** Может ли тот, кто выдаёт, поставить роль целиком. Директор не выдаёт выше
 *  своих прав и не выдаёт «Партнёров» — роль, которую сервер отказал бы
 *  целиком, в шторке не предлагается. */
export function roleAllowed(
  blocks: readonly AccessBlock[],
  role: RolePreset,
  teamId: string | null,
  levelOf: LevelReader,
  stepAllowed: (block: AccessBlock, teamId: string | null, level: AccessLevel) => boolean,
): boolean {
  const changes = roleChanges(blocks, role, teamId, levelOf) ?? [];
  return changes.every((change) => {
    const block = blocks.find((candidate) => candidate.key === change.block);
    return block ? stepAllowed(block, change.team_id, change.level) : false;
  });
}
