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
    calendarName: string | null;
    /** Раздел, который владелец только что настраивал. */
    area?: RightsArea;
  }) => {
    if (!tenantId || !input.blocks) return;
    enter({
      name: input.name.trim() || "сотрудник",
      role: "master",
      map: mirrorMapOf(tenantId, input.blocks, input.draft),
      calendarName: input.calendarName,
    });
    // СНАЧАЛА ВЫХОДИМ ИЗ НАСТРОЕК В КОРЕНЬ, И ЭТО НЕ КОСМЕТИКА. Страница прав
    // живёт внутри вкладки «Календарь», и если оставить её в стеке, то в
    // зеркале эта вкладка показывает стену «Недостаточно прав»: мастеру такой
    // маршрут закрыт. Экрана этого сотрудник не увидит никогда — значит и
    // предпросмотру показывать его нельзя (проверено глазами 20.09).
    //
    // Одним действием навигатора, а не циклом `back()`: переходы копятся в
    // очередь, `canGoBack()` внутри того же кадра отвечает по-старому, и цикл
    // не кончается — приложение встаёт намертво (проверено глазами: экран
    // перестал отвечать вовсе).
    router.dismissAll();

    // ОТКРЫВАЕМ ТО, ЧТО ОН ТОЛЬКО ЧТО СТАВИЛ. Зеркало всегда приземлялось в
    // календарь, и владелец, настроивший «Клиенты», первым делом искал их
    // руками. Раздел он назвал сам — открытой страницей прав.
    router.navigate(MIRROR_LANDING[input.area ?? "calendar"]);
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
