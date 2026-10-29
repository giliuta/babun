import { useQuery } from "@tanstack/react-query";
import { useAccountScope } from "@/session/account-scope";
import {
  calendarHasWork,
  paidCalendarCount,
  paidFromSummary,
  type CalendarWorkRow,
  type WorkClient,
  type WorkQuery,
} from "@/session/calendar-price";

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
//
// ОДИН ВЫЗОВ, А НЕ ТРИ НА КОМАНДУ. Сервер отвечает сводкой
// `calendar_work_summary` под RLS того же клиента — то же число, что давали
// запросы `limit(1)` по каждой команде и таблице (у шести команд — до 18 на
// круг). Пока функции на сервере нет (`PGRST202` / `42883`), считаем прежним
// путём.

const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);

type SummaryRpc = {
  rpc: (
    name: "calendar_work_summary",
    args: { p_tenant: string },
  ) => PromiseLike<{ data: CalendarWorkRow[] | null; error: { message: string; code?: string } | null }>;
};

export function useLiveCalendarCount(): number | undefined {
  const scope = useAccountScope();
  const query = useQuery({
    queryKey: ["teams", "live-count", scope.tenantId, scope.role],
    enabled: !!scope.tenantId,
    queryFn: async () => {
      const tenantId = scope.tenantId as string;
      const summary = await (scope.client as unknown as SummaryRpc).rpc("calendar_work_summary", {
        p_tenant: tenantId,
      });
      if (!summary.error) return paidFromSummary(summary.data ?? []);
      if (!summary.error.code || !MISSING_FUNCTION.has(summary.error.code)) {
        throw new Error(summary.error.message);
      }
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
