import { useLayoutEffect, useRef, useState } from "react";
import { View } from "react-native";
import type {
  FinanceCategory,
  FinanceCategoryKind,
} from "@babun/shared/db/repositories/finance-categories";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import { money } from "@babun/shared/common/utils/money";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Divider } from "@/components/ui/Divider";
import { NameColorField } from "@/components/ui/picker-fields";
import { SectionCard } from "@/components/ui/SectionCard";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { GUTTER } from "@/components/ui/tokens";
import { confirmAction } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { useTeams } from "@/features/reference/queries";
import { CATEGORY_KIND_ROW } from "./settings-levels";
import { useFinanceSettingLevelsOf } from "./use-finance-settings";
import { useCurrency } from "@/features/settings/currency";
import { AmountBlock } from "./AmountBlock";
import { askBudgetNotificationPermission } from "./budget-notify";
import { budgetInputText, parseBudgetInput } from "./category-budget";
import { useInsertCategory, useUpdateCategory } from "./queries";
import { useCategoryMonthSpend } from "./use-category-budget";

// ШТОРКА КАТЕГОРИИ — ОДНА НА СТРАНИЦУ КАТЕГОРИЙ И НА ШЕСТЕРЁНКУ «ФИНАНСОВ»
// (владелец 03.10: в шестерёнке у доходов, расходов и долгов свои блоки с
// самими категориями — тап по категории правит её на месте, «+» заводит
// новую, не уводя на страницу). Вынесена из `cabinet/categories.tsx` как была.
//
// ЛИСТ СОБРАН ИЗ БЛОКОВ, КАК ДОЛГ, ОПЕРАЦИЯ И СЧЁТ (владелец 2026-09-24:
// «переделай в категориях так, чтобы соблюдать нашу архитектуру»). Каждый
// вопрос — свой блок со своей шапкой и границами, а не поле формы с ярлыком:
// «Категория» — имя, цвет и значок одной строкой (как у календаря и счёта),
// «Бюджет в месяц» — тот же блок суммы, что в операции, «В операции
// спрашивать» — тумблеры в карточке.
//
// ЧТО СПРАШИВАТЬ В ОПЕРАЦИИ (владелец 2026-09-24: «зарплата смотрит
// сотрудников, другая прикрепляет клиента»). Три независимых тумблера, а не
// выбор одного из трёх: у чаевых и клиент, и мастер; топливу нужен чек.
//
// БЮДЖЕТ НА МЕСЯЦ — только у расхода; пусто — бюджета нет. Уведомление
// владельцу — на 80% и на 100% (`budget-notify.ts`).

export type CategoryEditorTarget =
  | { mode: "create"; kind: FinanceCategoryKind; teamId: string | null }
  | { mode: "edit"; category: FinanceCategory };

interface Asks {
  employee: boolean;
  client: boolean;
  receipt: boolean;
}

const NO_ASKS: Asks = { employee: false, client: false, receipt: false };

// Palette unified on the shared PRESET_COLORS (see ColorPicker); the old
// tailwind-hued SWATCHES are gone — default stays индиго.
const DEFAULT_COLOR = PRESET_COLOR_CYCLE[2].value;

const KIND_WORD: Record<FinanceCategoryKind, string> = {
  expense: "расход",
  income: "доход",
  debt: "долг",
};

