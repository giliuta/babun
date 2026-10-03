import { FinanceSettingsRoute } from "@/features/finances/FinanceSettingsRoute";
import { RequisitesScreen } from "@/features/companies/RequisitesScreen";

// РЕКВИЗИТЫ — ТОНКИЙ МАРШРУТ НАД СТРАНИЦЕЙ СПРАВОЧНИКА: экран держит только
// адрес, всё остальное живёт в `features/companies/RequisitesScreen.tsx`.
//
// АДРЕС — В КАБИНЕТЕ (владелец 2026-10-03: «запихни реквизиты компании в
// кабинет — это единый блок на все компании»). До этого страница жила за
// шестерёнкой «Финансов» (`/finances/requisites`, решение 2026-09-21).
// Документы зовут ту же страницу поверх себя — `app/(shared)/requisites.tsx`.
//
// ДВЕРЬ — ПРАВО СТРОКИ «Реквизиты» (03.10): партнёр с «Только видит» видит
// наборы без правки (страница гасит правку не владельцу сама).
export default function CabinetRequisitesRoute() {
  return (
    <FinanceSettingsRoute row="requisites" title="Реквизиты">
      <RequisitesScreen />
    </FinanceSettingsRoute>
  );
}
