import { useRef } from "react";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { randomUuid } from "@babun/shared/sync";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useAppointments } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import {
  InvoiceEditor,
  type InvoiceEditorValue,
} from "@/features/invoices/InvoiceEditor";
import { useIssueInvoice } from "@/features/invoices/queries";
import { useTeams } from "@/features/reference/queries";
import { useTenant } from "@/features/settings/tenant";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { todayYmd } from "@/features/invoices/format";

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
  const teams = useTeams();
  const tenant = useTenant();
  const calendarSettings = useCalendarSettings();
  const issue = useIssueInvoice();
  const requestId = useRef(randomUuid()).current;

  const amount = params.amount ? Number(params.amount) : null;
  const loading = clients.isLoading || appointments.isLoading || teams.isLoading
    || tenant.isLoading || calendarSettings.isLoading;
  // A failed background refetch must not unmount InvoiceEditor and erase the
  // user's draft. Only replace the editor when a required query has no usable
  // data at all; retrying keeps all local form state intact.
  const error = (clients.data === undefined ? clients.error : null)
    || (appointments.data === undefined ? appointments.error : null)
    || (teams.data === undefined ? teams.error : null)
    || (tenant.data === undefined ? tenant.error : null)
    || (calendarSettings.data === undefined ? calendarSettings.error : null);
  const retry = () => void Promise.all([
    clients.refetch(),
    appointments.refetch(),
    teams.refetch(),
    tenant.refetch(),
    calendarSettings.refetch(),
  ]);
  const businessToday = todayYmd(
    calendarSettings.data?.timezone ?? "Europe/Nicosia",
  );

  const submit = async (value: InvoiceEditorValue) => {
    const invoice = await issue.mutateAsync({ ...value, request_id: requestId });
    router.replace(`/invoices/${invoice.id}` as Href);
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Новый инвойс" />
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
          defaultVatMode={tenant.data?.vat_number ? "inclusive" : "off"}
          clients={clients.data ?? []}
          appointments={appointments.data ?? []}
          teams={teams.data ?? []}
          businessToday={businessToday}
          submitting={issue.isPending}
          onSubmit={submit}
        />
      )}
    </Screen>
  );
}
