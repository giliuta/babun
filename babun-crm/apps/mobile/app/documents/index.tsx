import { useMemo } from "react";
import { ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { calculateInvoiceSettlement } from "@babun/shared/local/finance/invoice-ledger";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { NavRow, RowCaption, RowGroup } from "@/components/ui/card-rows";
import { useClients } from "@/features/clients/queries";
import { formatInvoiceMoney } from "@/features/invoices/format";
import { useInvoicePayments, useInvoices } from "@/features/invoices/queries";
import { useReceipts } from "@/features/documents/receipts-queries";

// «Документы клиента» — дверь из карточки клиента (ClientDocumentsRow) к его
// бумагам: инвойсам и чекам. Бумаги ВСЕЙ компании живут не здесь, а в панели
// «Документы» на «Финансах» (канон 2026-08-12: только Инвойсы|Чеки) — этот
// экран остаётся до переезда карточки клиента на неё. Без clientId он
// показывает те же строки по всем бумагам — на случай прямого адреса.
export default function DocumentsScreen() {
  const router = useRouter();
  const { clientId } = useLocalSearchParams<{ clientId?: string }>();
  // Имя клиента в подзаголовке: без него сужённый список выглядит как общий,
  // и «Ещё не выдавались» читается как «во всей компании ни одного чека».
  const { data: clients = [] } = useClients();
  const clientName = clientId
    ? clients.find((c) => c.id === clientId)?.full_name
    : undefined;
  // Сужён список — сужен и запрос: экран клиента не имеет причин поднимать
  // историю счетов всей компании (тот же срез, что у чеков рядом).
  const invoicesQuery = useInvoices(clientId ? { clientId } : undefined);
  const receipts = useReceipts(clientId ? { clientId } : undefined);
  const invoicePaymentsQuery = useInvoicePayments();
  const invoicesData = invoicesQuery.data;
  const invoicePaymentsData = invoicePaymentsQuery.data;
  const summaryReady =
    invoicesData !== undefined && invoicePaymentsData !== undefined;

  // Сколько денег ждут инвойсы клиента — один проход по ним. Просрочка тут
  // не считается и не красится: неоплаченный документ — не тревога (решение
  // владельца 2026-08-15, как в панели «Документы» на «Финансах»).
  const outstanding = useMemo(() => {
    const invoices = invoicesData ?? [];
    const invoicePayments = invoicePaymentsData ?? {};
    let sum = 0;
    for (const invoice of invoices) {
      if (invoice.status === "void") continue;
      const settlement = calculateInvoiceSettlement(
        invoice,
        invoicePayments[invoice.id] ?? [],
      );
      if (settlement.remaining > 0) sum += settlement.remaining;
    }
    return sum;
  }, [invoicePaymentsData, invoicesData]);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Документы" subtitle={clientName} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <RowGroup>
          <NavRow
            label="Инвойсы"
            value={
              !summaryReady
                ? "…"
                : outstanding > 0
                  ? `К оплате ${formatInvoiceMoney(outstanding)}`
                  : "Все оплачены"
            }
            onPress={() =>
              router.push(clientId ? `/invoices?clientId=${clientId}` : "/invoices")
            }
          />
          {/* Чеки выписываются сами при каждом приёме денег (триггер
              issue_receipt_for_income). Строка живая с 2026-08-09. */}
          <NavRow
            label="Чеки"
            value={
              receipts.data === undefined
                ? "…"
                : receipts.data.length > 0
                  ? `Выдано ${receipts.data.length}`
                  : "Ещё не выдавались"
            }
            separated
            onPress={() =>
              router.push(
                clientId
                  ? `/documents/receipts?clientId=${clientId}`
                  : "/documents/receipts",
              )
            }
          />
          {/* Осознанный тизер: строка задимлена и НЕ нажимается — показание,
              а не дверь, пока договоров нет. */}
          <NavRow label="Договоры" placeholder="Скоро" separated dimmed />
        </RowGroup>
        <RowCaption text="Чек выписывается сам при каждом приёме денег — по записи и по инвойсу. Договоры привяжутся к клиентам и записям — следующий шаг." />
      </ScrollView>
    </Screen>
  );
}
