import { useMemo, useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type AccessibilityActionEvent,
} from "react-native";
import { EyeOff, RotateCcw, Trash2 } from "lucide-react-native";
import type {
  FinanceCategory,
  FinanceCategoryKind,
} from "@babun/shared/db/repositories/finance-categories";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { EmptyState } from "@/components/ui/EmptyState";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { GradientButton } from "@/components/ui/GradientButton";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { ReorderList } from "@/components/ui/ReorderList";
import {
  AppearanceTile,
  appearanceRowFill,
} from "@/components/ui/AppearanceSheet";
import { NameColorField } from "@/components/ui/picker-fields";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { notify } from "@/lib/notify";
import { confirmThen } from "@/lib/confirm";
import {
  useDeleteCategory,
  useFinanceCategories,
  useInsertCategory,
  useSetCategoryHidden,
  useUpdateCategory,
  useReorderFinanceCategories,
} from "@/features/finances/queries";

// КАТЕГОРИИ — ПО РЕЦЕПТУ «МЕТКИ» (сведено 2026-09-10).
//
// Экран рисовал себя сам: редактор — сырой `Modal animationType="slide"` со
// своей шапкой и своим нижним отступом, имя и цвет — двумя раздельными
// полями, удаление и скрытие — двумя кнопками ВНУТРИ строки (голая мусорка и
// «Скрыть» словом), кнопка добавления — строкой внутри списка, а под списком
// стоял объясняющий абзац.
//
// Теперь то же, что у меток, типов объектов, типов событий и тегов: строка
// 52pt с кружком цвета, действия — на кромках свайпа, редактор —
// канонический `BottomSheet` с `NameColorField`, главное действие — кнопкой
// внизу экрана.
//
// СПРАВА — «УДАЛИТЬ», СЛЕВА — «СКРЫТЬ» (владелец 2026-09-10: «свайп вправо —
// это удалить, а не скрыть»; «чтобы её скрыть, надо свайпнуть, и оно
// открывается с левой стороны»). Сторона закреплена за СМЫСЛОМ, а не за
// «самым сильным из доступного этой строке»: у стандартной категории удалять
// нечего (она общая на весь продукт, её защищает RLS), и правой кромки у неё
// просто НЕТ — палец упирается в ноль, а не находит там скрытие. Иначе
// мышечная память врёт: на одной строке справа удаление, на соседней — нет.
//
// ТАП — ВСЕГДА ПРАВКА (владелец 2026-09-10: «тап на категорию — это идёт
// редактирование, а не оно скрыто»). Раньше тап по стандартной строке её
// скрывал: одно касание молча убирало категорию из списка — так у владельца
// пропали «Налоги и сборы». Теперь правку открывает только своя строка, а
// стандартная на тап не отвечает вовсе: скрыть её можно лишь намеренным
// жестом, у которого на кромке написано, что будет.
//
// СКРЫТАЯ ПАДАЕТ ВНИЗ (владелец 2026-09-10: «она больше не показывается в
// выборе категории и падает вниз»). В листах выбора её нет совсем — кроме
// той, что уже стоит в операции или шаблоне, иначе прошлая запись потеряла бы
// подпись. Здесь она остаётся, но в конце списка: исчезнувшая строка
// читалась бы как «категория удалена».

// Palette unified on the shared PRESET_COLORS (see ColorPicker); the old
// tailwind-hued SWATCHES are gone — default stays индиго.
const DEFAULT_COLOR = PRESET_COLOR_CYCLE[2].value;

