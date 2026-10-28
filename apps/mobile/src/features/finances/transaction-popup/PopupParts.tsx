import { Text, View } from "react-native";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import { MoneyField } from "@/components/ui/MoneyField";
import { ActionRow, RowGroup } from "@/components/ui/card-rows";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

/** Строка-факт витрины: ярлык слева, значение справа. Читается, но не
 *  правится — правка живёт в форме операции. */
export function MetaRow({
  label,
  value,
  first,
}: {
  label: string;
  value: string;
  /** Первая строка группы шва над собой не имеет. */
  first?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View
      className="flex-row items-center justify-between px-4 py-2.5"
      style={{
        borderTopWidth: first ? 0 : 1,
        borderTopColor: t.separator,
      }}
    >
      <Text className="text-[13px]" style={{ color: t.sub }}>
        {label}
      </Text>
      <Text
        className="ml-2 flex-1 text-right text-[13px] font-medium"
        style={{ color: t.ink }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

/** СУММА — ГЕРОЙ ЛИСТА: ради неё его и открыли. Знак и цвет говорят
 *  направление денег раньше, чем прочитан ярлык. */
export function PopupAmount({
  sign,
  amount,
  tone,
  notes,
}: {
  sign: string;
  amount: number;
  tone: string;
  notes: string | null;
}) {
  const t = useThemeColors();
  return (
    <View className="items-center px-5 pb-1">
      <Text
        className="text-[32px] font-bold"
        style={{ color: tone, fontVariant: ["tabular-nums"] }}
      >
        {sign}
        {formatEUR(Math.abs(amount))}
      </Text>
      {notes ? (
        <Text
          className="mt-1 text-center text-[13px]"
          style={{ color: t.sub }}
        >
          {notes}
        </Text>
      ) : null}
    </View>
  );
}

/** «Создать возврат» раскрыт: сумма до остатка и два ряда. */
export function RefundForm({
  refundAmount,
  onChangeAmount,
  refundRemaining,
  refundValid,
  currency,
  busy,
  onRefund,
  onCancel,
}: {
  refundAmount: string;
  onChangeAmount: (value: string) => void;
  refundRemaining: number;
  refundValid: boolean;
  currency: string | undefined;
  busy: boolean;
  onRefund: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <View style={{ paddingHorizontal: GUTTER, paddingTop: 16 }}>
        <MoneyField
          label={`Сумма возврата (до ${formatEUR(refundRemaining)})`}
          value={refundAmount}
          onChangeText={onChangeAmount}
          currency={currency}
          autoFocus
          error={
            refundAmount && !refundValid
              ? `Не больше ${formatEUR(refundRemaining)} и больше нуля`
              : null
          }
        />
      </View>
      <RowGroup>
        <ActionRow
          label="Оформить возврат"
          tone="danger"
          dimmed={!refundValid || busy}
          onPress={onRefund}
        />
        <ActionRow
          label="Отмена"
          separated
          dimmed={busy}
          onPress={onCancel}
        />
      </RowGroup>
    </>
  );
}
