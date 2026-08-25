import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { calculateInvoiceSettlement } from "@babun/shared/local/finance/invoice-ledger";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import { SectionCard } from "@/components/ui/SectionCard";
import { ActionRow, NavRow } from "@/components/ui/card-rows";
import { useThemeColors } from "@/theme/colors";
import { formatInvoiceMoney } from "@/features/invoices/format";
import { useInvoicePayments, useInvoices } from "@/features/invoices/queries";
import { useReceipts } from "@/features/documents/receipts-queries";
import { ReceiptSheet } from "@/features/documents/ReceiptSheet";

// ДОКУМЕНТЫ ЖИВУТ РЯДОМ С РАБОТОЙ, ЗА КОТОРУЮ ИХ ВЫДАЛИ.
//
// Владелец 2026-08-09: «инвойс по кнопке… закрепляется за запись в календаре
// и также передаётся в документацию самого клиента». Раньше бумаги были
// видны только в общем списке «Документы»: чтобы понять, выставлен ли счёт
// по вчерашней работе, приходилось искать её номер среди всех.
//
// Чек здесь не выписывают — его выдаёт сервер в тот же миг, когда принимает
// деньги. Кнопка одна: выставить счёт. Всё остальное — витрина.

export function AppointmentDocuments({
  appointmentId,
  amount,
  onOpen,
}: {
  appointmentId: string;
  /** Сумма записи — только ПОРОГ кнопки: по бесплатной работе счёт не
   *  выставляют. Сам документ генератор собирает из СОХРАНЁННОЙ записи, а не
   *  из этого числа: счёт обязан называть ту же сумму, что деньги и долги. */
  amount: number;
  /** Уводит с экрана: лист закрывается сам, иначе новый экран уедет под него. */
  onOpen: (href: string) => void;
}) {
  const t = useThemeColors();
  const invoicesQuery = useInvoices();
  const paymentsQuery = useInvoicePayments();
  const receiptsQuery = useReceipts({ appointmentId });
  // Чек раскрывается листом ПРЯМО ЗДЕСЬ (канон 2026-08-12: «чек открывается
  // листом и высылается изнутри») — общий экран чеков не умел ни открыть
  // конкретный, ни выслать его.
  const [openReceipt, setOpenReceipt] = useState<Receipt | null>(null);

  const invoices = useMemo(
    () =>
      (invoicesQuery.data ?? []).filter(
        (i) => i.appointment_id === appointmentId,
      ),
    [invoicesQuery.data, appointmentId],
  );
  const receipts = receiptsQuery.data ?? [];
  const payments = paymentsQuery.data ?? {};

  // Пока ничего не выставлено и работа бесплатная — блока нет вовсе: пустая
  // карточка «Документов» на каждой записи только удлиняет лист.
  if (invoices.length === 0 && receipts.length === 0 && amount <= 0) return null;

  return (
    <SectionCard title="Документы">
      {invoices.map((invoice, index) => {
        const settlement = calculateInvoiceSettlement(
          invoice,
          payments[invoice.id] ?? [],
        );
        const state =
          invoice.status === "void"
            ? "аннулирован"
            : settlement.remaining <= 0
              ? "оплачен"
              : `ждёт ${formatInvoiceMoney(settlement.remaining)}`;
        return (
          <NavRow
            key={invoice.id}
            separated={index > 0}
            label={`Счёт ${invoice.number}`}
            value={state}
            onPress={() => onOpen(`/invoices/${invoice.id}`)}
          />
        );
      })}

      {receipts.map((receipt, index) => (
        <NavRow
          key={receipt.id}
          separated={invoices.length > 0 || index > 0}
          label={`Чек ${receipt.number}`}
          value={
            receipt.status === "void"
              ? "аннулирован"
              : formatInvoiceMoney(receipt.amount)
          }
          onPress={() => setOpenReceipt(receipt)}
        />
      ))}

      {amount > 0 ? (
        <ActionRow
          separated={invoices.length + receipts.length > 0}
          label="Выставить счёт"
          // В АДРЕСЕ ТОЛЬКО ЗАПИСЬ. Клиента, команду, дату, срок оплаты и
          // строки собирает генератор из самой заявки и настроек компании
          // (`generateInvoiceFromAppointment`). Тащить их сюда значило бы
          // держать второе описание одного документа — и оно разъехалось бы
          // с первым на первой же правке настроек.
          onPress={() => onOpen(`/invoices/new?appointmentId=${appointmentId}`)}
        />
      ) : null}

      {invoices.length === 0 && receipts.length === 0 ? (
        <View className="px-4 pb-3">
          <Text className="text-[13px]" style={{ color: t.faint }}>
            Чек выпишется сам, как только вы примете оплату.
          </Text>
        </View>
      ) : null}

      <ReceiptSheet
        receipt={openReceipt}
        // Мы уже стоим внутри этой записи — дверь «Запись» вела бы туда, где
        // человек и так находится, поэтому строка молчит.
        appointment={null}
        // Счетов у экрана записи нет, и грузить их ради одной подписи не
        // стоит: лист без имени счёта честно прячет строку.
        accountName={null}
        onClose={() => setOpenReceipt(null)}
        onOpen={onOpen}
      />
    </SectionCard>
  );
}
