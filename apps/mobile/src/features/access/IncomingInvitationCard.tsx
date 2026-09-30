import { Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";
import { TYPE } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

// ПРИГЛАШЕНИЕ ВНУТРИ ПРИЛОЖЕНИЯ (STORY-081; разворот владельца 14.09: «напрямую
// принять приглашение… без лишних действий и отправки на почту»). Приглашённый
// уже зарегистрирован, поэтому приглашение приходит к нему сюда, а не письмом.
//
// МЕСТО — СВЕРХУ КАБИНЕТА (владелец 14.09 перерешил с «над календарём»: «всё
// переводим на приглашение в кабинет»); на вкладке — красный счётчик. Здесь
// только слова и две кнопки; данные и ответ сервера живут у того, кто рисует.

export interface IncomingInvitationView {
  companyName: string;
  calendarName: string | null;
  /** Имя пригласившего, иначе его почта. */
  invitedBy: string | null;
}

export function IncomingInvitationCard({
  invitation,
  busy,
  onAccept,
  onDecline,
}: {
  invitation: IncomingInvitationView;
  /** Какая кнопка ждёт сервер: вторую в это время не нажать. */
  busy: "accept" | "decline" | null;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const t = useThemeColors();
  const where = invitation.calendarName
    ? `${invitation.companyName} · ${invitation.calendarName}`
    : invitation.companyName;
  return (
    <SectionCard padded className="mt-2">
      <Text style={{ ...TYPE.headline, color: t.ink }}>Вас пригласили</Text>
      <Text style={{ ...TYPE.body, color: t.ink, marginTop: 2 }} numberOfLines={2}>
        {where}
      </Text>
      {invitation.invitedBy ? (
        <Text style={{ ...TYPE.subhead, color: t.sub, marginTop: 2 }} numberOfLines={1}>
          Приглашение от {invitation.invitedBy}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <View style={{ flex: 1 }}>
          <Button
            label="Отклонить"
            variant="secondary"
            onPress={onDecline}
            disabled={busy !== null}
            loading={busy === "decline"}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Принять"
            onPress={onAccept}
            disabled={busy !== null}
            loading={busy === "accept"}
          />
        </View>
      </View>
    </SectionCard>
  );
}
