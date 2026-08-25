import { useQuery } from "@tanstack/react-query";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

// Чеки только ЧИТАЮТСЯ приложением: выписывает их сервер в тот же миг, что
// проводит деньги. Клиентская запись здесь была бы дырой — два телефона
// офлайн выдали бы один и тот же номер документа.

export function useReceipts(filter?: {
  clientId?: string | null;
  appointmentId?: string | null;
}) {
  const tenantId = useTenantId();
  const clientId = filter?.clientId ?? null;
  const appointmentId = filter?.appointmentId ?? null;
  return useQuery({
    queryKey: ["receipts", tenantId, clientId, appointmentId],
    enabled: !!tenantId,
    queryFn: async (): Promise<Receipt[]> => {
      let q = supabase
        .from("receipts")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("year", { ascending: false })
        .order("seq", { ascending: false });
      if (clientId) q = q.eq("client_id", clientId);
      if (appointmentId) q = q.eq("appointment_id", appointmentId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Receipt[];
    },
  });
}
