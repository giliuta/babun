import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";
import { ClientsListScreen } from "@/features/clients/list/ClientsListScreen";

// Clients tab route. The list lives in `src/features/clients/list/`.

// ОБЩАЯ СТРАНИЦА (STORY-082): ворота говорят, чья это компания, экран
// склеивает её список с клиентами компаний, где человеку их открыли.
export default function ClientsListRoute() {
  return (
    <ClientsCompanyRoute kind="tab">
      <ClientsListScreen />
    </ClientsCompanyRoute>
  );
}
