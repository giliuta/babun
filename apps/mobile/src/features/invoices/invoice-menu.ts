import { useRouter, type Href } from "expo-router";
import { Pencil, Undo2, type LucideIcon } from "lucide-react-native";
import {
  type InvoiceLedger,
  type InvoicePaymentLedger,
} from "@babun/shared/local/finance/invoice-ledger";
import { tDynamic } from "@babun/shared/i18n/runtime";
import { useCurrentRole } from "@/features/settings/tenant";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import type { ActionMenu } from "@/features/calendar/ActionMenuSheet";
import { confirmThen } from "@/lib/confirm";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { formatInvoiceMoney } from "./format";
import { invoiceDeleteBlock } from "./invoice-delete";
import { useDeleteInvoice } from "./queries";

// ДЕЙСТВИЯ С ИНВОЙСОМ — ОДНИ НА «⋯» СТРАНИЦЫ И НА ДОЛГОЕ НАЖАТИЕ В
// «ДОКУМЕНТАХ» (владелец 2026-10-04: «три точки — не „поделиться“ и прочее
// лишнее, а настройки: изменить, кредит-нота; долгое нажатие на инвойс или
// чек — шторка с тем же»). «Поделиться PDF» здесь нет: значок в шапке и
// кнопка внизу. Правила — те же, что у сервера: править и удалять можно, пока
// денег, чека и кредит-ноты нет; удалить — только последний в серии; отменить
// — кредит-нотой, и только когда денег по нему у нас не осталось.

export interface MenuAction {
  key: "edit" | "cancel" | "delete";
  label: string;
  destructive?: boolean;
  /** Значок и цвет строки в листе действий (как у меню записи). */
  icon?: LucideIcon;
  color?: string;
  run: () => void;
}

export interface InvoiceMenuContext {
  /** Все инвойсы — серия (последний ли) и кредит-ноты. */
  all: readonly InvoiceLedger[];
  payments: readonly InvoicePaymentLedger[];
  /** По инвойсу выписан чек. */
  hasReceipt: boolean;
  /** Удалён — куда уйти со страницы (у списка — никуда). */
  onDeleted?: () => void;
}

export function useInvoiceMenu() {
  const router = useRouter();
  const remove = useDeleteInvoice();
  const owner = useCurrentRole().data === "owner";

  const actionsFor = (invoice: InvoiceLedger, ctx: InvoiceMenuContext): MenuAction[] => {
    // Оплаченный тоже получает «Отменить»: шторка не молчит, а называет путь —
    // сначала возврат оплаты, потом кредит-нота.
    if (
      !owner ||
      (invoice.kind ?? "invoice") !== "invoice" ||
      (invoice.status !== "issued" && invoice.status !== "paid")
    ) {
      return [];
    }
    const hasNote = ctx.all.some((item) => item.credit_note_of_id === invoice.id);
    const untouched =
      invoice.status === "issued" && ctx.payments.length === 0 && !ctx.hasReceipt && !hasNote;

    const edit = () => router.push(`/invoices/new?invoiceId=${invoice.id}` as Href);
    // КРЕДИТ-НОТА — СВОЕЙ ФОРМОЙ С ПРЕВЬЮ (04.10): вся сумма — отмена, часть —
    // инвойс остаётся в силе. По оплаченному форма сама скажет, что на всю
    // сумму сначала возврат, а часть вернёт клиенту тем же движением.
    const cancel = () => router.push(`/invoices/credit-note?invoiceId=${invoice.id}` as Href);
    const del = () => {
      if (invoiceDeleteBlock(invoice, ctx.all, false) === "not-last") {
        notify(
          "Удалить нельзя",
          `После ${invoice.number} уже выставлены инвойсы — номер не освободить. Отмените его кредит-нотой.`,
        );
        return;
      }
      confirmThen(
        `Удалить ${invoice.number}?`,
        {
          message: "Инвойс исчезнет совсем, а его номер достанется следующему инвойсу. Отправленный клиенту лучше отменить кредит-нотой.",
          confirmLabel: "Удалить",
          destructive: true,
        },
        () =>
          remove.mutate(invoice.id, {
            onSuccess: () => {
              haptics.success();
              ctx.onDeleted?.();
            },
            onError: (error) => notify("Инвойс не удалён", tDynamic(error.message)),
          }),
      );
    };

    return [
      ...(untouched
        ? [{ key: "edit" as const, label: "Изменить инвойс", icon: Pencil, color: SETTINGS_TILE.indigo, run: edit }]
        : []),
      // «Кредит-нота», а не «Отменить инвойс»: рядом с «Отмена» шторки два
      // «отменить» путались (04.10).
      { key: "cancel" as const, label: "Кредит-нота", icon: Undo2, color: SETTINGS_TILE.orange, run: cancel },
      ...(untouched
        ? [{ key: "delete" as const, label: "Удалить инвойс", destructive: true, run: del }]
        : []),
    ];
  };

  /** Лист действий инвойса — тот же, что у записи в календаре (04.10:
   *  «зажимаю — вылезает полноценный список»). `lead` — пункты, которые знает
   *  только место вызова (открыть, поделиться, оплата, чек). */
  const menuFor = (
    invoice: InvoiceLedger,
    ctx: InvoiceMenuContext,
    lead: Omit<MenuAction, "key">[] = [],
  ): ActionMenu | null => {
    const items = [...lead, ...actionsFor(invoice, ctx)];
    if (items.length === 0) return null;
    return {
      title: invoice.number,
      subtitle: formatInvoiceMoney(invoice.total, invoice.currency),
      items: items.map(({ label, destructive, icon, color, run }) => ({ label, destructive, icon, color, run })),
    };
  };

  return { actionsFor, menuFor };
}
