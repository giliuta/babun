import { useClientAppointments } from "@/features/clients/appointments";
import { useGuardedBookingNav } from "@/features/clients/card-booking";
import type { ClientsScope } from "@/session/clients-company";
import { useDeleteWithUndo } from "@/features/clients/delete-undo";
import {
  useClient,
  useClientTags,
  useRestoreClient,
  useTrashClientAsPartner,
  useUpdateClient,
} from "@/features/clients/queries";
import { useRevealedClient } from "@/session/revealed-contacts";
import { useCalendarActionsReader } from "@/features/appointments/useRecordRights";
import { useAllServices } from "@/features/services/queries";
import { usePlanAllows } from "@/session/tenant";
import { useTenantId } from "@/lib/tenant";

/** What the card reads from the server and the writers it needs. */
export function useCardQueries(id: string, isDraft: boolean, scope: ClientsScope | null) {
  const clientQuery = useClient(isDraft ? "" : id);
  const {
    data: clientRow,
    isLoading,
    isError: clientFailed,
    error: clientError,
    isRefetching: clientRetrying,
    refetch: retryClient,
  } = clientQuery;
  // Номер, открытый сотрудником дверью, — поверх строки окна: сам
  // список контактов не несёт, открытое живёт только в памяти.
  const activeTenantId = useTenantId();
  const client = useRevealedClient(clientRow, scope?.tenantId ?? activeTenantId);
  const updateClient = useUpdateClient(isDraft ? "" : id);
  const deleteWithUndo = useDeleteWithUndo();
  const trashAsPartner = useTrashClientAsPartner();
  // «Записать» в «⋯» — тем же гейтом, что строка «Записать» блока
  // «История», и только с правом «Новые записи» в команде клиента.
  const guardedBook = useGuardedBookingNav();
  const calendarActionsFor = useCalendarActionsReader();
  const bookInPlan = usePlanAllows("book-clients");
  const restoreClient = useRestoreClient();
  const appointmentsQuery = useClientAppointments(isDraft ? "" : id);
  const {
    data: appointments = [],
    isError: appointmentsFailed,
    isRefetching: appointmentsRetrying,
    refetch: retryAppointments,
  } = appointmentsQuery;
  const tagsQuery = useClientTags();
  const {
    data: tags = [],
    isError: tagsFailed,
    isRefetching: tagsRetrying,
    refetch: retryTags,
  } = tagsQuery;
  // Web parity: VisitsBlock resolves service NAMES from the catalog.
  // Лента истории и блок объектов зовут услугу по имени — читаем весь
  // справочник, включая убранное: карточка показывает прошлое.
  const servicesQuery = useAllServices();
  const {
    data: services = [],
    isError: servicesFailed,
    isRefetching: servicesRetrying,
    refetch: retryServices,
  } = servicesQuery;
  const staleCopy = !isDraft && clientFailed;
  const partFailed = tagsFailed || (!isDraft && (appointmentsFailed || servicesFailed));
  return {
    clientQuery,
    clientRow,
    isLoading,
    clientFailed,
    clientError,
    clientRetrying,
    retryClient,
    client,
    updateClient,
    deleteWithUndo,
    trashAsPartner,
    guardedBook,
    calendarActionsFor,
    bookInPlan,
    restoreClient,
    appointments,
    appointmentsRetrying,
    retryAppointments,
    tags,
    tagsRetrying,
    retryTags,
    services,
    servicesRetrying,
    retryServices,
    staleCopy,
    partFailed,
  };
}
