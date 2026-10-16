import { useQuery } from "@tanstack/react-query";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

/**
 * Вторая нога перевода — id её счёта. Ленты грузят срез периода/счёта, и
 * парной строки в пропсах может не оказаться вовсе (карточка кассы видит
 * только свои операции), поэтому попап спрашивает её у леджера сам. Пара по
 * инварианту БД ровно из двух строк — первого совпадения достаточно.
 */
export function useTransferCounterpartAccountId(tx: FinanceTransaction | null) {
  const tenantId = useTenantId();
  const leg =
    tx && tx.type === "transfer" && tx.transfer_group_id
      ? { id: tx.id, groupId: tx.transfer_group_id }
      : null;
  return useQuery({
    queryKey: ["transfer-counterpart", tenantId, leg?.id],
    enabled: !!tenantId && !!leg,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("finance_transactions")
        .select("account_id")
        .eq("tenant_id", tenantId as string)
        .eq("transfer_group_id", (leg as { groupId: string }).groupId)
        .neq("id", (leg as { id: string }).id)
        .limit(1);
      if (error) throw new Error(error.message);
      return data?.[0]?.account_id ?? null;
    },
  });
}
