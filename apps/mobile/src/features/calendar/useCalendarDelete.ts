import { useMutation, useQueryClient } from "@tanstack/react-query";
import { listAccounts } from "@babun/shared/db/repositories/accounts";
import { listInvoices } from "@babun/shared/db/repositories/invoices";
import { useUpdateTeam } from "@/features/reference/queries";
import { accountRowsQueryKey, invoicesQueryKey } from "@/lib/company-query-keys";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import {
  calendarDeleteImpact,
  type CalendarDeleteImpact,
  type CalendarWorkRow,
} from "./calendar-delete";

// УДАЛЕНИЕ КАЛЕНДАРЯ — В ДВА ШАГА: СНАЧАЛА В АРХИВ, СТЕРЕТЬ — ИЗ АРХИВА.
//
// Владелец 2026-09-21: «удаляешь — оно кидается в архив и в архиве хранится,
// потом можно удалить с архива… если хочется полностью удалить, стереть, то
// это надо сделать — удалить из архива». Поэтому три действия и ни одного
// лишнего:
//
//   · `archive` — «Удалить» в настройках календаря. Мягко (`is_active=false`):
//     календарь пропадает из ленты, пикеров и финансов, а записи остаются в
//     карточках клиентов. Обратимо.
//   · `restore` — «Вернуть» в Кабинете → «Архив».
//   · `erase`   — «Удалить навсегда» там же. Одна серверная дверь
//     (`delete_calendar`): записи, счета со всеми операциями, прайс; клиенты
//     остаются, инвойсы аннулируются. Необратимо — поэтому вопрос называет
//     цену цифрами (`measure`).

/** Сервер знает `delete_calendar` с миграции 20260921060000; в сгенерированных
 *  типах её пока нет — сужаем клиента ровно до этого вызова. */
type RpcWithDeleteCalendar = {
  rpc: (
    name: "delete_calendar",
    args: { p_team_id: string },
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export function useCalendarDelete() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const updateTeam = useUpdateTeam();

  // СБРАСЫВАЕТСЯ ВСЁ. Уход календаря в архив (и тем более стирание) меняет
  // ленту, пикеры, счета, финансы, прайс и карточки клиентов — десяток ключей
  // в пяти разделах, и забытый один показал бы призрак. Действия редкие;
  // лишний перезапрос дешевле призрака. `void`, а не `await`: ждать, пока
  // каждый экран сходит в сеть, незачем.
  const refreshEverything = () => void qc.invalidateQueries();

  const setActive = (teamId: string, isActive: boolean) =>
    updateTeam.mutateAsync({ id: teamId, patch: { is_active: isActive } });

  const archive = useMutation({
    mutationFn: (teamId: string) => setActive(teamId, false),
    onSuccess: refreshEverything,
    meta: { errorHandled: true },
  });

  const restore = useMutation({
    mutationFn: (teamId: string) => setActive(teamId, true),
    onSuccess: refreshEverything,
    meta: { errorHandled: true },
  });

  /**
   * ЦЕНА СТИРАНИЯ — В МОМЕНТ НАЖАТИЯ, А НЕ ПРИ ОТКРЫТИИ ЭКРАНА. Счета и инвойсы
   * нужны ради одной цифры в одном вопросе; и цифра в необратимом вопросе
   * обязана быть свежей: запрос идёт в сеть, а не в кэш пятиминутной давности.
   */
  const measure = async (
    teamId: string,
    appointments: readonly CalendarWorkRow[],
  ): Promise<CalendarDeleteImpact> => {
    if (!tenantId) throw new Error("Нет активного аккаунта.");
    const [accounts, documents] = await Promise.all([
      qc.fetchQuery({
        queryKey: accountRowsQueryKey(tenantId, true),
        queryFn: () => listAccounts(supabase, tenantId, { includeInactive: true }),
      }),
      qc.fetchQuery({
        queryKey: invoicesQueryKey(tenantId),
        queryFn: () => listInvoices(supabase, tenantId, {}),
      }),
    ]);
    return calendarDeleteImpact({ teamId, appointments, accounts, documents });
  };

  const erase = useMutation({
    mutationFn: async (teamId: string) => {
      const client = supabase as unknown as RpcWithDeleteCalendar;
      const { error } = await client.rpc("delete_calendar", { p_team_id: teamId });
      if (error) throw new Error(error.message);
    },
    onSuccess: refreshEverything,
    meta: { errorHandled: true },
  });

  return { archive, restore, measure, erase };
}
