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

// СЕРВЕР ОБУЧЕНИЯ ЕЩЁ НЕ ВКЛЮЧЁН. Функции `my_onboarding` и `onboarding_done`
// приходят миграцией `20261018100000_signup_without_calendar`, а её накат меняет
// и регистрацию — он идёт отдельным решением. До него запрос не уходит вовсе:
// иначе каждый запуск у владельца — три ответа 404 (запрос и два повтора), а
// обучение всё равно молчит (`done` пуст — разделы открыты). Включается этим
// флагом в том же коммите, что и накат.
export const ONBOARDING_SERVER_READY = false;

export function useOnboardingDone() {
  const tenantId = useTenantId();
  const userId = useSession().session?.user.id ?? null;
  const role = useCurrentRole().data;
  return useQuery({
    queryKey: onboardingKey(tenantId, userId),
    enabled: ONBOARDING_SERVER_READY && !!tenantId && !!userId && role === "owner",
    // Ответ меняется только отсюда же — перечитывать его незачем.
    staleTime: Infinity,
    // Отказ сервера повтором не лечится, а повтор — лишний запрос на старте.
    retry: false,
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
      if (!ONBOARDING_SERVER_READY) return null;
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
