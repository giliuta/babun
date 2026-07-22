import { useQuery } from "@tanstack/react-query";
import type { Json } from "@babun/shared/db/database.types";
import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/query-client";
import { wipeTenantScopedData } from "@/lib/auth-clear";
import { pauseSyncBridgeForTenantSwitch } from "@/lib/sync-bridge";
import { pauseSyncRuntimeForTenantSwitch } from "@/lib/sync-runtime";
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

  const resumeOldBridge = pauseSyncBridgeForTenantSwitch();
  const resumeRuntime = pauseSyncRuntimeForTenantSwitch();
  let switched = false;
  try {
    // First wipe removes old offline operations before the active JWT changes.
    await wipeTenantScopedData();

    const { error: activateError } = await supabase.rpc("activate_tenant", {
      p_tenant_id: tenantId,
    });
    if (activateError) {
      throw new Error(invitationErrorMessage(activateError.message));
    }

    const { data: refreshed, error: refreshError } =
      await supabase.auth.refreshSession();
    if (refreshError || !refreshed.session) {
      throw new Error("Не удалось обновить вход. Проверьте интернет и повторите.");
    }

    const activeTenant = (
      refreshed.session.user.app_metadata as { tenant_id?: unknown }
    ).tenant_id;
    if (activeTenant !== tenantId) {
      throw new Error("Сессия не переключилась на приглашённую компанию.");
    }

    // Catch an old in-flight revalidation that may have completed after the
    // first wipe, then leave every query stale for the fresh tenant.
    await wipeTenantScopedData();
    await queryClient.invalidateQueries();
    await clearPendingInvitationToken(token);
    switched = true;
    return tenantId;
  } finally {
    if (!switched) {
      resumeRuntime();
      resumeOldBridge();
    }
    // On success SessionProvider observes TOKEN_REFRESHED and remounts both
    // sync lifetimes with the new tenant id; resuming either old-tenant
    // lifetime would be unsafe.
  }
}
