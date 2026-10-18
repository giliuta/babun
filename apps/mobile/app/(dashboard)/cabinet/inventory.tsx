import { InventoryList } from "@/features/inventory/InventoryList";

export { InventoryList } from "@/features/inventory/InventoryList";

// Экран склада переиспользуется в двух местах (не дублируем CRUD):
//  · глобальный /cabinet/inventory (весь склад, InventoryScreen ниже),
//  · «оборудования одной команды» нет: склад общий.
// The list and its editor live in `src/features/inventory/`.
export default function InventoryScreen() {
  return <InventoryList />;
}
