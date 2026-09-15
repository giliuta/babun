import {
  LEVEL_WORD,
  type AccessArea,
  type AccessBlock,
  type AccessChange,
  type AccessLevel,
} from "../access-map";

// НОВЫЙ МАСТЕР — ЧЕРНОВИК КАРТОЧКИ (владелец 15.09: «„Добавить мастера" —
// сразу полная карточка мастера, как создание клиента: имя, почта, телефон;
// календари и права — до „Пригласить"»).
//
// Лист без React и без сети: что обязательно, какое положение у блока, какое
// слово стоит у раздела и что уйдёт на сервер вместе с приглашением,
// проверяется тестом, а не глазами.

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

export function emptyMasterDraft(teamId: string | null): MasterDraft {
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

const defaultLevel = (block: AccessBlock): AccessLevel => block.levels[0] ?? "off";

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

/** Зависимые блоки: пока главный скрыт, их строки на странице прав свёрнуты,
 *  а выставленное в них сбрасывается. «Новые записи» без «Календаря и записей»
 *  — право на то, чего человек не видит; «Телефоны клиентов» без «Клиентов» —
 *  тоже. Зависимые живут в той же области действия, что и главный
 *  (реестр `access_blocks`, 14.09): календарные — в том же календаре. */
export const DEPENDANT_BLOCKS: Readonly<Record<string, readonly string[]>> = {
  "calendar.records": [
    "calendar.create",
    "record.status",
    "record.amount",
    "record.payment",
    "calendar.day_labels",
  ],
  clients: ["clients.scope", "clients.contacts"],
};

/** Главный блок зависимого, `null` — блок ни от кого не зависит. */
export function parentBlockOf(key: string): string | null {
  for (const [parent, dependants] of Object.entries(DEPENDANT_BLOCKS)) {
    if (dependants.includes(key)) return parent;
  }
  return null;
}

/** Строка блока свёрнута: её главный блок скрыт. `parentLevel` — положение
 *  главного в том же календаре (или в компании); один и тот же вопрос задают
 *  и черновик, и карта живого сотрудника. */
export function isBlockFolded(
  key: string,
  parentLevel: (parentKey: string) => AccessLevel,
): boolean {
  const parent = parentBlockOf(key);
  return parent !== null && parentLevel(parent) === "off";
}

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
): MasterDraft {
  if (!block.levels.includes(level)) return draft;
  const isDefault = level === defaultLevel(block);
  const cleared = level === "off" ? (DEPENDANT_BLOCKS[block.key] ?? []) : [];
  const drop = isDefault ? [block.key, ...cleared] : cleared;
  const apply = (levels: Record<string, AccessLevel>) => {
    const next = withoutKeys(levels, drop);
    if (!isDefault) next[block.key] = level;
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

/** Что сбросить у живого сотрудника вместе со скрытием главного блока — те же
 *  правила, что `withLevel` у черновика, в форме `set_member_access`. Сбрасываем
 *  на умолчание: такое изменение сервер пишет удалением строки. Одного блока
 *  дважды в наборе нет — сервер такой набор отказывает. */
export function dependantResets(
  blocks: readonly AccessBlock[],
  block: AccessBlock,
  level: AccessLevel,
  teamId: string | null,
): AccessChange[] {
  if (level !== "off") return [];
  const out: AccessChange[] = [];
  for (const key of DEPENDANT_BLOCKS[block.key] ?? []) {
    const dependant = blocks.find((candidate) => candidate.key === key);
    if (!dependant || dependant.ownerOnly || dependant.area === "owner") continue;
    if (dependant.scope === "calendar" && teamId === null) continue;
    out.push({
      block: dependant.key,
      team_id: dependant.scope === "calendar" ? teamId : null,
      level: defaultLevel(dependant),
    });
  }
  return out;
}

/** Второй тап снимает календарь — вместе с его положениями: календарь,
 *  добавленный снова, начинает с умолчаний, а не со старых прав. Порядок
 *  выбора сохраняется: первый выбранный остаётся домашним. */
export function toggleTeam(draft: MasterDraft, teamId: string): MasterDraft {
  if (!draft.teamIds.includes(teamId)) {
    return { ...draft, teamIds: [...draft.teamIds, teamId] };
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
): MasterDraft {
  const teamIds = [...new Set(picked)];
  const calendarLevels = Object.fromEntries(
    Object.entries(draft.calendarLevels).filter(([teamId]) => teamIds.includes(teamId)),
  );
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

export type CalendarsBlockMode = "choose" | "empty-words" | "rows-tappable" | "rows-display";

/** Блок «Календари» на карточке: дверь выбора — только там, где она
 *  открывается. Карточка сотрудника календари пока только показывает
 *  (прикрепления из приложения нет): серая «Выбрать календари», которая не
 *  откроется никогда, и строки шторки, которые не отзываются, — мёртвые тапы.
 *  Там пусто — словами, выбранное — строками без кнопки. */
export function calendarsBlockMode(chosenCount: number, canOpen: boolean): CalendarsBlockMode {
  if (chosenCount === 0) return canOpen ? "choose" : "empty-words";
  return canOpen ? "rows-tappable" : "rows-display";
}

/** Должность и цвет живут в приглашении только у мастера без карточки. У
 *  приглашения по существующей карточке их правят в самой карточке (сервер
 *  отказывает `invite:card_fields_on_card`), у диспетчера карточки нет вовсе
 *  (сервер молча пишет пусто). Такие приглашения могла выписать прежняя
 *  шторка — карточка их открывает, но эти два поля не правит. */
export function invitationCarriesCardFields(row: Readonly<Record<string, unknown>>): boolean {
  return row.role === "master" && (row.master_id === null || row.master_id === undefined);
}

export type InviteBlocker = "name" | "email" | "phone" | "calendar";

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
  if (!draft.name.trim()) out.push("name");
  if (!checks.isEmail(draft.email)) out.push("email");
  if (draft.phone.trim() && !checks.isPhone(draft.phone)) out.push("phone");
  if (draft.teamIds.length === 0) out.push("calendar");
  return out;
}

/** Черновик тронут: уход с экрана спросит, не потерять ли набранное. */
export function isDraftDirty(draft: MasterDraft, initialTeamId: string | null): boolean {
  const initial = initialTeamId ? [initialTeamId] : [];
  return (
    draft.name.trim() !== "" ||
    draft.email.trim() !== "" ||
    draft.phone.trim() !== "" ||
    draft.title.trim() !== "" ||
    draft.color !== null ||
    Object.keys(draft.companyLevels).length > 0 ||
    Object.values(draft.calendarLevels).some((levels) => Object.keys(levels).length > 0) ||
    draft.teamIds.length !== initial.length ||
    draft.teamIds.some((id, i) => id !== initial[i])
  );
}

/** Положение, которое видно на странице прав: свёрнутый зависимый стоит на
 *  умолчании, что бы в нём ни лежало (например, в приглашении, прочитанном с
 *  сервера) — иначе слово раздела и отправленное разошлись бы с экраном. */
function shownLevel(blocks: readonly AccessBlock[], draft: MasterDraft) {
  const byKey = new Map(blocks.map((block) => [block.key, block]));
  return (block: AccessBlock, teamId: string | null): AccessLevel => {
    const folded = isBlockFolded(block.key, (parentKey) => {
      const parent = byKey.get(parentKey);
      return parent ? draftLevel(parent, draft, teamId) : "write";
    });
    return folded ? defaultLevel(block) : draftLevel(block, draft, teamId);
  };
}

/** Положение раздела целиком — «mixed», когда блоки или календари расходятся. */
export type AreaLevel = AccessLevel | "mixed";

export const MIXED_WORD = "Разное";

/** Положение раздела на карточке. Считаются только блоки, которые можно
 *  скрыть: у «Валюты» и «Какие клиенты» положения «Скрыт» нет, и в счёте они
 *  превращали нетронутый черновик в «Смотрит 1» (замечание владельца 15.09).
 *  Календарный блок читается в каждом выбранном календаре. Считать нечего —
 *  раздел скрыт. */
export function areaLevel(
  blocks: readonly AccessBlock[],
  draft: MasterDraft,
  area: RightsArea,
): AreaLevel {
  let seen: AccessLevel | null = null;
  const teamIds = [...new Set(draft.teamIds)];
  const shown = shownLevel(blocks, draft);
  for (const block of blocks) {
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
  const shown = shownLevel(blocks, draft);
  const out: AccessChange[] = [];
  for (const block of blocks) {
    if (block.ownerOnly || block.area === "owner") continue;
    const targets = block.scope === "calendar" ? teamIds : [null];
    for (const teamId of targets) {
      const level = shown(block, teamId);
      if (level === defaultLevel(block)) continue;
      out.push({ block: block.key, team_id: teamId, level });
    }
  }
  return out;
}

/** Приглашение из черновика — ровно то, что уходит в `create_invitation` и
 *  `update_invitation`. Почта и имя обрезаны, пустые телефон, должность и цвет
 *  не шлются вовсе, календари — без повторов в порядке выбора (первый —
 *  домашний). `toPhone` — разбор номера «Профиля»: `null` — поля нет,
 *  `undefined` — набран мусор (тогда кнопку уже остановил `inviteBlockers`, а
 *  здесь номер просто не уйдёт). */
export interface MasterInvitationRequest {
  email: string;
  fullName: string;
  phone: string | null;
  teamIds: string[];
  title: string | null;
  color: string | null;
  access: AccessChange[];
}

export function invitationRequest(
  draft: MasterDraft,
  blocks: readonly AccessBlock[],
  toPhone: (value: string) => string | null | undefined,
): MasterInvitationRequest {
  const title = draft.title.trim();
  // Повтор календаря размножил бы и права — сервер отказывает повтору блока.
  const teamIds = [...new Set(draft.teamIds)];
  return {
    email: draft.email.trim(),
    fullName: draft.name.trim(),
    phone: toPhone(draft.phone) ?? null,
    teamIds,
    title: title || null,
    color: draft.color,
    access: draftAccessChanges(blocks, { ...draft, teamIds }),
  };
}

const isLevel = (value: unknown): value is AccessLevel =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(LEVEL_WORD, value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** Ждущее приглашение → черновик его карточки. Колонки `team_ids`,
 *  `master_title`, `master_color` и `access_changes` появились 15.09 и до
 *  обновления базы в строке их может не быть — тогда карточка честно
 *  показывает один домашний `team_id` и права по умолчанию. Незнакомое в
 *  строке пропускается: черновик — не проверка сервера, отказ пришёл бы уже
 *  на сохранении. */
export function draftFromInvitation(row: Readonly<Record<string, unknown>>): MasterDraft {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const nonEmpty = (value: unknown): value is string =>
    typeof value === "string" && value.trim() !== "";

  // Домашний — `team_id`, дальше остальные календари без повторов: так же
  // сливает их `create_invitation`.
  const listed = Array.isArray(row.team_ids) ? row.team_ids.filter(nonEmpty) : [];
  const teamIds = [...new Set([...(nonEmpty(row.team_id) ? [row.team_id] : []), ...listed])];

  const companyLevels: Record<string, AccessLevel> = {};
  const calendarLevels: Record<string, Record<string, AccessLevel>> = {};
  const changes = Array.isArray(row.access_changes) ? row.access_changes : [];
  for (const change of changes) {
    if (!isRecord(change) || !nonEmpty(change.block) || !isLevel(change.level)) continue;
    const teamId = change.team_id;
    if (teamId === null || teamId === undefined || teamId === "") {
      companyLevels[change.block] = change.level;
    } else if (typeof teamId === "string" && teamIds.includes(teamId)) {
      calendarLevels[teamId] = { ...calendarLevels[teamId], [change.block]: change.level };
    }
  }

  const color = typeof row.master_color === "string" ? row.master_color.trim() : "";
  return {
    name: text(row.full_name),
    email: text(row.email),
    phone: text(row.phone),
    title: text(row.master_title).trim(),
    color: HEX_COLOR.test(color) ? color : null,
    teamIds,
    companyLevels,
    calendarLevels,
  };
}

/** Ждущее приглашение открывается по `/calendar/masters/invite-<uuid>`.
 *  Двоеточие в сегменте ломает разбор диплинка, поэтому дефис; проверка
 *  строгая, чтобы id карточки мастера не приняли за приглашение. */
const INVITE_SEGMENT = /^invite-([0-9a-f-]{36})$/;

export function invitationSegment(invitationId: string): string {
  return `invite-${invitationId}`;
}

export function invitationIdFromSegment(segment: string | null | undefined): string | null {
  const match = typeof segment === "string" ? INVITE_SEGMENT.exec(segment) : null;
  return match ? (match[1] ?? null) : null;
}
