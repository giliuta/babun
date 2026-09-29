import { useState } from "react";
import { Text, View } from "react-native";
import { CircleCheck, CircleX, Send } from "lucide-react-native";
import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { useThemeColors } from "@/theme/colors";
import { fillTemplate } from "./sms-compose";
import { useAppointmentSms, useClientSms } from "./sms-account";
import type { SmsContext } from "./SmsCompose";
import { SmsHistoryRow, when } from "./SmsHistoryRow";
import { SmsSendSheet } from "./SmsSendSheet";

// БЛОК «SMS» — ВНИЗУ ЗАПИСИ И НА СТРАНИЦЕ КЛИЕНТА (STORY-089; владелец
// 25.09: «история SMS к клиенту… и на записи в самом низу блок — что мы уже
// отправили ему или не отправили… нажал „Отправить SMS“ — и оно сразу
// отправляет то, что записал»).
//
// Строки — сообщения: повод, когда, итог («Доставлено», «Не доставлено»,
// «Уйдёт 08:00»), текст. Сверху — ответ клиента по ссылке «Подтвердить /
// Отменить», если он был. У записи — ещё строка «Отправить SMS»: лист с
// шаблонами команды записи, первый уже заполнен. У клиента отправка живёт в
// кнопке номера, как и была; блок там — только история.

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
  context,
  phone,
}: {
  /** Поля записи, её id, клиент и календарь. */
  context: SmsContext;
  phone: string | null;
}) {
  const log = useAppointmentSms(context.appointmentId);
  const [sending, setSending] = useState(false);
  const messages = log.data?.messages ?? [];
  const templates = log.data?.templates ?? [];
  const answer = log.data?.clientAnswer ?? null;
  // Подпись строки — первый шаблон, который заполняется этой записью.
  const preview = templates.map((tpl) => fillTemplate(tpl.body, context.vars)).find((text) => !!text) ?? null;

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
            <SmsHistoryRow
              item={item}
              showClient={false}
              body={item.templateBody ? (fillTemplate(item.templateBody, context.vars) ?? item.templateBody) : null}
            />
          </View>
        ))}
        {messages.length === 0 && !answer && !log.isLoading ? <Empty /> : null}
        <Divider inset={48} />
        <SettingsRow
          tile="neutral"
          icon={Send}
          title="Отправить SMS"
          sub={preview ?? undefined}
          onPress={() => setSending(true)}
        />
      </SectionCard>
      <SmsSendSheet
        visible={sending}
        context={context}
        phone={phone}
        templates={templates}
        onClose={() => setSending(false)}
      />
    </>
  );
}

export function SmsClientBlock({ clientId }: { clientId: string }) {
  const log = useClientSms(clientId);
  const messages = log.data ?? [];
  return (
    <SectionCard title="SMS">
      {messages.map((item, index) => (
        <View key={item.id}>
          {index > 0 ? <Divider inset={16} /> : null}
          <SmsHistoryRow item={item} showClient={false} />
        </View>
      ))}
      {messages.length === 0 && !log.isLoading ? <Empty /> : null}
    </SectionCard>
  );
}
