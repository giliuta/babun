import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";

import { useMirror } from "@/features/access/mirror/mirror-state";
import { listAppointmentsPaged } from "@/features/calendar/queries";
import { masterAppointmentJsonToAppointment } from "@/features/calendar/master-appointment-mapper";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import type { supabase } from "@/lib/supabase";

import { viewKeyOf, type ClientsScope } from "./clients-company";
import { mirrorHistory } from "./member-history";

// ИСТОРИЯ ЗАПИСЕЙ КЛИЕНТОВ У СОТРУДНИКА — ДВЕРЬЮ СЕРВЕРА (`member-history.ts`).
// Ключ с головой `member-client-history`: в «его глазами» выход его стирает
// (`mirror-cache.ts`), чужие записи владельца на устройстве не остаются.

type RpcWithHistory = {
  rpc: (
    name: "member_client_history",
    args?: { p_client?: string },
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/** Записи клиентов с открытой «Историей записей» (все или одного). */
export async function listMemberClientHistory(
  client: typeof supabase,
  clientId?: string,
): Promise<Appointment[]> {
  const rpc = client as unknown as RpcWithHistory;
  const { data, error } = await rpc.rpc(
    "member_client_history",
    clientId ? { p_client: clientId } : undefined,
  );
  if (error) throw new Error(`memberClientHistory: ${error.message}`);
  return ((data as unknown[] | null) ?? []).map((row) =>
    masterAppointmentJsonToAppointment(row as Parameters<typeof masterAppointmentJsonToAppointment>[0]),
  );
}

export const memberHistoryQueryKey = (tenantId: string, view: string, mirrored: boolean) =>
  ["member-client-history", tenantId, view, mirrored ? "mirror" : "own"] as const;

/** История сотрудника в компании `scope` (только у вида «сотрудник»).
 *  В «его глазами» читает токен владельца — поэтому маска считается здесь
 *  по блокам строк `clients` (те же, что уже прошли маску зеркала). */
export function useMemberClientHistory(
  scope: ClientsScope | null | undefined,
  clients: readonly Client[] | undefined,
): Appointment[] {
  const mirror = useMirror();
  const mirrored = mirror !== null;
  // Команды, где у него открыта «История», — для положения «Своя команда».
  const ownTeamsKey = mirror
    ? Object.entries(mirror.map.calendars)
        .filter(([, levels]) => levels["clients.history"] === "read" || levels["clients.history"] === "write")
        .map(([teamId]) => teamId)
        .sort()
        .join(",")
    : "";
  const member = scope?.kind === "member";
  const query = useQuery({
    queryKey: memberHistoryQueryKey(scope?.tenantId ?? "", scope ? viewKeyOf(scope) : "", mirrored),
    enabled: member && !!scope?.tenantId,
    staleTime: 60_000,
    queryFn: () =>
      mirrored
        ? listAppointmentsPaged(scope?.tenantId as string)
        : listMemberClientHistory(tenantBoundClient(scope?.tenantId as string)),
  });
  return useMemo(() => {
    if (!member || !query.data) return [];
    if (!mirrored) return query.data;
    return mirrorHistory(
      query.data,
      new Map((clients ?? []).map((client) => [client.id, client])),
      new Set(ownTeamsKey ? ownTeamsKey.split(",") : []),
    );
  }, [member, mirrored, query.data, clients, ownTeamsKey]);
}
