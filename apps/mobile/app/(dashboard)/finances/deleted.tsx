import { FinanceSettingsRoute } from "@/features/finances/FinanceSettingsRoute";
import { DeletedOperationsScreen } from "@/features/finances/DeletedOperationsScreen";

// «УДАЛЁННЫЕ ОПЕРАЦИИ» — дверь шестерёнки «Финансов», блок «Деньги» (03.10).
// Закрыта правом строки «Удалённые операции».
export default function FinanceDeletedRoute() {
  return (
    <FinanceSettingsRoute row="trash" title="Удалённые операции">
      <DeletedOperationsScreen />
    </FinanceSettingsRoute>
  );
}
