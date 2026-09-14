import { useQueryClient } from "@tanstack/react-query";

import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { presentChoiceSheet } from "@/components/ui/ChoiceSheet";
import { ActionRow, NavRow, RowGroup } from "@/components/ui/card-rows";
import { useToast } from "@/components/ui/Toast";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import type { InvitableRole } from "@/features/settings/invitation-flow";
import { ROLE_LABELS } from "@/features/settings/role-policy";
import { useRemoveTenantMember, useUpdateTenantMember } from "@/features/settings/team-access";

import type { CalendarMember } from "./queries";

// РОЛЬ И «УБРАТЬ ИЗ КОМПАНИИ» — НА ЭКРАНЕ ЧЕЛОВЕКА (STORY-081). Владелец убрал
// «Доступ в CRM» из Кабинета («все настройки там, где шестерёнка»), а жили там
// ровно эти два действия, которых в «Мастерах» не было: без них уволить
// сотрудника в приложении было бы негде. Хуки те же (`team-access.ts`) — второй
// дороги к серверу не заводим.

const ROLE_ORDER: readonly InvitableRole[] = ["master", "dispatcher"];

const isStaffRole = (role: string): role is InvitableRole =>
  role === "master" || role === "dispatcher";

/** Второе окно поверх уезжающего не появляется вовсе (закон о двух окнах):
 *  вопрос задаётся только после того, как выбор уехал. */
const afterSheetExit = () => new Promise<void>((resolve) => setTimeout(resolve, SHEET_EXIT_MS));

export function MemberRoleGroup({ member }: { member: CalendarMember }) {
  const qc = useQueryClient();
  const toast = useToast();
  const update = useUpdateTenantMember();
  if (!isStaffRole(member.role)) return null;
  const role = member.role;

  const apply = async (next: InvitableRole) => {
    try {
      // Карточка бывает только у мастера: диспетчеру привязка снимается, а
      // мастер без карточки — норма приглашения в календарь (006). Роль меняется
      // только на ДРУГУЮ, поэтому привязку мастера это не трогает молча.
      await update.mutateAsync({ userId: member.userId, role: next, masterId: null });
      void qc.invalidateQueries({ queryKey: ["calendar-members"] });
      toast(`Роль: ${ROLE_LABELS[next]}`);
    } catch (error) {
      notify("Не удалось сменить роль", (error as Error).message);
    }
  };

  const choose = async () => {
    const picked = await presentChoiceSheet(
      "Роль",
      ROLE_ORDER.map((value) => ({ label: ROLE_LABELS[value] })),
    );
    const next = picked == null ? undefined : ROLE_ORDER[picked];
    if (!next || next === role) return;
    await afterSheetExit();
    if (next === "dispatcher") {
      // Повышение — с вопросом: диспетчер видит больше, чем мастер.
      confirmThen(
        `Сделать ${member.name} диспетчером?`,
        {
          message: "Диспетчер видит записи, клиентов и телефоны своих календарей.",
          confirmLabel: "Сделать диспетчером",
        },
        () => apply(next),
      );
      return;
    }
    await apply(next);
  };

  return (
    <RowGroup>
      <NavRow label="Роль" value={ROLE_LABELS[role]} onPress={() => void choose()} />
    </RowGroup>
  );
}

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
