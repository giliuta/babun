// Invitation <-> draft: the request sent to the server, a pending invitation
// read back into a draft, and its route segment.

import { LEVEL_WORD, type AccessBlock, type AccessChange, type AccessLevel } from "@/session/access-map";
import { draftAccessChanges } from "./area";
import type { MasterDraft } from "./draft";

/** Приглашение из черновика — ровно то, что уходит в `create_invitation` и
 *  `update_invitation`. Почта и имя обрезаны, пустые телефон, должность и цвет
 *  не шлются вовсе, календари — без повторов в порядке выбора (первый —
 *  домашний). `toPhone` — разбор номера «Профиля»: `null` — поля нет,
 *  `undefined` — набран мусор (тогда кнопку уже остановил `inviteBlockers`, а
 *  здесь номер просто не уйдёт). */
export interface MasterInvitationRequest {
  /** Карточка мастера без аккаунта, по которой зовут. */
  masterId?: string | null;
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
 *  `master_title`, `master_color` и `access_changes` до
 *  обновления базы в строке могут отсутствовать — тогда карточка честно
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

/** Ждущее приглашение открывается по `/cabinet/people/invite-<uuid>`.
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
