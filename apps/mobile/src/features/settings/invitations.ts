import { useQuery } from "@tanstack/react-query";
import type { Json } from "@babun/shared/db/database.types";
import { supabase } from "@/lib/supabase";
import { switchTenant } from "./switch-tenant";
import {
  clearPendingInvitationToken,
  getPendingInvitationToken,
  pendingInvitationQueryKey,
} from "./pending-invitation";
import {
  invitationErrorMessage,
  isInvitableRole,
  isInvitationToken,
  type InvitationState,
  type InvitableRole,
} from "./invitation-flow";

export interface InvitationPreview {
  tenantName: string;
  /** Календарь, в который зовут. `null` — приглашение старой формы, без
   *  календаря: человек войдёт по роли. Показываем ровно то, что приглашение
   *  на самом деле даёт: назвать одну компанию, когда права выдаются на один
   *  её календарь, значит пообещать больше, чем будет. */
  teamName: string | null;
  role: InvitableRole;
  emailHint: string;
  expiresAt: string;
  state: InvitationState;
}

function record(value: Json | null): Record<string, Json | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Сервер вернул некорректное приглашение");
  }
  return value as Record<string, Json | undefined>;
}

function parsePreview(value: Json | null): InvitationPreview {
  const row = record(value);
  if (
    typeof row.tenant_name !== "string" ||
    !isInvitableRole(row.role) ||
    typeof row.email_hint !== "string" ||
    typeof row.expires_at !== "string" ||
    (row.state !== "active" &&
      row.state !== "expired" &&
      row.state !== "accepted")
  ) {
    throw new Error("Сервер вернул некорректное приглашение");
  }
  return {
    tenantName: row.tenant_name,
    teamName: typeof row.team_name === "string" ? row.team_name : null,
    role: row.role,
    emailHint: row.email_hint,
    expiresAt: row.expires_at,
    state: row.state,
  };
}

export function usePendingInvitationToken() {
  return useQuery({
    queryKey: pendingInvitationQueryKey,
    queryFn: getPendingInvitationToken,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useInvitationPreview(token: string | null) {
  return useQuery({
    queryKey: ["invitation-preview", token],
    enabled: !!token,
    retry: 1,
    queryFn: async (): Promise<InvitationPreview> => {
      if (!isInvitationToken(token)) throw new Error("Некорректная ссылка");
      const { data, error } = await supabase.rpc("invitation_preview", {
        p_token: token,
      });
      if (error) throw new Error(invitationErrorMessage(error.message));
      if (data == null) {
        throw new Error("Приглашение не найдено или ссылка повреждена.");
      }
      return parsePreview(data);
    },
  });
}

/** Accept membership, switch the JWT-bound active tenant, and erase every
 * previous-tenant cache before navigation can expose the new workspace. */
export async function acceptAndActivateInvitation(
  token: string,
): Promise<string> {
  if (!isInvitationToken(token)) throw new Error("Некорректная ссылка");

  const { data: tenantId, error: acceptError } = await supabase.rpc(
    "accept_invitation",
    { p_token: token },
  );
  if (acceptError || !tenantId) {
    throw new Error(
      invitationErrorMessage(acceptError?.message ?? "Приглашение не найдено"),
    );
  }

  // Само переключение — общая транзакция `switchTenant`: её же зовёт
  // переключатель контуров. Приём приглашения от обычного перехода отличается
  // ровно одним — до него надо принять приглашение, после него погасить
  // сохранённый токен. Держать здесь вторую копию шагов значило бы завести
  // второй способ менять компанию, и они разошлись бы на первой же правке.
  //
  // `onboarded: true` — ФАКТ, а не догадка, и его знает сама эта строка:
  // `accept_invitation` отказывает, пока у компании пуст `onboarded_at`
  // («finish company setup before inviting employees»). Значит приглашение
  // ПРИНЯТО ⟹ компания настроена.
  //
  // Без этого человек, впервые входящий в чужую компанию, видел бы гейт
  // «Открываем компанию»: факт онбординга приезжает с догоняющим claim'ом, а
  // тот ушёл в фон ради мгновенного перехода — то есть к первому кадру ответа
  // ещё нет. Ленте контуров факт приходит заранее из `list_my_calendars`; у
  // приглашения такой ленты ещё нет вовсе, оно первое.
  await switchTenant(tenantId, { onboarded: true });
  await clearPendingInvitationToken(token);
  return tenantId;
}
