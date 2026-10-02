import { useState } from "react";
import { Text, View } from "react-native";
import type { Client } from "@babun/shared/local/clients";
import { FieldRow } from "@/components/ui/card-rows";
import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { useToast } from "@/components/ui/Toast";
import { useClientsScopeOrNull } from "@/features/clients/company-scope";
import { useDefaultCountry } from "@/features/clients/default-country";
import { formatPhoneForDisplay } from "@/features/clients/phone";
import { firstName } from "@/features/clients/sms-name";
import { useTeams } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";
import { smsErrorText, useClientSms, useSetClientSmsOptOut, type SmsHistoryItem } from "./sms-account";
import { SmsHistoryRow } from "./SmsHistoryRow";
import { SmsMessageSheet } from "./SmsMessageSheet";

// БЛОК «SMS» НА СТРАНИЦЕ КЛИЕНТА — ВСЁ ПРО SMS ЭТОМУ КЛИЕНТУ ОДНИМ БЛОКОМ
// (STORY-089; владелец 30.09: «присылать или не присылать — в едином блоке
// SMS… вторая строчка — имя для SMS: компания называется RTX, а номер
// принадлежит Ольге… и история — все SMS по этому клиенту и на какой номер
// ушло: у клиента бывает два-три-четыре номера»).
//
//   • «Присылать SMS» — клиент попросил не писать: сервис ему не пишет ни сам,
//     ни по кнопке. Своя функция базы, а не правка карточки: флаг нельзя
//     стереть офлайн-очередью. Тумблер откликается сразу;
//   • «Имя для SMS» — то, что встаёт в [Имя] (`sms_name`), пишется прямо в
//     строке; пусто — первое слово имени клиента, оно и показано серым;
//   • сообщения — все, что уходили клиенту, коротко: шаблон, когда, на какой
//     номер, итог; тап — сообщение целиком. Кнопки «Отправить SMS» нет
//     (владелец 03.10: «SMS отправляется исключительно, если нажать на трубку
//     клиента… внизу просто история»).

const HISTORY_LIMIT = 200;

export function SmsClientBlock({
  client,
  update,
  readOnly = false,
}: {
  client: Client;
  update: (patch: Partial<Client>) => Promise<boolean> | void;
  /** Сотрудник без «Клиенты: Меняет» — строки видны, но не меняются. */
  readOnly?: boolean;
}) {
  const t = useThemeColors();
  const toast = useToast();
  const country = useDefaultCountry(client.team_id ?? null);
  const { data: teams = [] } = useTeams();
  // Компания карточки: клиент работодателя читается под её заголовком.
  const cardTenantId = useClientsScopeOrNull()?.tenantId ?? null;
  const log = useClientSms(client.id, HISTORY_LIMIT, cardTenantId);
  const optOut = useSetClientSmsOptOut();
  const [smsOff, setSmsOff] = useState<boolean | null>(null);
  const [open, setOpen] = useState<SmsHistoryItem | null>(null);
  const smsBlocked = smsOff ?? client.sms_opt_out === true;
  const messages = log.data ?? [];
  const smsName = (client.sms_name ?? "").trim();
  const fallbackName = firstName(client);

  return (
    <>
      <SectionCard title="SMS">
        <SwitchRow
          label="Присылать SMS"
          hint={smsBlocked ? "Клиент просил не писать" : undefined}
          value={!smsBlocked}
          disabled={readOnly || optOut.isPending}
          onChange={(send) => {
            setSmsOff(!send);
            optOut.mutate(
              { clientId: client.id, value: !send, tenantId: cardTenantId },
              {
                onError: (e) => {
                  setSmsOff(null);
                  toast(smsErrorText(e), "error");
                },
              },
            );
          }}
        />
        {/* ИМЯ ДЛЯ SMS — ПИШЕТСЯ ПРЯМО В СТРОКЕ (владелец 30.09: «не
            шторка — сразу туда можно написать, блок справа»). Сохраняется,
            когда поле отпускают. */}
        <FieldRow
          label="Имя для SMS"
          value={smsName}
          placeholder={fallbackName || "Имя"}
          separated
          autoCapitalize="words"
          readOnly={readOnly}
          onSave={(name) => void update({ sms_name: name })}
        />
        {messages.map((item) => (
          <View key={item.id}>
            <Divider inset={16} />
            <SmsHistoryRow
              item={item}
              showClient={false}
              compact
              phone={item.toPhone ? formatPhoneForDisplay(item.toPhone, country) : null}
              onPress={() => setOpen(item)}
            />
          </View>
        ))}
        {messages.length === 0 && !log.isLoading ? (
          <>
            <Divider inset={16} />
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: t.sub }}
            >
              Сообщений пока нет
            </Text>
          </>
        ) : null}
      </SectionCard>

      <SmsMessageSheet
        item={open}
        teamName={(teamId) => teams.find((x) => x.id === teamId)?.name ?? null}
        from="client"
        onClose={() => setOpen(null)}
      />
    </>
  );
}

