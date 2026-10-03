import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { Client } from "@babun/shared/local/clients";
import { FieldRow } from "@/components/ui/card-rows";
import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { useToast } from "@/components/ui/Toast";
import { useClientsScopeOrNull } from "@/features/clients/company-scope";
import { clientSubParams } from "@/features/clients/clients-company";
import { fileDay } from "@/features/clients/client-files";
import { moreLabel } from "@/features/clients/more-label";
import { VisitDayHeader } from "@/features/clients/VisitRow";
import { haptics } from "@/lib/haptics";
import { useDefaultCountry } from "@/features/clients/default-country";
import { formatPhoneForDisplay } from "@/features/clients/phone";
import { firstName } from "@/features/clients/sms-name";
import { useThemeColors } from "@/theme/colors";
import { smsErrorText, useClientSms, useSetClientSmsOptOut, type SmsHistoryItem } from "./sms-account";
import { SmsPlaque } from "./SmsPlaque";

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
//   • сообщения — ПОСЛЕДНЕЕ плашкой под днём, как «История» и «Файлы»
//     (владелец 03.10: «постараться улучшить блок SMS, чтобы было более
//     красиво»): плитка — итог цветом, шаблон, время, номер; «Ещё N» в шапке
//     и тап по плашке — страница всех SMS клиента (`/clients/sms`). Кнопки
//     «Отправить SMS» нет (владелец 03.10: «SMS отправляется исключительно,
//     если нажать на трубку клиента… внизу просто история»).

const HISTORY_LIMIT = 200;
const NO_MESSAGES: SmsHistoryItem[] = [];

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
  const router = useRouter();
  const country = useDefaultCountry(client.team_id ?? null);
  // Компания карточки: клиент работодателя читается под её заголовком.
  const scope = useClientsScopeOrNull();
  const cardTenantId = scope?.tenantId ?? null;
  const log = useClientSms(client.id, HISTORY_LIMIT, cardTenantId);
  const optOut = useSetClientSmsOptOut();
  const [smsOff, setSmsOff] = useState<boolean | null>(null);
  const smsBlocked = smsOff ?? client.sms_opt_out === true;
  const messages = log.data ?? NO_MESSAGES;
  const last = useMemo<SmsHistoryItem | null>(
    () =>
      messages.reduce<SmsHistoryItem | null>(
        (best, item) => (best === null || item.createdAt > best.createdAt ? item : best),
        null,
      ),
    [messages],
  );
  const more = moreLabel(messages.length);
  const openAll = () => {
    haptics.tap();
    router.push({ pathname: "/clients/sms", params: clientSubParams(client.id, scope) });
  };
  const smsName = (client.sms_name ?? "").trim();
  const fallbackName = firstName(client);

  return (
    <>
      <SectionCard
        title="SMS"
        action={more ? { label: more, pill: true, onPress: openAll } : undefined}
      >
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
        {last ? (
          <>
            <Divider inset={16} />
            <VisitDayHeader date={fileDay(last.createdAt)} />
            <View style={{ paddingHorizontal: 2, paddingBottom: 6 }}>
              <SmsPlaque
                item={last}
                phone={last.toPhone ? formatPhoneForDisplay(last.toPhone, country) : null}
                onPress={openAll}
              />
            </View>
          </>
        ) : null}
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
    </>
  );
}

