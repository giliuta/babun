// What the rights page shows: folded/visible levels, the area word and the
// access changes that leave with an invitation.

import { LEVEL_WORD, type AccessBlock, type AccessChange, type AccessLevel } from "@/session/access-map";
import { offeredBlocks } from "../rights-copy";
import { RECORDS_KEY, isBlockFolded } from "./dependants";
import { defaultLevel, draftLevel, type MasterDraft, type RightsArea } from "./draft";

/** Положение, которое видно на странице прав: свёрнутый зависимый стоит на
 *  умолчании, что бы в нём ни лежало (например, в приглашении, прочитанном с
 *  сервера) — иначе слово раздела и отправленное разошлись бы с экраном.
 *
 *  ОДИН РАСЧЁТ НА ПЯТЬ ПОВЕРХНОСТЕЙ. Этим же положением обязаны говорить
 *  строка страницы, слово раздела, сводка «Сможет», зеркало и то, что уходит
 *  на сервер. Пока свёртка была написана в каждом месте заново, три копии
 *  врали: сводка обещала телефоны при скрытых клиентах, а отправка молчала.
 *
 *  СВОРАЧИВАТЬ МОЖЕТ ТОЛЬКО ТОТ, У КОГО НА СТРАНИЦЕ ЕСТЬ СТРОКА. Главный
 *  блок берётся из ПРЕДЛАГАЕМЫХ (`offeredBlocks`), а не из всего реестра:
 *  неживой `calendar.records` — родитель всех финансовых блоков — навсегда
 *  стоял бы на своём умолчании `off` и сворачивал живые «Доходы и расходы».
 *  Владелец ставил «Меняет», экран показывал «Меняет», а на сервер не
 *  уходило НИЧЕГО, и поднять родителя было нельзя: строки у него нет. */
export function visibleLevel(blocks: readonly AccessBlock[], draft: MasterDraft) {
  const folded = foldedBlock(blocks, draft);
  return (block: AccessBlock, teamId: string | null): AccessLevel =>
    folded(block, teamId) ? defaultLevel(block) : draftLevel(block, draft, teamId);
}

/** Свёрнут ли блок: его главный скрыт, строки на странице нет вовсе.
 *
 *  Положения свёрнутого блока мало: у «Каких клиентов» положения «Скрыт» не
 *  существует, и свёрнутый он честно отвечает «Только клиенты его
 *  календарей» — фразой, которая на карточке читалась как ОБЕЩАНИЕ, хотя
 *  клиенты у человека скрыты целиком. Обещать может только та строка, которую
 *  владельцу показали. */
export function foldedBlock(blocks: readonly AccessBlock[], draft: MasterDraft) {
  const byKey = new Map(offeredBlocks(blocks).map((block) => [block.key, block]));
  return (block: AccessBlock, teamId: string | null): boolean =>
    isBlockFolded(block.key, (parentKey) => {
      const parent = byKey.get(parentKey);
      return parent ? draftLevel(parent, draft, teamId) : "write";
    });
}

/** Положение раздела целиком — «mixed», когда блоки или календари расходятся. */
export type AreaLevel = AccessLevel | "mixed";

// «ЧАСТИЧНО», А НЕ «РАЗНОЕ»: «разное» не отвечает на вопрос
// владельца «что он видит», «частично» — отвечает: что-то видит, что-то нет.
export const MIXED_WORD = "Частично";

/** Положение раздела на карточке. Считаются только блоки, которые можно
 *  скрыть: у «Валюты» и «Какие клиенты» положения «Скрыт» нет, и в счёте они
 *  превращали бы нетронутый черновик в «Смотрит 1».
 *  Календарный блок читается в каждом выбранном календаре. Считать нечего —
 *  раздел скрыт. */
