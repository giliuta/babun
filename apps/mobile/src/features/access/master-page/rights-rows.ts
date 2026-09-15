import {
  LEVEL_WORD,
  sectionsFor,
  type AccessBlock,
  type AccessChange,
  type AccessLevel,
  type AccessRefusal,
  type MemberAccessMap,
} from "../access-map";
import {
  MIXED_WORD,
  areaLevel,
  dependantResets,
  isBlockFolded,
  type AreaLevel,
  type MasterDraft,
  type RightsArea,
} from "./master-draft";

/** Разделы прав на карточке и на странице — в порядке реестра. */
export const RIGHTS_AREAS: readonly RightsArea[] = ["calendar", "finance", "clients", "company"];

/** `?area=` из адреса — только знакомый раздел, иначе страница открывается
 *  сверху. */
export function rightsAreaOf(value: string | null | undefined): RightsArea | undefined {
  return RIGHTS_AREAS.find((area) => area === value);
}

/** Положение каждого раздела карточки разом. */
export function areaLevelsOf(
  blocks: readonly AccessBlock[],
  draft: MasterDraft,
): Record<RightsArea, AreaLevel> {
  return {
    calendar: areaLevel(blocks, draft, "calendar"),
    finance: areaLevel(blocks, draft, "finance"),
    clients: areaLevel(blocks, draft, "clients"),
    company: areaLevel(blocks, draft, "company"),
  };
}

/** Слово положения — и раздела («Разное»), и блока. */
export function levelWord(level: AreaLevel): string {
  return level === "mixed" ? MIXED_WORD : LEVEL_WORD[level];
}

/** Отказ сервера в правах сотрудника — словами (перенесено с прежнего экрана
 *  прав сотрудника вместе с его правилами). */
export const MEMBER_REFUSAL_TEXT: Record<AccessRefusal, string> = {
  not_live: "Этот раздел прав ещё не включён",
  not_owner: "Права сотрудников настраивает владелец",
  target_owner: "Права владельца не меняются",
  not_attached: "Сотрудник не прикреплён к этому календарю",
  not_member: "Сотрудник больше не работает в компании",
  other: "Не удалось сохранить права",
};

// СТРАНИЦА «ПРАВА» МАСТЕРА — ЧТО НА НЕЙ СТОИТ, БЕЗ REACT (владелец 15.09).
// Одна страница на три случая — черновик, ждущее приглашение и сотрудник, —
// и один ответ на вопрос «какие строки видны»: порядок в разделе, свёрнутые
// зависимые, положение в выбранном календаре. Проверяется тестом, а не глазами.

export interface RightsRow {
  block: AccessBlock;
  level: AccessLevel;
}

export interface RightsSection {
  area: RightsArea;
  title: string;
  rows: RightsRow[];
}

/** Положение блока: календарный — в календаре `teamId`, компанейский — `null`. */
export type LevelReader = (block: AccessBlock, teamId: string | null) => AccessLevel;

/** Разделы страницы для одного календаря. В разделе сначала блоки календаря
 *  (их переключают чипы), потом блоки всей компании — отдельной карточки
 *  «Во всех календарях» нет (замечание судей 15.09). Строка зависимого, чей
 *  главный блок скрыт, свёрнута. */
export function rightsSections(
  blocks: readonly AccessBlock[],
  levelOf: LevelReader,
  teamId: string | null,
): RightsSection[] {
  const byKey = new Map(blocks.map((block) => [block.key, block]));
  const read = (block: AccessBlock) =>
    levelOf(block, block.scope === "calendar" ? teamId : null);
  return sectionsFor(blocks)
    .map((section) => {
      // Без календаря календарных строк нет: выставить их некуда (сервер
      // отказал бы `access:bad_team`), а слово раздела на карточке их и так не
      // считает (`areaLevel`). Пригашенная строка остаётся только у запертого
      // блока — иначе пустой черновик выглядел бы сломанной страницей.
      const ordered = [
        ...(teamId === null ? [] : section.blocks.filter((block) => block.scope === "calendar")),
        ...section.blocks.filter((block) => block.scope !== "calendar"),
      ];
      const rows = ordered
        .filter(
          (block) =>
            !isBlockFolded(block.key, (parentKey) => {
              const parent = byKey.get(parentKey);
              return parent ? read(parent) : "write";
            }),
        )
        .map((block) => ({ block, level: read(block) }));
      return { area: section.area, title: section.title, rows };
    })
    .filter((section) => section.rows.length > 0);
}

