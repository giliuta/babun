import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useMirror } from "@/session/mirror-state";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";

// ПОРЯДОК КАЛЕНДАРЕЙ ЧЕЛОВЕКА (владелец 11.10: «чтоб можно менять местами
// календари») — строка `user_calendar_order`, одна на человека, как скрытые
// календари (`use-hidden-calendars.ts`): лента собирает календари всех его
// аккаунтов, и порядок обязан пережить переход между ними. «Его глазами»
// порядка нет: предпросмотр показывает ленту сотрудника, а не ваш выбор.

const orderKey = (userId: string | null) => ["calendar-order", userId] as const;

// Таблицы ещё нет в сгенерированных типах — узкая обёртка вместо `any`.
type Table = {
  select: (cols: string) => {
    maybeSingle: () => Promise<{
      data: { calendars: string[] | null } | null;
      error: { message: string } | null;
    }>;
  };
  upsert: (
    row: Record<string, unknown>,
    opts: { onConflict: string },
  ) => Promise<{ error: { message: string } | null }>;
};
const table = () =>
  (supabase as unknown as { from: (t: string) => Table }).from("user_calendar_order");

/** Ключи `calendarOrderKey` в порядке человека; `null` — порядка нет. */
export function useCalendarOrder(): readonly string[] | null {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const inMirror = useMirror() !== null;
  const query = useQuery({
    queryKey: orderKey(userId),
    enabled: !!userId && !inMirror,
    staleTime: 60_000,
    queryFn: async (): Promise<string[] | null> => {
      const { data, error } = await table().select("calendars").maybeSingle();
      // Нет таблицы или сети — лента стоит в заводском порядке.
      if (error) return null;
      return data?.calendars ?? null;
    },
  });
  return inMirror ? null : (query.data ?? null);
}

/** Запись порядка — мгновенно в ленте, затем на сервер. */
export function useSaveCalendarOrder() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (calendars: string[]) => {
      const { error } = await table().upsert(
        { calendars, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
      if (error) throw new Error(error.message);
    },
    onMutate: async (calendars) => {
      await qc.cancelQueries({ queryKey: orderKey(userId) });
      const before = qc.getQueryData<string[] | null>(orderKey(userId)) ?? null;
      qc.setQueryData(orderKey(userId), calendars);
      return { before };
    },
    onError: (_e, _v, ctx) => {
      if (ctx) qc.setQueryData(orderKey(userId), ctx.before);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: orderKey(userId) }),
    meta: { errorHandled: true },
  });
}
