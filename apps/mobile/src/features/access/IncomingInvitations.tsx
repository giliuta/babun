import { useState } from "react";
import { View } from "react-native";

import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { useToast } from "@/components/ui/Toast";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";

import { IncomingInvitationCard } from "./IncomingInvitationCard";
import { useAcceptInvitation, useDeclineInvitation, useMyInvitations } from "./inbox-queries";
import { invitationCardView, type IncomingInvitation } from "./invitation-inbox";

/** Карточки приглашений с «Принять / Отклонить». ОДНО ТЕЛО на страницу
 *  «Приглашения» и на блок в Кабинете — пока 007 не поставит строку-дверь. */
export function InvitationCards({ invitations }: { invitations: readonly IncomingInvitation[] }) {
  const accept = useAcceptInvitation();
  const decline = useDeclineInvitation();
  const toast = useToast();
  const [busy, setBusy] = useState<{ id: string; action: "accept" | "decline" } | null>(null);

  const onAccept = (invitation: IncomingInvitation) => {
    setBusy({ id: invitation.id, action: "accept" });
    accept.mutate(invitation, {
      onSuccess: () => toast(`Вы в «${invitation.calendar?.name ?? invitation.company}»`),
      onError: (error) => notify("Не удалось принять приглашение", (error as Error).message),
      onSettled: () => setBusy(null),
    });
  };

  const onDecline = (invitation: IncomingInvitation) =>
    confirmThen(
      "Отклонить приглашение?",
      {
        message: `${invitation.company} сможет пригласить вас снова только новым приглашением.`,
        confirmLabel: "Отклонить",
        destructive: true,
      },
      () => {
        setBusy({ id: invitation.id, action: "decline" });
        decline.mutate(invitation.id, {
          onError: (error) => notify("Не удалось отклонить приглашение", (error as Error).message),
          onSettled: () => setBusy(null),
        });
      },
    );

  return (
    <View>
      {invitations.map((invitation) => (
        <IncomingInvitationCard
          key={invitation.id}
          invitation={invitationCardView(invitation)}
          busy={busy?.id === invitation.id ? busy.action : null}
          onAccept={() => onAccept(invitation)}
          onDecline={() => onDecline(invitation)}
        />
      ))}
    </View>
  );
}

/** Блок входящих приглашений в Кабинете (владелец 14.09: «всё переводим на
 *  приглашение в кабинет»). Виден только при приглашениях; уходит, когда 007
 *  поставит на его место строку-дверь `InvitationsRow`. */
export function IncomingInvitations() {
  const query = useMyInvitations();
  const invitations = query.data ?? [];
  if (invitations.length === 0) return null;
  return (
    <View>
      <SectionEyebrow>Приглашения</SectionEyebrow>
      <InvitationCards invitations={invitations} />
    </View>
  );
}
