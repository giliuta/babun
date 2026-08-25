import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";

/**
 * ПЛАШКА СВЕРХУ — ОДИН ВИД НА ВЕСЬ ПРОДУКТ.
 *
 * Раньше эта вёрстка жила только внутри `Toast` и была ему не отдать: тост
 * рисуется провайдером на уровне приложения, а нижний лист — это `Modal`,
 * ОТДЕЛЬНОЕ ОКНО. Плашка, показанная из листа, честно появлялась под ним и
 * не была видна вообще. Поэтому вид вынесен сюда, а место, куда его класть,
 * каждый выбирает сам: тост — поверх экрана, лист — своим пропом `banner`.
 *
 * Тона говорят разное:
 *   success — сделано;
 *   error   — не вышло, поправить нечем;
 *   info    — чернильная плашка, обычное сообщение;
 *   warn    — янтарная: «так нельзя, но можно» — правило нарушено, и рядом
 *             стоит кнопка, которой его снимают.
 */
export type NoticeTone = "success" | "error" | "info" | "warn";

export function NoticeBar({
  tone,
  message,
  action,
}: {
  tone: NoticeTone;
  message: string;
  /** Кнопка справа. С ней плашка перестаёт быть сообщением и становится
   *  вопросом, на который отвечают одним тапом. */
  action?: { label: string; onPress: () => void };
}) {
  const t = useThemeColors();
  const bg =
    tone === "error"
      ? t.danger
      : tone === "warn"
        ? t.warning
        : tone === "info"
          ? t.ink
          : t.success;
  const ink = tone === "info" ? t.canvas : "#ffffff";

  return (
    <View
      className="flex-row items-center gap-3 rounded-[10px] px-4 py-3 shadow-lg"
      style={{ backgroundColor: bg }}
    >
      <Text
        className="flex-1 text-sm font-semibold"
        style={{ color: ink, textAlign: action ? "left" : "center" }}
      >
        {message}
      </Text>
      {action ? (
        <Pressable
          onPress={action.onPress}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          className="rounded-full px-3 active:opacity-70"
          style={{
            minHeight: 44,
            justifyContent: "center",
            backgroundColor: "rgba(255,255,255,0.22)",
          }}
        >
          <Text className="text-sm font-bold" style={{ color: ink }}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