export default function CategoriesScreen() {
  const th = useThemeColors();
  const { data: cats = [], isLoading, isError, error, refetch } =
    useFinanceCategories();
  const insert = useInsertCategory();
  const update = useUpdateCategory();
  const del = useDeleteCategory();
  const setHidden = useSetCategoryHidden();
  const reorderCats = useReorderFinanceCategories();

  // Третья ступень — долги (владелец 2026-09-10: «под расход свои категории,
  // под доход свои, под долги свои, они не смешиваются»). В списке
  // поставщиков и займов «Бензину» делать нечего.
  const [type, setType] = useState<FinanceCategoryKind>("expense");
  const [open, setOpen] = useState(false);
  // Правка своей категории (rename/цвет) — раньше единственным «редактором»
  // был деструктивный обход «удалить+создать», обнулявший category_id у
  // всей истории транзакций (аудит P1-8). Системные (tenant_id=null)
  // защищены RLS — их не открываем.
  const [editing, setEditing] = useState<FinanceCategory | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [icon, setIcon] = useState<string | null>(null);

  const filtered = useMemo(
    // Скрытые в конец, дальше — ПОРЯДОК ТЕНАНТА (перетаскивание), дальше имя.
    // До 2026-09-10 порядка не было вовсе: список шёл как пришёл из базы.
    () =>
      cats
        .filter((c) => c.type === type)
        .sort(
          (a, b) =>
            Number(a.hidden) - Number(b.hidden) ||
            a.position - b.position ||
            a.name.localeCompare(b.name, "ru", { sensitivity: "base" }),
        ),
    [cats, type],
  );

  const openCreate = () => {
    setEditing(null);
    setName("");
    setColor(DEFAULT_COLOR);
    setIcon(null);
    setOpen(true);
  };
  // СТАНДАРТНУЮ КАТЕГОРИЮ НЕЛЬЗЯ ПЕРЕИМЕНОВАТЬ — она общая на весь продукт,
  // и правка задела бы чужие компании. Зато её можно убрать из СВОЕГО списка:
  // владелец 2026-08-09 просил, чтобы список менялся полностью. Убирает
  // только левая кромка — тапом это не делается (см. закон в шапке).
  const [dragging, setDragging] = useState(false);

  // ПОРЯДОК — РУКА ВЛАДЕЛЬЦА И ТОЛЬКО ЕГО КОМПАНИИ: сами категории общие на
  // продукт, поэтому позиции лежат отдельной таблицей на тенант.
  const reorder = (ids: string[]) =>
    reorderCats.mutate(ids, {
      onError: (e: Error) =>
        notify("Не удалось сохранить порядок", e.message),
    });

  const toggleHidden = (c: FinanceCategory) => {
    setHidden.mutate(
      { id: c.id, hidden: !c.hidden },
      { onError: (e) => notify("Ошибка", e.message) },
    );
  };

  const openEdit = (c: FinanceCategory) => {
    setEditing(c);
    setName(c.name);
    setColor(c.color ?? DEFAULT_COLOR);
    setIcon(c.icon ?? null);
    setOpen(true);
  };

  const submit = async () => {
    if (!name.trim()) return;
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          patch: { name: name.trim(), color },
        });
      } else {
        await insert.mutateAsync({ name: name.trim(), type, color });
      }
      setName("");
      setOpen(false);
      setEditing(null);
    } catch (e) {
      // Sheet stays open — nothing entered is lost.
      notify("Ошибка", (e as Error).message);
    }
  };

  const confirmDelete = (c: FinanceCategory) => {
    if (!c.tenant_id) {
      notify("Системная категория", "Стандартную категорию нельзя удалить.");
      return;
    }
    confirmThen(
      "Удалить категорию?",
      {
        message: `«${c.name}» — прошлые операции останутся, но потеряют категорию в аналитике. Переименование безопаснее удаления.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      () =>
        del.mutate(c.id, { onError: (e) => notify("Ошибка", e.message) }),
    );
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Категории" />

      <SegmentedControl
        options={[
          { value: "expense", label: "Расходы", color: th.danger },
          { value: "income", label: "Доходы", color: th.success },
          { value: "debt", label: "Долги", color: th.warning },
        ]}
        value={type}
        onChange={setType}
        style={{ marginHorizontal: 16, marginTop: 12 }}
      />

      {isLoading ? (
        <EmptyState state="loading" fill />
      ) : isError ? (
        <EmptyState
          state="error"
          fill
          subtitle={error instanceof Error ? error.message : undefined}
          action={{ label: "Повторить", onPress: () => void refetch() }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          fill
          title={
            type === "expense"
              ? "Нет категорий расходов"
              : type === "income"
                ? "Нет категорий доходов"
                : "Нет категорий долгов"
          }
          subtitle={
            type === "debt"
              ? "Категории называют, за что висят деньги — «Поставщик», «Займ», «Аренда»"
              : "Категории группируют операции — «Бензин», «Аренда», «Выручка»"
          }
          action={{ label: "Добавить категорию", onPress: openCreate }}
        />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 12 }}
          scrollEnabled={!dragging}
        >
          <View style={{ paddingHorizontal: GUTTER }}>
            <ReorderList
              items={filtered}
              rowHeight={52}
              spaced
              labelFor={(item) => item.name}
              handleInside
              onReorder={reorder}
              onDraggingChange={setDragging}
            >
              {(item, _index, handle) => {
              const own = !!item.tenant_id;
              return (
                <SwipeRow
                  label={own ? "Удалить" : undefined}
                  color={own ? th.danger : undefined}
                  icon={own ? Trash2 : undefined}
                  accessibilityLabel={
                    own ? `Удалить категорию ${item.name}` : undefined
                  }
                  onAction={own ? () => confirmDelete(item) : undefined}
                  leading={{
                    label: item.hidden ? "Показать" : "Скрыть",
                    color: item.hidden ? th.success : th.warning,
                    icon: item.hidden ? RotateCcw : EyeOff,
                    accessibilityLabel: `${
                      item.hidden ? "Показать" : "Скрыть"
                    } категорию ${item.name}`,
                    onAction: () => toggleHidden(item),
                  }}
                >
                  <CategoryRow
                    item={item}
                    handle={handle}
                    onEdit={own ? () => openEdit(item) : undefined}
                    onToggleHidden={() => toggleHidden(item)}
                    onDelete={own ? () => confirmDelete(item) : undefined}
                  />
                </SwipeRow>
              );
              }}
            </ReorderList>
          </View>
        </ScrollView>
      )}

      {!isLoading && !isError && filtered.length > 0 ? (
        <View
          style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 16 }}
        >
          <GradientButton label="Добавить категорию" onPress={openCreate} />
        </View>
      ) : null}

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={
          editing
            ? "Категория"
            : `Новая категория · ${
                type === "expense" ? "расход" : type === "income" ? "доход" : "долг"
              }`
        }
        avoidKeyboard
        footer={
          <View style={{ paddingHorizontal: GUTTER }}>
            <Button
              label={editing ? "Сохранить" : "Создать категорию"}
              disabled={!name.trim()}
              onPress={() => void submit()}
            />
          </View>
        }
      >
        <NameColorField
          name={name}
          onNameChange={setName}
          color={color}
          onColorChange={setColor}
          icon={icon}
          onIconChange={setIcon}
          autoFocus={!editing}
        />
      </BottomSheet>
    </Screen>
  );
}

/** Строка категории — 52pt, кружок цвета, имя. Скрытая гаснет, но остаётся на
 *  месте: исчезнувшая строка читалась бы как «категория пропала».
 *
 *  ТАП ОТКРЫВАЕТ ПРАВКУ — и только её. У стандартной категории правки нет,
 *  поэтому строка не нажимается вовсе: «нажал — и оно скрылось» человек
 *  прочитает как поломку. Кромкам это не мешает, а ротор получает те же
 *  действия словами — подложка свайпа от него спрятана (см. SwipeRow). */
function CategoryRow({
  item,
  handle,
  onEdit,
  onToggleHidden,
  onDelete,
}: {
  item: FinanceCategory;
  /** Ручка перетаскивания — СНАРУЖИ нажимаемой области строки. */
  handle: ReactNode;
  /** Правка своей категории; `undefined` — стандартная, править нечего. */
  onEdit?: () => void;
  onToggleHidden: () => void;
  onDelete?: () => void;
}) {
  const th = useThemeColors();
  const actions = [
    { name: "hide", label: item.hidden ? "Показать" : "Скрыть" },
    ...(onDelete ? [{ name: "delete", label: "Удалить" }] : []),
  ];
  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === "hide") onToggleHidden();
    if (e.nativeEvent.actionName === "delete") onDelete?.();
  };
  const label = item.hidden
    ? `Категория ${item.name}, скрыта`
    : onEdit
      ? `Категория ${item.name}`
      : `Категория ${item.name}, стандартная`;
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
      {item.hidden ? (
        <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 12, color: th.faint }}>
          скрыта
        </Text>
      ) : null}
      {handle}
    </>
  );

  return onEdit ? (
    <Pressable
      onPress={onEdit}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Открывает имя и цвет"
      accessibilityActions={actions}
      onAccessibilityAction={onAccessibilityAction}
      style={({ pressed }) => box(pressed)}
    >
      {face}
    </Pressable>
  ) : (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      accessibilityActions={actions}
      onAccessibilityAction={onAccessibilityAction}
      style={box(false)}
    >
      {face}
    </View>
  );
}
