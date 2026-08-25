import { useState } from "react";
import { Alert } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
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
import { todayYmd } from "@/features/invoices/format";
import {
  useEditInvoice,
  useInvoice,
  useInvoicePayments,
} from "@/features/invoices/queries";
import { useTeams } from "@/features/reference/queries";
import { useTenant } from "@/features/settings/tenant";
import { useCalendarSettings } from "@/features/settings/local-settings";
import {
  effectiveVatSettings,
  useTeamVatOverrides,
  useVatSettings,
} from "@/features/finances/vat-queries";

export default function EditInvoiceScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoice = useInvoice(id);
  const clients = useClients();
  const appointments = useAppointments();
  // Счёт читает у услуги ТОЛЬКО имя и описание, ничего не выбирая, поэтому
  // список берётся полный — включая убранные из прайса. Иначе позиция уже
  // выставленного документа теряла название и печаталась заглушкой.
  const services = useAllServices();
  const teams = useTeams();
  const payments = useInvoicePayments();
  const calendarSettings = useCalendarSettings();
  const businessToday = todayYmd(
    calendarSettings.data?.timezone ?? "Europe/Nicosia",
  );
  const tenant = useTenant();
  const vat = useVatSettings();
  const teamVat = useTeamVatOverrides();
  const edit = useEditInvoice(id, invoice.data?.issued_on ?? businessToday);

  const loading =
    invoice.isLoading ||
    clients.isLoading ||
    appointments.isLoading ||
    teams.isLoading ||
    services.isLoading ||
    payments.isLoading ||
    calendarSettings.isLoading ||
    vat.isLoading ||
    teamVat.isLoading;
  // Отказ любого запроса (включая НДС и услуги) не должен молча пропускать
  // редактор с пустыми данными — он попадает в error и retry.
  const error =
    (invoice.data === undefined ? invoice.error : null) ||
    (clients.data === undefined ? clients.error : null) ||
    (appointments.data === undefined ? appointments.error : null) ||
    (teams.data === undefined ? teams.error : null) ||
    (services.data === undefined ? services.error : null) ||
    (payments.data === undefined ? payments.error : null) ||
    (calendarSettings.data === undefined ? calendarSettings.error : null) ||
    (vat.data === undefined ? vat.error : null) ||
    (teamVat.data === undefined ? teamVat.error : null);
  const hasPayments = (payments.data?.[id]?.length ?? 0) > 0;
  const retry = () => void Promise.all([
    invoice.refetch(),
    clients.refetch(),
    appointments.refetch(),
    teams.refetch(),
    services.refetch(),
    payments.refetch(),
    calendarSettings.refetch(),
    vat.refetch(),
    teamVat.refetch(),
  ]);

  const submit = async (value: InvoiceEditorValue) => {
    await edit.mutateAsync({
      due_on: value.due_on,
      client_id: value.client_id,
      appointment_id: value.appointment_id,
      brigade_id: value.brigade_id,
      vat_mode: value.vat_mode,
      vat_percent: value.vat_percent,
      lines: value.lines,
      notes: value.notes,
    });
    router.replace(`/invoices/${id}` as Href);
  };

  // Правка документа стирается тем же одним тапом, что и новый черновик —
  // и спрашивает о том же.
  const [dirty, setDirty] = useState(false);
  const leave = () =>
    router.canGoBack() ? router.back() : router.replace(`/invoices/${id}` as Href);
  const back = () => {
    if (!dirty) {
      leave();
      return;
    }
    Alert.alert("Правка не сохранена", "Выйти и потерять изменения?", [
      { text: "Остаться", style: "cancel" },
      { text: "Выйти", style: "destructive", onPress: leave },
    ]);
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Редактировать инвойс" onBack={back} />
      {loading ? (
        <EmptyState state="loading" fill />
      ) : error ? (
        <EmptyState
          state="error"
          fill
          subtitle={(error as Error).message}
          action={{ label: "Повторить", onPress: retry }}
        />
      ) : !invoice.data ? (
        <EmptyState
          state="error"
          fill
          title="Инвойс не найден"
          action={{ label: "Повторить", onPress: retry }}
        />
      ) : invoice.data.status !== "issued" || hasPayments ? (
        <EmptyState
          state="error"
          fill
          title="Редактирование недоступно"
          subtitle="Инвойс с платежами нельзя менять. Сначала оформите возврат или создайте новый документ."
        />
      ) : (
        <InvoiceEditor
          key={invoice.data.updated_at}
          initial={invoice.data}
          onDirtyChange={setDirty}
          tenant={tenant.data}
          // В режиме правки налог документа главнее настройки, но резолвер
          // нужен и здесь: он решает, показывать ли клавиши НДС вообще.
          vatForTeam={(teamId) =>
            effectiveVatSettings(
              vat.data,
              teamId
                ? (teamVat.data ?? []).find((o) => o.teamId === teamId)
                : undefined,
              null,
            )
          }
          clients={clients.data ?? []}
          appointments={appointments.data ?? []}
          services={services.data ?? []}
          // Выставленный документ хранит свои строки и срок — генератор здесь
          // работает только если к счёту ПРИВЯЖУТ заявку в пустом бланке.
          generator={invoiceGeneratorSettings(tenant.data)}
          teams={teams.data ?? []}
          businessToday={businessToday}
          submitting={edit.isPending}
          onSubmit={submit}
        />
      )}
    </Screen>
  );
}
