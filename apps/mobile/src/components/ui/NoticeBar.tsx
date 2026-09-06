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
 *   info    — обычное сообщение;
 *   warn    — «так нельзя, но можно»: правило нарушено, и рядом стоит
 *             кнопка, которой его снимают.
 *
 * ═══ ОДНА ФОРМА НА ВСЕ ТОНА = ПЛАШКА КАЛЕНДАРЯ, ЗНАК В ЗНАК (LOCKED) ═══
 *
 * 2026-08-27 владелец закрепил форму для тона `warn`: «сделай точно такую же
 * плашку, как когда я не могу записать в прошлом — всё единое архитектуры».
 * Остальные тона тогда остались скруглёнными залитыми карточками, и 6 сентября
 * владелец увидел зелёный тост с пилюлей «Снять» и спросил, почему
 * уведомление «в другой архитектуре, не так как везде»: «хочу, чтоб все
 * абсолютно уведомления были везде одинаковые — разные цвета, разные кнопки,
 * но расстояние, как выглядит, во весь верх — всё одинаковое, как полноценный
 * design block». Эталон — `CalendarNotice`, утверждённый 24 августа («не
 * должна быть броской, вообще не делай её ядовитую»).
 *
 * Совпадать обязаны НЕ ТОЛЬКО ЦВЕТА, НО И ФОРМА — у ВСЕХ тонов:
 *
 *   форма   — БЕЗ скругления, БЕЗ тени, во всю ширину, вплотную к верху;
 *             единственная линия — волосяная снизу (цвет тона 18%);
 *   фон     — белый + цвет тона 8% поверх: два слоя, а не одна заливка;
 *   текст   — 14/600 цветом тона, одна строка;
 *   кнопка  — 15/700 АКЦЕНТОМ, простой надписью без пилюли: заливка под ней
 *             стала бы вторым пятном цвета, а громкость несёт надпись;
 *   отступы — 16 слева, 6 справа (кнопка добирает своими 12).
 *
 * Тон меняет только цвет: янтарь, зелёный, красный, чернила. Меняешь что-то
 * здесь — меняй и в `CalendarNotice`, иначе они опять разъедутся.
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
  const color =
    tone === "warn"
      ? t.warning
      : tone === "error"
        ? t.danger
        : tone === "info"
          ? t.ink
          : t.success;

  return (
    <View style={{ minHeight: 48, justifyContent: "center" }}>
      {/* Белая подложка держит читаемость, цвет тона поверх неё только
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
          backgroundColor: `${color}14`,
          borderBottomWidth: 1,
          borderBottomColor: `${color}2e`,
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
          style={{ flex: 1, fontSize: 14, fontWeight: "600", color }}
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
