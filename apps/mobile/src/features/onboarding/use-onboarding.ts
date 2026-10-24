import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useSession } from "@/providers/SessionProvider";
import { useCurrentRole } from "@/session/tenant";
import { CHAPTER_ORDER, type ChapterId } from "./chapter-order";

// ПРОГРЕСС ОБУЧЕНИЯ — В БАЗЕ (`onboarding_progress`), а не на телефоне: на
// втором устройстве пройденное не начинается заново. `null` — обучения у
// человека нет совсем (он пришёл раньше обучения или он не владелец).

export {
  CHAPTER_ORDER,
  lockedByOnboarding,
  nextChapter,
  WRITTEN_CHAPTERS,
  type ChapterId,
  type TabWithChapter,
} from "./chapter-order";

const onboardingKey = (tenantId: string | null, userId: string | null) =>
  ["onboarding", tenantId, userId] as const;

export function useOnboardingDone() {
  const tenantId = useTenantId();
  const userId = useSession().session?.user.id ?? null;
  const role = useCurrentRole().data;
  return useQuery({
    queryKey: onboardingKey(tenantId, userId),
    enabled: !!tenantId && !!userId && role === "owner",
    // Ответ меняется только отсюда же — перечитывать его незачем.
    staleTime: Infinity,
    queryFn: async (): Promise<string[] | null> => {
      const { data, error } = await supabase.rpc("my_onboarding");
      if (error) throw new Error(error.message);
      return data ?? null;
    },
    meta: { errorHandled: true },
  });
}

export function useMarkOnboardingDone() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const userId = useSession().session?.user.id ?? null;
  return useMutation({
    mutationFn: async (chapter: ChapterId | "all"): Promise<string[] | null> => {
      const { data, error } = await supabase.rpc("onboarding_done", { p_chapter: chapter });
      if (error) throw new Error(error.message);
      return data ?? null;
    },
    // Раздел открывается сразу, не дожидаясь ответа: человек закончил главу
    // сейчас, и ждать сеть ради следующей вкладки незачем.
    onMutate: (chapter) => {
      const key = onboardingKey(tenantId, userId);
      qc.setQueryData<string[] | null>(key, (prev) => {
        if (!prev) return prev;
        if (chapter === "all") return [...CHAPTER_ORDER];
        return prev.includes(chapter) ? prev : [...prev, chapter];
      });
    },
    onSuccess: (done) => {
      if (done) qc.setQueryData(onboardingKey(tenantId, userId), done);
    },
    meta: { errorHandled: true },
  });
}
