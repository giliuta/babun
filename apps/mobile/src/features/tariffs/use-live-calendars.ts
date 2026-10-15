import { useQuery } from "@tanstack/react-query";
import { useAccountScope } from "@/session/account-scope";

// СКОЛЬКО ЖИВЫХ КАЛЕНДАРЕЙ У АККАУНТА СТРАНИЦЫ «ТАРИФ» (13.10). Платят за
// каждый живой календарь, и кнопка называет сумму. Страница считала их по
// `useTeams()` — а он отвечает за аккаунт, открытый в календаре: владелец,
// открывший «Тариф» своего аккаунта при чужом календаре, видел число и цену
// чужого, а Stripe списал бы за свои (`liveCalendars` в tariff-checkout).
//
// Считаем клиентом аккаунта страницы, тем же условием, что сервер: владельцу
// RLS отдаёт все календари. Партнёр видит только свои — его число может быть
// меньше серверного; точный счёт для партнёра — дело сервера.
// Ключ начинается с "teams": заведение и архив календаря его сбрасывают.
export function useLiveCalendarCount(): number | undefined {
  const scope = useAccountScope();
  const query = useQuery({
    queryKey: ["teams", "live-count", scope.tenantId, scope.role],
    enabled: !!scope.tenantId,
    queryFn: async () => {
      const { count, error } = await scope.client
        .from("teams")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", scope.tenantId as string)
        .eq("is_active", true);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
  return query.data;
}
