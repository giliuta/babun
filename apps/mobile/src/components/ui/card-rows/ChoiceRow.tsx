import { Pressable, Text, View } from "react-native";
import { Settings2 } from "lucide-react-native";
import { Chip } from "@/components/ui/Chip";
import { useThemeColors } from "@/theme/colors";
import { ICON } from "../tokens";

/** Строка ВЫБОРА КНОПКАМИ: капс-ярлык и готовые значения пилюлями + «+», чтобы
 *  создать своё прямо здесь (тип объекта: готовые кнопки и кнопка плюс).
 *
 *  Почему не лист снизу и не текстовое поле: значений три-пять и они короткие,
 *  поэтому выбор — ОДИН тап без экрана поверх экрана. «+» превращается в поле
 *  ввода на месте: новое значение сразу становится выбранным. */
export function ChoiceRow({
  label,
  options,
  value,
  separated,
  onSettings,
  onSelect,
}: {
  /** Без ярлыка строка — просто ряд пилюль. Ярлык не нужен, когда строка в
   *  группе одна и её уже назвал капс-заголовок группы: два капса на 20pt
   *  друг от друга читаются как раздел, вложенный сам в себя. */
  label?: string;
  options: readonly string[];
  value: string;
  separated?: boolean;
  /** Открыть настройки этого словаря: не плюсик, а шестерёнка справа вверху,
   *  и там идёт редактирование. Свой тип
   *  заводится один раз в настройках бизнеса, а не на бегу в каждой карточке:
   *  иначе у одного бизнеса заводится «Склад», «склад» и «Склады». */
  onSettings?: () => void;
  onSelect: (v: string) => void;
}) {
  const t = useThemeColors();

  return (
    <View
      style={{
        paddingLeft: 16,
        paddingRight: 12,
        paddingVertical: 10,
        gap: 8,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
      }}
    >
      {label ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{
              flex: 1,
              fontSize: 11,
              fontWeight: "700",
              letterSpacing: 1.2,
              textTransform: "uppercase",
              color: t.ink,
            }}
          >
            {label}
          </Text>
          {onSettings ? (
            <Pressable
              onPress={onSettings}
              accessibilityRole="button"
              accessibilityLabel={
                label ? `Настроить: ${label.toLowerCase()}` : "Настроить"
              }
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Settings2 color={t.ink} size={ICON.command} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* rowGap 14, а не общий gap 6: у чипа вертикальный hitSlop 6, поэтому
          при переносе на вторую строку зоны касания СМЫКАЛИСЬ и тап по нижней
          кромке чипа выбирал чип со строки ниже. */}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          rowGap: 14,
          columnGap: 6,
        }}
      >
        {options.map((option) => (
          <Chip
            key={option}
            label={option}
            radio
            selected={
              value.trim().toLowerCase() === option.trim().toLowerCase()
            }
            onPress={() => onSelect(option)}
          />
        ))}
        {/* БЕЗ ЯРЛЫКА шестерёнка живёт В РЯДУ ЧИПОВ, а не отдельной строкой
            над ними: строка ради одной иконки — пустой этаж карточки.
            Тише чипов (sub), чтобы не спорить с выбором. */}
        {!label && onSettings ? (
          <Pressable
            onPress={onSettings}
            accessibilityRole="button"
            accessibilityLabel="Настроить список"
            hitSlop={{ top: 14, bottom: 14, left: 8, right: 12 }}
            style={({ pressed }) => ({
              marginLeft: "auto",
              paddingHorizontal: 4,
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Settings2 color={t.sub} size={ICON.command} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
