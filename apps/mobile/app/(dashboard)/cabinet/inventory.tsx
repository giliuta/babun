import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";

// СКЛАД ОБОРУДОВАНИЯ — ПОКА В РАЗРАБОТКЕ. Дверь в Кабинете уже стоит, а
// рабочий список (`features/inventory/InventoryList.tsx`: позиции, команда,
// удаление) наружу не показывается: настройка склада доделывается отдельно,
// и до тех пор экран честно говорит, что раздел не готов. Код склада не
// удалён — его подключит тот, кто доделает раздел.
export default function InventoryScreen() {
  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Склад оборудования" />
      <EmptyState
        fill
        title="В разработке"
        subtitle="Здесь будет склад оборудования команд: что есть и за кем закреплено"
      />
    </Screen>
  );
}
