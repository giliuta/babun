import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { parseCalendarTariffs, tierAllows, type TierFeature } from "@/session/tiers";

// ТАРИФ КАЖДОГО КАЛЕНДАРЯ — `calendar_tariffs()`: тариф каждого календаря
// открытого аккаунта, который человек видит (владелец — все, партнёр —
// свои); срок, период и отмену — владельцу и партнёру с правом «Тариф».
// Календарь всегда живёт в открытом аккаунте: тариф читается тем же
// клиентом, что календарь. Ключ — под «tenant»: оплата и возврат из
// браузера перечитывают его вместе с профилем.

/** Дверь `calendar_tariffs` — до наката её нет в типах базы. */
type CalendarTariffsRpc = {
  rpc: (name: "calendar_tariffs") => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export function useCalendarTariffs() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["tenant", tenantId, "calendar-tariffs"],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as CalendarTariffsRpc).rpc("calendar_tariffs");
      if (error) throw new Error(error.message || "calendar_tariffs");
      return parseCalendarTariffs(data);
    },
  });
}

/** Разрешает ли ТАРИФ КАЛЕНДАРЯ это действие. Календаря нет в ответе или
 *  ответ не пришёл — `null`: решает тариф аккаунта у вызывающего, а
 *  настоящий замок стоит на сервере. */
export function useCalendarPlanAllows(teamId: string | null | undefined, capability: TierFeature): boolean | null {
  const tariffs = useCalendarTariffs();
  const row = teamId ? tariffs.data?.get(teamId) : undefined;
  return row ? tierAllows(row.plan, capability) : null;
}
