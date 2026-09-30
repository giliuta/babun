import { useQueryClient } from "@tanstack/react-query";

import { ActionRow, RowGroup } from "@/components/ui/card-rows";
import { useToast } from "@/components/ui/Toast";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import type { InvitableRole } from "@/features/settings/invitation-flow";
import { useRemoveTenantMember } from "@/features/settings/team-access";

import type { CalendarMember } from "./queries";

// «УБРАТЬ ИЗ КОМПАНИИ» — НА ЭКРАНЕ ЧЕЛОВЕКА (STORY-081). Владелец убрал
// «Доступ в CRM» из Кабинета («все настройки там, где шестерёнка»), а жило там
// и это действие, которого в «Мастерах» не было: без него уволить сотрудника в
// приложении было бы негде. Хук тот же (`team-access.ts`) — второй дороги к
// серверу не заводим.
//
// СТРОКИ «РОЛЬ» ЗДЕСЬ БОЛЬШЕ НЕТ (владелец 15.09: «роль уберём, она в целом
// нам не нужна»): что человеку можно, настраивается блоками прав.

const isStaffRole = (role: string): role is InvitableRole =>
  role === "master" || role === "dispatcher";

export function MemberRemoveGroup({
  member,
  onRemoved,
}: {
  member: CalendarMember;
  onRemoved: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const remove = useRemoveTenantMember();
  if (!isStaffRole(member.role)) return null;

  const ask = () =>
    confirmThen(
      `Убрать ${member.name} из компании?`,
      {
        message:
          "Доступ ко всем календарям компании пропадёт сразу. Вернуть можно только новым приглашением.",
        confirmLabel: "Убрать",
        destructive: true,
      },
      async () => {
        try {
          await remove.mutateAsync(member.userId);
          void qc.invalidateQueries({ queryKey: ["calendar-members"] });
          toast(`${member.name} больше не в компании`);
          onRemoved();
        } catch (error) {
          notify("Не удалось убрать из компании", (error as Error).message);
        }
      },
    );

  // «Убрать из компании», а не «из команды»: членство одно на компанию, и
  // уходит доступ ко ВСЕМ её календарям — слово не обещает меньше, чем будет.
  return (
    <RowGroup title="Доступ к компании">
      <ActionRow label="Убрать из компании" tone="danger" onPress={ask} />
    </RowGroup>
  );
}
