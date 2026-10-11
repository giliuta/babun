import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { evictCompanyFromDevice } from "@/lib/evict-company";
import { myCalendarsQueryKey } from "@/features/settings/my-calendars-key";
import { switchTenant } from "@/features/settings/switch-tenant";
import { createdCompanyFrom, type CreatedCompany } from "./created-company";

// КОМПАНИЯ: ЗАВЕСТИ, ВЫЙТИ, ПЕРЕДАТЬ (владелец 11.10, PLAN-COMPANIES).
//
// Истина — на сервере: `create_company` (владелец, первый календарь с именем
// компании, 14 дней Про, если пробный для компании ещё не брали),
// `leave_company` (партнёр выходит целиком, владелец — нет),
// `transfer_company_ownership` (прежний владелец остаётся партнёром со всеми
// правами). Здесь — вызов и что после него обновить на телефоне.

type Rpc = {
  rpc: (
    name: "create_company" | "leave_company" | "transfer_company_ownership",
    args: Record<string, string>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
const rpc = supabase as unknown as Rpc;

/** Аккаунты человека поменялись: лента, переключатель, членства. */
function refreshAccounts(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["my-accounts"] });
  void qc.invalidateQueries({ queryKey: ["my-memberships"] });
  void qc.invalidateQueries({ queryKey: myCalendarsQueryKey });
}

export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({
    // Без сети — отказ сразу, а не отложенное создание (как у календаря).
    networkMode: "always",
    mutationFn: async (name: string): Promise<CreatedCompany> => {
      const { data, error } = await rpc.rpc("create_company", { p_name: name });
      if (error) throw new Error(error.message);
      const created = createdCompanyFrom(data);
      // Телефон сразу в новой компании, на её первом календаре.
      await switchTenant(created.tenantId, {
        onboarded: true,
        role: "owner",
        viewTeamId: created.teamId,
      });
      return created;
    },
    onSettled: () => refreshAccounts(qc),
    meta: { errorHandled: true },
  });
}

export function useLeaveCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tenantId: string) => {
      const { error } = await rpc.rpc("leave_company", { p_tenant: tenantId });
      if (error) throw new Error(error.message);
      // Компания уходит с телефона тем же путём, что при удалении владельцем.
      await evictCompanyFromDevice(tenantId, { fresh: true });
    },
    onSuccess: () => void qc.invalidateQueries(),
    meta: { errorHandled: true },
  });
}

export function useTransferOwnership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { tenantId: string; userId: string }) => {
      const { error } = await rpc.rpc("transfer_company_ownership", {
        p_tenant: input.tenantId,
        p_user: input.userId,
      });
      if (error) throw new Error(error.message);
    },
    // Роль на телефоне сменилась целиком: права, страницы, лента — заново.
    onSuccess: () => void qc.invalidateQueries(),
    meta: { errorHandled: true },
  });
}
