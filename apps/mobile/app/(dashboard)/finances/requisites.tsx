import { FinanceSettingsRoute } from "@/features/finances/FinanceSettingsRoute";
import { RequisitesScreen } from "@/features/companies/RequisitesScreen";

// РЕКВИЗИТЫ — ТОНКИЙ МАРШРУТ НАД СТРАНИЦЕЙ СПРАВОЧНИКА, как `invoices/new`
// над `InvoiceEditor`: экран держит только адрес, всё остальное живёт в
// `features/companies/RequisitesScreen.tsx`.
//
// АДРЕС — В «ФИНАНСАХ», А НЕ В КАБИНЕТЕ (владелец 2026-09-21: «настройка
// реквизитов — это будет находиться в настройках финансов»). Туда же ведёт
// строка «Реквизиты компании» из шестерёнки финансов и дверь «Реквизиты» из
// самих документов — дверь на настройку одна.
//
// ДВЕРЬ — ПРАВО СТРОКИ «Реквизиты» (03.10): партнёр с «Только видит» видит
// наборы без правки (страница гасит правку не владельцу сама).
export default function FinanceRequisitesRoute() {
  return (
    <FinanceSettingsRoute row="requisites" title="Реквизиты">
      <RequisitesScreen />
    </FinanceSettingsRoute>
  );
}
