import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { Receipt as ReceiptIcon } from "lucide-react-native";
import { receiptClientName, type Receipt } from "@babun/shared/local/finance/receipt";
import { money } from "@babun/shared/common/utils/money";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { ClientDataNotice } from "@/features/clients/ClientDataNotice";
import { useReceipts } from "@/features/documents/receipts-queries";
import { ReceiptSheet } from "@/features/documents/ReceiptSheet";
import { useAppointments } from "@/features/calendar/queries";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { formatShortDateRu } from "@/features/clients/format";
import { useClients } from "@/features/clients/queries";
import { useThemeColors } from "@/theme/colors";

// ЧЕКИ — ЛЕНТА ВЫДАННЫХ ДОКУМЕНТОВ.
//
// Читается сверху вниз как выписка: номер, кому, сколько, когда. Погашенные
// (возврат) не прячутся, а гаснут с пометкой «аннулирован» — документ
// существовал, и проверяющий должен видеть, почему номер занят.
//
// Строка открывает ТОТ ЖЕ лист, что и панель «Документы» на «Финансах»
// (`DocumentsPanel`) — второй вёрстки чека в продукте нет.
export default function ReceiptsScreen() {
  const t = useThemeColors();
  const router = useRouter();
  // Чеки одного клиента: та же лента, отфильтрованная сервером. Отдельного
  // экрана «документы клиента» нет — иначе один список жил бы в двух вёрстках.
  const { clientId } = useLocalSearchParams<{ clientId?: string }>();
  const receipts = useReceipts(clientId ? { clientId } : undefined);
  const { data: clients = [] } = useClients();
  // Запись и счёт нужны только строкам открытого листа — та же пара запросов,
  // что у `DocumentsPanel`.
  const appointmentsQuery = useAppointments();
  const accountsQuery = useAccountsWithBalances();
  const [openReceipt, setOpenReceipt] = useState<Receipt | null>(null);
  const clientName = clientId
    ? clients.find((c) => c.id === clientId)?.full_name
    : undefined;

  if (receipts.isLoading) {
    return (
      <Screen className="items-center justify-center">
        <Spinner size={28} label="Загрузка чеков" />
      </Screen>
    );
  }
  if (receipts.isError) {
    return (
      <Screen>
        <ScreenHeader title="Чеки" subtitle={clientName} />
        <ClientDataNotice
          fullScreen
          title="Не удалось загрузить чеки"
          message={(receipts.error as Error).message}
          onRetry={() => void receipts.refetch()}
          retrying={receipts.isRefetching}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title="Чеки" subtitle={clientName} />
      <FlatList
        data={receipts.data ?? []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ paddingBottom: 32, flexGrow: 1 }}
        ItemSeparatorComponent={() => (
          <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />
        )}
        renderItem={({ item }) => {
          const dead = item.status === "void";
          return (
            <Pressable
              onPress={() => setOpenReceipt(item)}
              accessibilityRole="button"
              accessibilityLabel={`Чек ${item.number}, ${receiptClientName(item)}, ${money(item.amount, item.currency)}`}
              className="flex-row items-center gap-3 px-4 py-3 active:opacity-60"
              style={{ opacity: dead ? 0.55 : 1 }}
            >
              <View className="min-w-0 flex-1">
                <View className="flex-row items-center gap-2">
                  <Text
                    className="text-[15px] font-semibold"
                    style={{ color: t.ink }}
                    numberOfLines={1}
                  >
                    {item.number}
                  </Text>
                  {dead ? (
                    // Слово и тон — как в панели «Документы»: аннуляция —
                    // факт, а не тревога, красным она не кричит.
                    <Text
                      className="text-[11px] font-semibold uppercase"
                      style={{ color: t.caption }}
                    >
                      аннулирован
                    </Text>
                  ) : null}
                </View>
                <Text className="mt-0.5 text-[13px]" style={{ color: t.sub }} numberOfLines={1}>
                  {receiptClientName(item)} · {formatShortDateRu(item.issued_on)}
                </Text>
              </View>
              <View className="items-end">
                <Text
                  className="text-[15px] font-semibold"
                  style={{ color: t.ink, fontVariant: ["tabular-nums"] }}
                >
                  {money(item.amount, item.currency)}
                </Text>
                {/* НДС отдельной строкой: это не выручка компании, а чужие
                    деньги внутри полученной суммы. */}
                {item.vat_amount ? (
                  <Text className="text-[11px]" style={{ color: t.sub }}>
                    в т.ч. VAT {money(item.vat_amount, item.currency)}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon={<ReceiptIcon color={t.faint} size={40} strokeWidth={1.5} />}
            title="Чеков пока нет"
            subtitle="Чек выписывается кнопкой в «Финансах», в разделе «Документы»: клиент, услуги, счёт — и документ готов."
          />
        }
      />
      <ReceiptSheet
        receipt={openReceipt}
        appointment={
          openReceipt?.appointment_id
            ? ((appointmentsQuery.data ?? []).find(
                (a) => a.id === openReceipt.appointment_id,
              ) ?? null)
            : null
        }
        accountName={
          (accountsQuery.data ?? []).find((a) => a.id === openReceipt?.account_id)
            ?.name ?? null
        }
        onClose={() => setOpenReceipt(null)}
        onOpen={(href) => router.push(href as Href)}
      />
    </Screen>
  );
}
