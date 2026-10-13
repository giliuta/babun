import type { TxVatMode } from "@babun/shared/local/finance/vat";
import { PayRow } from "@/features/appointments/VatLooks";
import { haptics } from "@/lib/haptics";
import { AmountBlock } from "../AmountBlock";

/** 4. СУММА. VAT СПРЯТАН (владелец 03.10: «VAT используется крайне
 *  редко — спрятать; справа у суммы кнопочка, нажимаешь — вылазит»):
 *  в шапке блока справа «+ VAT»; открытый — строка «Итого» записи
 *  (клавиша «VAT»: сверху → внутри → без налога, ставка цифрами, налог,
 *  «К оплате»), а в шапке «Без VAT» снимает налог и прячет строку.
 *  Видна только тем, кто работает с налогом (`vatVisible`). */
export function OperationAmount({
  amount,
  onAmountChange,
  vatVisible,
  vatShown,
  onToggleVat,
  gross,
  vatMode,
  vatRate,
  vatAmount,
  onVatModeChange,
  onVatRateChange,
}: {
  amount: string;
  onAmountChange: (next: string) => void;
  vatVisible: boolean;
  vatShown: boolean;
  /** «+ VAT» opens the tax row, «Без VAT» closes it. */
  onToggleVat: () => void;
  gross: number;
  vatMode: TxVatMode;
  vatRate: number;
  vatAmount: number;
  onVatModeChange: (next: TxVatMode) => void;
  onVatRateChange: (next: number) => void;
}) {
  return (
    <AmountBlock
      value={amount}
      onChange={onAmountChange}
      accessibilityLabel="Сумма операции"
      action={
        vatVisible
          ? {
              label: vatShown ? "Без VAT" : "+ VAT",
              pill: true,
              onPress: () => {
                haptics.tap();
                onToggleVat();
              },
            }
          : undefined
      }
      footer={
        vatVisible && vatShown ? (
          <PayRow
            total={gross}
            vat={{
              mode: vatMode,
              rate: vatRate,
              amount: vatAmount,
              onModeChange: onVatModeChange,
              onRateChange: onVatRateChange,
            }}
          />
        ) : undefined
      }
    />
  );
}
