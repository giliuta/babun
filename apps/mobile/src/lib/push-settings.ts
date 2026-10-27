import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";

// ПУШ-НАСТРОЙКИ ЧЕЛОВЕКА — не команды: сводки утром и вечером говорят про весь
// его день во всех календарях, а время сводки — его часовой пояс. Одна строка
// `push_settings` на человека; строки нет — всё выключено.

export interface PushSettings {
  digestMorning: boolean;
  digestEvening: boolean;
}

export const DEFAULT_PUSH_SETTINGS: PushSettings = { digestMorning: false, digestEvening: false };

interface PushSettingsRow {
  digest_morning: boolean | null;
  digest_evening: boolean | null;
}

export function pushSettingsFromRow(row: Partial<PushSettingsRow> | null | undefined): PushSettings {
  return {
    digestMorning: row?.digest_morning === true,
    digestEvening: row?.digest_evening === true,
  };
}

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
        .select("digest_morning, digest_evening")
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
      const next = { ...(qc.getQueryData<PushSettings>(key(userId)) ?? DEFAULT_PUSH_SETTINGS), ...patch };
      const { error } = await supabase.from("push_settings").upsert(
        {
          user_id: userId,
          digest_morning: next.digestMorning,
          digest_evening: next.digestEvening,
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
