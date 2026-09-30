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
  // Отказы про календарь — раньше общих «истёк» и «не найдено»: строка
  // `calendar not found or archived` иначе читалась как «приглашение не
  // найдено», а на экране создания это неправда.
  if (/invitation calendar is archived/i.test(message)) {
    return "Календарь приглашения в архиве — попросите новое приглашение.";
  }
  if (/calendar not found or archived/i.test(message)) {
    return "Этот календарь в архиве — пригласить в него нельзя.";
  }
  if (/master invitation requires a calendar/i.test(message)) {
    return "Выберите календарь, в который зовёте мастера.";
  }
  if (/finish company setup|company setup is incomplete/i.test(message)) {
    return "Сначала завершите настройку компании, затем пригласите сотрудника.";
  }
  // Принять приглашение можно только с подтверждённой почтой (миграция
  // 20260924120000): иначе его забрал бы любой, кто занял адрес сотрудника.
  if (/invite:email_not_confirmed/i.test(message)) {
    return "Подтвердите почту — письмо пришло при регистрации — и примите приглашение снова.";
  }
  if (/already has access/i.test(message)) {
    return "У этого аккаунта уже есть доступ к компании.";
  }
  if (/invalid invitation email/i.test(message)) {
    return "Проверьте адрес электронной почты.";
  }
  if (/invalid invitation phone/i.test(message)) {
    return "Проверьте номер телефона — введите его с кодом страны.";
  }
  if (/invitation name is too long/i.test(message)) {
    return "Имя слишком длинное — оставьте до 120 символов.";
  }
  // Карточка мастера в приглашении (миграция 20260915110000): должность, цвет
  // и права проверяет сервер, и отказ называется словами поля, а не строкой
  // базы.
  if (/invitation job title is too long/i.test(message)) {
    return "Должность слишком длинная — оставьте до 120 символов.";
  }
  if (/invalid invitation colou?r/i.test(message)) {
    return "Этот цвет не подходит — выберите другой.";
  }
  // Должность и цвет приглашения по существующей карточке сервер не хранит:
  // они правятся в самой карточке (`invite:card_fields_on_card`).
  if (/belong to the linked employee card/i.test(message)) {
    return "Должность и цвет меняются в карточке сотрудника.";
  }
  // Отказы общей проверки прав (`access_validate_changes`) приходят русской
  // строкой базы. Архив там не проверяется — его раньше отказывает
  // `calendar not found or archived`; «не из этой компании» значит, что
  // календаря больше нет, а карточка открыта со старым списком.
  if (/календарь не из этой компании/i.test(message)) {
    return "Этого календаря больше нет — откройте карточку ещё раз.";
  }
  if (/не прикреплён к календарю/i.test(message)) {
    return "Права календаря ставятся только в календарях мастера.";
  }
  if (/выдаётся только владельцу/i.test(message)) {
    return "Этот раздел прав есть только у владельца.";
  }
  if (
    /неизвестный блок|нет положения|назван дважды|действует на всю компанию|изменени[ея] —/i.test(
      message,
    )
  ) {
    return "Права не сохранились — откройте карточку ещё раз.";
  }
  if (/must be signed in/i.test(message)) {
    return "Войдите в аккаунт и попробуйте ещё раз.";
  }
  if (/only an owner can update invitations/i.test(message)) {
    return "Менять приглашения может только владелец.";
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

/** Отказ приглашения при регистрации по ссылке — словами, а не «не удалось
 *  создать аккаунт». Приглашение проводит триггер базы, а GoTrue любую ошибку
 *  триггера отдаёт одной строкой «Database error saving new user». С токеном
 *  приглашения в регистрации это отказ приглашения: истекло, уже принято,
 *  другой email, календарь в архиве. `null` — ошибка не из этой беды. */
export function invitationSignupErrorMessage(
  message: string | undefined,
): string | null {
  return /database error saving new user/i.test(message ?? "")
    ? "Приглашение больше не действует — попросите владельца отправить новое."
    : null;
}

export function invitationShareText(args: {
  tenantName?: string | null;
  url: string;
}): string {
  const company = args.tenantName?.trim()
    ? ` в «${args.tenantName.trim()}»`
    : " в Babun CRM";
  // Роль не называем (владелец 15.09: «роль уберём, она в целом нам не нужна»).
  return `Вас пригласили${company}. Откройте ссылку на iPhone:\n${args.url}`;
}

/** Сервер ответил, что приглашения по этой ссылке больше нет: не найдено,
 *  ссылка испорчена или приглашение уже принято. Это ответ, а не обрыв связи —
 *  «Повторить» его не изменит, и запомненную ссылку пора забыть. Иначе
 *  отозванное приглашение открывало бы свой экран при каждом входе
 *  (владелец 15.09: «вечная хуета открывается»). «Выписано на другой email» —
 *  не сюда: под нужным аккаунтом то же приглашение примут. */
export class InvitationGoneError extends Error {}

export function isGoneInvitationMessage(message: string): boolean {
  return /not found|invalid token|already accepted|Некорректная ссылка/i.test(message);
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
