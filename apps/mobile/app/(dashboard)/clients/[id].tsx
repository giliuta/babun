import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";
import { ClientDetailScreen } from "@/features/clients/card/ClientDetailScreen";

// Client card route (also the create page, `id=new`). The body lives in
// `src/features/clients/card/`; `app/(shared)/client.tsx` reuses it from here.
export { ClientDetailScreen };

// КАРТОЧКА ОТКРЫВАЕТСЯ В КОМПАНИИ СВОЕЙ СТРОКИ (STORY-082): `?tenant=` несёт
// компанию, ворота решают, чья она, и объявляют источник блокам.
export default function ClientDetailRoute() {
  return (
    <ClientsCompanyRoute kind="card">
      <ClientDetailScreen />
    </ClientsCompanyRoute>
  );
}
