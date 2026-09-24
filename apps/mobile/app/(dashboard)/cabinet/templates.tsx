import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import {
  formatEURExact as formatEUR,
  parseMoneyInputToCents,
} from "@babun/shared/common/utils/money";
import { accountDisplayName } from "@babun/shared/local/finance/account";
import {
  accountsForTeam,
  paymentMethodForAccountKind,
} from "@babun/shared/local/finance/integrity";
import {
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
} from "@babun/shared/local/finance/transaction";
import { Screen } from "@/components/ui/Screen";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { GradientButton } from "@/components/ui/GradientButton";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useMoney } from "@/features/settings/currency";
import { useFinanceCategories } from "@/features/finances/queries";
import { categoryInTeam, pickableCategories } from "@/features/finances/category-asks";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { useTeams } from "@/features/reference/queries";
import { notify } from "@/lib/notify";
import { confirmAction, confirmThen } from "@/lib/confirm";
import {
  useDeleteTemplate,
  useFinanceTemplates,
  useInsertTemplate,
  useUpdateTemplate,
  type FinanceTemplate,
} from "@/features/finances/templates-queries";

// Шаблоны операций — чип-строка над формой «+ Доход/Расход». Экран задаёт
// ВСЕ поля, которые чип реально применяет (OperationSheet.tsx: сумма,
// категория, команда, счёт; способ оплаты выводится из вида счёта) — раньше
// здесь были только name/kind/amount/category, а полноценный шаблон можно
// было получить лишь инлайн-захватом из формы операции; редактирования не
// было вовсе (аудит P1-7).
//
// ПО КАНОНУ ПРОДУКТА (прогон финансов 2026-09-24). Экран был старше
// дизайн-системы: мусорка на каждой строке, редактор отдельным окном `Modal`,
// «Добавить» то строкой внутри списка, то кнопкой пустого состояния. Теперь
// как у категорий: удаление — правой кромкой свайпа с вопросом, правка — та же
// шторка `BottomSheet`, главное действие — всегда кнопкой в футере. У компании
// с одной командой вопроса «Команда» нет — она подставляется сама.

const methodLabel = (m: PaymentMethod | null) =>
  m ? PAYMENT_METHOD_LABEL[m] : null;

/** ЕСТЬ ЛИ В ШТОРКЕ ШАБЛОНА ЧТО ТЕРЯТЬ (аудит финансов 2026-09-24): свайп
 *  вниз, тап по скриму и системная кнопка «назад» закрывали лист молча — тот
 *  же баг, что чинили в форме операции (`operation-dirty.ts`). Команда и счёт
 *  не входят напрямую: их ставит эффект-дефолт у пустой формы (одна команда,
 *  первый счёт), и такая подстановка — не то, что человек набрал руками. */
function templateDraftKey(f: {
  name: string;
  kind: "income" | "expense";
  amount: string;
  categoryId: string | null;
  brigadeId: string | null;
  accountId: string | null;
}): string {
  return JSON.stringify([
    f.name.trim(),
    f.kind,
    f.amount.trim(),
    f.categoryId,
    f.brigadeId,
    f.accountId,
  ]);
}

