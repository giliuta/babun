import type { AccessBlock, AccessChange, AccessLevel } from "../access-map";
import { offeredBlocks } from "./rights-copy";
import { STARTER_CALENDAR_LEVELS, type MasterDraft } from "./master-draft";

// НАБОРЫ ПРАВ ОДНИМ ТАПОМ (STORY-088, волна 6; владелец 24.09: «назначить
// директора… полное предоставление всех прав»). Набор — не четвёртая роль и
// не отдельное хранилище: он выставляет положения тех же блоков, что строки
// страницы прав, и дальше каждая строка правится как обычно. Поэтому набор
// «горит» только пока положения ему соответствуют: владелец поправил строку —
// на карточке уже «Свой набор».
//
// Трогаются только ЖИВЫЕ блоки, не «только владелец»: неживой блок сервер не
// держит, а «Календарь и записи» засевается при прикреплении — «Мастер» с
// его «Не видит» спрятал бы человеку весь календарь.

export type PresetKey = "master" | "senior" | "director";

export interface Preset {
  key: PresetKey;
  /** Слово на сегменте. */
  title: string;
  /** Что человек сможет — одной фразой под сегментами. */
  sentence: string;
}

export const PRESETS: readonly Preset[] = [
  {
    key: "master",
    title: "Мастер",
    sentence: "Видит свою работу и ставит статус; клиенты и деньги закрыты",
  },
  {
    key: "senior",
    title: "Старший",
    sentence: "Ведёт записи целиком, видит деньги и клиентов своих календарей",
  },
  {
    key: "director",
    title: "Директор",
    sentence: "Меняет всё в своих календарях и компании, видит всех клиентов",
  },
];

/** Самое сильное положение блока: реестр перечисляет их от слабого к
 *  сильному («Не видит → Видит → Меняет», «Свои → Все»). */
const strongest = (block: AccessBlock): AccessLevel =>
  block.levels[block.levels.length - 1] ?? "off";

const weakest = (block: AccessBlock): AccessLevel => block.levels[0] ?? "off";

/** `level`, если блок его знает, иначе самое слабое. */
const clamp = (block: AccessBlock, level: AccessLevel): AccessLevel =>
  block.levels.includes(level) ? level : weakest(block);

/** Положение блока в наборе. */
export function presetLevel(block: AccessBlock, preset: PresetKey): AccessLevel {
  if (preset === "director") return strongest(block);
  if (preset === "master") {
    return block.scope === "calendar"
      ? clamp(block, STARTER_CALENDAR_LEVELS[block.key] ?? weakest(block))
      : weakest(block);
  }
  // СТАРШИЙ: записи и календарь — целиком, деньги — смотрит; из компании —
  // клиенты своих календарей с телефонами (без них не создать запись).
  if (block.area === "calendar") return strongest(block);
  if (block.area === "finance") {
    return block.scope === "calendar" ? clamp(block, "read") : weakest(block);
  }
  if (block.key === "clients" || block.key === "clients.contacts") return clamp(block, "read");
  if (block.key === "clients.scope") return clamp(block, "own");
  // Пишет клиентам своих записей — шаблоны SMS читает (STORY-089).
  if (block.key === "company.sms_templates") return clamp(block, "read");
  return weakest(block);
}

/** Блоки, которые трогает набор: живые и не «только владелец». */
export function presetBlocks(blocks: readonly AccessBlock[]): AccessBlock[] {
  return offeredBlocks(blocks);
}

/** Набор → изменения для `set_member_access`: календарные — в каждом его
 *  календаре, компанейские — один раз. */
export function presetChanges(
  blocks: readonly AccessBlock[],
  preset: PresetKey,
  teamIds: readonly string[],
): AccessChange[] {
  const out: AccessChange[] = [];
  for (const block of presetBlocks(blocks)) {
    const level = presetLevel(block, preset);
    if (block.scope === "calendar") {
      for (const teamId of teamIds) out.push({ block: block.key, team_id: teamId, level });
    } else {
      out.push({ block: block.key, team_id: null, level });
    }
  }
  return out;
}

/** Набор → черновик (новый мастер и приглашение). Умолчание не хранится:
 *  «нет ключа» и есть умолчание, как «нет строки» в `member_access`. */
export function presetDraft(
  draft: MasterDraft,
  blocks: readonly AccessBlock[],
  preset: PresetKey,
): MasterDraft {
  const companyLevels = { ...draft.companyLevels };
  const calendarLevels: Record<string, Record<string, AccessLevel>> = {};
  for (const teamId of draft.teamIds) calendarLevels[teamId] = { ...(draft.calendarLevels[teamId] ?? {}) };
  for (const block of presetBlocks(blocks)) {
    const level = presetLevel(block, preset);
    const put = (target: Record<string, AccessLevel>) => {
      if (level === weakest(block)) delete target[block.key];
      else target[block.key] = level;
    };
    if (block.scope === "calendar") {
      for (const teamId of draft.teamIds) put(calendarLevels[teamId]);
    } else {
      put(companyLevels);
    }
  }
  return { ...draft, companyLevels, calendarLevels };
}

/** Какой набор сейчас выставлен — или `null`, если положения свои. Без
 *  календарей календарные блоки не судятся: судить нечего. */
export function matchedPreset(
  blocks: readonly AccessBlock[],
  levelOf: (block: AccessBlock, teamId: string | null) => AccessLevel,
  teamIds: readonly string[],
): PresetKey | null {
  const offered = presetBlocks(blocks);
  for (const { key } of PRESETS) {
    const fits = offered.every((block) =>
      block.scope === "calendar"
        ? teamIds.every((teamId) => levelOf(block, teamId) === presetLevel(block, key))
        : levelOf(block, null) === presetLevel(block, key),
    );
    if (fits) return key;
  }
  return null;
}

/** Снимок положений тех же блоков — «Отменить» после набора: набор
 *  перезаписывает строки, и откат обязан вернуть именно их. */
export function snapshotChanges(
  blocks: readonly AccessBlock[],
  levelOf: (block: AccessBlock, teamId: string | null) => AccessLevel,
  teamIds: readonly string[],
): AccessChange[] {
  const out: AccessChange[] = [];
  for (const block of presetBlocks(blocks)) {
    if (block.scope === "calendar") {
      for (const teamId of teamIds) {
        out.push({ block: block.key, team_id: teamId, level: levelOf(block, teamId) });
      }
    } else {
      out.push({ block: block.key, team_id: null, level: levelOf(block, null) });
    }
  }
  return out;
}

/** Фраза под сегментами: что даёт набор, или что положения свои. */
export function presetSentence(preset: PresetKey | null): string {
  return PRESETS.find((p) => p.key === preset)?.sentence ?? "Свой набор: строки выставлены вручную";
}
