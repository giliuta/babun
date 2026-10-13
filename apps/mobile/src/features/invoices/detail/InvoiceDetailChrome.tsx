import { Pressable, Text, View } from "react-native";
import { MoreHorizontal, Share2 } from "lucide-react-native";
import {
  INVOICE_STATUS_LABELS,
  type InvoiceDisplayStatus,
  type InvoiceLedger,
  type InvoiceSettlement,
} from "@babun/shared/local/finance/invoice-ledger";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { formatInvoiceMoney } from "../format";
import { InvoiceStatusBadge } from "../InvoiceStatusBadge";

/** «Поделиться PDF» and «⋯» in the invoice page header. */
export function InvoiceHeaderActions({
  docWrite,
  pdfBusy,
  hasMenu,
  onShare,
  onMenu,
}: {
  docWrite: boolean;
  pdfBusy: boolean;
  hasMenu: boolean;
  onShare: () => void;
  onMenu: () => void;
}) {
  const t = useThemeColors();
  return (
    <View style={{ flexDirection: "row" }}>
      {/* «Документы: Видит» — смотрит, но не отправляет (владелец 04.10). */}
      {docWrite ? (
      <Pressable
        onPress={pdfBusy ? undefined : onShare}
        disabled={pdfBusy}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Поделиться PDF"
        className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
      >
        {/* Сборка PDF занимает секунды: немая иконка под пальцем
            читается как поломка — на время работы крутится спиннер. */}
        {pdfBusy ? (
          <Spinner size={18} label="Готовим PDF" />
        ) : (
          <Share2 color={t.body} size={ICON.sm} />
        )}
      </Pressable>
      ) : null}
      {hasMenu ? (
        <Pressable
          onPress={onMenu}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Ещё действия"
          className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
        >
          <MoreHorizontal color={t.body} size={ICON.sm} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The one footer action of the invoice page. */
export function InvoiceDetailFooter({
  awaitsPayment,
  docWrite,
  canIssueReceipt,
  paymentLabel,
  pdfBusy,
  onPayment,
  onIssueReceipt,
  onShare,
}: {
  awaitsPayment: boolean;
  docWrite: boolean;
  /** Not void/cancelled, not a credit note, receipts loaded and a payment
   *  still without its receipt. */
  canIssueReceipt: boolean;
  paymentLabel: string;
  pdfBusy: boolean;
  onPayment: () => void;
  onIssueReceipt: () => void;
  onShare: () => void;
}) {
  const t = useThemeColors();
  // ДЕЙСТВИЕ ЭКРАНА ОДНО И ЖИВЁТ ВНИЗУ (AGENTS: главное действие — в
  // футере): пока документ ждёт денег — «Принять оплату».
  return awaitsPayment && docWrite ? (
    <View
      className="px-4 pb-7 pt-3"
      style={{ backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.separator }}
    >
      <Button label={paymentLabel} onPress={onPayment} />
    </View>
  ) : docWrite && !awaitsPayment && canIssueReceipt ? (
    // Оплачен — главное действие экрана становится «Выписать чек»: чек
    // рождается кнопкой, а не сам (владелец 2026-09-20).
    <View
      className="px-4 pb-7 pt-3"
      style={{ backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.separator }}
    >
      <Button label="Выписать чек" onPress={onIssueReceipt} />
    </View>
  ) : !docWrite ? null : (
    // ШАГОВ НЕ ОСТАЛОСЬ — ДОКУМЕНТ ОТПРАВЛЯЮТ, как у чека (владелец 04.10:
    // «на чеке внизу „Поделиться PDF“ есть, а в инвойсе нет — расхождение
    // в архитектуре; то же и в кредит-ноте»). Оплачен с чеком, отменён,
    // кредит-нота — внизу «Поделиться PDF».
    <View
      className="px-4 pb-7 pt-3"
      style={{ backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.separator }}
    >
      <Button label="Поделиться PDF" loading={pdfBusy} onPress={onShare} />
    </View>
  );
}

/** Статус — одной строкой над бумагой: на самой бумаге его нет. */
export function InvoiceStatusLine({
  invoice,
  settlement,
  today,
  isCreditNote,
  isOverdue,
  awaitsPayment,
  status,
}: {
  invoice: InvoiceLedger;
  settlement: InvoiceSettlement;
  today: string;
  isCreditNote: boolean;
  isOverdue: boolean;
  awaitsPayment: boolean;
  status: InvoiceDisplayStatus;
}) {
  const t = useThemeColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {isCreditNote ? (
        <Badge label="Кредит-нота" variant="neutral" />
      ) : (
        <InvoiceStatusBadge invoice={invoice} settlement={settlement} today={today} />
      )}
      {isCreditNote ? null : (
        <Text
          className="text-sm"
          style={{ color: isOverdue ? t.danger : t.sub, fontVariant: ["tabular-nums"] }}
        >
          {isOverdue
            ? `Просрочен · остаток ${formatInvoiceMoney(settlement.remaining, invoice.currency)}`
            : settlement.paid > 0
              ? `Оплачено ${formatInvoiceMoney(settlement.paid, invoice.currency)} · остаток ${formatInvoiceMoney(settlement.remaining, invoice.currency)}`
              : awaitsPayment
                ? `Ждёт оплату · ${formatInvoiceMoney(settlement.remaining, invoice.currency)}`
                : INVOICE_STATUS_LABELS[status]}
        </Text>
      )}
    </View>
  );
}
