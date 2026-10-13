import { Text } from "react-native";
import { useThemeColors } from "@/theme/colors";

/** Тихая подпись ПОД группой — то, что объясняет группу, но не является её
 *  строкой: «7 визитов · посл. 14 апр», «Следующее ТО через 63 дн». Тон
 *  несёт смысл: обычное серым, «скоро» янтарём, «просрочено» красным. */
export function RowCaption({
  text,
  tone = "quiet",
}: {
  text: string;
  tone?: "quiet" | "warning" | "danger";
}) {
  const t = useThemeColors();
  return (
    <Text
      maxFontSizeMultiplier={1.3}
      style={{
        marginHorizontal: 16,
        marginTop: 6,
        // Пояснение приглушается РАЗМЕРОМ, а не серостью (закон 2026-07-27).
        fontSize: 13,
        color:
          tone === "danger" ? t.danger : tone === "warning" ? t.warning : t.sub,
      }}
    >
      {text}
    </Text>
  );
}
