import { useRouter, type Href } from "expo-router";
import {
  calculateInvoiceSettlement,
  type InvoiceLedger,
  type InvoicePaymentLedger,
} from "@babun/shared/local/finance/invoice-ledger";
import { tDynamic } from "@babun/shared/i18n/runtime";
import { useCurrentRole } from "@/features/settings/tenant";
import { chooseOption } from "@/lib/choose";
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
    const paid = calculateInvoiceSettlement(invoice, [...ctx.payments]).paid;
    const hasNote = ctx.all.some((item) => item.credit_note_of_id === invoice.id);
    const untouched =
      invoice.status === "issued" && ctx.payments.length === 0 && !ctx.hasReceipt && !hasNote;

    const edit = () => router.push(`/invoices/new?invoiceId=${invoice.id}` as Href);
    // ОТМЕНА — КРЕДИТ-НОТОЙ, СВОЕЙ ФОРМОЙ С ПРЕВЬЮ (04.10). Деньги вперёд
    // бумаги: на инвойс с оплатой нота не выписывается — сразу говорим путь.
    const cancel = () => {
      if (paid > 0) {
        notify(
          "Сначала верните оплату",
          `По инвойсу получено ${formatInvoiceMoney(paid, invoice.currency)}.`
            + " Оформите возврат в списке платежей — после него инвойс отменяется"
            + " кредит-нотой.",
        );
        return;
      }
      router.push(`/invoices/credit-note?invoiceId=${invoice.id}` as Href);
    };
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
      ...(untouched ? [{ key: "edit" as const, label: "Изменить инвойс", run: edit }] : []),
      // «Кредит-нота», а не «Отменить инвойс»: рядом с «Отмена» шторки два
      // «отменить» путались (04.10).
      { key: "cancel" as const, label: "Кредит-нота", destructive: true, run: cancel },
      ...(untouched
        ? [{ key: "delete" as const, label: "Удалить инвойс", destructive: true, run: del }]
        : []),
    ];
  };

  /** Шторка действий; пусто — шторки нет. */
  const open = async (invoice: InvoiceLedger, ctx: InvoiceMenuContext) => {
    const actions = actionsFor(invoice, ctx);
    if (actions.length === 0) return;
    const index = await chooseOption(
      invoice.number,
      actions.map(({ label, destructive }) => ({ label, destructive })),
    );
    if (index !== null && index >= 0) actions[index]?.run();
  };

  return { actionsFor, open };
}
