import { Pressable, Text, View } from "react-native";
import { Tag } from "lucide-react-native";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { iconPreset } from "@/components/ui/icon-set";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

// БЛОК КАТЕГОРИИ — КАНОН (владелец 2026-09-10: «категории сверху, как написано
// „клиент“, то же самое; ниже — выбор самой категории. Если я прошу создать
// блок категории, ты чётко вносишь именно этот блок»).
//
// Устроен как блок клиента и блок объекта, и это не совпадение, а закон
// продукта: предмет выбирают в блоке со своей шапкой, пустое состояние —
// строка-дверь «Выбрать …», выбранное — сам предмет, и тап по нему открывает
// выбор заново. Стрелки справа у выбранного нет нигде (владелец 2026-09-04).
//
// Слово «Категория» слева в строке больше не нужно: его говорит шапка. Раньше
// строка звучала дважды — «КАТЕГОРИЯ» сверху и «Категория» в строке, — а
// значение жалось к правому краю мелким серым.
//
// ЗНАЧОК И ЦВЕТ — ИЗ САМОЙ КАТЕГОРИИ. Они лежат в справочнике (⛽ 🧰 📦, свой
// цвет у каждой), и человек узнаёт «Топливо» по оранжевой колонке быстрее, чем
// читает слово. Кружок и его размер — те же, что у строки-двери, поэтому при
// выборе ничего не прыгает.

export function CategoryBlock({
  category,
  title = "Категория",
  emptyLabel = "Выбрать категорию",
  emptyHint = "Открывает список категорий",
  onPress,
}: {
  /** Выбранная категория; `null` — ещё не выбрана. */
  category: FinanceCategory | null | undefined;
  /** Шапка блока. Своё слово нужно там, где категорий несколько видов. */
  title?: string;
  emptyLabel?: string;
  emptyHint?: string;
  onPress: () => void;
}) {
  const t = useThemeColors();

  if (!category) {
    return (
      <SectionCard title={title} dense>
        <ChooseRow
          icon={Tag}
          label={emptyLabel}
          hint={emptyHint}
          compact
          onPress={onPress}
        />
      </SectionCard>
    );
  }

  const tint = category.color ?? t.accent;
  const Preset = iconPreset(category.icon);
  // В справочнике значок лежит либо именем из словаря, либо эмодзи как есть.
  const emoji = !Preset && category.icon ? category.icon : null;

  return (
    <SectionCard title={title} dense>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Категория: ${category.name}`}
        accessibilityHint="Открывает список категорий"
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 10,
          minHeight: 60,
          backgroundColor: pressed ? t.pressed : "transparent",
        })}
      >
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${tint}1f`,
          }}
        >
          {emoji ? (
            <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 16 }}>
              {emoji}
            </Text>
          ) : Preset ? (
            <Preset color={tint} size={ICON.sm} strokeWidth={2.2} />
          ) : (
            <Tag color={tint} size={ICON.sm} strokeWidth={2.2} />
          )}
        </View>
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{ flex: 1, fontSize: 17, fontWeight: "600", color: t.ink }}
        >
          {category.name}
        </Text>
      </Pressable>
    </SectionCard>
  );
}
