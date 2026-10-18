import type { ComponentType } from "react";
import { View } from "react-native";
import { useToast } from "@/components/ui/Toast";
import { useTeams } from "@/features/reference/queries";
import { openFirstCalendarSheet } from "@/features/calendar/first-calendar-sheet";
import { useCurrentRole } from "@/session/tenant";
import { lockedByOnboarding, useOnboardingDone, type TabWithChapter } from "./use-onboarding";

// ЗАКРЫТЫЕ ВКЛАДКИ. Это единственное исключение из «вкладки не зависят от
// права»: закрывает не право, а очерёдность. Вкладки не прячутся, а бледнеют:
// ряд остаётся тем же, что будет через минуту, и видно, что откроется.
//
// Два замка:
//   • календаря ещё нет — открыт только «Календарь»: без него у Клиентов и
//     Финансов нет команды, к которой они относятся. Тап по бледной ведёт к
//     шторке создания календаря;
//   • идёт обучение — раздел открывается, когда пройдены главы перед ним
//     (Календарь → Финансы → Клиенты → Кабинет).
//
// Только у владельца. Сотрудник календари не заводит и обучения не проходит.
// У того, кого ждёт приглашение, Кабинет не закрывается: ответ на
// приглашение живёт там.

type TabIcon = ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

/** Бледность закрытой вкладки: видно, что вкладка есть и откроется позже. */
const LOCKED_OPACITY = 0.32;

export function useTabLocks(invitationCount: number) {
  const role = useCurrentRole().data;
  const teams = useTeams();
  const { data: done } = useOnboardingDone();
  const toast = useToast();
  const owner = role === "owner";
  const noCalendar = owner && teams.isSuccess && teams.data.length === 0 && invitationCount === 0;

  const isLocked = (tab: TabWithChapter): boolean => {
    if (tab === "cabinet" && invitationCount > 0) return false;
    return noCalendar || (owner && lockedByOnboarding(done, tab));
  };

  const icon = (tab: TabWithChapter, Icon: TabIcon) =>
    function LockableIcon({ color, size, focused }: { color: string; size: number; focused: boolean }) {
      return (
        <View style={{ opacity: isLocked(tab) ? LOCKED_OPACITY : 1 }}>
          <Icon color={color} size={size} strokeWidth={focused ? 2.4 : 2} />
        </View>
      );
    };

  const options = (tab: TabWithChapter) => ({
    tabBarLabelStyle: {
      fontSize: 10,
      fontWeight: "500" as const,
      opacity: isLocked(tab) ? LOCKED_OPACITY : 1,
    },
    tabBarAccessibilityState: isLocked(tab) ? { disabled: true } : undefined,
  });

  const listeners = (tab: TabWithChapter) => ({ navigation }: { navigation: { navigate: (name: string) => void } }) => ({
    tabPress: (e: { preventDefault: () => void }) => {
      if (!isLocked(tab)) return;
      e.preventDefault();
      if (noCalendar) {
        navigation.navigate("(home)");
        openFirstCalendarSheet();
      } else {
        toast("Раздел откроется, когда пройдёте обучение до него", "info");
      }
    },
  });

  return { icon, options, listeners };
}
