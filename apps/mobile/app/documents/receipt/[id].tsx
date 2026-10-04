import { useLocalSearchParams } from "expo-router";
import { ReceiptPage } from "@/features/documents/ReceiptPage";

// СТРАНИЦА ЧЕКА — ТОНКИЙ МАРШРУТ, как `invoices/[id]` над своей страницей:
// выписанный чек живёт страницей (владелец 04.10: «чек — в такой же
// архитектуре, как инвойс»).
export default function ReceiptRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReceiptPage id={id} />;
}
