import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useMirror } from "@/features/access/mirror/mirror-state";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";

import { calendarKey, canHideCalendar, effectiveHidden } from "./hidden-calendars";

// СКРЫТЫЕ КАЛЕНДАРИ ЧЕЛОВЕКА (владелец 04.10) — строки `user_hidden_calendars`
// через правило `hidden-calendars.ts`. Ключ — человек, а не компания: список
// один по обе стороны перехода между аккаунтами. «Его глазами» скрытого нет:
// предпросмотр показывает его ленты, а не ваш выбор.

const hiddenKey = (userId: string | null) => ["hidden-calendars", userId] as const;

/** `calendars` — все календари человека (`useMyCalendars`); `undefined`, пока
 *  список едет. Список передаёт зовущий: этот модуль не тянет `workspaces`,
 *  которая сама им пользуется в ленте. */
export function useHiddenCalendars(
  calendars: readonly { tenantId: string; teamId: string }[] | undefined,
) {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const inMirror = useMirror() !== null;
  const qc = useQueryClient();
  const storedQuery = useQuery({
    queryKey: hiddenKey(userId),
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("user_hidden_calendars")
        .select("tenant_id, team_id");
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => calendarKey(row.tenant_id, row.team_id));
    },
  });

  const stored = useMemo(() => new Set(storedQuery.data ?? []), [storedQuery.data]);
  const all = useMemo(
    () => calendars?.map((c) => ({ tenantId: c.tenantId, teamId: c.teamId })) ?? null,
    [calendars],
  );
  const hidden = useMemo(
    () => (inMirror ? new Set<string>() : effectiveHidden(all, stored)),
    [inMirror, all, stored],
  );

  // ПОСЛЕДНИЙ ВИДИМЫЙ ПРОПАЛ — СКРЫТИЕ СНИМАЕТСЯ НАСОВСЕМ (владелец 04.10:
  // «забрали доступ — он автоматически выходит из архива»). Строки стираются,
  // чтобы следующий открытый доступ не спрятал «Личный» снова сам.
  // Пустой список — не «доступ забрали»: на смене входа сервер отвечает
  // пустым 200, и стирать по нему нельзя.
  const staleRows = !inMirror && !!all && all.length > 0 && stored.size > 0 && hidden.size === 0;
  useEffect(() => {
    if (!staleRows) return;
    void supabase
      .from("user_hidden_calendars")
      .delete()
      .not("team_id", "is", null)
      .then(() => qc.invalidateQueries({ queryKey: hiddenKey(userId) }));
  }, [staleRows, qc, userId]);

  const isHidden = useCallback(
    (tenantId: string | null | undefined, teamId: string) =>
      !!tenantId && hidden.has(calendarKey(tenantId, teamId)),
    [hidden],
  );
  /** Скрыть можно, только если останется другой видимый календарь. */
  const canHide = useCallback(
    (tenantId: string, teamId: string) => canHideCalendar(all ?? [], hidden, { tenantId, teamId }),
    [all, hidden],
  );

  const toggle = useMutation({
    mutationFn: async (input: { tenantId: string; teamId: string; hide: boolean }) => {
      if (input.hide) {
        const { error } = await supabase
          .from("user_hidden_calendars")
          .upsert(
            { tenant_id: input.tenantId, team_id: input.teamId },
            { onConflict: "user_id,tenant_id,team_id", ignoreDuplicates: true },
          );
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from("user_hidden_calendars")
          .delete()
          .eq("tenant_id", input.tenantId)
          .eq("team_id", input.teamId);
        if (error) throw new Error(error.message);
      }
    },
    // Тумблер отвечает сразу: лента перестраивается в том же кадре.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: hiddenKey(userId) });
      const key = calendarKey(input.tenantId, input.teamId);
      const before = qc.getQueryData<string[]>(hiddenKey(userId)) ?? [];
      qc.setQueryData<string[]>(
        hiddenKey(userId),
        input.hide ? [...before.filter((k) => k !== key), key] : before.filter((k) => k !== key),
      );
      return { before };
    },
    onError: (_error, _input, context) => {
      if (context) qc.setQueryData(hiddenKey(userId), context.before);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: hiddenKey(userId) }),
    meta: { errorHandled: true },
  });

  return { hidden, isHidden, canHide, toggle, loading: storedQuery.isPending };
}
