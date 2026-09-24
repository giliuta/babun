import { useState } from "react";
import { Text, View } from "react-native";
import { Send } from "lucide-react-native";
import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { useThemeColors } from "@/theme/colors";
import { fillTemplate } from "./sms-compose";
import { useAppointmentSms, useClientSms } from "./sms-account";
import type { SmsContext } from "./SmsCompose";
import { SmsHistoryRow } from "./SmsHistoryRow";
import { SmsSendSheet } from "./SmsSendSheet";

// БЛОК «SMS» — ВНИЗУ ЗАПИСИ И НА СТРАНИЦЕ КЛИЕНТА (STORY-089; владелец
// 25.09: «история SMS к клиенту… и на записи в самом низу блок — что мы уже
// отправили ему или не отправили… нажал „Отправить SMS“ — и оно сразу
// отправляет то, что записал»).
//
// Строки — сообщения: повод, когда, итог («Доставлено», «Не доставлено»,
// «Уйдёт 08:00»), текст. У записи — ещё строка «Отправить SMS»: лист с уже
// заполненным текстом записи. У клиента отправка живёт в кнопке номера, как
// и была; блок там — только история.

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
  const confirmBody = log.data?.confirmBody ?? "";
  const preview = confirmBody ? fillTemplate(confirmBody, context.vars) : null;

  return (
    <>
      <SectionCard title="SMS">
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
        {messages.length === 0 && !log.isLoading ? <Empty /> : null}
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
        confirmBody={confirmBody}
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
