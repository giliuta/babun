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
 * ═══ ТОН `warn` = ПЛАШКА КАЛЕНДАРЯ, ЗНАК В ЗНАК (LOCKED 2026-08-27) ═══
 *
 * Владелец: «сделай точно такую же плашку, как когда я не могу записать в
 * прошлом — всё единое архитектуры». Эталон — `CalendarNotice`, утверждённый
 * 24 августа («не должна быть броской, вообще не делай её ядовитую»).
 *
 * Совпадать обязаны НЕ ТОЛЬКО ЦВЕТА, НО И ФОРМА. Первый заход 27 августа
 * подогнал только палитру, и плашка осталась висящей карточкой со
 * скруглением, тенью и полями по бокам — рядом с плоской полосой календаря
 * это читалось как другой элемент. Поэтому здесь закреплено всё:
 *
 *   форма   — БЕЗ скругления, БЕЗ тени, во всю ширину, вплотную к верху;
 *             единственная линия — волосяная снизу (`warning` 18%);
 *   фон     — белый + янтарь 8% поверх: два слоя, а не одна заливка;
 *   текст   — 14/600 янтарём, одна строка;
 *   кнопка  — 15/700 АКЦЕНТОМ, простой надписью без пилюли: заливка под ней
 *             стала бы вторым пятном цвета, а громкость несёт надпись;
 *   отступы — 16 слева, 6 справа (кнопка добирает своими 12).
 *
 * Меняешь что-то здесь — меняй и в `CalendarNotice`, иначе они опять
 * разъедутся. Остальные тона залиты сплошняком НАМЕРЕННО: они сообщают ФАКТ
 * («сделано», «не вышло»), а не задают вопрос, и отвечать на них нечем.
 */
export type NoticeTone = "success" | "error" | "info" | "warn";

/** Тон рисуется плоской полосой во всю ширину, а не карточкой. Тост читает
 *  это, чтобы убрать свои поля и прижать плашку к верхней кромке. */
export const isQuietTone = (tone: NoticeTone) => tone === "warn";

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

  if (isQuietTone(tone)) {
    return (
      <View style={{ minHeight: 48, justifyContent: "center" }}>
        {/* Белая подложка держит читаемость, янтарь поверх неё только
            окрашивает воздух — как в `CalendarNotice`. */}
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "#ffffff",
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: `${t.warning}14`,
            borderBottomWidth: 1,
            borderBottomColor: `${t.warning}2e`,
          }}
        />
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: 16,
            paddingRight: 6,
            gap: 8,
          }}
        >
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={{ flex: 1, fontSize: 14, fontWeight: "600", color: t.warning }}
          >
            {message}
          </Text>
          {action ? (
            <Pressable
              onPress={action.onPress}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              hitSlop={8}
              style={({ pressed }) => ({
                minHeight: 44,
                justifyContent: "center",
                paddingHorizontal: 12,
                opacity: pressed ? 0.5 : 1,
              })}
            >
              <Text
                maxFontSizeMultiplier={1.2}
                style={{ fontSize: 15, fontWeight: "700", color: t.accent }}
              >
                {action.label}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  const bg =
    tone === "error" ? t.danger : tone === "info" ? t.ink : t.success;
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
