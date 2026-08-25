import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Database, Json } from "@babun/shared/db/database.types";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useSession } from "@/providers/SessionProvider";
import {
  isInvitableRole,
  normalizeInvitationEmail,
  type InvitableRole,
} from "./invitation-flow";
import { isUserRole, type UserRole } from "./role-policy";

type MemberRow = Database["public"]["Tables"]["tenant_members"]["Row"];
type InvitationRow = Database["public"]["Tables"]["invitations"]["Row"];

export type TenantMember = Omit<MemberRow, "role"> & {
  role: UserRole;
  master_id: string | null;
};

export interface CreatedInvitation {
  id: string;
  tenant_id: string;
  email: string;
  role: InvitableRole;
  master_id: string | null;
  token: string;
  expires_at: string;
  created_at: string;
}

function parseCreatedInvitation(value: Json | null): CreatedInvitation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Сервер вернул некорректное приглашение");
  }
  const row = value as Record<string, Json | undefined>;
  if (
    typeof row.id !== "string" ||
    typeof row.tenant_id !== "string" ||
    typeof row.email !== "string" ||
    !isInvitableRole(row.role) ||
    !(row.master_id === null || typeof row.master_id === "string") ||
    typeof row.token !== "string" ||
    typeof row.expires_at !== "string" ||
    typeof row.created_at !== "string"
  ) {
    throw new Error("Сервер вернул некорректное приглашение");
  }
  return row as unknown as CreatedInvitation;
}

function requireRole(value: unknown): UserRole {
  if (!isUserRole(value)) throw new Error("Неизвестная роль сотрудника");
  return value;
}

async function requireOwner(): Promise<void> {
  const { data, error } = await supabase.rpc("current_user_role");
  if (error) throw new Error(error.message);
  if (data !== "owner") {
    throw new Error("Управлять доступом может только владелец.");
  }
}

export function useTenantMembers() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["tenant-members", tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<TenantMember[]> => {
      const { data, error } = await supabase
        .from("tenant_members")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("joined_at");
      if (error) throw new Error(error.message);
      return data.map((row) => ({
        ...row,
        role: requireRole(row.role),
        master_id: typeof row.master_id === "string" ? row.master_id : null,
      }));
    },
  });
}

export function usePendingInvitations() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["tenant-invitations", tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<InvitationRow[]> => {
      const { data, error } = await supabase
        .from("invitations")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .is("accepted_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useCreateInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      email,
      role,
      masterId,
    }: {
      email: string;
      role: InvitableRole;
      masterId: string | null;
    }): Promise<CreatedInvitation> => {
      await requireOwner();
      if (role === "master" && !masterId) {
        throw new Error("Для мастера выберите карточку сотрудника.");
      }
      const { data, error } = await supabase.rpc("create_invitation", {
        p_email: normalizeInvitationEmail(email),
        p_role: role,
        ...(role === "master" && masterId ? { p_master_id: masterId } : {}),
      });
      if (error) throw new Error(error.message);
      return parseCreatedInvitation(data);
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["tenant-invitations"] }),
    meta: { errorHandled: true },
  });
}

export function useUpdateTenantMember() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      userId,
      role,
      masterId,
    }: {
      userId: string;
      role: UserRole;
      masterId: string | null;
    }) => {
      if (!tenantId) throw new Error("Нет активной компании");
      await requireOwner();
      const { data, error } = await supabase
        .from("tenant_members")
        .update({ role, master_id: masterId })
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .select("user_id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Сотрудник не найден или доступ запрещён");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tenant-members"] });
      void qc.invalidateQueries({ queryKey: ["current-role"] });
    },
    meta: { errorHandled: true },
  });
}

export function useRemoveTenantMember() {
  const tenantId = useTenantId();
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      if (!tenantId) throw new Error("Нет активной компании");
      if (session?.user.id === userId) {
        throw new Error("Свой доступ нельзя удалить с этого экрана.");
      }
      await requireOwner();
      const { data, error } = await supabase
        .from("tenant_members")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .select("user_id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Сотрудник не найден или доступ запрещён");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tenant-members"] }),
    meta: { errorHandled: true },
  });
}

export function useRevokeInvitation() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!tenantId) throw new Error("Нет активной компании");
      await requireOwner();
      const { data, error } = await supabase
        .from("invitations")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Приглашение не найдено или доступ запрещён");
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["tenant-invitations"] }),
    meta: { errorHandled: true },
  });
}
