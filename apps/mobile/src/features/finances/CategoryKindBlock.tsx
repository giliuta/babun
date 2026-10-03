import { Text, View } from "react-native";
import { Tag } from "lucide-react-native";
import type {
  FinanceCategory,
  FinanceCategoryKind,
} from "@babun/shared/db/repositories/finance-categories";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { SelectRow } from "@/components/ui/select-rows";
import { iconPreset } from "@/components/ui/icon-set";
import { useThemeColors } from "@/theme/colors";
import { budgetLevel, budgetShort, hasBudget } from "./category-budget";
import { kindBlockRows } from "./category-kind-block";

// БЛОК ВИДА КАТЕГОРИЙ В ШЕСТЕРЁНКЕ «ФИНАНСОВ» (владелец 03.10, вариант 2:
// «разделите категории — доход, расход, долги, — но не так, как сейчас»).
// Вместо трёх плиток с числом — у каждого вида свой блок, и в нём сами
// категории: первые три плашками, как «История» клиента. Тап — правка этой
// категории шторкой поверх шестерёнки. «Ещё N» (или «Все», когда всё видно)
// ведёт на страницу вида — там порядок, скрытие и удаление.
//
// НОВАЯ — СТРОКОЙ «ДОБАВИТЬ КАТЕГОРИЮ» ВНИЗУ БЛОКА, как «Добавить файл» у
// клиента: значка «+» для создания в продукте нет (`ui-policy-contract`).
// Пустой блок — только эта строка.

export function CategoryKindBlock({
  title,
  kind,
  categories,
  spend,
  fmt,
  onEdit,
  onAdd,
  onOpenAll,
}: {
  title: string;
  kind: FinanceCategoryKind;
  /** Категории команды этого вида — все, со скрытыми. */
  categories: readonly FinanceCategory[];
  /** Траты месяца по категории — для бюджета расхода. */
  spend: ReadonlyMap<string, number> | null | undefined;
  fmt: (n: number) => string;
  onEdit: (category: FinanceCategory) => void;
  onAdd: () => void;
  onOpenAll: () => void;
}) {
  const t = useThemeColors();
  const { shown, more, total } = kindBlockRows(categories);
  return (
    <SectionCard
      title={title}
      action={
        total > 0
          ? { label: more > 0 ? `Ещё ${more}` : "Все", pill: true, onPress: onOpenAll }
          : undefined
      }
    >
      {shown.length > 0 ? (
        <View style={{ paddingHorizontal: 12, paddingTop: 4, gap: 4 }}>
          {shown.map((category) => {
            const spent = spend?.get(category.id) ?? 0;
            const budget =
              kind === "expense" && hasBudget(category) && spend
                ? {
                    text: budgetShort(spent, category.monthly_budget ?? 0, fmt),
                    level: budgetLevel(spent, category.monthly_budget ?? 0),
                  }
                : null;
            return (
              <SelectRow
                key={category.id}
                plain
                icon={iconPreset(category.icon) ?? Tag}
                color={category.color ?? undefined}
                title={category.name}
                accessibilityLabel={
                  budget ? `${category.name}, бюджет: ${budget.text}` : category.name
                }
                accessibilityHint="Открывает категорию"
                trailing={
                  budget ? (
                    <Text
                      maxFontSizeMultiplier={1.2}
                      style={{
                        fontSize: 13,
                        fontVariant: ["tabular-nums"],
                        fontWeight: budget.level ? "600" : "400",
                        // Тот же порог, что на странице категорий: 80% —
                        // жёлтым, перерасход — красным.
                        color:
                          budget.level === 100
                            ? t.danger
                            : budget.level === 80
                              ? t.warning
                              : t.faint,
                      }}
                    >
                      {budget.text}
                    </Text>
                  ) : undefined
                }
                onPress={() => onEdit(category)}
              />
            );
          })}
        </View>
      ) : null}
      <ChooseRow compact icon={Tag} label="Добавить категорию" onPress={onAdd} />
    </SectionCard>
  );
}
