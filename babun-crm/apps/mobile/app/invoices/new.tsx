import { useRef, useState } from "react";
import { Alert } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { randomUuid } from "@babun/shared/sync";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useAppointments } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import { useAllServices } from "@/features/services/queries";
import { invoiceGeneratorSettings } from "@/features/invoices/generator-settings";
import {
  InvoiceEditor,
  type InvoiceEditorValue,
} from "@/features/invoices/InvoiceEditor";
import {
  useIssueInvoice,
  useNextInvoiceNumber,
} from "@/features/invoices/queries";
import { useTeams } from "@/features/reference/queries";
import { useTenant } from "@/features/settings/tenant";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { todayYmd } from "@/features/invoices/format";
import {
  effectiveVatSettings,
  useTeamVatOverrides,
  useVatSettings,
} from "@/features/finances/vat-queries";

export default function NewInvoiceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    transactionId?: string;
    clientId?: string;
    appointmentId?: string;
    teamId?: string;
    amount?: string;
    title?: string;
    issuedOn?: string;
  }>();
  const clients = useClients();
  const appointments = useAppointments();
  // Услуги нужны генератору: он расписывает визит их названиями.
  // Счёт читает у услуги ТОЛЬКО имя и описание, ничего не выбирая, поэтому
  // список берётся полный — включая убранные из прайса. Иначе позиция уже
  // выставленного документа теряла название и печаталась заглушкой.
  const services = useAllServices();
  const teams = useTeams();
  const tenant = useTenant();
  const calendarSettings = useCalendarSettings();
  const issue = useIssueInvoice();
  const vat = useVatSettings();
  const teamVat = useTeamVatOverrides();
  const businessToday = todayYmd(
    calendarSettings.data?.timezone ?? "Europe/Nicosia",
  );
  // Год для серии номера — от ДАТЫ ВЫСТАВЛЕНИЯ (редактор сообщает её сюда),
  // а не от часов устройства: в новогоднюю ночь и при датировании другим
  // годом человек видел номер чужой серии.
  const [issuedOn, setIssuedOn] = useState<string | null>(null);
  const nextNumber = useNextInvoiceNumber(
    Number((issuedOn ?? businessToday).slice(0, 4)),
  );
  const requestId = useRef(randomUuid()).current;

  const amount = params.amount ? Number(params.amount) : null;
  // Ждём и настройки НДС (компании И команд): редактор берёт режим ОДИН РАЗ
  // при рождении, и смонтированный раньше ответа он навсегда оставался
  // «Без НДС».
  // Услуги ждём вместе с остальным: смонтированный без них редактор собрал бы
  // строки без названий и запомнил бы их — генератор считает ОДИН раз.
  const loading = clients.isLoading || appointments.isLoading || teams.isLoading
    || services.isLoading || tenant.isLoading || calendarSettings.isLoading
    || vat.isLoading || teamVat.isLoading;
  // A failed background refetch must not unmount InvoiceEditor and erase the
  // user's draft. Only replace the editor when a required query has no usable
  // data at all; retrying keeps all local form state intact.
  // НДС и услуги стоят в этом же гейте: их отказ гасит isLoading, и редактор
  // молча рождался бы «Без НДС» и со строками без названий.
  const error = (clients.data === undefined ? clients.error : null)
    || (appointments.data === undefined ? appointments.error : null)
    || (teams.data === undefined ? teams.error : null)
    || (services.data === undefined ? services.error : null)
    || (tenant.data === undefined ? tenant.error : null)
    || (calendarSettings.data === undefined ? calendarSettings.error : null)
    || (vat.data === undefined ? vat.error : null)
    || (teamVat.data === undefined ? teamVat.error : null);
  const retry = () => void Promise.all([
    clients.refetch(),
    appointments.refetch(),
    teams.refetch(),
    services.refetch(),
    tenant.refetch(),
    calendarSettings.refetch(),
    vat.refetch(),
    teamVat.refetch(),
  ]);

  const submit = async (value: InvoiceEditorValue) => {
    const invoice = await issue.mutateAsync({ ...value, request_id: requestId });
    router.replace(`/invoices/${invoice.id}` as Href);
  };

  // ЗАПОЛНЕННЫЙ ЧЕРНОВИК НЕ ИСЧЕЗАЕТ ПО ОДНОМУ ТАПУ. Клиент, позиции, налог и
  // комментарий — это работа на минуту, и «‹» стирала её без вопроса.
  const [dirty, setDirty] = useState(false);
  const leave = () =>
    router.canGoBack() ? router.back() : router.replace("/invoices" as Href);
  const back = () => {
    if (!dirty) {
      leave();
      return;
    }
    Alert.alert("Черновик не сохранён", "Выйти и потерять заполненное?", [
      { text: "Остаться", style: "cancel" },
      { text: "Выйти", style: "destructive", onPress: leave },
    ]);
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Новый инвойс" onBack={back} />
      {loading ? (
        <EmptyState state="loading" fill />
      ) : error ? (
        <EmptyState
          state="error"
          fill
          subtitle={(error as Error).message}
          action={{ label: "Повторить", onPress: retry }}
        />
      ) : (
        <InvoiceEditor
          prefill={{
            transactionId: params.transactionId,
            clientId: params.clientId,
            appointmentId: params.appointmentId,
            teamId: params.teamId,
            amount: Number.isFinite(amount) ? amount : null,
            title: params.title,
            issuedOn: params.issuedOn,
          }}
          // Налог инвойса — из НАСТРОЙКИ, а не из догадки по наличию VAT-номера:
          // раньше компания, работающая «плюсом», получала счёт с налогом
          // внутри цены, то есть на 19% меньше денег. Резолвер — по КОМАНДЕ
          // (Кипр 19 и Греция 24 живут в одном тенанте); счёта у инвойса нет.
          vatForTeam={(teamId) =>
            effectiveVatSettings(
              vat.data,
              teamId
                ? (teamVat.data ?? []).find((o) => o.teamId === teamId)
                : undefined,
              null,
            )
          }
          onIssuedOnChange={setIssuedOn}
          onDirtyChange={setDirty}
          clients={clients.data ?? []}
          appointments={appointments.data ?? []}
          services={services.data ?? []}
          generator={invoiceGeneratorSettings(tenant.data)}
          teams={teams.data ?? []}
          businessToday={businessToday}
          tenant={tenant.data}
          nextNumber={nextNumber.data ?? undefined}
          submitting={issue.isPending}
          onSubmit={submit}
        />
      )}
    </Screen>
  );
}
