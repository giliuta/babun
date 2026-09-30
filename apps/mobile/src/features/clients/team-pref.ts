import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { readTenantPref, writeTenantPref } from "@/lib/tenant-prefs";
import { ALL_TEAMS, type ClientsTeamChoice } from "./team-scope";

// Выбранный чип ленты команд «Клиентов» помнится ПО КОМПАНИИ и на устройстве
// (как вид календаря): у каждой компании свои команды, и чип одной фирмы не
// должен всплывать в другой.

const BASE = "clients.team";

const key = (tenantId: string | null) => ["clients-team", tenantId] as const;

export function useClientsTeam(tenantId: string | null) {
  return useQuery({
    queryKey: key(tenantId),
    enabled: !!tenantId,
    queryFn: (): ClientsTeamChoice =>
      readTenantPref<string>(BASE, tenantId as string) ?? ALL_TEAMS,
    staleTime: Infinity,
  });
}

export function useSetClientsTeam(tenantId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    // Запись локальная (MMKV) — не ждёт сети.
    networkMode: "always",
    mutationFn: async (choice: ClientsTeamChoice) => {
      if (tenantId) writeTenantPref(BASE, tenantId, choice);
      return choice;
    },
    onMutate: (choice) => qc.setQueryData(key(tenantId), choice),
  });
}
