import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

import type { PayoutLike } from "./partner-facts";

// ВЫПЛАТЫ ПАРТНЁРУ — расходы, где его карточка стоит в «Кому» (`master_id`,
// категория с флажком «Кому»). Ключ под `["transactions", компания]`:
// запись, правка и удаление операции (`invalidateLedger`) сбрасывают и его.
// Видно ровно то, что отдаёт политика журнала тому, кто смотрит.

export interface PartnerPayout extends PayoutLike {
  id: string;
  category_id: string | null;
  account_id: string | null;
  team_id: string | null;
  notes: string | null;
}

const LIMIT = 500;

export function usePartnerPayouts(masterId: string | null | undefined) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["transactions", tenantId, "payouts", masterId ?? null],
    enabled: !!tenantId && !!masterId,
    queryFn: async (): Promise<PartnerPayout[]> => {
      const { data, error } = await supabase
        .from("finance_transactions")
        .select("id, type, amount, occurred_on, created_at, category_id, account_id, team_id, notes")
        .eq("tenant_id", tenantId as string)
        .eq("master_id", masterId as string)
        .eq("type", "expense")
        .order("created_at", { ascending: false })
        .limit(LIMIT);
      if (error) throw new Error(error.message);
      return (data ?? []) as PartnerPayout[];
    },
  });
}
