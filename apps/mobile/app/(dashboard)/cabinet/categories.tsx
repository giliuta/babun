import { useMemo, useRef, useState, type ReactNode } from "react";
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
import { SwitchRow } from "@/components/ui/SwitchRow";
import { Divider } from "@/components/ui/Divider";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { EmptyState } from "@/components/ui/EmptyState";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { SectionCard } from "@/components/ui/SectionCard";
import { AmountBlock } from "@/features/finances/AmountBlock";
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
import { confirmAction, confirmThen } from "@/lib/confirm";
import { money } from "@babun/shared/common/utils/money";
import { useCurrency } from "@/features/settings/currency";
import {
  useDeleteCategory,
  useFinanceCategories,
  useInsertCategory,
  useSetCategoryHidden,
  useUpdateCategory,
  useReorderFinanceCategories,
} from "@/features/finances/queries";
import {
  budgetInputText,
  budgetLevel,
  budgetShort,
  hasBudget,
  parseBudgetInput,
} from "@/features/finances/category-budget";
import { askBudgetNotificationPermission } from "@/features/finances/budget-notify";
import { useCategoryMonthSpend } from "@/features/finances/use-category-budget";

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
// «самым сильным из доступного этой строке»: мышечная память не должна врать —
// на каждой строке справа удаление, слева скрытие.
//
// ТАП — ВСЕГДА ПРАВКА (владелец 2026-09-10: «тап на категорию — это идёт
// редактирование, а не оно скрыто»). Раньше тап по стандартной строке её
// скрывал: одно касание молча убирало категорию из списка — так у владельца
// пропали «Налоги и сборы». Скрыть теперь можно лишь намеренным жестом, у
// которого на кромке написано, что будет.
//
// СКРЫТАЯ ПАДАЕТ ВНИЗ (владелец 2026-09-10: «она больше не показывается в
// выборе категории и падает вниз»). В листах выбора её нет совсем — кроме
// той, что уже стоит в операции или шаблоне, иначе прошлая запись потеряла бы
// подпись. Здесь она остаётся, но в конце списка: исчезнувшая строка
// читалась бы как «категория удалена».

// КАТЕГОРИИ ТОЛЬКО СВОИ (владелец 2026-09-24: «категорий вообще не должно
// быть готовых — клиент сам должен их создавать»). Готовые общие выведены из
// продукта миграцией 20260924200000: те, что компания использовала, стали её
// собственными. Поэтому «стандартной» строки больше нет — каждая правится
// тапом, скрывается слева и удаляется справа. Служебные категории сервера
// («Услуги» оплаты записи, «Возврат», пересчёт кассы) здесь не показываются:
// их не выбирают руками.
//
// ЧТО СПРАШИВАТЬ В ОПЕРАЦИИ (владелец 2026-09-24: «при добавлении категории
// надо понимать, что она должна делать — зарплата смотрит сотрудников, другая
// прикрепляет клиента»; «продумай, что ещё можно прикрепить»). Три
// независимых тумблера, а не выбор одного из трёх: у чаевых и клиент, и
// мастер; топливу нужен чек. Форма операции показывает ровно эти блоки.
//
// БЮДЖЕТ НА МЕСЯЦ (владелец 2026-09-24: «когда создам категорию, выставить
// бюджет, и она пришлёт уведомление, что перевалил лимит»). Только у расхода.
// Пусто — бюджета нет. В строке справочника — «€180 из €250» за этот месяц,
// жёлтым от 80%, красным при превышении; уведомление владельцу — на 80% и на
// 100% (`budget-notify.ts`).
//
// УДАЛИТЬ МОЖНО ТОЛЬКО НЕИСПОЛЬЗОВАННУЮ. По категории с операциями сервер
// удаление отбивает (история не теряет подписей), и экран предлагает то, что
// можно, — скрыть её из выбора.

interface Asks {
  employee: boolean;
  client: boolean;
  receipt: boolean;
}