export default function TemplatesScreen() {
  const templatesQuery = useFinanceTemplates();
  const categoriesQuery = useFinanceCategories();
  const teamsQuery = useTeams();
  const accountsQuery = useAccountsWithBalances();
  const templates = useMemo(
    () => templatesQuery.data ?? [],
    [templatesQuery.data],
  );
  const categories = useMemo(
    () => categoriesQuery.data ?? [],
    [categoriesQuery.data],
  );
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const accounts = useMemo(
    () => accountsQuery.data ?? [],
    [accountsQuery.data],
  );
  const insert = useInsertTemplate();
  const update = useUpdateTemplate();
  const del = useDeleteTemplate();
  const t = useThemeColors();
  const { symbol } = useMoney();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FinanceTemplate | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [brigadeId, setBrigadeId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  // Команду/счёт нажали руками — отличает жест человека от эффекта-дефолта
  // (одна команда, первый счёт), который дирти-чек обязан игнорировать.
  const [brigadeTouched, setBrigadeTouched] = useState(false);
  const [accountTouched, setAccountTouched] = useState(false);
  // Снимок формы В МОМЕНТ открытия — сравнение живёт в `templateDraftKey`.
  const initialDraftKey = useRef<string | null>(null);
  // ИЗ ОТКРЫТОГО ЛИСТА ВОПРОС НЕ ПОКАЗАТЬ (DS, LOCKED 2026-08-29): лист
  // уезжает первым (askingClose), вопрос звучит по `onExited` листа.
  const [askingClose, setAskingClose] = useState(false);
  const afterExit = useRef<(() => void) | null>(null);

  // Скрытой категории в выборе нет (владелец 2026-09-10: «когда идёт скрыть,
  // она больше не показывается в выборе категории»). Исключение — та, что уже
  // стоит в этом шаблоне: иначе правка шаблона молча обнулила бы категорию.
  // И только команды шаблона (владелец 2026-09-24: «у каждой команды свой
  // тип расходов»): сменили команду — категория переходит на такую же у
  // новой команды или снимается.
  const cats = useMemo(
    () => pickableCategories(categories, kind, categoryId, brigadeId),
    [categories, kind, categoryId, brigadeId],
  );
  useEffect(() => {
    if (!brigadeId) return;
    setCategoryId((current) => categoryInTeam(categories, current, brigadeId));
  }, [brigadeId, categories]);
  // Чипы счёта появляются после выбора команды: её собственные счета плюс
  // счета компании, к которым команда подключена.
  const brigadeAccounts = useMemo(
    () => (brigadeId ? accountsForTeam(accounts, brigadeId) : []),
    [accounts, brigadeId],
  );
  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  );
  // Счёт из сохранённого шаблона мог закрыться или отвязаться от команды —
  // тогда шаблон нечем оплачивать, и сказать об этом надо до сохранения.
  const accountMismatch =
    !!accountId && !brigadeAccounts.some((a) => a.id === accountId);
  const teamName = useMemo(
    () => new Map(teams.map((tm) => [tm.id, tm.name])),
    [teams],
  );

  // Comma decimals («12,50» from the ru decimal-pad) must pass the same
  // normalisation as submit(), otherwise the button never enables.
  const amountCents = parseMoneyInputToCents(amount);
  const busy = insert.isPending || update.isPending;
  // КАТЕГОРИЯ ОБЯЗАТЕЛЬНА (прогон 2026-09-24): форма операции без неё не
  // сохраняет, и шаблон без категории «в один тап» упирался в «Выберите
  // категорию операции».
  const canSave =
    !!name.trim() &&
    amountCents != null &&
    !!categoryId &&
    cats.some((c) => c.id === categoryId) &&
    !!brigadeId &&
    !!accountId &&
    !accountMismatch &&
    !busy;
  const loading =
    templatesQuery.isLoading ||
    categoriesQuery.isLoading ||
    teamsQuery.isLoading ||
    accountsQuery.isLoading;
  const loadError =
    (templatesQuery.data === undefined ? templatesQuery.error : null) ||
    (categoriesQuery.data === undefined ? categoriesQuery.error : null) ||
    (teamsQuery.data === undefined ? teamsQuery.error : null) ||
    (accountsQuery.data === undefined ? accountsQuery.error : null);
  const refreshAll = () =>
    void Promise.all([
      templatesQuery.refetch(),
      categoriesQuery.refetch(),
      teamsQuery.refetch(),
      accountsQuery.refetch(),
    ]);

  useEffect(() => {
    if (!open || accountId || brigadeAccounts.length === 0) return;
    setAccountId(brigadeAccounts[0].id);
  }, [open, accountId, brigadeAccounts]);
  // Одна команда — выбирать не из чего: она и есть команда шаблона.
  useEffect(() => {
    if (!open || brigadeId || teams.length !== 1) return;
    setBrigadeId(teams[0].id);
  }, [open, brigadeId, teams]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setKind("expense");
    setAmount("");
    setCategoryId(null);
    setBrigadeId(null);
    setAccountId(null);
    setBrigadeTouched(false);
    setAccountTouched(false);
    initialDraftKey.current = templateDraftKey({
      name: "",
      kind: "expense",
      amount: "",
      categoryId: null,
      // Эффект-дефолт ещё не сработал — снимок берёт пустое состояние, как
      // и дирти-чек ниже, пока команду/счёт не тронули руками.
      brigadeId: null,
      accountId: null,
    });
    setOpen(true);
  };
  const openEdit = (tpl: FinanceTemplate) => {
    setEditing(tpl);
    setName(tpl.name);
    setKind(tpl.kind);
    setAmount(String(tpl.amount));
    setCategoryId(tpl.category_id);
    setBrigadeId(tpl.brigade_id);
    setAccountId(tpl.account_id);
    setBrigadeTouched(false);
    setAccountTouched(false);
    initialDraftKey.current = templateDraftKey({
      name: tpl.name,
      kind: tpl.kind,
      amount: String(tpl.amount),
      categoryId: tpl.category_id,
      brigadeId: tpl.brigade_id,
      accountId: tpl.account_id,
    });
    setOpen(true);
  };

  // Дирти-чек: команда/счёт участвуют только когда их выбрали РУКАМИ (или это
  // правка существующего шаблона — там оба поля были частью снимка с самого
  // начала). Иначе эффект-дефолт «одна команда» / «первый счёт» на пустой
  // форме читался бы как правка секунду спустя после открытия.
  const currentDraftKey = templateDraftKey({
    name,
    kind,
    amount,
    categoryId,
    brigadeId: editing || brigadeTouched ? brigadeId : null,
    accountId: editing || accountTouched ? accountId : null,
  });
  const dirty =
    initialDraftKey.current !== null &&
    currentDraftKey !== initialDraftKey.current;

  /** Свайп вниз, тап по скриму, системная кнопка «назад» — все идут сюда
   *  (`BottomSheet.onClose`). Есть что терять — лист сначала уезжает, вопрос
   *  звучит когда он уже снят (см. закон в OperationSheet.guardedClose). */
  const guardedClose = () => {
    if (busy) return;
    if (!dirty) {
      setOpen(false);
      return;
    }
    afterExit.current = () => {
      void confirmAction("Закрыть без сохранения?", {
        message: "Набранное не сохранится.",
        confirmLabel: "Закрыть",
        destructive: true,
      }).then((ok) => {
        if (!ok) {
          // Лист возвращается, когда уехал вопрос: окно поверх уезжающего
          // iOS не покажет, и лист остался бы невидимым.
          setTimeout(() => setAskingClose(false), SHEET_EXIT_MS + 350);
          return;
        }
        setAskingClose(false);
        setOpen(false);
      });
    };
    setAskingClose(true);
  };

  const submit = async () => {
    if (amountCents == null) {
      notify(
        "Проверьте сумму",
        "Введите сумму больше нуля и не больше двух знаков после запятой.",
      );
      return;
    }
    if (!brigadeId || !accountId) {
      notify(
        "Не заполнена оплата",
        "Выберите команду и счёт, на который проходит операция.",
      );
      return;
    }
    if (accountMismatch || !selectedAccount) {
      notify(
        "Счёт не подходит",
        "Сохранённый счёт больше не обслуживает эту команду. Выберите доступный счёт заново.",
      );
      return;
    }
    const draft = {
      name: name.trim(),
      kind,
      amount: amountCents / 100,
      category_id: categoryId,
      // Способ оплаты выводится из вида счёта: касса — «Наличные», карта —
      // «Карта». Спрашивать его отдельно значило дать собрать шаблон с
      // противоречием («Перевод» на кассу).
      payment_method: paymentMethodForAccountKind(selectedAccount.kind),
      brigade_id: brigadeId,
      account_id: accountId,
    };
    try {
      if (editing) await update.mutateAsync({ id: editing.id, patch: draft });
      else await insert.mutateAsync(draft);
      setOpen(false);
      setEditing(null);
    } catch (e) {
      // Sheet stays open — nothing entered is lost.
      notify("Ошибка", (e as Error).message);
    }
  };

  const confirmDelete = (id: string, label: string) =>
    confirmThen(
      "Удалить шаблон?",
      {
        // Последствие, а не имя: имя уже в заголовке строки, которую смахнули.
        message: `«${label}» пропадёт из списка шаблонов в форме операции. Сами операции, внесённые по нему, останутся.`,
        confirmLabel: "Удалить шаблон",
        destructive: true,
      },
      () =>
        del.mutate(id, { onError: (e) => notify("Ошибка", e.message) }),
    );

  // Причина погашенной кнопки — над ней, словами: серая кнопка без причины
  // читается как поломка.
  const reason = accountMismatch
    ? "Сохранённый счёт больше не подходит — выберите доступный."
    : brigadeId && brigadeAccounts.length === 0
      ? "У этой команды нет открытого счёта."
      : !brigadeId
        ? "Выберите команду."
        : !accountId
          ? "Выберите счёт."
          : !name.trim()
            ? "Назовите шаблон."
            : amountCents == null
              ? "Укажите сумму."
              : cats.length === 0
                ? `Сначала создайте категорию ${kind === "expense" ? "расходов" : "доходов"} в «Категориях операций».`
                : !categoryId || !cats.some((c) => c.id === categoryId)
                  ? "Выберите категорию."
                  : null;

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Шаблоны операций" />
      {loading ? (
        <EmptyState state="loading" fill />
      ) : loadError ? (
        <EmptyState
          fill
          state="error"
          subtitle={loadError instanceof Error ? loadError.message : undefined}
          action={{ label: "Повторить", onPress: refreshAll }}
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={templates}
          keyExtractor={(item) => item.id}
          // СТРОКА — СВОЯ КАРТОЧКА, как у категорий и счетов (`ReorderList
          // spaced`): полоса во всю ширину экрана с волосиной между строками
          // была облика другого, старого продукта.
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: 12,
            paddingBottom: 16,
            paddingHorizontal: GUTTER,
          }}
          renderItem={({ item }) => {
            // Подзаголовок: вид · способ · команда (команду — только когда их
            // несколько: у одной команды это повтор в каждой строке).
            const bits = [
              item.kind === "expense" ? "Расход" : "Доход",
              methodLabel(item.payment_method),
              teams.length > 1 && item.brigade_id
                ? teamName.get(item.brigade_id)
                : null,
            ].filter(Boolean);
            return (
              <View
                style={{
                  borderRadius: t.radius.card,
                  borderCurve: "continuous",
                  overflow: "hidden",
                  backgroundColor: t.surface,
                  boxShadow: t.cardShadow,
                }}
              >
              <SwipeRow
                // УДАЛИТЬ — ПРАВОЙ КРОМКОЙ, С ВОПРОСОМ (канон кромок, AGENTS 9).
                label="Удалить"
                color={t.danger}
                accessibilityLabel={`Удалить шаблон ${item.name}`}
                onAction={() => confirmDelete(item.id, item.name)}
              >
                <Pressable
                  onPress={() => openEdit(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Шаблон ${item.name}, ${formatEUR(Number(item.amount))}`}
                  accessibilityHint="Открывает правку шаблона"
                  accessibilityActions={[{ name: "delete", label: "Удалить" }]}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === "delete") {
                      confirmDelete(item.id, item.name);
                    }
                  }}
                  style={({ pressed }) => ({
                    minHeight: 56,
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    backgroundColor: pressed ? t.pressed : t.surface,
                  })}
                >
                  <View style={{ flex: 1, paddingRight: 8, minWidth: 0 }}>
                    <Text
                      numberOfLines={1}
                      maxFontSizeMultiplier={1.3}
                      style={{ fontSize: 16, fontWeight: "600", color: t.ink }}
                    >
                      {item.name}
                    </Text>
                    <Text
                      numberOfLines={1}
                      maxFontSizeMultiplier={1.3}
                      style={{ fontSize: 13, color: t.sub }}
                    >
                      {bits.join(" · ")}
                    </Text>
                  </View>
                  <Text
                    maxFontSizeMultiplier={1.3}
                    style={{
                      fontSize: 16,
                      fontWeight: "700",
                      fontVariant: ["tabular-nums"],
                      color: item.kind === "expense" ? t.danger : t.success,
                    }}
                  >
                    {formatEUR(Number(item.amount))}
                  </Text>
                </Pressable>
              </SwipeRow>
              </View>
            );
          }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={
            // Только слова: кнопка «Добавить шаблон» стоит в футере всегда.
            // Подпись говорит, зачем шаблон, — одно «Нет шаблонов» не
            // объясняло, что это вообще.
            <EmptyState
              fill
              title="Нет шаблонов"
              subtitle="Аренда, связь, топливо — повторяющийся расход сохраняется один раз и вносится одним тапом."
            />
          }
        />
      )}

      {/* ГЛАВНОЕ ДЕЙСТВИЕ — В ФУТЕРЕ, ВСЕГДА (AGENTS 7.1), как у категорий. */}
      {!loading && !loadError ? (
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 16 }}>
          <GradientButton label="Добавить шаблон" onPress={openCreate} />
        </View>
      ) : null}

      <BottomSheet
        visible={open && !askingClose}
        onClose={guardedClose}
        onExited={() => {
          const run = afterExit.current;
          afterExit.current = null;
          run?.();
        }}
        title={editing ? "Шаблон" : "Новый шаблон"}
        avoidKeyboard
        scroll
        footer={
          <View style={{ paddingHorizontal: GUTTER, gap: 8 }}>
            {reason ? (
              <Text
                maxFontSizeMultiplier={1.3}
                style={{
                  fontSize: 13,
                  textAlign: "center",
                  color: accountMismatch || (brigadeId && brigadeAccounts.length === 0)
                    ? t.danger
                    : t.sub,
                }}
              >
                {reason}
              </Text>
            ) : null}
            <Button
              label={editing ? "Сохранить" : "Создать шаблон"}
              onPress={() => void submit()}
              disabled={!canSave}
              loading={busy}
            />
          </View>
        }
      >
        <SegmentedControl
          options={[
            { value: "expense", label: "Расход", color: t.danger },
            { value: "income", label: "Доход", color: t.success },
          ]}
          value={kind}
          onChange={(k) => {
            setKind(k);
            setCategoryId(null);
          }}
          style={{ marginBottom: 12 }}
        />
        <Field
          label="Название"
          value={name}
          onChangeText={setName}
          placeholder="Аренда"
          autoFocus={!editing}
        />
        <Field
          label={`Сумма ${symbol}`}
          value={amount}
          onChangeText={setAmount}
          placeholder="0"
          keyboardType="decimal-pad"
        />
        {amount.length > 0 && amountCents == null ? (
          <Text style={{ marginBottom: 12, fontSize: 13, color: t.danger }}>
            Сумма — больше нуля и не больше двух знаков после запятой.
          </Text>
        ) : null}
        {/* КАТЕГОРИЯ ОБЯЗАТЕЛЬНА — ПОЭТОМУ ПОЛЕ ЕСТЬ ВСЕГДА. Готовых
            категорий у компании больше нет (владелец 2026-09-24), и пустой
            справочник прятал поле целиком: кнопка просила «Выберите
            категорию», а выбрать было не из чего. Теперь поле говорит
            словами, где категорию завести. */}
        <Text style={{ marginBottom: 8, fontSize: 13, fontWeight: "500", color: t.sub }}>
          Категория
        </Text>
        {cats.length > 0 ? (
          <View style={{ marginBottom: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {cats.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                radio
                selected={categoryId === c.id}
                onPress={() => setCategoryId(c.id)}
              />
            ))}
          </View>
        ) : (
          <Text style={{ marginBottom: 12, fontSize: 15, color: t.faint }}>
            {`Категорий ${kind === "expense" ? "расходов" : "доходов"} пока нет — их создают в «Категориях операций»`}
          </Text>
        )}
        {teams.length > 1 ? (
          <>
            <Text style={{ marginBottom: 8, fontSize: 13, fontWeight: "500", color: t.sub }}>
              Команда
            </Text>
            <View style={{ marginBottom: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {teams.map((tm) => (
                <Chip
                  key={tm.id}
                  label={tm.name}
                  radio
                  selected={brigadeId === tm.id}
                  onPress={() => {
                    const next = brigadeId === tm.id ? null : tm.id;
                    setBrigadeId(next);
                    setBrigadeTouched(true);
                    setAccountId(null);
                    setAccountTouched(false);
                  }}
                />
              ))}
            </View>
          </>
        ) : null}
        {brigadeAccounts.length > 0 ? (
          <>
            <Text style={{ marginBottom: 8, fontSize: 13, fontWeight: "500", color: t.sub }}>
              Счёт
            </Text>
            <View style={{ marginBottom: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {brigadeAccounts.map((a) => (
                <Chip
                  key={a.id}
                  label={accountDisplayName(a)}
                  radio
                  selected={accountId === a.id}
                  onPress={() => {
                    setAccountId(accountId === a.id ? null : a.id);
                    setAccountTouched(true);
                  }}
                />
              ))}
            </View>
          </>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}
