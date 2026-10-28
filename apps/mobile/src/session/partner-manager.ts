import type { AccessBlock, AccessLevel, MemberAccessMap } from "@/session/access-map";

// «ПАРТНЁРЫ» — ПРАВО ДИРЕКТОРА (директор добавляет
// партнёров, но с собой не может: сам себе доступ не выдаёт).
//
// Копия границ сервера (миграция 20261004084205: `partners_manageable`,
// `partners_check_caps`, `partners_check_teams`), чтобы на странице прав не
// было дверей, которые кончатся отказом:
//   • себя, владельца и других директоров директор не правит — их ведёт
//     только владелец;
//   • партнёра без общей с ним команды — тоже владелец;
//   • право «Партнёры» выдаёт только владелец;
//   • ступень — не выше его собственной в той же команде, действующей:
//     «Сумма» и «Оплата» без «Услуг» у него не действуют;
//   • команды — только те, где работает он сам;
//   • убрать из аккаунта — только партнёра, все команды которого — его.
// Владельцу всё открыто, как прежде.

const PARTNERS_KEY = "company.partners";

type Role = string | null | undefined;

interface Viewer {
  role: Role;
  /** Карта прав того, кто смотрит (`my_access_map`). */
  myMap: MemberAccessMap | undefined;
}

const isOwner = ({ role, myMap }: Viewer) => role === "owner" || myMap?.isOwner === true;

/** Право «Партнёры» у того, кто смотрит. */
function partnersLevel(viewer: Viewer): AccessLevel | "owner" {
  if (isOwner(viewer)) return "owner";
  return (viewer.myMap?.company[PARTNERS_KEY] as AccessLevel | undefined) ?? "off";
}

export interface PartnerManager {
  /** Почему права этого человека отсюда не меняются; `null` — меняются. */
  readOnly: string | null;
  /** «Посмотреть его глазами» — инструмент владельца. */
  canPreview: boolean;
  /** «Убрать из компании». */
  canRemove: boolean;
}

/** Что тот, кто смотрит, может с этим партнёром. */
export function partnerManager(
  viewer: Viewer & { me: string | null | undefined },
  target: { userId: string; map: MemberAccessMap | undefined },
): PartnerManager {
  if (isOwner(viewer)) return { readOnly: null, canPreview: true, canRemove: true };
  if (partnersLevel(viewer) !== "write") {
    return { readOnly: "Права партнёров меняет владелец", canPreview: false, canRemove: false };
  }
  if (viewer.me && target.userId === viewer.me) {
    return { readOnly: "Свои права меняет владелец", canPreview: false, canRemove: false };
  }
  const targetDirector = (target.map?.company[PARTNERS_KEY] ?? "off") !== "off";
  if (targetDirector || target.map?.isOwner) {
    return { readOnly: "Права директора меняет владелец", canPreview: false, canRemove: false };
  }
  const theirs = target.map?.attachedCalendars ?? [];
  const mine = new Set(viewer.myMap?.attachedCalendars ?? []);
  // Партнёра чужих команд — его права на весь аккаунт и карточку — ведёт
  // владелец (`partners_manageable`); партнёра без команд тоже.
  if (!theirs.some((teamId) => mine.has(teamId))) {
    return { readOnly: "Права партнёра чужих команд меняет владелец", canPreview: false, canRemove: false };
  }
  // Убрать из аккаунта директор может только партнёра, все команды которого —
  // его команды (`partners_removable`): иначе он выгнал бы человека и из
  // чужих команд.
  const canRemove = theirs.every((teamId) => mine.has(teamId));
  return { readOnly: null, canPreview: false, canRemove };
}

/** Может ли тот, кто смотрит, поставить эту ступень этого права в этой
 *  команде. `teamId` — команда строки; у права на весь аккаунт — `null`. */
export function stepAllowed(
  viewer: Viewer,
  block: Pick<AccessBlock, "key" | "scope" | "levels">,
  teamId: string | null,
  step: AccessLevel,
): boolean {
  if (isOwner(viewer)) return true;
  if (block.key === PARTNERS_KEY) return false;
  const map = viewer.myMap;
  if (!map) return false;
  let mine: AccessLevel | undefined;
  if (block.scope === "calendar") {
    if (!teamId || !map.calendars[teamId]) return false;
    const own = map.calendars[teamId];
    mine = own[block.key];
    // Сервер меряет действующим уровнем (`partners_check_caps`): «Сумма» и
    // «Оплата» без «Услуг», «Оплата» без «Суммы» у директора не действуют.
    const services = own["record.services"] ?? "off";
    if ((block.key === "record.amount" || block.key === "record.payment") && services === "off") mine = undefined;
    if (block.key === "record.payment" && (own["record.amount"] ?? "off") === "off") mine = undefined;
  } else {
    mine = map.company[block.key];
  }
  const rank = (level: AccessLevel | undefined) => block.levels.indexOf(level ?? block.levels[0]);
  return rank(step) <= rank(mine);
}

/** Команды, которые тот, кто смотрит, может добавить человеку или снять;
 *  `null` — любые (владелец). */
export function teamsAllowed(viewer: Viewer): ReadonlySet<string> | null {
  if (isOwner(viewer)) return null;
  const map = viewer.myMap;
  return new Set([...Object.keys(map?.calendars ?? {}), ...(map?.attachedCalendars ?? [])]);
}
