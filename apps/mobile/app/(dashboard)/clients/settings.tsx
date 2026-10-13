import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";
import { ClientsSettingsScreen } from "@/features/clients/settings-page/ClientsSettingsScreen";

// «Настройки клиентов» — the page body lives in
// `src/features/clients/settings-page/`.

// Экран вкладки «Клиенты»: компанию называет источник, а не роль
// (STORY-082).
export default function ClientsSettingsScreenRoute() {
  return (
    <ClientsCompanyRoute kind="tab">
      <ClientsSettingsScreen />
    </ClientsCompanyRoute>
  );
}
