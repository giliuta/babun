import { FinanceSettingsRoute } from "@/features/finances/FinanceSettingsRoute";
import { InvoiceBlankScreen } from "@/features/invoices/InvoiceBlankScreen";

// «ИНВОЙСЫ» — дверь шестерёнки «Финансов», блок «Документы». Закрыта правом
// строки «Инвойсы» (03.10): партнёр его только видит.
export default function FinanceInvoiceBlankRoute() {
  return (
    <FinanceSettingsRoute row="invoices" title="Инвойсы">
      <InvoiceBlankScreen />
    </FinanceSettingsRoute>
  );
}
