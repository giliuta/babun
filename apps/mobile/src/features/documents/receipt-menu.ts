import { useRouter, type Href } from "expo-router";
import { Pencil, Undo2, type LucideIcon } from "lucide-react-native";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import { tDynamic } from "@babun/shared/i18n/runtime";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import type { ActionMenu } from "@/features/calendar/ActionMenuSheet";
import { confirmThen } from "@/lib/confirm";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { formatInvoiceMoney } from "@/features/invoices/format";
import { useDocumentWriter } from "./document-rights";
import { useDeleteReceipt } from "./receipts-queries";

// ДЕЙСТВИЯ С ЧЕКОМ — ОДНИ НА «⋯» СТРАНИЦЫ ЧЕКА И НА ДОЛГОЕ НАЖАТИЕ В
// «ДОКУМЕНТАХ» (владелец 2026-10-04: «зажимаю — вылезает полноценный список»,
// лист — как у записи). Выписанный чек оплаты можно править на месте (тот же
// номер), вернуть по нему деньги (форма возврата выпишет кредит-ноту) и
// удалить, если он последний в серии (номер вернётся, деньги останутся).
// Погашенный — только смотреть.

type Item = { label: string; destructive?: boolean; icon?: LucideIcon; color?: string; run: () => void };

export function receiptCanEdit(receipt: Pick<Receipt, "status" | "transaction_id">): boolean {
  return receipt.status !== "void" && !!receipt.transaction_id;
}

export function useReceiptMenu() {
  const router = useRouter();
  const remove = useDeleteReceipt();
  const canWrite = useDocumentWriter();

  const actionsFor = (receipt: Receipt, opts: { onDeleted?: () => void } = {}): Item[] => {
    // «Документы: Видит» — только смотреть (сервер откажет и сам).
    if (receipt.status === "void" || !canWrite(receipt.team_id)) return [];
    const items: Item[] = [];
    if (receiptCanEdit(receipt)) {
      items.push({
        label: "Изменить чек",
        icon: Pencil,
        color: SETTINGS_TILE.indigo,
        run: () => router.push(`/documents/receipt-new?receiptId=${receipt.id}` as Href),
      });
    }
    if (receipt.transaction_id) {
      items.push({
        label: "Возврат",
        icon: Undo2,
        color: SETTINGS_TILE.orange,
        run: () => router.push(`/documents/receipt-refund?receiptId=${receipt.id}` as Href),
      });
    }
    items.push({
      label: "Удалить чек",
      destructive: true,
      run: () =>
        confirmThen(
          `Удалить ${receipt.number}?`,
          {
            message: "Чек исчезнет, его номер достанется следующему чеку. Деньги останутся — чек на них можно выписать снова.",
            confirmLabel: "Удалить",
            destructive: true,
          },
          () =>
            remove.mutate(receipt.id, {
              onSuccess: () => {
                haptics.success();
                opts.onDeleted?.();
              },
              onError: (error) => notify("Чек не удалён", tDynamic(error.message)),
            }),
        ),
    });
    return items;
  };

  const menuFor = (
    receipt: Receipt,
    lead: Item[] = [],
    opts: { onDeleted?: () => void } = {},
  ): ActionMenu | null => {
    const items = [...lead, ...actionsFor(receipt, opts)];
    if (items.length === 0) return null;
    return {
      title: receipt.number,
      subtitle: formatInvoiceMoney(receipt.amount, receipt.currency),
      items,
    };
  };

  return { actionsFor, menuFor };
}
