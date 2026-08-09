import { useMemo } from "react";
import { Text, View } from "react-native";
import { calculateInvoiceSettlement } from "@babun/shared/local/finance/invoice-ledger";
import { SectionCard } from "@/components/ui/SectionCard";
import { ActionRow, NavRow } from "@/components/ui/card-rows";
import { useThemeColors } from "@/theme/colors";
import { formatInvoiceMoney } from "@/features/invoices/format";
import { useInvoicePayments, useInvoices } from "@/features/invoices/queries";
import { useReceipts } from "@/features/documents/receipts-queries";

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
  clientId,
  teamId,
  amount,
  title,
  issuedOn,
  onOpen,
}: {
  appointmentId: string;
  clientId: string | null;
  teamId: string | null;
  /** Сумма записи — предзаполнение строки счёта. */
  amount: number;
  title: string;
  issuedOn: string;
  /** Уводит с экрана: лист закрывается сам, иначе новый экран уедет под него. */
  onOpen: (href: string) => void;
}) {
  const t = useThemeColors();
  const invoicesQuery = useInvoices();
  const paymentsQuery = useInvoicePayments();
  const receiptsQuery = useReceipts({ appointmentId });

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
          onPress={() => onOpen("/documents/receipts")}
        />
      ))}

      {amount > 0 ? (
        <ActionRow
          separated={invoices.length + receipts.length > 0}
          label="Выставить счёт"
          onPress={() =>
            onOpen(
              `/invoices/new?appointmentId=${appointmentId}` +
                `&clientId=${clientId ?? ""}&teamId=${teamId ?? ""}` +
                `&amount=${amount}&issuedOn=${issuedOn}` +
                `&title=${encodeURIComponent(title)}`,
            )
          }
        />
      ) : null}

      {invoices.length === 0 && receipts.length === 0 ? (
        <View className="px-4 pb-3">
          <Text className="text-[13px]" style={{ color: t.faint }}>
            Чек выпишется сам, как только вы примете оплату.
          </Text>
        </View>
      ) : null}
    </SectionCard>
  );
}
