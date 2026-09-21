import type { AccessBlock, MemberAccessMap } from "@/features/access/access-map";
import { accessGate } from "@/features/access/my-access";

// ОДНА СТРАНИЦА ЗАПИСИ ДЛЯ ВСЕХ — БЛОКИ ПО ПРАВАМ (владелец 21.09: «визуал
// должен быть идентичный… берёшь чётко те блоки, даёшь просто разрешение на
// них»). Мастер открывает ту же страницу записи, что и владелец; каждый блок
// показывается по уровню своего права в календаре записи:
//   • hidden — блока нет вовсе;
//   • read   — тот же блок, без нажатий и стрелок выбора;
//   • write  — как у владельца.
//
// Блоки, которых сервер ещё не проверяет (Команда, Метка, Время), сотрудник
// видит без правки — как видел и раньше: сменить их ему не даёт сервер.
// Запись без календаря сотруднику закрыта целиком — сервер её тоже прячет.

type Role = "owner" | "dispatcher" | "master";

export type RecordLevel = "hidden" | "read" | "write";

export interface RecordBlocks {
  /** Команда и мастер записи. */
  team: RecordLevel;
  /** Метка записи. */
  label: RecordLevel;
  /** Время записи. */
  when: RecordLevel;
  client: RecordLevel;
  object: RecordLevel;
  /** Услуги в записи — строки работ. */
  services: RecordLevel;
  /** Сумма записи — цены в строках, скидка, «Итого». */
  amount: RecordLevel;
  payment: RecordLevel;
  files: RecordLevel;
  /** Статус записи. */
  status: RecordLevel;
  /** Заметку пишет тот, кто меняет статус (владелец 21.09); читают все. */
  note: RecordLevel;
}

const KEYS = {
  team: "record.team",
  label: "record.label",
  when: "record.when",
  client: "record.client",
  object: "record.object",
  services: "record.services",
  amount: "record.amount",
  payment: "record.payment",
  files: "record.files",
  status: "record.status",
} as const;

type GatedKey = keyof typeof KEYS;

const EVERYTHING: RecordBlocks = {
  team: "write",
  label: "write",
  when: "write",
  client: "write",
  object: "write",
  services: "write",
  amount: "write",
  payment: "write",
  files: "write",
  status: "write",
  note: "write",
};

const NOTHING: RecordBlocks = {
  team: "hidden",
  label: "hidden",
  when: "hidden",
  client: "hidden",
  object: "hidden",
  services: "hidden",
  amount: "hidden",
  payment: "hidden",
  files: "hidden",
  status: "hidden",
  note: "hidden",
};

export function recordBlocks(input: {
  role: Role | null | undefined;
  map: MemberAccessMap | undefined;
  /** Реестр блоков: какие из них сервер уже проверяет. `undefined` — едет. */
  registry: readonly Pick<AccessBlock, "key" | "live">[] | undefined;
  teamId: string | null;
}): RecordBlocks {
  const { role, map, registry, teamId } = input;
  if (role === "owner" || map?.isOwner) return EVERYTHING;
  // Роль, карта или реестр ещё едут — закрытая сторона: блок появится, когда
  // всё приедет, а не мигнёт лишним.
  if (!role || !map || !registry || teamId === null) return NOTHING;
  // Чужой календарь — ничего, даже блоков, которых сервер не проверяет.
  if (!map.attachedCalendars.includes(teamId)) return NOTHING;
  const live = new Set(registry.filter((b) => b.live).map((b) => b.key));
  const level = (key: GatedKey): RecordLevel => {
    const blockKey = KEYS[key];
    if (!live.has(blockKey)) return "read";
    const gate = accessGate({ role, map, blockKey, scope: "calendar", teamId });
    if (gate === "write") return "write";
    if (gate === "read") return "read";
    return "hidden";
  };
  const status = level("status");
  return {
    team: level("team"),
    label: level("label"),
    when: level("when"),
    client: level("client"),
    object: level("object"),
    services: level("services"),
    amount: level("amount"),
    payment: level("payment"),
    files: level("files"),
    status,
    note: status === "write" ? "write" : "read",
  };
}
