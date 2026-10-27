import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import type { AccountMove } from "./past-minus";

/** Движения счёта позже дня `date` — только владельцу: остаток счёта считает
 *  сервер по всем строкам, а партнёру часть строк не видна (окно, чужие
 *  стороны денег), и разница с ними выдумала бы минус. */
export function useMovesAfter(accountId: string | null, date: string, enabled: boolean) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["finances", tenantId, "account-moves-after", accountId, date],
    enabled: enabled && !!tenantId && !!accountId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_transactions")
        .select("occurred_on, type, amount")
        .eq("tenant_id", tenantId as string)
        .eq("account_id", accountId as string)
        .gt("occurred_on", date);
      if (error) throw new Error(error.message);
      return (data ?? []) as AccountMove[];
    },
  });
}
