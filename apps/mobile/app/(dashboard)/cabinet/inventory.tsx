import { InventoryList } from "@/features/inventory/InventoryList";

export { InventoryList } from "@/features/inventory/InventoryList";

// Экран склада переиспользуется в двух местах (не дублируем CRUD):
//  · глобальный /cabinet/inventory (весь склад, InventoryScreen ниже),
//  · обёртка «оборудование одной команды» снесена 2026-08-30 вместе с
//    разделом «Команды» в Кабинете; склад остался общим.
// The list and its editor live in `src/features/inventory/`.
export default function InventoryScreen() {
  return <InventoryList />;
}
