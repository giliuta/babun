import { useRouter, type Href } from "expo-router";

import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useTenantId } from "@/lib/tenant";
import type { Team } from "@/features/reference/queries";

import type { AccessBlock } from "../access-map";
import { mirrorMapOf } from "../mirror/mirror-map";
import { useMirrorMode } from "../mirror/mirror-state";
import type { RightsArea } from "./master-draft";

// ОБЩЕЕ ТРЁМ РЕЖИМАМ СТРАНИЦЫ ПРАВ: вход в зеркало, экран «едет/отказ» и два
// мелких правила выбора календаря. Лежит отдельно, потому что режимы —
// черновик, приглашение и сотрудник — живут в своих файлах: страница перевалила
// за предел в 400 строк.

/** Куда приземляется зеркало: вкладка того раздела, который настраивали. */
const MIRROR_LANDING: Record<RightsArea, Href> = {
  calendar: "/",
  finance: "/finances",
  clients: "/clients",
  // У «Компании» своей вкладки нет — её блоки живут в Кабинете.
  company: "/cabinet",
};

export function usePreview() {
  const router = useRouter();
  const tenantId = useTenantId();
  const { enter } = useMirrorMode();
  return (input: {
    blocks: readonly AccessBlock[] | undefined;
    draft: Parameters<typeof mirrorMapOf>[2];
    name: string;
    /** Раздел, который владелец только что настраивал. */
    area?: RightsArea;
    /** Сотрудник, уже вошедший в компанию; у черновика и приглашения нет. */
    userId?: string | null;
  }) => {
    if (!tenantId || !input.blocks) return;
    const state = {
      name: input.name.trim() || "сотрудник",
      userId: input.userId ?? null,
      role: "master" as const,
      map: mirrorMapOf(tenantId, input.blocks, input.draft),
    };
    // СНАЧАЛА ВЫХОДИМ ИЗ НАСТРОЕК В КОРЕНЬ, И ЭТО НЕ КОСМЕТИКА. Страница прав
    // закрыта мастеру, и оставленная в стеке она показала бы в зеркале стену
    // «Недостаточно прав» — экран, которого сотрудник не увидит никогда
    // (проверено глазами 20.09).
    //
    // Одним действием навигатора, а не циклом `back()`: переходы копятся в
    // очередь, `canGoBack()` внутри того же кадра отвечает по-старому, и цикл
    // не кончается — приложение встаёт намертво.
    //
    // И ДО ВКЛЮЧЕНИЯ ЗЕРКАЛА (аудит 29.09): роль «мастер» тут же прячет стек
    // Кабинета за стеной, и «закрыть всё» приходило в стек, которого уже нет, —
    // «POP_TO_TOP was not handled by any navigator». Поэтому: закрыть, уйти в
    // раздел, и только следующим кадром включить зеркало.
    if (router.canDismiss()) router.dismissAll();

    // ОТКРЫВАЕМ ТО, ЧТО ОН ТОЛЬКО ЧТО СТАВИЛ. Раздел владелец назвал сам —
    // открытой страницей прав.
    router.navigate(MIRROR_LANDING[input.area ?? "calendar"]);
    requestAnimationFrame(() => enter(state));
  };
}

export function RightsPlaceholder({
  subtitle,
  onBack,
  error,
  title,
  onRetry,
}: {
  subtitle?: string;
  onBack: () => void;
  error?: boolean;
  title?: string;
  onRetry?: () => void;
}) {
  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Права" subtitle={subtitle} onBack={onBack} />
      {error ? (
        <EmptyState
          fill
          state="error"
          title={title}
          action={onRetry ? { label: "Повторить", onPress: onRetry } : undefined}
        />
      ) : title ? (
        <EmptyState fill title={title} />
      ) : (
        <EmptyState fill state="loading" />
      )}
    </Screen>
  );
}

export const activeOf = (active: string | null, teamIds: readonly string[]) =>
  active && teamIds.includes(active) ? active : (teamIds[0] ?? null);

/** Календари с чипом — активные. Только они выбираются, считаются и уходят:
 *  архивный календарь правился бы без подписи, а сервер молча снял бы правку.
 *  Поэтому страница ждёт список календарей — пустой снял бы все. */
export const liveIdsOf = (teams: readonly Team[]) => new Set(teams.map((team) => team.id));
