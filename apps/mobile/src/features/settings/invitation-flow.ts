import type { UserRole } from "./role-policy";

export type InvitableRole = Extract<UserRole, "dispatcher" | "master">;
export type InvitationState = "active" | "expired" | "accepted";

// New tokens are exactly 32 URL-safe base64 characters (24 bytes / 192 bits).
// The wider upper bound keeps previously issued strong tokens routable.
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isInvitationToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

export function normalizeInvitationEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isInvitationEmail(value: string): boolean {
  const normalized = normalizeInvitationEmail(value);
  return normalized.length <= 320 && EMAIL_RE.test(normalized);
}

export function isInvitableRole(value: unknown): value is InvitableRole {
  return value === "dispatcher" || value === "master";
}

export function invitationPath(token: string): `/invite/${string}` {
  if (!isInvitationToken(token)) throw new Error("Некорректная ссылка");
  return `/invite/${token}`;
}

export function invitationErrorMessage(message: string): string {
  if (/finish company setup|company setup is incomplete/i.test(message)) {
    return "Сначала завершите настройку компании, затем пригласите сотрудника.";
  }
  if (/already has access/i.test(message)) {
    return "У этого аккаунта уже есть доступ к компании.";
  }
  if (/invalid invitation email/i.test(message)) {
    return "Проверьте адрес электронной почты.";
  }
  if (/does not match/i.test(message)) {
    return "Приглашение выписано на другой email. Войдите под нужным аккаунтом.";
  }
  if (/expired/i.test(message)) {
    return "Срок приглашения истёк. Попросите владельца отправить новое.";
  }
  if (/already accepted/i.test(message)) {
    return "Это приглашение уже использовано.";
  }
  if (/employee card (is unavailable|already linked)/i.test(message)) {
    return "Карточка сотрудника уже привязана к другому аккаунту. Попросите владельца выбрать другую.";
  }
  if (/not found|invalid token|Некорректная ссылка/i.test(message)) {
    return "Приглашение не найдено или ссылка повреждена.";
  }
  if (/only an owner/i.test(message)) {
    return "Создавать приглашения может только владелец.";
  }
  if (/membership not found/i.test(message)) {
    return "Доступ к этой компании не найден.";
  }
  return message || "Не удалось обработать приглашение.";
}

export function invitationShareText(args: {
  tenantName?: string | null;
  roleLabel: string;
  url: string;
}): string {
  const company = args.tenantName?.trim()
    ? ` в «${args.tenantName.trim()}»`
    : " в Babun CRM";
  return `Вас пригласили${company} с ролью «${args.roleLabel}». Откройте ссылку на iPhone:\n${args.url}`;
}

/** Роль, с которой открыть компанию сразу после приёма приглашения.
 *
 *  Без роли первый кадр новой компании — полноэкранная граница прав и
 *  крутилка, пока `current_user_role` летит на сервер (этап 0(ж) плана
 *  доступа). Поэтому роль спрашивается ДО перехода, под заголовком новой
 *  компании, и засевается переходом.
 *
 *  Порядок доверия: ответ сервера → роль из самого приглашения (то же значение,
 *  которое `accept_invitation` записал в членство) → ничего. Ответ сервера
 *  `null` значит «не состоит в компании» — такую роль не засеваем вовсе:
 *  пусть экран спросит сам. `undefined` — сервер не ответил (сеть, таймаут). */
export function seededInvitationRole(
  serverRole: unknown,
  previewRole: unknown,
): UserRole | undefined {
  if (serverRole === "owner" || serverRole === "dispatcher" || serverRole === "master") {
    return serverRole;
  }
  if (serverRole === null) return undefined;
  return isInvitableRole(previewRole) ? previewRole : undefined;
}
