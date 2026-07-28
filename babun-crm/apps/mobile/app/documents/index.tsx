import { useMemo } from "react";
import { Alert, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { calculateInvoiceSettlement } from "@babun/shared/local/finance/invoice-ledger";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { NavRow, RowCaption, RowGroup } from "@/components/ui/card-rows";
import { useThemeColors } from "@/theme/colors";
import { formatInvoiceMoney, todayYmd } from "@/features/invoices/format";
import { useInvoicePayments, useInvoices } from "@/features/invoices/queries";
import { useCalendarSettings } from "@/features/settings/local-settings";

// «Документы» — одна дверь ко всем финансовым бумагам компании: инвойсы,
// чеки о приёме денег, договоры. Каждый вид — своя страница; здесь только
// выбор и живые итоги. Чеки и договоры включатся по мере готовности —
// строки честно задимлены, а не притворяются рабочими.
export default function DocumentsScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const businessToday = todayYmd(
    useCalendarSettings().data?.timezone ?? "Europe/Nicosia",
  );
  const invoicesQuery = useInvoices();
  const invoicePaymentsQuery = useInvoicePayments();
  const invoicesData = invoicesQuery.data;
  const invoicePaymentsData = invoicePaymentsQuery.data;
  const summaryReady =
    invoicesData !== undefined && invoicePaymentsData !== undefined;

  const summary = useMemo(() => {
    const invoices = invoicesData ?? [];
    const invoicePayments = invoicePaymentsData ?? {};
    let openCount = 0;
    let outstanding = 0;
    let overdue = 0;
    for (const invoice of invoices) {
      if (invoice.status === "void") continue;
      const settlement = calculateInvoiceSettlement(
        invoice,
        invoicePayments[invoice.id] ?? [],
      );
      if (settlement.remaining <= 0) continue;
      openCount += 1;
      outstanding += settlement.remaining;
      if (invoice.due_on && invoice.due_on < businessToday) {
        overdue += settlement.remaining;
      }
    }
    return { openCount, outstanding, overdue };
  }, [businessToday, invoicePaymentsData, invoicesData]);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Документы" />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <RowGroup>
          <NavRow
            label="Инвойсы"
            value={
              !summaryReady
                ? "…"
                : summary.overdue > 0
                ? `Просрочено ${formatInvoiceMoney(summary.overdue)}`
                  : summary.outstanding > 0
                    ? `К оплате ${formatInvoiceMoney(summary.outstanding)}`
                    : "Все оплачены"
            }
            valueColor={summary.overdue > 0 ? t.danger : undefined}
            onPress={() => router.push("/invoices")}
          />
          <NavRow
            label="Чеки"
            placeholder="Скоро"
            separated
            dimmed
            onPress={() =>
              Alert.alert(
                "Чеки",
                "Чек будет создаваться автоматически при каждом приёме денег — по записи и по инвойсу. Раздел включится вместе с ними.",
              )
            }
          />
          <NavRow
            label="Договоры"
            placeholder="Скоро"
            separated
            dimmed
            onPress={() =>
              Alert.alert(
                "Договоры",
                "Договоры будут привязываться к клиентам и записям — следующий шаг после чеков.",
              )
            }
          />
        </RowGroup>
        <RowCaption text="Чек создаётся автоматически при каждом приёме денег — по записи и по инвойсу; раздел включится вместе с ними. Договоры привязываются к клиентам и записям — следующий шаг." />
      </ScrollView>
    </Screen>
  );
}