/** Карта сотрудника → черновик той же формы: слово раздела на карточке и
 *  строки страницы прав считаются для сотрудника тем же кодом, что для нового
 *  мастера. Положения в календарях, к которым он уже не прикреплён, не
 *  считаются — там он не работает. */
export function draftFromMemberAccess(
  map: MemberAccessMap,
  identity: Pick<MasterDraft, "name" | "email" | "phone" | "title" | "color">,
): MasterDraft {
  const teamIds = [...new Set(map.attachedCalendars)];
  const calendarLevels: Record<string, Record<string, AccessLevel>> = {};
  for (const teamId of teamIds) {
    const levels = map.calendars[teamId];
    if (levels) calendarLevels[teamId] = { ...levels };
  }
  return { ...identity, teamIds, companyLevels: { ...map.company }, calendarLevels };
}

/** Что уходит в `set_member_access`, когда владелец выбрал положение: сам
 *  блок и сброс его зависимых, если главный скрыт. Календарный блок без
 *  календаря не выставляется вовсе — сервер отказал бы (`access:bad_team`). */
export function levelChanges(
  blocks: readonly AccessBlock[],
  block: AccessBlock,
  level: AccessLevel,
  teamId: string | null,
): AccessChange[] | null {
  if (block.scope === "calendar" && teamId === null) return null;
  return [
    { block: block.key, team_id: block.scope === "calendar" ? teamId : null, level },
    ...dependantResets(blocks, block, level, teamId),
  ];
}

/** Что уходит в `set_member_access` со страницы прав сотрудника: сам блок и
 *  сброс ВСЕХ его зависимых, живых и неживых. Уровень неживого блока хранится
 *  (перенос прав 14.09 и приём приглашения его пишут, миграция 20260915110000
 *  больше не отказывает неживым) и заработает, когда блок оживёт. Оставить
 *  его при скрытом главном — выдать право на то, чего человек не видит.
 *  Отдельное имя — шов под тест: фильтр по живости в экран не вернуть молча. */
export function memberLevelChanges(
  blocks: readonly AccessBlock[],
  block: AccessBlock,
  level: AccessLevel,
  teamId: string | null,
): AccessChange[] | null {
  return levelChanges(blocks, block, level, teamId);
}

/** Карта с применёнными изменениями — до ответа сервера, чтобы строка сменила
 *  слово под пальцем. Исходная карта не меняется: при отказе она и есть откат.
 *  Умолчание не хранится, как «нет строки» в `member_access`. */
export function withMemberChanges(
  map: MemberAccessMap,
  blocks: readonly AccessBlock[],
  changes: readonly AccessChange[],
): MemberAccessMap {
  const company = { ...map.company };
  const calendars: Record<string, Record<string, AccessLevel>> = {};
  for (const [teamId, levels] of Object.entries(map.calendars)) {
    calendars[teamId] = { ...levels };
  }
  for (const change of changes) {
    const block = blocks.find((candidate) => candidate.key === change.block);
    if (!block || (block.scope === "calendar") !== (change.team_id !== null)) continue;
    const target =
      change.team_id === null ? company : (calendars[change.team_id] ??= {});
    if (change.level === (block.levels[0] ?? "off")) delete target[change.block];
    else target[change.block] = change.level;
  }
  return { ...map, company, calendars };
}
