import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";
import {
  prefsFromRow,
  rowFromPrefs,
  type TeamNotifyPrefs,
  type TeamNotifyRow,
} from "./notification-prefs";
import {
  readTeamNotifyPrefs,
  readTeamPrefsMap as readMap,
  subscribeTeamPrefs as subscribe,
  teamPrefsVersion,
  writeTeamPrefsMap as writeMap,
  type TeamPrefsMap as PrefsMap,
} from "./notification-prefs-cache";

// НАСТРОЙКИ УВЕДОМЛЕНИЙ ПО КОМАНДАМ — база + копия на телефоне.
//
// Истина — `team_notification_prefs` (у каждого человека свои строки). Копия
// в MMKV нужна тем, кто читает настройки синхронно и без сети: сверка
// напоминаний календаря, напоминание о клиенте, сторож бюджета и читатель
// событий команды. Запрос обновляет копию; правка пишет в копию сразу (экран
// и сверка видят её мгновенно) и уходит в базу.

const COLUMNS =
  "tenant_id, team_id, record_reminder, client_reminder_time, notify_new, notify_change, notify_cancel, notify_payment, budget";

export { readTeamNotifyPrefs };

// Правки в пути: пока они не сохранились, ответ запроса не перетирает копию —
// иначе ответ, ушедший до второго тапа, на миг вернул бы тумблер назад.
let pendingWrites = 0;

/** Номер версии копии — подпись для эффектов, которым нужно пересобраться
 *  при любой правке настроек (сверка напоминаний календаря). */
export function useTeamNotifyVersion(): number {
  return useSyncExternalStore(subscribe, teamPrefsVersion, teamPrefsVersion);
}

export const teamNotifyKey = (userId: string | null) => ["team-notify-prefs", userId] as const;

/** Все строки человека — копия обновляется при каждом чтении. */
export function useTeamNotifyPrefs() {
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  useTeamNotifyVersion();
  const query = useQuery({
    queryKey: teamNotifyKey(userId),
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<PrefsMap> => {
      const { data, error } = await supabase
        .from("team_notification_prefs")
        .select(COLUMNS)
        .eq("user_id", userId as string);
      if (error) throw new Error(`team_notification_prefs: ${error.message}`);
      const map: PrefsMap = {};
      for (const row of (data ?? []) as TeamNotifyRow[]) map[row.team_id] = prefsFromRow(row);
      if (pendingWrites === 0) writeMap(map);
      return map;
    },
  });
  return { ...query, prefsFor: readTeamNotifyPrefs };
}

/** Правка настроек команды: копия — сразу, база — следом; сбой — откат. */
export function useSaveTeamNotifyPrefs() {
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const qc = useQueryClient();
  return useMutation<void, Error, { tenantId: string; teamId: string; patch: Partial<TeamNotifyPrefs> }, PrefsMap>({
    onMutate: ({ teamId, patch }) => {
      pendingWrites += 1;
      const before = readMap();
      writeMap({ ...before, [teamId]: { ...readTeamNotifyPrefs(teamId), ...patch } });
      return before;
    },
    mutationFn: async ({ tenantId, teamId }) => {
      if (!userId) throw new Error("Нет входа");
      const { error } = await supabase
        .from("team_notification_prefs")
        .upsert(
          {
            user_id: userId,
            tenant_id: tenantId,
            team_id: teamId,
            ...rowFromPrefs(readTeamNotifyPrefs(teamId)),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,tenant_id,team_id" },
        );
      if (error) throw new Error(`team_notification_prefs: ${error.message}`);
    },
    onError: (_error, _vars, before) => {
      if (before) writeMap(before);
    },
    onSettled: () => {
      pendingWrites = Math.max(0, pendingWrites - 1);
      void qc.invalidateQueries({ queryKey: teamNotifyKey(userId) });
    },
    meta: { errorHandled: true },
  });
}
