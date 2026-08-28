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
 *   warn    — «так нельзя, но можно»: правило нарушено, и рядом стоит
 *             кнопка, которой его снимают.
 *
 * ТОН `warn` РИСУЕТСЯ ТИХО, И ЭТО ЗАКОН, А НЕ ВКУС (владелец 2026-08-24:
 * «не должна быть броской и бросаться в глаза, вообще не делай её ядовитую»;
 * 2026-08-27: «должно быть точно так же, как когда я не могу заполнить в
 * календаре в прошлом времени — всё единое архитектуры»).
 *
 * Правило и его рецепт взяты у `CalendarNotice` — плашки «в прошлое
 * записывать нельзя», которую владелец утвердил первой. Разница между ними
 * была только в том, что одну писали в августе, а другую позже: обе говорят
 * «так нельзя, но вот дверь», и выглядеть по-разному не имеют права.
 *
 * ДВА СЛОЯ ВМЕСТО ОДНОЙ ЗАЛИВКИ: белая подложка держит читаемость, янтарь
 * поверх неё только окрашивает воздух. Одним цветом в 100% это была бы та
 * самая ядовитая плашка. Громкость несёт КНОПКА, а не фон, — поэтому она
 * синяя и без пилюли: в тихой плашке заливка под кнопкой была бы вторым
 * пятном цвета.
 *
 * Остальные тона залиты сплошняком намеренно: они сообщают ФАКТ («сделано»,
 * «не вышло»), а не задают вопрос, и отвечать на них нечем.
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
  const quiet = tone === "warn";
  const bg = quiet
    ? "#ffffff"
    : tone === "error"
      ? t.danger
      : tone === "info"
        ? t.ink
        : t.success;
  const ink = quiet ? t.warning : tone === "info" ? t.canvas : "#ffffff";

  return (
    <View
      className="flex-row items-center gap-3 overflow-hidden rounded-[10px] px-4 py-3 shadow-lg"
      style={{
        backgroundColor: bg,
        borderWidth: quiet ? 1 : 0,
        borderColor: quiet ? `${t.warning}2e` : "transparent",
      }}
    >
      {/* Янтарный воздух поверх белой подложки — те же 8%, что у плашки
          «в прошлое записывать нельзя». */}
      {quiet ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: `${t.warning}14`,
          }}
        />
      ) : null}
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
            // В тихой плашке пилюли нет: заливка под кнопкой стала бы вторым
            // пятном цвета, а громкость должна нести сама надпись.
            backgroundColor: quiet ? "transparent" : "rgba(255,255,255,0.22)",
          }}
        >
          <Text
            className="text-sm font-bold"
            style={{ color: quiet ? t.accent : ink, fontSize: quiet ? 15 : 14 }}
          >
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
