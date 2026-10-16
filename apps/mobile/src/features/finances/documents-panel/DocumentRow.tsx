import { Text, View } from "react-native";
import { Receipt as ReceiptIcon, ReceiptText } from "lucide-react-native";
import { money } from "@babun/shared/common/utils/money";
import { SelectRow } from "@/components/ui/select-rows";
import { useThemeColors } from "@/theme/colors";
import type { FinanceDocument } from "../documents";

/** ДОКУМЕНТ — ПЛАШКОЙ, КАК ФАЙЛ КЛИЕНТА: слева
 *  плитка инвойса или чека, номер — названием, кому выдан — подписью;
 *  справа сумма и состояние словом. Погашенный документ гаснет, но стоит:
 *  номер занят, и проверяющий должен видеть почему. */
export function DocumentRow({
  document,
  onPress,
  onLongPress,
}: {
  document: FinanceDocument;
  onPress: () => void;
  /** Удержание — шторка действий документа (как «⋯» его страницы). */
  onLongPress?: () => void;
}) {
  const t = useThemeColors();
  const invoice = document.kind === "invoice";
  return (
    <View style={{ opacity: document.dead ? 0.55 : 1 }}>
      <SelectRow
        icon={invoice ? ReceiptIcon : ReceiptText}
        // Чек — деньги уже пришли (зелёный, как на карточке клиента);
        // инвойс — документ к оплате (акцент).
        color={invoice ? t.accent : t.success}
        plain
        title={document.title}
        // Даты здесь нет: её называет заголовок дня над плашкой.
        subtitle={document.clientName || undefined}
        accessibilityLabel={[
          document.title,
          document.clientName,
          money(document.amount, document.currency),
          document.state,
        ]
          .filter(Boolean)
          .join(", ")}
        onPress={onPress}
        onLongPress={onLongPress}
        trailing={
          <View style={{ alignItems: "flex-end", flexShrink: 0 }}>
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={{
                fontSize: 15,
                fontWeight: "700",
                color: t.ink,
                fontVariant: ["tabular-nums"],
              }}
            >
              {money(document.amount, document.currency)}
            </Text>
            {/* СОСТОЯНИЕ ГОВОРИТ СЛОВОМ, А НЕ ЦВЕТОМ (неоплаченный документ — ничего страшного). */}
            {document.state ? (
              <Text
                maxFontSizeMultiplier={1.3}
                style={{ fontSize: 13, color: t.caption }}
              >
                {document.state}
              </Text>
            ) : null}
          </View>
        }
      />
    </View>
  );
}