export function CategoryEditorSheet({
  target,
  onClose,
}: {
  /** `null` — шторка закрыта. */
  target: CategoryEditorTarget | null;
  onClose: () => void;
}) {
  const th = useThemeColors();
  const insert = useInsertCategory();
  const update = useUpdateCategory();
  const allTeamsList = useTeams().data ?? [];
  const currency = useCurrency();
  const fmt = (n: number) => money(n, currency);

  // УХОДЯЩИЙ ЛИСТ НЕ ПЕРЕСТРАИВАЕТСЯ (краш Fabric «unmount … different
  // index», 03.10): пока шторка уезжает, она рисует ту же категорию, с
  // которой открылась, а не «новую · расход» по умолчанию.
  const lastTarget = useRef(target);
  if (target) lastTarget.current = target;
  const view = target ?? lastTarget.current;
  const editing = view?.mode === "edit" ? view.category : null;
  const kind: FinanceCategoryKind =
    view?.mode === "edit" ? view.category.type : (view?.kind ?? "expense");
  const teamId = view?.mode === "create" ? view.teamId : (editing?.team_id ?? null);
  // «Во всех командах» — только там, где человек сам правит категории этого
  // вида (03.10): сервер вставку в чужую команду отбил бы, и создание
  // упало бы целиком. У владельца — все команды.
  const levelsOf = useFinanceSettingLevelsOf();
  const teams = allTeamsList.filter((team) => levelsOf(team.id)[CATEGORY_KIND_ROW[kind]] === "write");
  const spend = useCategoryMonthSpend(kind === "expense" && view != null);

  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [icon, setIcon] = useState<string | null>(null);
  const [asks, setAsks] = useState<Asks>(NO_ASKS);
  const [budgetText, setBudgetText] = useState("");
  const [allTeams, setAllTeams] = useState(false);

  // ЗАКРЫТЬ БЕЗ СОХРАНЕНИЯ — ТОЛЬКО ПОСЛЕ ВОПРОСА (аудит 2026-09-24: свайп
  // по граберу молча терял набранное имя и тумблеры). Снимок — то, с чем
  // лист открылся; вопрос задаётся, когда лист уже уехал (окно поверх
  // уезжающего листа iOS не покажет) — как у формы операции.
  const opened = useRef("");
  const [askingClose, setAskingClose] = useState(false);
  const askOnExit = useRef(false);

  // Поля встают ДО первого кадра шторки: иначе она выезжала бы с прошлой
  // категорией и на глазах перерисовывалась.
  useLayoutEffect(() => {
    if (!target) return;
    if (target.mode === "edit") {
      const c = target.category;
      const openedAsks = {
        employee: c.ask_employee,
        client: c.ask_client,
        receipt: c.require_receipt,
      };
      const openedBudget = budgetInputText(c.monthly_budget);
      setName(c.name);
      setColor(c.color ?? DEFAULT_COLOR);
      setIcon(c.icon ?? null);
      setAsks(openedAsks);
      setBudgetText(openedBudget);
      opened.current = JSON.stringify([
        c.name.trim(),
        c.color ?? DEFAULT_COLOR,
        c.icon ?? null,
        openedAsks,
        openedBudget,
      ]);
    } else {
      setName("");
      setColor(DEFAULT_COLOR);
      setIcon(null);
      setAsks(NO_ASKS);
      setBudgetText("");
      opened.current = JSON.stringify(["", DEFAULT_COLOR, null, NO_ASKS, ""]);
    }
    setAllTeams(false);
  }, [target]);

  // У долга «кто» уже есть своим блоком (клиент или имя) — прикреплять нечего.
  const attachable = kind !== "debt";
  const budgetable = kind === "expense";
  const budget = budgetable ? parseBudgetInput(budgetText) : null;
  const snapshot = JSON.stringify([name.trim(), color, icon, asks, budgetText.trim()]);
  const saving = insert.isPending || update.isPending;
  const dirty = target != null && snapshot !== opened.current;
  const editingSpent = editing ? spend?.get(editing.id) : undefined;

  const guardedClose = () => {
    if (saving) return;
    if (!dirty) {
      onClose();
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
      if (ok) onClose();
      // Лист возвращается (или остаётся закрытым), когда уехал вопрос.
      setTimeout(() => setAskingClose(false), SHEET_EXIT_MS + 350);
    });
  };

  const submit = async () => {
    if (!target || !name.trim() || budget === undefined || saving) return;
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
        // «Во всех командах» — такая же категория каждой команде; иначе —
        // только выбранной. Команды без своей копии не остаётся ни одной.
        const targets = allTeams ? teams.map((t) => t.id) : teamId ? [teamId] : [];
        if (targets.length === 0) return;
        for (const team of targets) {
          await insert.mutateAsync({
            team_id: team,
            name: name.trim(),
            type: kind,
            color,
            icon,
            ...asksPayload,
          });
        }
      }
      onClose();
      // Разрешение на уведомления спрашиваем, когда бюджет только что
      // поставлен: тогда вопрос iOS понятен без объяснений.
      if (budgetAdded) void askBudgetNotificationPermission();
    } catch (e) {
      // Sheet stays open — nothing entered is lost.
      notify("Ошибка", (e as Error).message);
    }
  };

  return (
    <BottomSheet
      visible={target != null && !askingClose}
      onClose={guardedClose}
      onExited={askAfterExit}
      padded={false}
      scroll
      title={editing ? "Категория" : `Новая категория · ${KIND_WORD[kind]}`}
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
          {!editing && teams.length > 1 ? (
            <>
              <Divider inset={16} />
              <SwitchRow
                label="Во всех командах"
                hint={
                  allTeams
                    ? "Такая же категория появится у каждой команды"
                    : `Только у команды «${teams.find((t) => t.id === teamId)?.name ?? ""}»`
                }
                value={allTeams}
                onChange={setAllTeams}
              />
            </>
          ) : null}
        </SectionCard>

        {/* БЮДЖЕТ — ТОЛЬКО У РАСХОДА. Ноль или пусто — бюджета нет. */}
        {budgetable ? (
          <AmountBlock
            title="Бюджет в месяц"
            value={budgetText}
            onChange={setBudgetText}
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
              label="Партнёра"
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
  );
}
