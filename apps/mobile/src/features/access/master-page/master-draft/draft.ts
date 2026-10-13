// The draft shape, its blank/starter forms and how a block's level is read.

import type { AccessArea, AccessBlock, AccessChange, AccessLevel } from "../../access-map";
import { offeredBlocks } from "../rights-copy";

export interface MasterDraft {
  name: string;
  email: string;
  /** Номер как набран — с пробелами форматирования. */
  phone: string;
  /** Должность — подпись под именем в карточке. */
  title: string;
  color: string | null;
  /** Календари приглашения. Первый — домашний: в нём заводится карточка
   *  мастера (`create_invitation` берёт его своим `team_id`). */
  teamIds: string[];
  /** Положения блоков на всю компанию, по ключу реестра. */
  companyLevels: Record<string, AccessLevel>;
  /** Положения календарных блоков: `[teamId][key]`. У каждого календаря свои —
   *  одно положение на все календари сервер и не хранит, и мастеру его обычно
   *  не дают одинаковым (решение 15.09). Хранится только отличное от умолчания:
   *  «нет ключа» и есть умолчание, как «нет строки» в `member_access`. */
  calendarLevels: Record<string, Record<string, AccessLevel>>;
}

export type RightsArea = Exclude<AccessArea, "owner">;

/** СТАРТОВЫЕ ПРАВА В НОВОМ КАЛЕНДАРЕ (владелец 24.09: «да, сделай»). С одними
 *  «Не видит» новый мастер входил и не видел в календаре даже своей работы,
 *  пока владелец не открывал права. Теперь он видит, что и где делать —
 *  статус, объект и услуги, — а клиент, суммы, оплата и деньги закрыты, пока
 *  владелец их не откроет. Это ЗАГОТОВКА черновика и только что добавленного
 *  календаря, а не умолчание реестра: у живого сотрудника страница читает
 *  то, что лежит на сервере, и не может показать «Видит» там, где «Не видит». */
export const STARTER_CALENDAR_LEVELS: Readonly<Record<string, AccessLevel>> = {
  // Записи команды видит — так их засевает и сервер при приёме приглашения
  // (`seed_records_level`); без этой строки черновик показывал «Скрыты», а
  // человек приходил с «Видит» (01.10).
  "calendar.records": "read",
  "record.object": "read",
  "record.services": "read",
  // STORY-088, волна 1: события, метки дня и график команды сотрудник видел
  // всегда — сервер засеял им «Видит», и новый мастер начинает так же.
  "calendar.events": "read",
  "calendar.day_labels": "read",
  "calendar.schedule": "read",
};

/** Черновик без заготовки — чистая механика (и база для чтения с сервера). */
export function blankMasterDraft(teamId: string | null): MasterDraft {
  return {
    name: "",
    email: "",
    phone: "",
    title: "",
    color: null,
    teamIds: teamId ? [teamId] : [],
    companyLevels: {},
    calendarLevels: {},
  };
}

/** Черновик НОВОГО мастера: календарь, откуда позвали, — со стартовыми
 *  правами. */
export function emptyMasterDraft(teamId: string | null): MasterDraft {
  const draft = blankMasterDraft(teamId);
  return teamId ? { ...draft, calendarLevels: { [teamId]: { ...STARTER_CALENDAR_LEVELS } } } : draft;
}

/** Стартовые права календаря изменениями — для сотрудника, которого
 *  прикрепили к новому календарю и выбрали «Выставлю сам». Только живые
 *  блоки: запись неживого сервер бы отверг. */
export function starterCalendarChanges(
  blocks: readonly AccessBlock[],
  teamId: string,
): AccessChange[] {
  return offeredBlocks(blocks)
    .filter((block) => block.scope === "calendar" && STARTER_CALENDAR_LEVELS[block.key])
    .filter((block) => block.levels.includes(STARTER_CALENDAR_LEVELS[block.key]))
    .map((block) => ({ block: block.key, team_id: teamId, level: STARTER_CALENDAR_LEVELS[block.key] }));
}

export const defaultLevel = (block: AccessBlock): AccessLevel => block.levels[0] ?? "off";

/** Положение блока в черновике. Не выбрано — умолчание реестра: у нового
 *  человека заготовок нет (владелец 14.09). Календарный блок читается по
 *  календарю; без календаря у него есть только умолчание. */
export function draftLevel(
  block: AccessBlock,
  draft: MasterDraft,
  teamId: string | null,
): AccessLevel {
  const chosen =
    block.scope === "calendar"
      ? teamId === null
        ? undefined
        : draft.calendarLevels[teamId]?.[block.key]
      : draft.companyLevels[block.key];
  return chosen && block.levels.includes(chosen) ? chosen : defaultLevel(block);
}
