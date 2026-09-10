import { Text, View } from "react-native";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import { accountDisplayName } from "@babun/shared/local/finance/account";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";
import { useAccountsWithBalances } from "./accounts";
import { useAppointmentLedger } from "./queries";
import { paymentEvents, paymentEventsNet } from "./payment-history";

// ИСТОРИЯ ПЛАТЕЖЕЙ ЗАПИСИ. Открывается кнопкой из блока оплаты (владелец
// 2026-09-09). На главной ленте одна запись теперь занимает одну строку, а
// поимённая история — сколько раз платили, чем и что снимали — живёт здесь.
//
// Снятое печатается тише живых денег и зачёркнутым: это поправка, а не
// движение (тот же язык, что выбрал владелец для ленты 2026-09-08).

function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function dayOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function PaymentHistorySheet({
  visible,
  appointmentId,
  onClose,
}: {
  visible: boolean;
  appointmentId: string | null;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const ledger = useAppointmentLedger(visible ? appointmentId : null);
  const accounts = useAccountsWithBalances().data ?? [];
  const events = paymentEvents(ledger.data ?? []);
  const net = paymentEventsNet(events);

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      title="История платежей"
      scroll
      maxHeightRatio={0.8}
      // ЧЕСТНЫЙ ВЫХОД ОБЯЗАТЕЛЕН (владелец 2026-09-09: «я не могу теперь
      // закрыть»). Лист читают, а не заполняют, поэтому кнопки внизу у него
      // не было — и закрыть его можно было только тапом по затемнению или
      // свайпом ПО ГРАБЕРУ: свайп по самому списку его прокручивает. Человек
      // считает, что застрял. Одна подписанная кнопка снимает вопрос.
      footer={
        <View style={{ paddingHorizontal: 20 }}>
          <Button label="Закрыть" onPress={onClose} />
        </View>
      }
    >
      {events.length === 0 ? (
        <EmptyState
          state={ledger.isLoading ? "loading" : "empty"}
          title={ledger.isLoading ? undefined : "По записи ещё не платили"}
        />
      ) : (
        <View style={{ paddingBottom: 24 }}>
          {events.map((event, i) => {
            const account = accounts.find((a) => a.id === event.accountId);
            return (
              <View
                key={event.id}
                className="flex-row items-center gap-3 px-4"
                style={{
                  minHeight: 56,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: t.separator,
                }}
              >
                <View className="min-w-0 flex-1">
                  <Text
                    className="text-[15px] font-semibold"
                    style={{ color: event.cancelled ? t.sub : t.ink }}
                    numberOfLines={1}
                  >
                    {event.title}
                  </Text>
                  <Text
                    className="text-[13px]"
                    style={{ color: t.faint }}
                    numberOfLines={1}
                  >
                    {[dayOf(event.at), timeOf(event.at), account ? accountDisplayName(account) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
                <Text
                  className="text-[15px] font-bold"
                  style={{
                    color: event.cancelled ? t.faint : t.success,
                    fontVariant: ["tabular-nums"],
                    textDecorationLine: event.cancelled ? "line-through" : "none",
                  }}
                >
                  {event.cancelled ? "−" : ""}
                  {formatEUR(event.amount)}
                </Text>
              </View>
            );
          })}
          {/* Итог — то же число, что стоит в блоке оплаты. Лист, который с ним
              не сходится, хуже отсутствующего листа. */}
          <View
            className="flex-row items-center justify-between px-4"
            style={{
              minHeight: 56,
              borderTopWidth: 1,
              borderTopColor: t.separator,
            }}
          >
            <Text className="text-[15px] font-semibold" style={{ color: t.ink }}>
              Осталось по записи
            </Text>
            <Text
              className="text-[17px] font-bold"
              style={{ color: t.success, fontVariant: ["tabular-nums"] }}
            >
              {formatEUR(net)}
            </Text>
          </View>
        </View>
      )}
    </BottomSheet>
  );
}