export function areaLevel(
  blocks: readonly AccessBlock[],
  draft: MasterDraft,
  area: RightsArea,
): AreaLevel {
  let seen: AccessLevel | null = null;
  const teamIds = [...new Set(draft.teamIds)];
  const shown = visibleLevel(blocks, draft);
  // СЧИТАЕТСЯ ТОЛЬКО ТО, ЧТО ВЛАДЕЛЕЦ МОЖЕТ ПОСТАВИТЬ. Мёртвые блоки раздела
  // («Инвойсы и чеки», «Категории, шаблоны, НДС») вечно стоят на своём
  // умолчании, и раздел с ними всегда «Разное»: владелец выставил бы все три
  // живых блока «Финансов» в «Меняет», а карточка продолжала бы отвечать
  // «Разное» — про блоки, строки которых на странице нет.
  for (const block of offeredBlocks(blocks)) {
    if (block.area !== area || block.ownerOnly || !block.levels.includes("off")) continue;
    const levels =
      block.scope === "calendar"
        ? teamIds.map((teamId) => shown(block, teamId))
        : [shown(block, null)];
    for (const level of levels) {
      if (seen === null) seen = level;
      else if (seen !== level) return "mixed";
    }
  }
  return seen ?? "off";
}

/** ПРАВА «КАК В ТОМ КАЛЕНДАРЕ»: добавили мастеру второй календарь —
 *  одним тапом перенести положения первого, а не выставлять десять строк
 *  заново. Только живые календарные блоки; свёрнутое переносится свёрнутым. */
export function copyCalendarLevels(
  blocks: readonly AccessBlock[],
  draft: MasterDraft,
  fromTeamId: string,
  toTeamId: string,
): AccessChange[] {
  const shown = visibleLevel(blocks, draft);
  return offeredBlocks(blocks)
    .filter((block) => block.scope === "calendar")
    .map((block) => ({ block: block.key, team_id: toTeamId, level: shown(block, fromTeamId) }));
}

/** Слово раздела: «Скрыт», «Смотрит», «Меняет» или «Разное». Счётчиков нет. */
export function areaWord(
  blocks: readonly AccessBlock[],
  draft: MasterDraft,
  area: RightsArea,
): string {
  const level = areaLevel(blocks, draft, area);
  return level === "mixed" ? MIXED_WORD : LEVEL_WORD[level];
}

export type LevelTone = "ink" | "sub" | "faint";

/** Тон слова положения — на карточке и на странице прав одинаковый: скрытое
 *  тише всего, «смотрит» — вполголоса, открытое и разное — полным цветом. */
export function levelTone(level: AreaLevel): LevelTone {
  switch (level) {
    case "off":
      return "faint";
    case "read":
    case "own":
      return "sub";
    default:
      return "ink";
  }
}

/** Что уйдёт с приглашением — изменения в форме `set_member_access`.
 *  Умолчание не пишется: «нет строки» и есть умолчание. Каждый календарь
 *  несёт свои положения; блоков «только владелец» сотруднику не выдают вовсе.
 *  Свёрнутое не уходит: пока главный блок скрыт, зависимый — тоже, что бы в
 *  нём ни лежало (например, в приглашении, прочитанном с сервера). */
export function draftAccessChanges(
  blocks: readonly AccessBlock[],
  draft: MasterDraft,
): AccessChange[] {
  const teamIds = [...new Set(draft.teamIds)];
  const shown = visibleLevel(blocks, draft);
  const out: AccessChange[] = [];
  for (const block of blocks) {
    if (block.ownerOnly || block.area === "owner") continue;
    const targets = block.scope === "calendar" ? teamIds : [null];
    for (const teamId of targets) {
      const level = shown(block, teamId);
      // «Записи клиентов» уходят всегда: приём засевает им «Видит», и
      // «Скрыты» без явной строки молча превратилось бы в «Видит».
      if (level === defaultLevel(block) && block.key !== RECORDS_KEY) continue;
      out.push({ block: block.key, team_id: teamId, level });
    }
  }
  return out;
}
