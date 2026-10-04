import type { Href, Router } from "expo-router";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import { chooseOption } from "@/lib/choose";

// ДЕЙСТВИЯ С ЧЕКОМ — ОДНИ НА «⋯» СТРАНИЦЫ ЧЕКА И НА ДОЛГОЕ НАЖАТИЕ В
// «ДОКУМЕНТАХ» (владелец 2026-10-04). Править можно выписанный чек оплаты —
// на месте, тот же номер; аннулированный — только смотреть.

export function receiptCanEdit(receipt: Pick<Receipt, "status" | "transaction_id">): boolean {
  return receipt.status !== "void" && !!receipt.transaction_id;
}

export async function openReceiptMenu(
  receipt: Pick<Receipt, "id" | "number" | "status" | "transaction_id">,
  router: Pick<Router, "push">,
): Promise<void> {
  if (!receiptCanEdit(receipt)) return;
  const actions = [
    { label: "Изменить чек", run: () => router.push(`/documents/receipt-new?receiptId=${receipt.id}` as Href) },
  ];
  const index = await chooseOption(receipt.number, actions.map(({ label }) => ({ label })));
  if (index !== null && index >= 0) actions[index]?.run();
}
