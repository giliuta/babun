import { Fragment, useMemo, useState } from "react";
import { ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectList } from "@/components/ui/select-rows";
import { fileDay, groupFilesByDay } from "@/features/clients/client-files";
import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";
import { useClientsScopeOrNull } from "@/features/clients/company-scope";
import { useDefaultCountry } from "@/features/clients/default-country";
import { formatPhoneForDisplay } from "@/features/clients/phone";
import { useClient } from "@/features/clients/queries";
import { useCardAccess } from "@/features/clients/use-card-access";
import { VisitDayHeader } from "@/features/clients/VisitRow";
import { useTeams } from "@/features/reference/queries";
import { useClientSms, type SmsHistoryItem } from "@/features/sms/sms-account";
import { SmsMessageSheet } from "@/features/sms/SmsMessageSheet";
import { SmsPlaque } from "@/features/sms/SmsPlaque";
import { loadErrorWords } from "@/lib/connection-words";

// ВСЕ SMS КЛИЕНТУ — СВОЯ СТРАНИЦА, КАК «ИСТОРИЯ» И «ФАЙЛЫ» (владелец 03.10:
// «блок SMS — постараться улучшить, чтобы было более красиво»). На карточке
// — последнее сообщение плашкой и «Ещё N»; здесь — все, днями, свежие
// сверху. Тап — сообщение целиком. Кнопки «Отправить» нет и здесь: SMS
// уходит только с трубки клиента (владелец 03.10).
//
// Открыта по праву «SMS» этого клиента (`card-access.ts`), как блок.

const HISTORY_LIMIT = 200;

export default function ClientSmsScreenRoute() {
  return (
    <ClientsCompanyRoute kind="card">
      <ClientSmsScreen />
    </ClientsCompanyRoute>
  );
}

function ClientSmsScreen() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const id = clientId ?? "";
  const { data: client } = useClient(id);
  const access = useCardAccess(client, false);
  const country = useDefaultCountry(client?.team_id ?? null);
  const { data: teams = [] } = useTeams();
  // Компания карточки: клиент работодателя читается под её заголовком.
  const cardTenantId = useClientsScopeOrNull()?.tenantId ?? null;
  const log = useClientSms(id, HISTORY_LIMIT, cardTenantId);
  const [open, setOpen] = useState<SmsHistoryItem | null>(null);
  const days = useMemo(
    () =>
      groupFilesByDay(
        [...(log.data ?? [])]
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
          .map((item) => ({ item, day: fileDay(item.createdAt) })),
      ),
    [log.data],
  );

  const errorWords = loadErrorWords(log.error, {
    failed: "Не удалось загрузить SMS",
    later: "Сообщения загрузятся, как только сервер ответит.",
  });

  return (
    // Нижнюю зону держит таб-бар — как у «Истории» и «Файлов».
    <Screen edges={["top"]}>
      <ScreenHeader title="SMS" subtitle={client?.full_name || undefined} />
      {!access.sms.show ? null : log.isLoading ? (
        <EmptyState state="loading" fill />
      ) : log.isError && !log.data ? (
        <EmptyState
          state="error"
          fill
          title={errorWords.title}
          subtitle={errorWords.subtitle}
          action={{ label: "Повторить", onPress: () => void log.refetch(), loading: log.isRefetching }}
        />
      ) : days.length === 0 ? (
        <EmptyState fill title="Сообщений пока нет" />
      ) : (
        <ScrollView contentContainerStyle={{ paddingTop: 4, paddingBottom: 24 }}>
          {days.map(({ day, items }) => (
            <Fragment key={day}>
              <VisitDayHeader date={day} />
              <SelectList>
                {items.map(({ item }) => (
                  <SmsPlaque
                    key={item.id}
                    item={item}
                    phone={item.toPhone ? formatPhoneForDisplay(item.toPhone, country) : null}
                    onPress={() => setOpen(item)}
                  />
                ))}
              </SelectList>
            </Fragment>
          ))}
        </ScrollView>
      )}

      <SmsMessageSheet
        item={open}
        teamName={(teamId) => teams.find((x) => x.id === teamId)?.name ?? null}
        from="client"
        onClose={() => setOpen(null)}
      />
    </Screen>
  );
}
