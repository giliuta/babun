import type { AccessBlock, AccessLevel, MemberAccessMap } from "../access-map";

// «ПАРТНЁРЫ» — ПРАВО ДИРЕКТОРА (владелец 04.10: «кто-то ещё добавлял
// партнёров… с собой он не может, сам себе доступ не выдаёт»).
//
// Копия границ сервера (миграция 20261004084205: `partners_manageable`,
// `partners_check_caps`, `partners_check_teams`), чтобы на странице прав не
// было дверей, которые кончатся отказом:
//   • себя, владельца и других директоров директор не правит — их ведёт
//     только владелец;
//   • право «Партнёры» выдаёт только владелец;
//   • ступень — не выше его собственной в той же команде;
//   • команды — только те, где работает он сам.
// Владельцу всё открыто, как прежде.

export const PARTNERS_KEY = "company.partners";

type Role = string | null | undefined;

interface Viewer {
  role: Role;
  /** Карта прав того, кто смотрит (`my_access_map`). */
  myMap: MemberAccessMap | undefined;
}

const isOwner = ({ role, myMap }: Viewer) => role === "owner" || myMap?.isOwner === true;

/** Право «Партнёры» у того, кто смотрит. */
export function partnersLevel(viewer: Viewer): AccessLevel | "owner" {
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
  return { readOnly: null, canPreview: false, canRemove: true };
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
    mine = map.calendars[teamId][block.key];
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
