import { type ReactNode } from "react";
import { Pressable, Text, type AccessibilityActionEvent } from "react-native";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import { AppearanceTile, appearanceRowFill } from "@/components/ui/AppearanceSheet";
import { useThemeColors } from "@/theme/colors";

// СТРОКА СПРАВОЧНИКА КАТЕГОРИЙ — вынесена из страницы категорий (03.10,
// когда у страницы появился режим «Только видит»): страница выросла за 400
// строк.

/** Строка категории — 52pt, кружок цвета, имя. Скрытая гаснет, но остаётся на
 *  месте: исчезнувшая строка читалась бы как «категория пропала».
 *
 *  ТАП ОТКРЫВАЕТ ПРАВКУ — и только её: «нажал — и оно скрылось» человек
 *  прочитает как поломку. Кромкам это не мешает, а ротор получает те же
 *  действия словами — подложка свайпа от него спрятана (см. SwipeRow). */
export function CategoryRow({
  item,
  budget,
  handle,
  onEdit,
  onToggleHidden,
  onDelete,
}: {
  item: FinanceCategory;
  /** Бюджет месяца: «€180 из €250» и порог (80 — жёлтым, 100 — красным). */
  budget: { text: string; level: 0 | 80 | 100 } | null;
  /** Ручка перетаскивания — СНАРУЖИ нажимаемой области строки. */
  handle: ReactNode;
  /** Нет — строка только показывает («Только видит», 03.10): ни правки, ни
   *  кромок, ни действий ротора. */
  onEdit?: () => void;
  onToggleHidden?: () => void;
  onDelete?: () => void;
}) {
  const th = useThemeColors();
  const actions = onEdit
    ? [
        { name: "hide", label: item.hidden ? "Показать" : "Скрыть" },
        { name: "delete", label: "Удалить" },
      ]
    : [];
  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === "hide") onToggleHidden?.();
    if (e.nativeEvent.actionName === "delete") onDelete?.();
  };
  const label = item.hidden
    ? `Категория ${item.name}, скрыта`
    : budget
      ? `Категория ${item.name}, бюджет: ${budget.text}`
      : `Категория ${item.name}`;
  const box = (pressed: boolean) =>
    ({
      height: 52,
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: 16,
      paddingRight: 12,
      borderRadius: th.radius.card,
      backgroundColor: appearanceRowFill(item.color, pressed, {
        rest: th.surface,
        pressed: th.pressed,
      }),
      opacity: item.hidden ? 0.45 : 1,
    }) as const;
  const face = (
    <>
      {/* ПЛИТКА ВИДА — как у тега, метки, услуги и типа объекта. Точка 12pt
          умела показать только цвет, а у категории есть и значок. */}
      <AppearanceTile color={item.color} icon={item.icon} size={28} />
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        style={{ flex: 1, marginLeft: 12, fontSize: 16, color: th.ink }}
      >
        {item.name}
      </Text>
      {budget && !item.hidden ? (
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            fontSize: 13,
            fontVariant: ["tabular-nums"],
            fontWeight: budget.level ? "600" : "400",
            color:
              budget.level === 100
                ? th.danger
                : budget.level === 80
                  ? th.warning
                  : th.faint,
          }}
        >
          {budget.text}
        </Text>
      ) : null}
      {item.hidden ? (
        <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 12, color: th.faint }}>
          скрыта
        </Text>
      ) : null}
      {handle}
    </>
  );

  return (
    <Pressable
      onPress={onEdit}
      disabled={!onEdit}
      accessibilityRole={onEdit ? "button" : undefined}
      accessibilityLabel={label}
      accessibilityHint={onEdit ? "Открывает имя, цвет и что прикрепляет" : undefined}
      accessibilityActions={actions}
      onAccessibilityAction={onAccessibilityAction}
      style={({ pressed }) => box(pressed)}
    >
      {face}
    </Pressable>
  );
}
