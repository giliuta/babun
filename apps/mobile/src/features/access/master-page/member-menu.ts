import { Keyboard } from "react-native";
import type { QueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import type { useToast } from "@/components/ui/Toast";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import type { ActionMenu } from "@/components/blocks/ActionMenuSheet";
import { confirmThen } from "@/lib/confirm";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import type { CalendarMember } from "@/session/access-queries";
import { removalMessage, upcomingWorkCount } from "./removal-impact";

export interface MemberMenuDeps {
  member: CalendarMember | null;
  card: { is_active: boolean } | null;
  patchCard: (patch: { is_active?: boolean }) => void;
  setMenu: (menu: ActionMenu) => void;
  toast: ReturnType<typeof useToast>;
  appointments: readonly Appointment[] | undefined;
  teamIds: readonly string[];
  businessNow: () => { ymd: string };
  remove: { mutateAsync: (userId: string) => Promise<unknown> };
  qc: QueryClient;
  onBack: () => void;
}

/** «Убрать из команд» and the ⋯ action sheet of a partner's card. */
export function memberMenuActions({
  member,
  card,
  patchCard,
  setMenu,
  toast,
  appointments,
  teamIds,
  businessNow,
  remove,
  qc,
  onBack,
}: MemberMenuDeps) {
  // «УБРАТЬ ИЗ КОМАНД» (04.10: компаний нет — аккаунт и команды): членство
  // одно на аккаунт, и уходит человек разом из всех ваших команд. Слово не
  // обещает меньше, чем будет.
  const askRemove = () => {
    if (!member) return;
    confirmThen(
      `Убрать ${member.name} из команд?`,
      {
        // ВОПРОС НАЗЫВАЕТ ЦИФРУ. Владельца держит не «пропадёт доступ», а то,
        // что на четверг у человека три выезда: убрал в среду — узнал от
        // клиента (`removal-impact.ts`).
        message: removalMessage(
          upcomingWorkCount(appointments ?? [], teamIds, businessNow().ymd),
        ),
        confirmLabel: "Убрать",
        destructive: true,
      },
      async () => {
        try {
          await remove.mutateAsync(member.userId);
          void qc.invalidateQueries({ queryKey: ["calendar-members"] });
          toast(`${member.name} больше не в ваших командах`);
          onBack();
        } catch (error) {
          notify("Не удалось убрать из команд", (error as Error).message);
        }
      },
    );
  };
  // ⋯ — ТО, ЧЕГО НЕТ В БЛОКАХ СТРАНИЦЫ (STORY-087): архив карточки и уход из
  // команд. Шторкой действий, как у записи и документа (04.10), а не
  // системным списком. «Посмотреть его глазами» — строкой в блоке «Доступ».
  const openMenu = () => {
    if (!member) return;
    Keyboard.dismiss();
    haptics.tap();
    setMenu({
      title: member.name,
      subtitle: member.email || undefined,
      items: [
        ...(card
          ? [
              {
                label: card.is_active ? "В архив" : "Вернуть из архива",
                icon: card.is_active ? Archive : ArchiveRestore,
                color: card.is_active ? SETTINGS_TILE.yellow : SETTINGS_TILE.green,
                run: () => {
                  patchCard({ is_active: !card.is_active });
                  toast(card.is_active ? "Партнёр в архиве — в выборе команды его нет" : "Партнёр снова в работе");
                },
              },
            ]
          : []),
        { label: "Убрать из команд", destructive: true, run: askRemove },
      ],
    });
  };
  return { askRemove, openMenu };
}
