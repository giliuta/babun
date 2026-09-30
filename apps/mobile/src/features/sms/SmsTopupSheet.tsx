import { useEffect, useState } from "react";
import { View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { GradientButton } from "@/components/ui/GradientButton";
import { MoneyField } from "@/components/ui/MoneyField";
import { GUTTER } from "@/components/ui/tokens";
import { parseTopupEuros, topupProblem } from "./sms-model";
import { smsCount } from "./SmsParts";
import { euro } from "./sms-words";

// ПОПОЛНИТЬ БАЛАНС — СВОЯ СУММА (владелец 30.09: «открывается шторка, я
// вписываю туда сумму и нажимаю оплатить»). Одно поле суммы, под ним —
// сколько это SMS; внизу «Оплатить €N». Пакетов больше нет: платят ровно
// столько, сколько нужно, целыми евро от €5 до €500.

export function SmsTopupSheet({
  visible,
  priceCents,
  onClose,
  onPay,
}: {
  visible: boolean;
  /** Цена одной SMS — для «≈ N SMS». */
  priceCents: number;
  onClose: () => void;
  onPay: (cents: number) => void;
}) {
  const [text, setText] = useState("");
  // Шторка открывается пустой: прошлую сумму не подставляем.
  useEffect(() => {
    if (visible) setText("");
  }, [visible]);

  const cents = parseTopupEuros(text);
  const problem = topupProblem(text);
  const ready = cents != null && problem == null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Пополнить баланс"
      // Поле с автофокусом: лист поднимается над цифровой клавиатурой, иначе
      // она закрывает и сумму, и «Оплатить».
      avoidKeyboard
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
          <GradientButton
            label={ready ? `Оплатить ${euro(cents)}` : "Оплатить"}
            disabled={!ready}
            onPress={() => {
              if (ready) onPay(cents);
            }}
          />
        </View>
      }
    >
      <View style={{ paddingHorizontal: GUTTER, paddingBottom: 16 }}>
        <MoneyField
          label="Сумма"
          value={text}
          onChangeText={setText}
          currency="EUR"
          autoFocus
          error={problem}
          hint={ready ? `≈ ${smsCount(Math.floor(cents / Math.max(1, priceCents)))}` : "От €5 до €500"}
        />
      </View>
    </BottomSheet>
  );
}
