import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";
import type { PriceEntryMode } from "../economics";
import { GAP, W_COST, W_QTY, W_TIME } from "./layout";

/** The one header row of the ladder; «Цена» and «Расход» toggle their mode. */
export function LadderHeader({
  priceEntry,
  costEntry,
  onPriceEntryChange,
  onCostEntryChange,
}: {
  priceEntry: PriceEntryMode;
  costEntry: PriceEntryMode;
  onPriceEntryChange: (m: PriceEntryMode) => void;
  onCostEntryChange: (m: PriceEntryMode) => void;
}) {
  const t = useThemeColors();

  // ШАПКА — НЕ ПОДПИСЬ, А НАСТРОЙКА КОЛОНКИ: тап по цене переключает «за
  // одну» и «за всё». Подпись ОДНА на колонку и вдобавок работает — она же и
  // есть тот переключатель, который иначе стоял бы отдельной строкой.
  //
  // ШАПКА КОЛОНКИ: ИМЯ СВЕРХУ, РЕЖИМ В СКОБКАХ СНИЗУ, ТАП ПЕРЕКЛЮЧАЕТ.
  // Панель с двумя пилюлями на ДВУХ значениях — лишний ход: она занимала бы
  // целую строку блока, толкала таблицу вниз и висела, пока в неё не ткнут
  // второй раз. Переключатель из двух положений переключается тапом, а не
  // выбором из списка.
  //
  // Имя колонки серое, как у «Кол» и «Время», — все четыре читаются
  // одинаково. Синие только скобки: они и есть то, что нажимается, и они же
  // говорят текущее состояние. Нажимаемая подпись помечена цветом акцента:
  // серая читалась бы обычным ярлыком, и на неё никто бы не нажал.
  const headCell = (
    text: string,
    width?: number,
    mode?: PriceEntryMode,
    onToggle?: () => void,
  ) => {
    const body = (
      <>
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{
            textAlign: "right",
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: t.faint,
          }}
        >
          {text}
        </Text>
        {mode ? (
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{
              textAlign: "right",
              fontSize: 11,
              fontWeight: "600",
              color: t.accent,
              marginTop: 1,
            }}
          >
            {mode === "total" ? "(за всё)" : "(за одну)"}
          </Text>
        ) : null}
      </>
    );
    if (!onToggle) {
      return (
        <View style={{ width, flex: width ? undefined : 1 }}>{body}</View>
      );
    }
    return (
      <Pressable
        onPress={onToggle}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${text}, сейчас ${
          mode === "total" ? "за всё" : "за одну"
        }. Переключить`}
        style={({ pressed }) => ({
          width,
          flex: width ? undefined : 1,
          opacity: pressed ? 0.5 : 1,
        })}
      >
        {body}
      </Pressable>
    );
  };

  const flip = (m: PriceEntryMode): PriceEntryMode =>
    m === "total" ? "unit" : "total";


  return (
    <>
    {/* ШАПКА ОДИН РАЗ. Она и есть единственные подписи в блоке. */}
    <View
      className="flex-row items-center"
      style={{
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 6,
        gap: GAP,
      }}
    >
      {/* КОЛОНКА КОЛИЧЕСТВА СТОИТ ВСЕГДА, даже у новой услуги. Спрятанная,
          пока ступеней нет, она прятала бы и саму мысль, что цена привязана к
          количеству, — а таблица без первого столбца читается как три
          несвязанных поля. Единица на месте объясняет остальные три числа:
          «одна штука стоит столько». */}
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            width: W_QTY,
            textAlign: "center",
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: t.faint,
          }}
        >
          Кол
        </Text>
      {headCell("Цена", undefined, priceEntry, () =>
        onPriceEntryChange(flip(priceEntry)),
      )}
      {headCell("Расход", W_COST, costEntry, () =>
        onCostEntryChange(flip(costEntry)),
      )}
      {headCell("Время", W_TIME)}
    </View>
    </>
  );
}
