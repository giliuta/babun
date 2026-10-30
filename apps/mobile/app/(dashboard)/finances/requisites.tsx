// РЕКВИЗИТЫ — шестерёнка «Финансов» → «Реквизиты» у выбранного календаря
// (`?team=`). Наборы одни на аккаунт, у каждого — его календари; партнёр с
// «Реквизиты: Видит» видит только наборы своих календарей (сервер). Тело —
// `features/companies/RequisitesScreen.tsx`; документы зовут ту же страницу
// поверх себя — `app/(shared)/requisites.tsx`.
import { FinanceSettingsRoute } from "@/features/finances/FinanceSettingsRoute";
import { RequisitesScreen } from "@/features/companies/RequisitesScreen";

export default function FinanceRequisitesRoute() {
  return (
    <FinanceSettingsRoute row="requisites" title="Реквизиты">
      <RequisitesScreen />
    </FinanceSettingsRoute>
  );
}