const NO_ASKS: Asks = { employee: false, client: false, receipt: false };

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
  const [asks, setAsks] = useState<Asks>(NO_ASKS);
  const [budgetText, setBudgetText] = useState("");
  const currency = useCurrency();
  const fmt = (n: number) => money(n, currency);
  const spend = useCategoryMonthSpend(type === "expense");

  // ЗАКРЫТЬ БЕЗ СОХРАНЕНИЯ — ТОЛЬКО ПОСЛЕ ВОПРОСА (аудит 2026-09-24: свайп
  // по граберу молча терял набранное имя и тумблеры). Снимок — то, с чем
  // лист открылся; вопрос задаётся, когда лист уже уехал (окно поверх
  // уезжающего листа iOS не покажет) — как у формы операции.
  const opened = useRef("");
  const [askingClose, setAskingClose] = useState(false);
  const askOnExit = useRef(false);

  const filtered = useMemo(
    // Скрытые в конец, дальше — ПОРЯДОК ТЕНАНТА (перетаскивание), дальше имя.
    // До 2026-09-10 порядка не было вовсе: список шёл как пришёл из базы.
    () =>
      cats
        .filter((c) => c.type === type && !c.is_system)
        .sort(
          (a, b) =>
            Number(a.hidden) - Number(b.hidden) ||
            a.position - b.position ||
            a.name.localeCompare(b.name, "ru", { sensitivity: "base" }),
        ),
    [cats, type],
  );

  // У долга «кто» уже есть своим блоком (клиент или имя) — прикреплять нечего.
  const attachable = (editing?.type ?? type) !== "debt";
  const budgetable = (editing?.type ?? type) === "expense";
  const budget = budgetable ? parseBudgetInput(budgetText) : null;
  const snapshot = JSON.stringify([name.trim(), color, icon, asks, budgetText.trim()]);
  const saving = insert.isPending || update.isPending;
  const dirty = open && snapshot !== opened.current;
  const editingSpent = editing ? spend?.get(editing.id) : undefined;

  const openCreate = () => {
    setEditing(null);
    setName("");
    setColor(DEFAULT_COLOR);
    setIcon(null);
    setAsks(NO_ASKS);
    setBudgetText("");
    opened.current = JSON.stringify(["", DEFAULT_COLOR, null, NO_ASKS, ""]);
    setOpen(true);
  };
  // Скрывает только левая кромка — тапом это не делается (см. закон в шапке).
  const [dragging, setDragging] = useState(false);

  // ПОРЯДОК — РУКА ВЛАДЕЛЬЦА И ТОЛЬКО ЕГО КОМПАНИИ: позиции лежат отдельной
  // таблицей на тенант (завели, когда категории ещё были общими).
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
    const openedAsks = { employee: c.ask_employee, client: c.ask_client, receipt: c.require_receipt };
    setAsks(openedAsks);
    const openedBudget = budgetInputText(c.monthly_budget);
    setBudgetText(openedBudget);
    opened.current = JSON.stringify([
      c.name.trim(),
      c.color ?? DEFAULT_COLOR,
      c.icon ?? null,
      openedAsks,
      openedBudget,
    ]);
    setOpen(true);
  };

  const guardedClose = () => {
    if (saving) return;
    if (!dirty) {
      setOpen(false);
      return;
    }
    askOnExit.current = true;
    setAskingClose(true);
  };

  const askAfterExit = () => {
    if (!askOnExit.current) return;
    askOnExit.current = false;
    void confirmAction("Закрыть без сохранения?", {
      message: "Набранное в категории не сохранится.",
      confirmLabel: "Закрыть",
      destructive: true,
    }).then((ok) => {
      if (ok) {
        setOpen(false);
        setEditing(null);
      }
      // Лист возвращается (или остаётся закрытым), когда уехал вопрос.
      setTimeout(() => setAskingClose(false), SHEET_EXIT_MS + 350);
    });
  };

  const submit = async () => {
    if (!name.trim() || budget === undefined || saving) return;
    // У долга своих вопросов нет — «кто» у него отдельным блоком.
    const asksPayload = {
      ask_employee: attachable && asks.employee,
      ask_client: attachable && asks.client,
      require_receipt: attachable && asks.receipt,
      // Бюджет бывает только у расхода; у дохода и долга поля нет.
      ...(budgetable ? { monthly_budget: budget } : {}),
    };
    const budgetAdded =
      budgetable && budget != null && budget !== (editing?.monthly_budget ?? null);
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          patch: { name: name.trim(), color, icon, ...asksPayload },
        });
      } else {
        await insert.mutateAsync({
          name: name.trim(),
          type,
          color,
          icon,
          ...asksPayload,
        });
      }
      setName("");
      setOpen(false);
      setEditing(null);
      // Разрешение на уведомления спрашиваем, когда бюджет только что
      // поставлен: тогда вопрос iOS понятен без объяснений.
      if (budgetAdded) void askBudgetNotificationPermission();
    } catch (e) {
      // Sheet stays open — nothing entered is lost.
      notify("Ошибка", (e as Error).message);
    }
  };

  const confirmDelete = (c: FinanceCategory) => {
    confirmThen(
      "Удалить категорию?",
      {
        message: `«${c.name}» исчезнет из списка насовсем.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      () =>
        del.mutate(c.id, {
          onError: (e) => {
            // Категория уже в операциях: сервер удаление отбивает, чтобы
            // история не потеряла подписи. Предлагаем то, что можно.
            if (/используется/i.test(e.message) && !c.hidden) {
              confirmThen(
                "Категория уже в операциях",
                {
                  message: `Удалить «${c.name}» нельзя — прошлые операции потеряли бы подпись. Скрыть её из выбора?`,
                  confirmLabel: "Скрыть",
                },
                () => toggleHidden(c),
              );
              return;
            }
            notify("Ошибка", e.message);
          },
        }),
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
              : "Своих категорий пока нет — создайте те, что нужны именно вам"
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
              {(item, _index, handle) => (
                <SwipeRow
                  label="Удалить"
                  color={th.danger}
                  icon={Trash2}
                  accessibilityLabel={`Удалить категорию ${item.name}`}
                  onAction={() => confirmDelete(item)}
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
                    budget={
                      hasBudget(item) && spend
                        ? {
                            text: budgetShort(spend.get(item.id) ?? 0, item.monthly_budget, fmt),
                            level: budgetLevel(spend.get(item.id) ?? 0, item.monthly_budget),
                          }
                        : null
                    }
                    handle={handle}
                    onEdit={() => openEdit(item)}
                    onToggleHidden={() => toggleHidden(item)}
                    onDelete={() => confirmDelete(item)}
                  />
                </SwipeRow>
              )}
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
        visible={open && !askingClose}
        onClose={guardedClose}
        onExited={askAfterExit}
        padded={false}
        scroll
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
              disabled={!name.trim() || budget === undefined || saving}
              onPress={() => void submit()}
            />
          </View>
        }
      >
        {/* ЛИСТ СОБРАН ИЗ БЛОКОВ, КАК ДОЛГ, ОПЕРАЦИЯ И СЧЁТ (владелец
            2026-09-24: «переделай в категориях так, чтобы соблюдать нашу
            архитектуру»). Каждый вопрос — свой блок со своей шапкой и
            границами, а не поле формы с ярлыком: «Категория» — имя, цвет и
            значок одной строкой (как у календаря и счёта), «Бюджет в месяц» —
            тот же блок суммы, что в операции, «В операции спрашивать» —
            тумблеры в карточке. */}
        <View style={{ backgroundColor: th.canvas, paddingBottom: 16 }}>
          <SectionCard title="Категория" dense>
            <NameColorField
              bare
              label={null}
              placeholder="Название категории"
              name={name}
              onNameChange={setName}
              color={color}
              onColorChange={setColor}
              icon={icon}
              onIconChange={setIcon}
              autoFocus={!editing}
            />
          </SectionCard>

          {/* БЮДЖЕТ — ТОЛЬКО У РАСХОДА. Ноль или пусто — бюджета нет. */}
          {budgetable ? (
            <AmountBlock
              title="Бюджет в месяц"
              value={budgetText}
              onChange={setBudgetText}
              color={th.danger}
              accessibilityLabel="Бюджет в месяц"
              hint={
                budget === undefined
                  ? { text: "Сумма, не больше двух знаков после запятой", error: true }
                  : {
                      text: editingSpent
                        ? `В этом месяце — ${fmt(editingSpent)} · сообщим на 80% и при превышении`
                        : "Сообщим на 80% и при превышении",
                    }
              }
            />
          ) : null}

          {/* В ОПЕРАЦИИ СПРАШИВАТЬ — тумблеры с последствием словами: человек
              решает по тому, что появится в форме, а не по термину. */}
          {attachable ? (
            <SectionCard title="В операции спрашивать" dense>
              <SwitchRow
                label="Сотрудника"
                hint="Кому выплата или кто принёс: зарплата, аванс, подотчёт"
                value={asks.employee}
                onChange={(v) => setAsks((a) => ({ ...a, employee: v }))}
              />
              <Divider inset={16} />
              <SwitchRow
                label="Клиента"
                hint="От кого или для кого: продажа, чаевые, поставщик"
                value={asks.client}
                onChange={(v) => setAsks((a) => ({ ...a, client: v }))}
              />
              <Divider inset={16} />
              <SwitchRow
                label="Фото чека"
                hint="Без фото чека операцию не сохранить"
                value={asks.receipt}
                onChange={(v) => setAsks((a) => ({ ...a, receipt: v }))}
              />
            </SectionCard>
          ) : null}
        </View>
      </BottomSheet>
    </Screen>
  );
}

/** Строка категории — 52pt, кружок цвета, имя. Скрытая гаснет, но остаётся на
 *  месте: исчезнувшая строка читалась бы как «категория пропала».
 *
 *  ТАП ОТКРЫВАЕТ ПРАВКУ — и только её: «нажал — и оно скрылось» человек
 *  прочитает как поломку. Кромкам это не мешает, а ротор получает те же
 *  действия словами — подложка свайпа от него спрятана (см. SwipeRow). */
function CategoryRow({
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
  onEdit: () => void;
  onToggleHidden: () => void;
  onDelete: () => void;
}) {
  const th = useThemeColors();
  const actions = [
    { name: "hide", label: item.hidden ? "Показать" : "Скрыть" },
    { name: "delete", label: "Удалить" },
  ];
  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === "hide") onToggleHidden();
    if (e.nativeEvent.actionName === "delete") onDelete();
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
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Открывает имя, цвет и что прикрепляет"
      accessibilityActions={actions}
      onAccessibilityAction={onAccessibilityAction}
      style={({ pressed }) => box(pressed)}
    >
      {face}
    </Pressable>
  );
}
