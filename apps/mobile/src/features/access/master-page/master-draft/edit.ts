// Draft edits (levels, calendars), invite blockers and dirtiness.

import type { AccessBlock, AccessLevel } from "@/session/access-map";
import { compositeRow } from "../composite-rows";
import { companionLevels, resetOnHide } from "./dependants";
import {
  STARTER_CALENDAR_LEVELS,
  defaultLevel,
  draftLevel,
  emptyMasterDraft,
  type MasterDraft,
} from "./draft";

function withoutKeys(
  levels: Record<string, AccessLevel>,
  keys: readonly string[],
): Record<string, AccessLevel> {
  const out = { ...levels };
  for (const key of keys) delete out[key];
  return out;
}

/** Выставить положение. Календарный блок — только в календаре черновика:
 *  уровень в невыбранном календаре сервер отказал бы (`access:not_attached`).
 *  Положения, которого у блока нет, не бывает. Умолчание не хранится, а скрытый
 *  главный блок сбрасывает свои зависимые. */
export function withLevel(
  draft: MasterDraft,
  block: AccessBlock,
  level: AccessLevel,
  teamId: string | null,
  /** Реестр — нужен строкам из нескольких прав («Услуги», «Цены», «Время»):
   *  их ступень раскладывается на права реестра (`composite-rows`). */
  registry?: readonly AccessBlock[],
): MasterDraft {
  // Без реестра — одно право, как раньше; с реестром строка раскладывается
  // на права, которые за ней стоят.
  const composite = registry ? compositeRow(block.key) : undefined;
  if (composite && registry) {
    if (!composite.levels.includes(level)) return draft;
    const real = (key: string) => registry.find((candidate) => candidate.key === key);
    const get = (key: string): AccessLevel => {
      const found = real(key);
      return found ? draftLevel(found, draft, teamId) : "off";
    };
    let next = draft;
    for (const [key, realLevel] of Object.entries(composite.changesFor(level, get))) {
      const found = real(key);
      if (found) next = applyLevel(next, found, realLevel, teamId);
    }
    return next;
  }
  return applyLevel(draft, block, level, teamId);
}

/** Положение одного права реестра в черновике. */
function applyLevel(
  draft: MasterDraft,
  block: AccessBlock,
  level: AccessLevel,
  teamId: string | null,
): MasterDraft {
  if (!block.levels.includes(level)) return draft;
  const isDefault = level === defaultLevel(block);
  const cleared = level === "off" ? resetOnHide(block.key) : [];
  const drop = isDefault ? [block.key, ...cleared] : cleared;
  const apply = (levels: Record<string, AccessLevel>) => {
    const next = withoutKeys(levels, drop);
    if (!isDefault) next[block.key] = level;
    // Спутники — положением прямо в ту же карту; умолчание («off») не храним.
    for (const [key, companion] of Object.entries(companionLevels(block.key, level))) {
      if (companion === "off") delete next[key];
      else next[key] = companion;
    }
    return next;
  };

  if (block.scope === "calendar") {
    if (teamId === null || !draft.teamIds.includes(teamId)) return draft;
    const next = apply(draft.calendarLevels[teamId] ?? {});
    const calendarLevels = { ...draft.calendarLevels };
    if (Object.keys(next).length > 0) calendarLevels[teamId] = next;
    else delete calendarLevels[teamId];
    return { ...draft, calendarLevels };
  }
  return { ...draft, companyLevels: apply(draft.companyLevels) };
}

/** Второй тап снимает календарь — вместе с его положениями: календарь,
 *  добавленный снова, начинает с умолчаний, а не со старых прав. Порядок
 *  выбора сохраняется: первый выбранный остаётся домашним. */
export function toggleTeam(draft: MasterDraft, teamId: string, starter = false): MasterDraft {
  if (!draft.teamIds.includes(teamId)) {
    const added = { ...draft, teamIds: [...draft.teamIds, teamId] };
    // Добавленный календарь начинается со стартовых прав — где их просят.
    return starter && !draft.calendarLevels[teamId]
      ? {
          ...added,
          calendarLevels: { ...draft.calendarLevels, [teamId]: { ...STARTER_CALENDAR_LEVELS } },
        }
      : added;
  }
  const calendarLevels = { ...draft.calendarLevels };
  delete calendarLevels[teamId];
  return {
    ...draft,
    teamIds: draft.teamIds.filter((id) => id !== teamId),
    calendarLevels,
  };
}

/** «Применить» в шторке календарей ждущего приглашения. Из шторки берутся
 *  только выбранные календари, всё остальное — из карточки в момент
 *  «Применить»: открытие шторки снимает клавиатуру, и уход из поля уже
 *  сохранил имя, телефон или должность. Копия приглашения, снятая при
 *  открытии шторки, отправила бы их старыми и затёрла только что сохранённое.
 *  Уровни снятого календаря уходят вместе с ним, как в `toggleTeam`. */
