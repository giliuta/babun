import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";
import { switchTenant } from "./switch-tenant";

// КАЛЕНДАРИ ЧЕЛОВЕКА ВО ВСЕХ ЕГО КОМПАНИЯХ.
//
// Владелец 2026-09-12: «устроился к кому-то — ему добавляют календарь
// компании, и у него два календаря: свой и рабочий».
//
// Прочитать это обычным запросом нельзя: `tenants` отдаёт строку компании
// только владельцу и только для АКТИВНОЙ компании, а свои членства человек
// видит без названий. Поэтому безопасная функция `list_my_calendars()` —
// всё от `auth.uid()`, наружу только имя компании, имя и цвет календаря,
// роль и права.

export interface MyCalendar {
  tenantId: string;
  tenantName: string;
  teamId: string;
  teamName: string;
  teamColor: string | null;
  role: string;
  grants: string[];
  /** Календарь активной компании — открывается без переключения. */
  isActive: boolean;
}

interface MyCalendarRow {
  tenant_id: string;
  tenant_name: string;
  team_id: string;
  team_name: string;
  team_color: string | null;
  role: string;
  grants: string[] | null;
  is_active: boolean;
}

/** Сгенерированный `database.types.ts` отстаёт от базы и этой функции ещё не
 *  знает. Узкий тип вместо `any`: канон запрещает `any`, а делать вид, что
 *  функции нет, нельзя. Уйдёт, когда типы перегенерируют. */
type RpcWithMyCalendars = {
  rpc: (name: "list_my_calendars") => PromiseLike<{
    data: MyCalendarRow[] | null;
    error: { message: string } | null;
  }>;
};

function toCalendar(row: MyCalendarRow): MyCalendar {
  return {
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    teamId: row.team_id,
    teamName: row.team_name,
    teamColor: row.team_color,
    role: row.role,
    grants: row.grants ?? [],
    isActive: row.is_active,
  };
}

export const myCalendarsQueryKey = ["my-calendars"] as const;

export function useMyCalendars() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useQuery({
    // Ключ НЕ содержит активную компанию: список один и тот же по обе стороны
    // перехода, и переспрашивать его на каждом переключении незачем. Зато
    // содержит человека — чужой список после смены аккаунта не показывается.
    queryKey: [...myCalendarsQueryKey, userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<MyCalendar[]> => {
      const client = supabase as unknown as RpcWithMyCalendars;
      const { data, error } = await client.rpc("list_my_calendars");
      if (error) throw new Error(error.message);
      return (data ?? []).map(toCalendar);
    },
  });
}

/** В скольких компаниях человек состоит. Переключателю нечего показывать,
 *  пока она одна, — и он не показывается: пустой орган хуже отсутствующего. */
export function workspaceCount(calendars: MyCalendar[]): number {
  return new Set(calendars.map((c) => c.tenantId)).size;
}

export function useSwitchWorkspace() {
  return useMutation({
    networkMode: "always",
    mutationFn: (tenantId: string) => switchTenant(tenantId),
  });
}
