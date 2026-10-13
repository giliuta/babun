import { Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { useThemeColors } from "@/theme/colors";
import type { InvoiceReason } from "./invoice-rules";

/* ИТОГ ЖИВЁТ ВНИЗУ И НЕ УЕЗЖАЕТ С ПРОКРУТКОЙ. Кнопка выпуска
   стояла последней строкой формы: чтобы увидеть, на какую сумму
   документ, приходилось долистать до конца — а сумма меняется от
   каждого тапа по степперу. */
export function InvoiceEditorFooter({
  error,
  reason,
  actionLabel,
  submitting,
  onPreview,
}: {
  error: string | null;
  reason: InvoiceReason;
  actionLabel: string;
  submitting: boolean;
  onPreview: () => void;
}) {
  const t = useThemeColors();
  return (
    <View
      className="px-4 pb-7 pt-3"
      style={{
        backgroundColor: t.surface,
        borderTopWidth: 1,
        borderTopColor: t.separator,
      }}
    >
      {error ?? reason ? (
        <Text
          accessibilityRole={error ? "alert" : undefined}
          accessibilityLiveRegion="polite"
          className="mb-2 text-center text-sm"
          style={{ color: error || reason?.error ? t.danger : t.sub }}
        >
          {error ?? reason?.text}
        </Text>
      ) : null}
      {/* КНОПКА ОТКРЫВАЕТ ПРЕВЬЮ, А НЕ ВЫСТАВЛЯЕТ СРАЗУ. Владелец
          2026-09-20: «сначала делается превью этого инвойса, и потом
          я нажимаю сохранить». */}
      <Button
        label={actionLabel}
        onPress={onPreview}
        loading={submitting}
        disabled={submitting || reason !== null}
      />
    </View>
  );
}
