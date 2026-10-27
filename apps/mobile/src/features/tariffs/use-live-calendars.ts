import { useQuery } from "@tanstack/react-query";
import { useAccountScope } from "@/session/account-scope";
import { calendarHasWork, paidCalendarCount, type WorkClient, type WorkQuery } from "@/session/calendar-price";

// СКОЛЬКО КАЛЕНДАРЕЙ АККАУНТА СТРАНИЦЫ «ТАРИФ» ПЛАТЯТ. Платит живой
// календарь, в котором есть работа (запись, операция финансов или SMS), —
// правило `CALENDAR_WORK_SOURCES` в `session/calendar-price.ts`, то же, что у
// сервера (`paid_calendar_count`). Кнопка называет сумму, и она обязана
// совпасть с тем, что спишет Stripe.
//
// Аккаунт — страницы, а не открытого в календаре: владелец, открывший «Тариф»
// своего аккаунта при чужом календаре, видел бы число и цену чужого.
//
// Считаем клиентом аккаунта страницы: владельцу RLS отдаёт все календари,
// записи, операции и SMS. Партнёр видит только своё — его число может быть
// меньше серверного; точный счёт для партнёра — дело сервера.
// Ключ начинается с "teams": заведение и архив календаря его сбрасывают.
export function useLiveCalendarCount(): number | undefined {
  const scope = useAccountScope();
  const query = useQuery({
    queryKey: ["teams", "live-count", scope.tenantId, scope.role],
    enabled: !!scope.tenantId,
    queryFn: async () => {
      const tenantId = scope.tenantId as string;
      const { data: teams, error } = await scope.client
        .from("teams")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("is_active", true);
      if (error) throw new Error(error.message);
      const ids = (teams ?? []).map((team) => team.id);
      // Узкий вид клиента для правила: `select → eq → limit` по трём таблицам
      // из `CALENDAR_WORK_SOURCES`. Типизированный построитель Supabase
      // параметризован схемой и интерфейсу прямо не присваивается, хотя
      // делает ровно эти вызовы; переходник — на одно место.
      const work: WorkClient = { from: (table) => scope.client.from(table) as unknown as WorkQuery };
      const withWork = new Set<string>();
      await Promise.all(
        ids.map(async (teamId) => {
          if (await calendarHasWork(work, tenantId, teamId)) withWork.add(teamId);
        }),
      );
      return paidCalendarCount(ids, withWork);
    },
  });
  return query.data;
}