export function applyPickedCalendars(
  draft: MasterDraft,
  picked: readonly string[],
  starter = false,
): MasterDraft {
  const teamIds = [...new Set(picked)];
  const calendarLevels: MasterDraft["calendarLevels"] = Object.fromEntries(
    Object.entries(draft.calendarLevels).filter(([teamId]) => teamIds.includes(teamId)),
  );
  // Новые в приглашении календари — со стартовыми правами, где их просят.
  if (starter) {
    for (const teamId of teamIds) {
      if (!draft.teamIds.includes(teamId) && !calendarLevels[teamId]) {
        calendarLevels[teamId] = { ...STARTER_CALENDAR_LEVELS };
      }
    }
  }
  return { ...draft, teamIds, calendarLevels };
}

/** Календари, которых нет среди активных (архив, удалён), со страницы прав и
 *  из отправки уходят — так же молча их снимает `update_invitation` (v_gone).
 *  Иначе страница открылась бы на календаре без чипа: правка в нём мелькнула
 *  бы и пропала после ответа сервера, а слово раздела считало бы и его. */
export function withLiveTeams(draft: MasterDraft, liveIds: ReadonlySet<string>): MasterDraft {
  const teamIds = draft.teamIds.filter((id) => liveIds.has(id));
  if (teamIds.length === draft.teamIds.length) return draft;
  const calendarLevels = Object.fromEntries(
    Object.entries(draft.calendarLevels).filter(([teamId]) => liveIds.has(teamId)),
  );
  return { ...draft, teamIds, calendarLevels };
}

/** Должность и цвет живут в приглашении только у мастера без карточки. У
 *  приглашения по существующей карточке их правят в самой карточке (сервер
 *  отказывает `invite:card_fields_on_card`), у диспетчера карточки нет вовсе
 *  (сервер молча пишет пусто). Такие приглашения могла выписать прежняя
 *  шторка — карточка их открывает, но эти два поля не правит. */
export function invitationCarriesCardFields(row: Readonly<Record<string, unknown>>): boolean {
  return row.role === "master" && (row.master_id === null || row.master_id === undefined);
}

export type InviteBlocker = "email" | "phone" | "calendar";

/** Чего не хватает до «Пригласить» — в порядке полей на странице: серая
 *  кнопка по тапу ведёт к первому. Набранный в телефон мусор — повод
 *  остановиться, а не молча его потерять. */
export function inviteBlockers(
  draft: MasterDraft,
  checks: {
    isEmail: (value: string) => boolean;
    isPhone: (value: string) => boolean;
  },
): InviteBlocker[] {
  const out: InviteBlocker[] = [];
  // Имя не нужно: партнёр — со своим аккаунтом, имя и телефон
  // приходят из его профиля при приёме.
  if (!checks.isEmail(draft.email)) out.push("email");
  if (draft.phone.trim() && !checks.isPhone(draft.phone)) out.push("phone");
  if (draft.teamIds.length === 0) out.push("calendar");
  return out;
}

/** Черновик тронут: уход с экрана спросит, не потерять ли набранное. */
function sameCalendarLevels(
  a: MasterDraft["calendarLevels"],
  b: MasterDraft["calendarLevels"],
): boolean {
  const norm = (levels: MasterDraft["calendarLevels"]) =>
    JSON.stringify(
      Object.entries(levels)
        .filter(([, byKey]) => Object.keys(byKey).length > 0)
        .map(([teamId, byKey]) => [teamId, Object.entries(byKey).sort()] as const)
        .sort(([x], [y]) => x.localeCompare(y)),
    );
  return norm(a) === norm(b);
}

export function isDraftDirty(draft: MasterDraft, initialTeamId: string | null): boolean {
  const initial = initialTeamId ? [initialTeamId] : [];
  return (
    draft.name.trim() !== "" ||
    draft.email.trim() !== "" ||
    draft.phone.trim() !== "" ||
    draft.title.trim() !== "" ||
    draft.color !== null ||
    Object.keys(draft.companyLevels).length > 0 ||
    // Стартовые права — заготовка, а не правка: сравниваем с нею.
    !sameCalendarLevels(draft.calendarLevels, emptyMasterDraft(initialTeamId).calendarLevels) ||
    draft.teamIds.length !== initial.length ||
    draft.teamIds.some((id, i) => id !== initial[i])
  );
}

/** Черновик по карточке открывается уже с именем, телефоном и
 *  календарями карточки — «грязный» он, только если что-то поменяли против
 *  этого начала. Без сравнения нетронутая «Пригласить в CRM» спрашивала
 *  «Удалить черновик?» на первом же «Назад». */
export function draftChangedFrom(draft: MasterDraft, baseline: MasterDraft): boolean {
  const norm = (d: MasterDraft) =>
    JSON.stringify([
      d.name.trim(),
      d.email.trim(),
      d.phone.trim(),
      d.title.trim(),
      d.color,
      d.teamIds,
      d.companyLevels,
      Object.entries(d.calendarLevels).filter(([, levels]) => Object.keys(levels).length > 0),
    ]);
  return norm(draft) !== norm(baseline);
}
