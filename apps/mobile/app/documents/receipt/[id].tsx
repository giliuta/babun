import { useLocalSearchParams } from "expo-router";
import { ReceiptPage } from "@/features/documents/ReceiptPage";

// СТРАНИЦА ЧЕКА — ТОНКИЙ МАРШРУТ, как `invoices/[id]` над своей страницей:
// выписанный чек живёт страницей, в такой же архитектуре, как инвойс.
export default function ReceiptRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReceiptPage id={id} />;
}
