import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";

// ПУШ-НАСТРОЙКИ ЧЕЛОВЕКА — не команды: сводки утром и вечером говорят про весь
// его день во всех календарях, тихие часы — про его сон, а время того и
// другого — его часовой пояс. Одна строка `push_settings` на человека; строки
// нет — всё выключено.
//
// Пишутся ТОЛЬКО изменённые столбцы: сводки и тихие часы накатываются
// разными миграциями, и правка одного не должна зависеть от другого.

import {
  DEFAULT_PUSH_SETTINGS,
  pushSettingsColumns,
  pushSettingsFromRow,
  type PushSettings,
} from "./push-settings-rules";

export { DEFAULT_PUSH_SETTINGS, DEFAULT_QUIET, quietLabel, type PushSettings } from "./push-settings-rules";

const key = (userId: string | null) => ["push-settings", userId] as const;

/** Пояс телефона: сводка в 8:00 — по часам того, кто её включил. */
function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Nicosia";
  } catch {
    return "Asia/Nicosia";
  }
}

export function usePushSettings() {
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  return useQuery({
    queryKey: key(userId),
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<PushSettings> => {
      const { data, error } = await supabase
        .from("push_settings")
        // Все столбцы, какие есть: тихие часы приходят своей миграцией.
        .select("*")
        .eq("user_id", userId as string)
        .maybeSingle();
      if (error) throw new Error(`push_settings: ${error.message}`);
      return pushSettingsFromRow(data);
    },
  });
}

/** Правка: экран — сразу, база — следом; сбой — откат. */
export function useSavePushSettings() {
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  const qc = useQueryClient();
  return useMutation<void, Error, Partial<PushSettings>, PushSettings | undefined>({
    onMutate: (patch) => {
      const before = qc.getQueryData<PushSettings>(key(userId));
      qc.setQueryData<PushSettings>(key(userId), { ...(before ?? DEFAULT_PUSH_SETTINGS), ...patch });
      return before;
    },
    mutationFn: async (patch) => {
      if (!userId) throw new Error("Нет входа");
      const { error } = await supabase.from("push_settings").upsert(
        {
          user_id: userId,
          ...pushSettingsColumns(patch),
          time_zone: deviceTimeZone(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw new Error(`push_settings: ${error.message}`);
    },
    onError: (_error, _patch, before) => {
      qc.setQueryData(key(userId), before);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: key(userId) }),
    meta: { errorHandled: true },
  });
}
