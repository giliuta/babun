import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useAppointments } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
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
import { useCalendarSettings } from "@/features/settings/local-settings";

export default function EditInvoiceScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoice = useInvoice(id);
  const clients = useClients();
  const appointments = useAppointments();
  const teams = useTeams();
  const payments = useInvoicePayments();
  const calendarSettings = useCalendarSettings();
  const businessToday = todayYmd(
    calendarSettings.data?.timezone ?? "Europe/Nicosia",
  );
  const edit = useEditInvoice(id, invoice.data?.issued_on ?? businessToday);

  const loading =
    invoice.isLoading ||
    clients.isLoading ||
    appointments.isLoading ||
    teams.isLoading ||
    payments.isLoading ||
    calendarSettings.isLoading;
  const error =
    (invoice.data === undefined ? invoice.error : null) ||
    (clients.data === undefined ? clients.error : null) ||
    (appointments.data === undefined ? appointments.error : null) ||
    (teams.data === undefined ? teams.error : null) ||
    (payments.data === undefined ? payments.error : null) ||
    (calendarSettings.data === undefined ? calendarSettings.error : null);
  const hasPayments = (payments.data?.[id]?.length ?? 0) > 0;
  const retry = () => void Promise.all([
    invoice.refetch(),
    clients.refetch(),
    appointments.refetch(),
    teams.refetch(),
    payments.refetch(),
    calendarSettings.refetch(),
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

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Редактировать инвойс" />
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
          defaultVatMode="off"
          clients={clients.data ?? []}
          appointments={appointments.data ?? []}
          teams={teams.data ?? []}
          businessToday={businessToday}
          submitting={edit.isPending}
          onSubmit={submit}
        />
      )}
    </Screen>
  );
}
