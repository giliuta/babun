import { useState } from "react";
import { View } from "react-native";

import { useToast } from "@/components/ui/Toast";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";

import { IncomingInvitationCard } from "./IncomingInvitationCard";
import { useAcceptInvitation, useDeclineInvitation } from "./inbox-queries";
import { invitationCardView, type IncomingInvitation } from "./invitation-inbox";

/** Карточки приглашений с «Принять / Отклонить» на странице «Приглашения».
 *  Блок в Кабинете, который жил рядом, снят: в Кабинете теперь строка-дверь
 *  `InvitationsRow` на постоянном месте (владелец не находил блок). */
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
