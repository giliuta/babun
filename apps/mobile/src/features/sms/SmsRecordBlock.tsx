import { useState } from "react";
import { Text, View } from "react-native";
import { CircleCheck, CircleX } from "lucide-react-native";
import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { useTeams } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";
import { useAppointmentSms, type SmsHistoryItem } from "./sms-account";
import { SmsHistoryRow, when } from "./SmsHistoryRow";
import { SmsMessageSheet } from "./SmsMessageSheet";

// БЛОК «SMS» — ВНИЗУ ЗАПИСИ (STORY-089). Только история (владелец 03.10:
// «внизу просто история SMS, которые отправили для этого клиента… SMS
// отправляется исключительно, если нажать на трубку клиента»): кнопки
// «Отправить SMS» здесь нет — отправка у трубки, `SmsSendSheet`. Блок
// клиента — свой, `SmsClientBlock`.
//
// SMS ЗАКРЕПЛЕНЫ ЗА КЛИЕНТОМ (владелец 03.10: «при смене клиента SMS
// фиксируются за клиентом»): в записи — только сообщения её нынешнему
// клиенту; поменяли клиента — SMS прежнему остаются в его карточке.
//
// Строка — коротко: шаблон, когда, итог; тап — сообщение целиком. Сверху —
// ответ клиента по ссылке «Подтвердить / Отменить», если он был.

/** Ответ клиента по ссылке из SMS — строкой над сообщениями. */
function ClientAnswer({ answer, at }: { answer: "confirmed" | "cancelled"; at: string | null }) {
  const t = useThemeColors();
  const confirmed = answer === "confirmed";
  const Icon = confirmed ? CircleCheck : CircleX;
  const color = confirmed ? t.success : t.danger;
  const words = confirmed ? "Клиент подтвердил" : "Клиент отменил по ссылке";
  return (
    <View
      accessible
      accessibilityLabel={at ? `${words}, ${when(at)}` : words}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12 }}
    >
      <Icon color={color} size={20} strokeWidth={2} />
      <Text maxFontSizeMultiplier={1.3} style={{ flex: 1, fontSize: 16, fontWeight: "600", color }}>
        {words}
      </Text>
      {at ? (
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 14, color: t.sub, fontVariant: ["tabular-nums"] }}>
          {when(at)}
        </Text>
      ) : null}
    </View>
  );
}

function Empty() {
  const t = useThemeColors();
  return (
    <Text maxFontSizeMultiplier={1.3} style={{ paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: t.sub }}>
      Сообщений пока нет
    </Text>
  );
}

export function SmsRecordBlock({
  appointmentId,
  clientId,
}: {
  /** Сохранённая запись: её SMS. */
  appointmentId: string;
  /** Клиент на экране — сменили и не сохранили, всё равно его SMS. */
  clientId: string | null;
}) {
  const log = useAppointmentSms(appointmentId);
  const { data: teams = [] } = useTeams();
  const [open, setOpen] = useState<SmsHistoryItem | null>(null);
  // Только нынешнему клиенту записи; у старых строк без клиента — как было.
  const messages = (log.data?.messages ?? []).filter((m) => !m.clientId || m.clientId === clientId);
  const answer = log.data?.clientAnswer ?? null;

  return (
    <>
      <SectionCard title="SMS">
        {answer ? (
          <>
            <ClientAnswer answer={answer} at={log.data?.clientAnsweredAt ?? null} />
            {messages.length > 0 ? <Divider inset={16} /> : null}
          </>
        ) : null}
        {messages.map((item, index) => (
          <View key={item.id}>
            {index > 0 ? <Divider inset={16} /> : null}
            <SmsHistoryRow item={item} showClient={false} compact onPress={() => setOpen(item)} />
          </View>
        ))}
        {messages.length === 0 && !answer && !log.isLoading ? <Empty /> : null}
      </SectionCard>
      <SmsMessageSheet
        item={open}
        teamName={(teamId) => teams.find((x) => x.id === teamId)?.name ?? null}
        from="record"
        onClose={() => setOpen(null)}
      />
    </>
  );
}
