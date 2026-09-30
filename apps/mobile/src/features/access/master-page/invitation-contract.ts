import type { AccessChange } from "../access-map";
import {
  invitationErrorMessage,
  normalizeInvitationEmail,
} from "../../settings/invitation-flow";
import type { MasterInvitationRequest } from "./master-draft";

// ПРИГЛАШЕНИЕ С КАРТОЧКОЙ — КОНТРАКТ С СЕРВЕРОМ БЕЗ СЕТИ (миграция
// 20260915110000). Лист без React: какие аргументы уходят в
// `create_invitation` и `update_invitation`, что лежит в ответе и какой отказ
// касается почты, проверяется тестом. Сгенерированные типы базы о новых
// аргументах ещё не знают, поэтому имена сверяет тест с самой миграцией:
// опечатка в имени аргумента всплыла бы только на устройстве отказом
// «функция не найдена».

export interface CreateInvitationArgs {
  p_email: string;
  p_role: "master";
  p_team_id: string | null;
  p_team_ids: string[];
  p_full_name: string | null;
  p_phone: string | null;
  p_master_title: string | null;
  p_master_color: string | null;
  p_access: AccessChange[];
  /** Карточка мастера без аккаунта, по которой зовут (STORY-087). */
  p_master_id?: string;
}

export interface UpdateInvitationArgs {
  p_invitation_id: string;
  p_full_name: string | null;
  p_phone: string | null;
  p_team_ids: string[];
  p_master_title: string | null;
  p_master_color: string | null;
  p_access: AccessChange[];
}

export function createInvitationArgs(request: MasterInvitationRequest): CreateInvitationArgs {
  return {
    p_email: normalizeInvitationEmail(request.email),
    p_role: "master",
    // Домашний — первый выбранный: сервер кладёт его в `team_id`, и по нему
    // приглашение видят прежние читатели (список «Мастера», входящие).
    p_team_id: request.teamIds[0] ?? null,
    p_team_ids: request.teamIds,
    p_full_name: request.fullName || null,
    p_phone: request.phone,
    p_master_title: request.title,
    p_master_color: request.color,
    p_access: request.access,
    // ПО СУЩЕСТВУЮЩЕЙ КАРТОЧКЕ: сервер привяжет аккаунт к ней, а должность и
    // цвет не примет — они живут в самой карточке.
    ...(request.masterId
      ? { p_master_id: request.masterId, p_master_title: null, p_master_color: null }
      : {}),
  };
}

/** Правка открытого приглашения — те же поля, кроме почты: приглашение
 *  выписано на адрес, и сменить его значит позвать другого человека. */
export function updateInvitationArgs(
  invitationId: string,
  request: MasterInvitationRequest,
): UpdateInvitationArgs {
  return {
    p_invitation_id: invitationId,
    p_full_name: request.fullName || null,
    p_phone: request.phone,
    p_team_ids: request.teamIds,
    p_master_title: request.title,
    p_master_color: request.color,
    p_access: request.access,
  };
}

/** Поля строки `invitations`, которые меняет правка карточки, — в той форме,
 *  в какой их вернёт сервер. Ложатся в кэш «Ждут ответа» до ответа сервера,
 *  чтобы карточка и страница прав показали правку сразу. */
export function invitationRowPatch(request: MasterInvitationRequest): Record<string, unknown> {
  return {
    team_id: request.teamIds[0] ?? null,
    team_ids: request.teamIds.length > 0 ? request.teamIds : null,
    full_name: request.fullName || null,
    phone: request.phone,
    master_title: request.title,
    master_color: request.color,
    access_changes: request.access,
  };
}

export interface SavedMasterInvitation {
  id: string;
  tenant_id: string;
  email: string;
  role: "master" | "dispatcher";
  master_id: string | null;
  token: string;
  expires_at: string;
  created_at: string;
}

const BAD_INVITATION = "Сервер вернул некорректное приглашение";

/** Ответ `create_invitation` / `update_invitation` (jsonb) — те же проверки,
 *  что у прежнего приглашения из шторки: без номера и токена карточке нечего
 *  открыть и нечем поделиться. */
export function parseSavedInvitation(value: unknown): SavedMasterInvitation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(BAD_INVITATION);
  }
  const row = value as Record<string, unknown>;
  const { id, tenant_id, email, role, master_id, token, expires_at, created_at } = row;
  if (
    typeof id !== "string" ||
    typeof tenant_id !== "string" ||
    typeof email !== "string" ||
    (role !== "master" && role !== "dispatcher") ||
    !(master_id === null || master_id === undefined || typeof master_id === "string") ||
    typeof token !== "string" ||
    typeof expires_at !== "string" ||
    typeof created_at !== "string"
  ) {
    throw new Error(BAD_INVITATION);
  }
  return {
    id,
    tenant_id,
    email,
    role,
    master_id: master_id ?? null,
    token,
    expires_at,
    created_at,
  };
}

/** Отказ сервера с `hint`: по нему карточка отличает «приглашения больше нет»
 *  от ошибки в поле. */
export class MasterInvitationError extends Error {
  readonly hint: string | null;
  readonly code: string | null;

  constructor(error: { message: string; hint?: string | null; code?: string | null }) {
    super(error.message);
    this.hint = error.hint || null;
    this.code = error.code || null;
  }
}

/** Отказ приглашения словами. Сначала `hint` сервера — он не зависит от
 *  языка и формулировки строки базы; строка — запасной путь для отказов без
 *  `hint` и для проверки владельца на устройстве. `access:bad_team` сервер
 *  шлёт и про пропавший календарь, и про блок компании с календарём — оба
 *  значат карточку со старым списком, поэтому слово общее. */
export function invitationRefusalText(error: unknown): string {
  const hint = error instanceof MasterInvitationError ? error.hint : null;
  switch (hint) {
    case "invite:bad_calendar":
      return "Этот календарь в архиве — пригласить в него нельзя.";
    case "invite:needs_calendar":
      return "Выберите календарь, в который зовёте мастера.";
    case "invite:card_fields_on_card":
      return "Должность и цвет меняются в карточке сотрудника.";
    case "access:not_attached":
      return "Права календаря ставятся только в календарях мастера.";
    case "access:owner_only":
      return "Этот раздел прав есть только у владельца.";
    case "access:bad_team":
    case "access:bad_level":
    case "access:bad_block":
    case "access:bad_changes":
      return "Права не сохранились — откройте карточку ещё раз.";
  }
  return invitationErrorMessage(error instanceof Error ? error.message : "");
}

/** Отказ про почту: поле краснеет и теряет ✓, а не только звучит тостом. */
export function isEmailRefusal(message: string): boolean {
  return /invalid invitation email|already has access/i.test(message);
}

/** Приглашения больше нет — приняли, истекло или отозвали на другом
 *  устройстве: карточке нечего править, она уходит в список. */
export function isInvitationGone(error: unknown): boolean {
  return (
    error instanceof MasterInvitationError &&
    (error.hint === "invite:not_found" || error.hint === "invite:not_pending")
  );
}
