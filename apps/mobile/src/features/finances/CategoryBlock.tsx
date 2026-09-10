import { Tag } from "lucide-react-native";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import { ReferenceBlock } from "@/components/ui/ReferenceBlock";
import { iconPreset } from "@/components/ui/icon-set";

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
  // В справочнике значок лежит либо именем из словаря, либо эмодзи как есть.
  const Preset = iconPreset(category?.icon);
  const emoji = !Preset && category?.icon ? category.icon : null;

  return (
    <ReferenceBlock
      dense
      title={title}
      emptyIcon={Tag}
      emptyLabel={emptyLabel}
      emptyHint={emptyHint}
      value={
        category
          ? {
              name: category.name,
              color: category.color,
              Icon: Preset,
              emoji,
            }
          : null
      }
      onPress={onPress}
    />
  );
}
