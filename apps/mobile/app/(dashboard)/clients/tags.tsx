import { ClientSettingsRoute } from "@/features/clients/ClientSettingsRoute";
import { ClientTagsScreen } from "@/features/clients/tags-page/ClientTagsScreen";

// Теги клиентов — the page body lives in `src/features/clients/tags-page/`.

// Экран вкладки «Клиенты»: компанию называет источник, а не роль
// (STORY-082).
export default function ClientTagsScreenRoute() {
  return (
    <ClientSettingsRoute row="tags">
      <ClientTagsScreen />
    </ClientSettingsRoute>
  );
}
