import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useSession } from "@/providers/SessionProvider";
import { useCurrentRole } from "@/session/tenant";

// ПРОГРЕСС ОБУЧЕНИЯ — В БАЗЕ (`onboarding_progress`), а не на телефоне: на
// втором устройстве пройденное не начинается заново. `null` — обучения у
// человека нет совсем (он пришёл раньше обучения или он не владелец).

/** Главы по порядку разблокировки разделов. */
export const CHAPTER_ORDER = ["calendar", "finances", "clients", "cabinet"] as const;
export type ChapterId = (typeof CHAPTER_ORDER)[number];

/** Главы, которые уже написаны. Глава, которой ещё нет, считается пройденной:
 *  иначе её раздел и все следующие остались бы закрытыми навсегда. */
export const WRITTEN_CHAPTERS: ReadonlySet<ChapterId> = new Set(["calendar"]);

export type TabWithChapter = Exclude<ChapterId, "calendar">;

/** Раздел закрыт, пока не пройдены все главы перед ним. */
export function lockedByOnboarding(done: readonly string[] | null | undefined, tab: TabWithChapter): boolean {
  if (!done) return false;
  const before = CHAPTER_ORDER.slice(0, CHAPTER_ORDER.indexOf(tab));
  return before.some((c) => WRITTEN_CHAPTERS.has(c) && !done.includes(c));
}

/** Первая непройденная написанная глава. */
export function nextChapter(done: readonly string[] | null | undefined): ChapterId | null {
  if (!done) return null;
  return CHAPTER_ORDER.find((c) => WRITTEN_CHAPTERS.has(c) && !done.includes(c)) ?? null;
}

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
