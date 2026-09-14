// ВХОДЯЩИЕ ПРИГЛАШЕНИЯ — ЧИСТЫЙ СЛОЙ (STORY-081; контракт 006 `my_invitations`,
// 14.09). Разворот владельца: приглашённый уже зарегистрирован, поэтому
// приглашение приходит в приложение карточкой в Кабинете, а не письмом.
//
// Лист без React и без сети: разбор ответа сервера и слова карточки
// проверяются тестом, а не глазами.

import type { IncomingInvitationView } from "./IncomingInvitationCard";

export type InvitedRole = "dispatcher" | "master";

export interface IncomingInvitation {
  id: string;
  tenantId: string;
  company: string;
  /** Имя пригласившего, иначе часть его почты до «@» — полную почту сервер
   *  не отдаёт. */
  inviter: string;
  role: InvitedRole;
  calendar: { id: string; name: string; color: string | null } | null;
  expiresAt: string;
  createdAt: string;
}

const BAD = "Сервер вернул некорректные приглашения";

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseCalendar(value: unknown): IncomingInvitation["calendar"] {
  if (value == null) return null;
  if (!isRow(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    throw new Error(BAD);
  }
  if (!(value.color == null || typeof value.color === "string")) throw new Error(BAD);
  return { id: value.id, name: value.name, color: value.color ?? null };
}

/** Ответ `my_invitations` → приглашения в порядке сервера (новые сверху). */
export function parseMyInvitations(value: unknown): IncomingInvitation[] {
  if (!Array.isArray(value)) throw new Error(BAD);
  return value.map((item): IncomingInvitation => {
    if (!isRow(item)) throw new Error(BAD);
    const { id, tenant_id, company, inviter, role, expires_at, created_at } = item;
    if (
      typeof id !== "string" ||
      typeof tenant_id !== "string" ||
      typeof company !== "string" ||
      typeof inviter !== "string" ||
      (role !== "dispatcher" && role !== "master") ||
      typeof expires_at !== "string" ||
      typeof created_at !== "string"
    ) {
      throw new Error(BAD);
    }
    return {
      id,
      tenantId: tenant_id,
      company,
      inviter,
      role,
      calendar: parseCalendar(item.calendar),
      expiresAt: expires_at,
      createdAt: created_at,
    };
  });
}

/** Слова карточки над календарём. */
export function invitationCardView(invitation: IncomingInvitation): IncomingInvitationView {
  return {
    companyName: invitation.company,
    calendarName: invitation.calendar?.name ?? null,
    invitedBy: invitation.inviter.trim() || null,
  };
}

/** Приглашения уже нет (отклонено, отозвано, принято с другого устройства):
 *  для «Отклонить» это не ошибка, а готовый результат. */
export function isInvitationGone(error: { message?: string | null; hint?: string | null } | null): boolean {
  if (!error) return false;
  return error.hint === "invite:not_found" || /invitation not found/i.test(error.message ?? "");
}
