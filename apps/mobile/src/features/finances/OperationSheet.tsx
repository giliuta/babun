import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ChevronRight } from "lucide-react-native";
import type {
  FinanceTransaction,
  PaymentMethod,
} from "@babun/shared/local/finance/transaction";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { ActionRow } from "@/components/ui/card-rows";
import { Chip } from "@/components/ui/Chip";
import { OperationReceiptRow } from "./OperationReceiptRow";
import { paymentMethodForAccountKind } from "@/features/appointments/payment";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  applyTxVat,
  defaultTxVatMode,
  inputFromGross,
  TX_VAT_MODE_LABELS,
  type TxVatMode,
} from "@babun/shared/local/finance/vat";
import {
  effectiveVatSettings,
  useTeamVatOverrides,
  useVatSettings,
} from "./vat-queries";
import { ValuePickerSheet } from "@/components/ui/ValuePickerSheet";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import {
  formatEURExact as formatEUR,
  moneySign,
  parseMoneyInputToCents,
} from "@babun/shared/common/utils/money";
import { isOnline, randomUuid, useIsOnline } from "@babun/shared/sync";
import {
  accountServesTeam,
  isPaymentAccountCompatible,
} from "@babun/shared/local/finance/integrity";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import { useRouter } from "expo-router";
import { useTeams } from "@/features/reference/queries";
import {
  useDeleteTransaction,
  useFinanceCategories,
  useInsertTransaction,
  useUpdateTransaction,
} from "./queries";
import { useAccountsWithBalances } from "./accounts";
import { accountPickerLabel } from "./account-ui";

/** Финансы онлайн-only НА ЗАПИСЬ (ТЗ §8): без сети кнопка гасится и называет
 *  причину. Крутящаяся кнопка страшнее отказа — по ней не понять, записалась
 *  операция или нет, а свёрнутое приложение унесло бы намерение молча. */
const OFFLINE_OPERATION =
  "Без сети операция не записывается. Оформите её, когда появится связь.";

/** Команду в самом листе выбрать нечем — она приезжает с экрана финансов.
 *  Раньше подсказка отсылала «наверх экрана», которого под модальным листом
 *  не видно: совет обязан быть выполнимым. */
const NO_TEAM_REASON =
  "Закройте форму и выберите команду чипом на экране финансов — без команды операция не запишется.";

/** Операция закрытого счёта: сервер не принимает НИ правку, НИ удаление,
 *  пока счёт не открыт снова. Совет «выберите счёт заново» здесь невыполним,
 *  поэтому причина и единственный выход названы честно. */
const CLOSED_ACCOUNT_REASON =
  "Счёт этой операции закрыт. Изменить или удалить её можно, когда счёт снова открыт.";

export function OperationSheet({
  visible,
  onClose,
  defaultTeamId,
  defaultAccountId,
  defaultType = "expense",
  businessToday,
  transaction,
  onInvoice,
  onClientOpen,
  onRefund,
  refundedTotal = 0,
}: {
  visible: boolean;
  onClose: () => void;
  defaultTeamId?: string | null;
  /** Счёт, с карточки которого пришли: второй раз одно и то же не спрашиваем,
   *  а способ оплаты выводится из вида счёта. Только для НОВОЙ операции —
   *  существующая приносит свой счёт. */
  defaultAccountId?: string | null;
  /** С чего открыть НОВУЮ операцию. Расход — обычный случай (их за день
   *  десяток), поэтому он и по умолчанию. «Принять оплату» из вкладки чеков
   *  открывает сразу доход: иначе кнопка обещает одно, а форма делает другое. */
  defaultType?: "income" | "expense";
  /** Tenant-local YYYY-MM-DD, shared with the database business-day rules. */
  businessToday: string;
  transaction?: FinanceTransaction | null;
  /** Действия существующей операции — живут внизу той же формы, а не в
   *  отдельной витрине: владелец 2026-08-10 «всё сразу в редакции». */
  onInvoice?: (tx: FinanceTransaction) => void;
  onClientOpen?: (clientId: string) => void;
  onRefund?: (tx: FinanceTransaction) => void;
  /** Сколько уже вернули — по нему прячем «Создать возврат» и не даём
   *  опустить сумму дохода ниже возвращённого. */
  refundedTotal?: number;
}) {
  const th = useThemeColors();
  const online = useIsOnline();
  const { data: categories = [] } = useFinanceCategories();
  const { data: teams = [] } = useTeams();
  // Делит кэш счетов с экраном «Финансы» — один запрос на двоих вместо
  // повторного listAccounts.
  const accountsQuery = useAccountsWithBalances();
  const accounts = useMemo(
    () => accountsQuery.data ?? [],
    [accountsQuery.data],
  );
  // `account_balances` owner-only и на отказе БРОСАЕТ. Пустой список счетов из
  // этого делать нельзя: форма сказала бы «у команды нет активного счёта», то
  // есть соврала бы про устройство компании вместо того, чтобы назвать сбой.
  const accountsFailed =
    accountsQuery.data === undefined && accountsQuery.error !== null;
  const insert = useInsertTransaction();
  const update = useUpdateTransaction();
  const del = useDeleteTransaction();
  const toast = useToast();
  const isEdit = !!transaction;
  const router = useRouter();

  // No free-form «Возврат» here — a real refund is created from the
  // tx-detail popup («Создать возврат»): negative amount + refund_of_id
  // capped by the income's remaining sum (web parity).
  const [type, setType] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(defaultTeamId ?? null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [date, setDate] = useState(businessToday);
  const [notes, setNotes] = useState("");
  // Документ, подтверждающий операцию (путь в приватном бакете).
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  // Категория выбирается ЛИСТОМ, а не лентой чипов: категорий бывает два
  // десятка, и половина ленты всегда за краем экрана.
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  // Три клавиши НДС на самой операции. Владелец 2026-08-09: «не всегда надо
  // указывать НДС — иногда есть оплаты без него, это надо самому
  // регулировать». Пока не тронули руками, режим следует за настройкой
  // счёта/команды/компании.
  const [vatMode, setVatMode] = useState<TxVatMode>("none");
  const [vatTouched, setVatTouched] = useState(false);
  // Оператор нажал клавишу НДС В ЭТОМ открытии листа. Отдельно от vatTouched:
  // тот при правке взводится гидрацией, а здесь нужен именно жест человека —
  // только он разрешает пересчитать операцию по сегодняшней ставке.
  const [vatRetouched, setVatRetouched] = useState(false);
  // «Умный дефолт» счёта: пока диспетчер сам не трогал чипы счёта,
  // счёт следует за командой операции (счета строго per-team).
  const [accountTouched, setAccountTouched] = useState(false);
  // Идемпотентность вставки: клиентский PK, новый после каждого успеха.
  const [requestId, setRequestId] = useState(randomUuid);
  const savingRef = useRef(false);

  // Гидрация ТОЛЬКО по фронту открытия/смене операции: смена businessToday
  // в полночь или фоновый рефетч не должны стирать заполняемую форму.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) {
      hydratedFor.current = null;
      return;
    }
    const key = transaction?.id ?? "new";
    if (hydratedFor.current === key) return;
    hydratedFor.current = key;
    setRequestId(randomUuid());
    setAccountTouched(false);
    setVatRetouched(false);
    if (transaction) {
      setType(transaction.type === "income" ? "income" : "expense");
      const txVat: TxVatMode =
        transaction.vat_mode ?? (transaction.vat_amount ? "inclusive" : "none");
      setVatMode(txVat);
      setVatTouched(true);
      setAmount(
        String(
          inputFromGross(
            transaction.amount,
            txVat,
            Number(transaction.vat_rate ?? 0),
          ),
        ),
      );
      setCategoryId(transaction.category_id ?? null);
      setTeamId(transaction.team_id ?? null);
      setAccountId(transaction.account_id ?? null);
      setDate(transaction.occurred_on);
      setNotes(transaction.notes ?? "");
      setReceiptUrl(transaction.receipt_url ?? null);
    } else {
      setType(defaultType);
      setVatTouched(false);
      setAmount("");
      setCategoryId(null);
      setTeamId(defaultTeamId ?? null);
      setAccountId(null);
      setDate(businessToday);
      setNotes("");
      setReceiptUrl(null);
    }
    // Hydrate once per opened transaction id (guarded by hydratedFor).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, defaultTeamId, defaultType, transaction?.id, businessToday]);

  const cats = useMemo(
    () =>
      categories.filter(
        (c) =>
          c.type === (type === "expense" ? "expense" : "income") &&
          (!c.hidden || c.id === categoryId),
      ),
    [categories, type, categoryId],
  );
  // Счета команды операции. Способ оплаты их НЕ фильтрует: он из счёта и
  // выводится — раньше эти два контрола фильтровали друг друга, и человек
  // выбирал одно и то же дважды, сначала «Карта», потом «Карта».
  //
  // Сортировка простая по `position`: делить счета на «командные» и «общие»
  // больше не нужно — у счёта один владелец (владелец 2026-08-15).
  const teamAccounts = useMemo(
    () =>
      teamId
        ? accounts
            .filter((a) => accountServesTeam(a, teamId))
            .sort((a, b) => a.position - b.position)
        : [],
    [accounts, teamId],
  );

  const categoryName =
    categories.find((c) => c.id === categoryId)?.name ?? null;
  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  );

  const txAccountId = transaction?.account_id ?? null;
  // Счёт операции закрыт: среди живых счетов его нет, а сервер не примет ни
  // правку, ни удаление такой строки. Пока счета не приехали, не решаем —
  // иначе каждая правка на долю секунды объявлялась бы тупиком.
  const txAccountClosed =
    isEdit &&
    !!txAccountId &&
    accountsQuery.data !== undefined &&
    accounts.every((a) => a.id !== txAccountId);

  // ОПЕРАЦИЯ БЕЗ КОМАНДЫ — НЕ ТУПИК: команду наследуем от её счёта, как это
  // делает серверный триггер целостности. Эффект, а не сет при гидрации,
  // потому что счета приезжают асинхронно.
  useEffect(() => {
    if (!visible || !isEdit || teamId) return;
    const home = accounts.find((a) => a.id === txAccountId);
    if (home?.brigade_id) setTeamId(home.brigade_id);
  }, [visible, isEdit, teamId, accounts, txAccountId]);

  // СПОСОБ ОПЛАТЫ ВЫВОДИТСЯ ИЗ ВИДА СЧЁТА (биекция способ⇄вид) — отдельного
  // состояния у него нет: оно и рождало формы с ложным «Счёт не подходит»,
  // когда счёт уже выбран, а способ ещё стоял начальным «cash». У существующей
  // операции с её же счётом сохранённый способ сильнее вывода — правка заметки
  // не должна молча переписывать payment_method; тап по чипу счёта
  // (accountTouched) переводит на вывод.
  const payment: PaymentMethod | null =
    transaction &&
    !accountTouched &&
    accountId === transaction.account_id &&
    transaction.payment_method
      ? transaction.payment_method
      : selectedAccount
        ? paymentMethodForAccountKind(selectedAccount.kind)
        : null;
  const accountMismatch =
    !!accountId &&
    (!selectedAccount ||
      !teamId ||
      !accountServesTeam(selectedAccount, teamId) ||
      !isPaymentAccountCompatible(payment, selectedAccount.kind));

  // ДЕЙСТВУЮЩИЙ НАЛОГ ЭТОЙ ОПЕРАЦИИ: счёт → команда → компания.
  const vatSettingsQuery = useVatSettings();
  const teamVatOverrides = useTeamVatOverrides();
  const vat = effectiveVatSettings(
    vatSettingsQuery.data,
    (teamVatOverrides.data ?? []).find((o) => o.teamId === teamId),
    selectedAccount?.vat_mode ?? null,
  );
  // КЛАВИШИ ГАСИТ ТОЛЬКО ТУМБЛЕР КОМПАНИИ, А НЕ ПИН СЧЁТА.
  //
  // Компания с выключенным налогом не должна видеть слово «НДС» вообще — это
  // правило. А вот «Без НДС», закреплённое ЗА СЧЁТОМ, — это ПРЕДУСТАНОВКА:
  // настройки счёта прямо обещают «значение подставляется в новую операцию… в
  // самой операции его всегда можно переключить». Пока сюда смотрел
  // эффективный режим, пин счёта прятал секцию целиком — подпись врала, а
  // канон «три клавиши на КАЖДОЙ операции» ломался ровно там, где он важнее
  // всего: на расчётный счёт падает выручка с налогом, а в ту же кассу от
  // частника — без.
  //
  // Сервер против этого не возражает: `fill_transaction_vat` уважает и явное
  // 'none', и присланный снимок `vat_amount` — то есть клавиша операции
  // сильнее пина счёта и на записи тоже.
  const tenantVatOn = (vatSettingsQuery.data?.mode ?? "off") !== "off";
  const vatVisible = tenantVatOn && vat.rate > 0;

  // Дефолт счёта = счёт команды операции (командный раньше общего). Эффект
  // (а не разовый сет при открытии), потому что счета приезжают асинхронно
  // и команда меняется чипами; ручной выбор/сброс (accountTouched) дефолт
  // отключает.
  useEffect(() => {
    if (!visible || accountTouched || isEdit) return;
    if (!teamId || accountId !== null) return;
    const def = teamAccounts[0];
    if (def) setAccountId(def.id);
  }, [visible, accountTouched, isEdit, teamId, accountId, teamAccounts]);

  // ПРИШЛИ С КАРТОЧКИ СЧЁТА — счёт уже назван, спрашивать его второй раз
  // незачем; способ оплаты выведется из вида счёта сам. Эффектом, а не
  // разовым сетом при открытии: список счетов приезжает асинхронно, и вид
  // счёта на момент гидрации бывает ещё неизвестен.
  useEffect(() => {
    if (!visible || isEdit || accountTouched) return;
    if (!defaultAccountId || accountId === defaultAccountId) return;
    const preset = accounts.find((a) => a.id === defaultAccountId);
    if (!preset) return;
    setAccountId(preset.id);
  }, [
    visible,
    isEdit,
    accountTouched,
    defaultAccountId,
    accountId,
    accounts,
  ]);

  // Пока диспетчер не нажал клавишу сам, режим идёт за настройкой счёта.
  // Зависимость — ПОЛЯ настройки, а не сам объект: effectiveVatSettings
  // собирает новый объект на каждый рендер, и эффект зациклился бы.
  const vatModeSetting = vat.mode;
  const vatRateSetting = vat.rate;
  useEffect(() => {
    if (!visible || vatTouched || isEdit) return;
    setVatMode(
      defaultTxVatMode({
        mode: vatModeSetting,
        rate: vatRateSetting,
        exemptionNote: null,
      }),
    );
  }, [visible, vatTouched, isEdit, vatModeSetting, vatRateSetting]);

  // СТАВКА ОПЕРАЦИИ — ЕЁ СНИМОК, а не сегодняшняя настройка. Страница НДС
  // обещает: «поднимете ставку завтра — прошлые отчёты не изменятся», и
  // правка одной заметки у старой «Плюс НДС» не должна молча пересобрать
  // сумму по новой ставке (сервер снимок операции на UPDATE держит сам).
  // Сегодняшняя ставка достаётся новым операциям и явному пере-нажатию
  // клавиши НДС оператором.
  const opVatRate =
    isEdit && !vatRetouched ? Number(transaction?.vat_rate ?? 0) : vat.rate;

  const amountCents = parseMoneyInputToCents(amount);
  const amountNum = (amountCents ?? 0) / 100;
  const vatBreakdown = applyTxVat(amountNum, vatMode, opVatRate);
  // Возвраты сравниваются В ЦЕНТАХ: float-вычитание ломает ровные границы.
  // Доход нельзя опустить ниже уже возвращённого — иначе возвраты по нему
  // превысили бы сам доход (сервер это тоже отбивает, но причину человек
  // должен прочитать до нажатия).
  const belowRefunded =
    isEdit &&
    type === "income" &&
    amountCents != null &&
    Math.round(refundedTotal * 100) > 0 &&
    Math.round(vatBreakdown.gross * 100) < Math.round(refundedTotal * 100);
  const busy = insert.isPending || update.isPending || del.isPending;
  const dateInFuture = date > businessToday;
  const canSave =
    amountCents != null &&
    !!teamId &&
    !!accountId &&
    !accountMismatch &&
    !dateInFuture &&
    !belowRefunded &&
    !txAccountClosed &&
    // Финансы онлайн-only НА ЗАПИСЬ (ТЗ §8): без сети кнопка гасится и
    // объясняет себя строкой ниже. Крутящаяся кнопка страшнее отказа —
    // человек не знает, записалась операция или нет.
    online &&
    !busy;
  const isExpense = type === "expense";

  const save = async () => {
    // Синхронный гард: isPending включается только после ре-рендера,
    // сверхбыстрый двойной тап успевал бы дважды.
    if (savingRef.current) return;
    // Сеть проверяется В МОМЕНТ нажатия, а не только реактивным `online`:
    // между последним кадром и тапом связь могла пропасть.
    if (!isOnline()) {
      Alert.alert("Нет сети", OFFLINE_OPERATION);
      return;
    }
    if (txAccountClosed) {
      Alert.alert("Счёт закрыт", CLOSED_ACCOUNT_REASON);
      return;
    }
    if (amountCents == null) {
      Alert.alert(
        "Проверьте сумму",
        "Введите сумму больше нуля и не больше двух знаков после запятой.",
      );
      return;
    }
    if (belowRefunded) {
      Alert.alert(
        "Возвращено больше",
        `По этому доходу уже возвращено ${formatEUR(refundedTotal)}. Сумма не может стать меньше возвращённого — сначала удалите возврат.`,
      );
      return;
    }
    if (!teamId || !accountId) {
      Alert.alert("Не выбран счёт", "Операции нужны команда и её счёт. Команда выбирается чипом на экране финансов.");
      return;
    }
    if (accountMismatch || !payment) {
      Alert.alert(
        "Счёт не подходит",
        "Сохранённый счёт относится к другой команде или способу оплаты. Выберите доступный счёт заново.",
      );
      return;
    }
    savingRef.current = true;
    try {
      const breakdown = applyTxVat(amountNum, vatMode, opVatRate);
      const draft = {
        amount: breakdown.gross,
        vat_mode: vatMode,
        category_id: categoryId,
        team_id: teamId,
        account_id: accountId,
        payment_method: payment,
        notes: notes.trim() || null,
        occurred_on: date,
        receipt_url: receiptUrl,
        business_today: businessToday,
      };
      if (isEdit && transaction) {
        await update.mutateAsync({ id: transaction.id, patch: draft });
      } else {
        // request_id стабилен на время попытки: ретрай после потерянного
        // ответа не задваивает деньги (duplicate key = успех в репозитории).
        await insert.mutateAsync({ type, request_id: requestId, ...draft });
        setRequestId(randomUuid());
      }
      haptics.success();
      toast(isEdit ? "Сохранено" : "Операция добавлена");
      onClose();
    } catch (e) {
      Alert.alert("Ошибка", (e as Error).message);
    } finally {
      savingRef.current = false;
    }
  };

  const remove = () => {
    if (!transaction) return;
    // Тело — ПОСЛЕДСТВИЕ, а не «нельзя отменить» (правила текстов
    // account-alerts): человек решает по тому, что произойдёт с деньгами.
    Alert.alert(
      "Удалить операцию?",
      "Операция исчезнет из ленты, остаток счёта пересчитается.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            try {
              await del.mutateAsync(transaction.id);
              haptics.success();
              onClose();
            } catch (e) {
              Alert.alert("Ошибка", (e as Error).message);
            }
          },
        },
      ],
    );
  };

  // Пока мутация в полёте, лист не закрывается ни скримом, ни свайпом:
  // ошибка сохранения должна прилететь в открытую форму, а не поверх уже
  // закрытой ленты, где набранное потеряно.
  const guardedClose = () => {
    if (!busy) onClose();
  };

  // Строки «Ещё»: разделители считаются от реально показанных соседей.
  const showClientRow = !!transaction?.client_id && !!onClientOpen;
  const showInvoiceRow = transaction?.type === "income" && !!onInvoice;
  const showRefundRow =
    !!transaction &&
    transaction.type === "income" &&
    !!onRefund &&
    // Возврат — тоже запись на закрытый счёт, сервер её не примет.
    !txAccountClosed &&
    // Остаток к возврату — по округлённым центам (moneySign), а не через
    // самодельный эпсилон: сравниваем ровно то, что напечатано.
    moneySign(transaction.amount - refundedTotal) > 0;

  // Причина погашенной кнопки — ровно одна и самая важная. Офлайн и
  // закрытый счёт — закрытые двери (нейтральный цвет), остальное — ошибки
  // ввода.
  const reason: { text: string; error: boolean } | null = !online
    ? { text: OFFLINE_OPERATION, error: false }
    : accountsFailed
      ? {
          text: "Не удалось загрузить счета. Закройте лист и откройте заново",
          error: true,
        }
      : txAccountClosed
        ? { text: CLOSED_ACCOUNT_REASON, error: false }
        : amount.length > 0 && amountCents == null
          ? {
              text: "Введите сумму больше нуля и не больше двух знаков после запятой",
              error: true,
            }
          : belowRefunded
            ? {
                text: `По этому доходу уже возвращено ${formatEUR(refundedTotal)} — сумма не может стать меньше возвращённого`,
                error: true,
              }
            : dateInFuture
              ? {
                  text: "Финансовую операцию нельзя записать будущей датой",
                  error: true,
                }
              : accountMismatch
                ? {
                    text: "Сохранённый счёт не подходит. Выберите доступный счёт заново",
                    error: true,
                  }
                : teamId && teamAccounts.length === 0
                  ? {
                      text: "У этой команды нет активного счёта — заведите его в «Счетах»",
                      error: true,
                    }
                  : amountCents != null && !teamId
                    ? { text: NO_TEAM_REASON, error: true }
                    : amountCents != null && !accountId
                      ? {
                          text: "Выберите счёт, на который записать операцию",
                          error: true,
                        }
                      : null;

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={guardedClose}
      title={isEdit ? "Операция" : "Новая операция"}
      scroll
      avoidKeyboard
      maxHeightRatio={0.86}
      footer={
        <View style={{ paddingHorizontal: 20, gap: 8 }}>
          {reason ? (
            <Text
              accessibilityLiveRegion="polite"
              maxFontSizeMultiplier={1.3}
              style={{
                fontSize: 13,
                lineHeight: 18,
                textAlign: "center",
                color: reason.error ? th.danger : th.sub,
              }}
            >
              {reason.text}
            </Text>
          ) : null}
          <Button
            label={
              isEdit
                ? "Сохранить"
                : isExpense
                  ? "Добавить расход"
                  : "Добавить доход"
            }
            onPress={save}
            disabled={!canSave}
            loading={busy}
          />
        </View>
      }
    >
      <View style={{ backgroundColor: th.canvas, paddingBottom: 24 }}>
        {/* ПОРЯДОК ПОЛЕЙ — КАК ЧЕЛОВЕК ДУМАЕТ (владелец 2026-08-09):
            расход/доход → команда и дата → категория → сумма → счёт →
            заметка → документ. Компактно: каждая строка ровно на своё
            содержимое, лист не растянут на весь экран.

            Полосы шаблонов здесь больше нет: она первой встречала на
            экране создания и занимала место под то, чем пользуются раз в
            месяц. Шаблоны живут в настройках финансов. */}

        {/* 1. Расход | Доход */}
        <SegmentedControl
          options={[
            { value: "expense", label: "Расход", color: th.danger },
            { value: "income", label: "Доход", color: th.success },
          ]}
          value={type}
          onChange={(seg) => {
            setType(seg);
            setCategoryId(null);
          }}
          disabled={isEdit}
          style={{ marginHorizontal: GUTTER, marginTop: 12 }}
        />

        {/* 2. Команда и дата ОДНОЙ карточкой. Команда не выбирается: она
            уже выбрана чипом на экране финансов, и второй выбор того же —
            лишний вопрос. Здесь она просто подписана. */}
        <SectionCard>
          <View className="flex-row items-center justify-between px-4 py-2.5">
            <Text className="text-base" style={{ color: th.sub }}>
              Команда
            </Text>
            <Text
              className="text-base font-semibold"
              style={{ color: th.ink }}
              numberOfLines={1}
            >
              {teamId
                ? (teams.find((t) => t.id === teamId)?.name ?? "Команда")
                : "Компания"}
            </Text>
          </View>
          <View className="ml-4 h-px" style={{ backgroundColor: th.separator }} />
          <View className="flex-row items-center justify-between px-4 py-2.5">
            <Text className="text-base" style={{ color: th.ink }}>Дата</Text>
            <DateTimePicker
              value={parseYMD(date)}
              maximumDate={parseYMD(businessToday)}
              mode="date"
              display="compact"
              themeVariant="light"
              locale="ru-RU"
              onChange={(_, d) => d && setDate(formatYMD(d))}
            />
          </View>
        </SectionCard>

        {/* 3. Категория — СТРОКА, а не полоса чипов: категорий бывает
            два десятка, и горизонтальная лента прячет половину за краем.
            Свои категории заводятся в настройках, и дорога туда лежит
            внутри выбора — там, где рука уже находится. */}
        <SectionCard>
          <Pressable
            onPress={() => setCategoryPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Категория: ${categoryName ?? "не выбрана"}`}
            className="min-h-[48px] flex-row items-center px-4 py-2.5"
            style={({ pressed }) => ({
              backgroundColor: pressed ? th.pressed : "transparent",
            })}
          >
            <Text className="text-base" style={{ color: th.ink }}>
              Категория
            </Text>
            <View className="ml-auto flex-row items-center gap-1.5">
              <Text
                className="text-base"
                style={{ color: categoryName ? th.ink : th.faint }}
                numberOfLines={1}
              >
                {categoryName ?? "Выбрать"}
              </Text>
              <ChevronRight color={th.chevron} size={17} strokeWidth={2.2} />
            </View>
          </Pressable>
        </SectionCard>

        {/* 4. Сумма */}
        <SectionCard title="Сумма">
          <View className="flex-row items-center px-4 py-2.5">
            <TextInput
              value={amount}
              accessibilityLabel="Сумма операции"
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              autoFocus
              placeholder="0"
              placeholderTextColor={th.placeholder}
              selectionColor={th.accent}
              keyboardAppearance="light"
              maxFontSizeMultiplier={1.2}
              className="flex-1 text-3xl font-bold"
              style={{
                color: isExpense ? th.danger : th.success,
                fontVariant: ["tabular-nums"],
              }}
            />
            <Text
              maxFontSizeMultiplier={1.2}
              className="text-3xl font-bold"
              style={{ color: th.faint }}
            >
              €
            </Text>
          </View>
        </SectionCard>

        {/* 4a. НДС — ТРИ КЛАВИШИ НА КАЖДОЙ ОПЕРАЦИИ. Появляются только у тех,
            кто с налогом работает: выключили тумблер компании — слова «НДС» в
            форме нет. Режим, закреплённый за счётом, клавиши не прячет — он
            выбирает, какая из них нажата при открытии.
            Под клавишами стоит последствие в евро, потому что разница
            между «включён» и «плюсом» — это деньги, а не термин. */}
        {vatVisible ? (
          <SectionCard title="НДС">
            <View className="flex-row flex-wrap gap-2 px-3 py-3">
              {(["none", "inclusive", "exclusive"] as TxVatMode[]).map(
                (m) => (
                  <Chip
                    key={m}
                    label={TX_VAT_MODE_LABELS[m]}
                    radio
                    selected={vatMode === m}
                    onPress={() => {
                      setVatTouched(true);
                      setVatRetouched(true);
                      setVatMode(m);
                    }}
                  />
                ),
              )}
            </View>
            {amountCents != null && vatMode !== "none" ? (
              <Text
                maxFontSizeMultiplier={1.3}
                className="px-4 pb-3 text-[13px]"
                style={{ color: th.sub, fontVariant: ["tabular-nums"] }}
              >
                {vatMode === "exclusive"
                  ? `На счёт придёт ${formatEUR(vatBreakdown.gross)} · налог ${formatEUR(vatBreakdown.vat)}`
                  : `Из них налог ${formatEUR(vatBreakdown.vat)} · вам остаётся ${formatEUR(vatBreakdown.net)}`}
              </Text>
            ) : null}
          </SectionCard>
        ) : null}

        {/* 5. Счёт — только кассы выбранной команды. Способ оплаты
            выводится из вида счёта: отдельного выбора «нал/карта» здесь
            нет, он повторял бы кассу. */}
        {teamAccounts.length > 0 ? (
          <SectionCard title="Счёт">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: 12,
                paddingVertical: 10,
                gap: 8,
              }}
            >
              {teamAccounts.map((a) => (
                <Chip
                  key={a.id}
                  label={accountPickerLabel(a)}
                  radio
                  selected={accountId === a.id}
                  // Radio-семантика: «ничего не выбрано» здесь не значение,
                  // а тупик (счёт обязателен) — повторный тап по выбранному
                  // чипу выбор не снимает.
                  onPress={() => {
                    setAccountTouched(true);
                    setAccountId(a.id);
                  }}
                />
              ))}
            </ScrollView>
          </SectionCard>
        ) : (
          <SectionCard title="Счёт">
            <Text className="px-4 py-3 text-sm" style={{ color: th.faint }}>
              {teamId
                ? "У этой команды нет активного счёта — заведите его в «Счетах»."
                : "Кассы принадлежат командам. Закройте форму и выберите команду чипом на экране финансов."}
            </Text>
          </SectionCard>
        )}

        {/* 6. Заметка */}
        <SectionCard title="Заметка">
          <TextInput
            value={notes}
            accessibilityLabel="Заметка к операции"
            onChangeText={setNotes}
            placeholder="Напр. бензин, материалы…"
            placeholderTextColor={th.placeholder}
            selectionColor={th.accent}
            keyboardAppearance="light"
            className="px-4 py-3 text-base"
            style={{ color: th.ink }}
          />
        </SectionCard>

        {/* 7. Документ, подтверждающий операцию: скан чека или накладная.
            Бухгалтеру нужна не сумма, а бумага под ней. Стоит ДО действий:
            документ — поле самой операции, и поля идут подряд. */}
        <SectionCard title="Документ">
          <OperationReceiptRow
            receiptUrl={receiptUrl}
            onPick={setReceiptUrl}
            disabled={busy}
          />
        </SectionCard>

        {/* 8. Действия этой операции. Раньше они жили в отдельной витрине,
            и до правки надо было пройти лишний экран. Теперь всё в одной
            форме: открыл — правь, а рядом то, что ещё можно сделать.
            «Удалить» — последняя строка этого же списка: красной кнопки в
            шапке у канонического листа нет. */}
        {isEdit && transaction ? (
          <SectionCard title="Ещё">
            {showClientRow ? (
              <ActionRow
                label="Открыть клиента"
                onPress={() => onClientOpen?.(transaction.client_id as string)}
              />
            ) : null}
            {showInvoiceRow ? (
              <ActionRow
                separated={showClientRow}
                label={
                  transaction.invoice_id ? "Открыть инвойс" : "Выставить инвойс"
                }
                onPress={() => onInvoice?.(transaction)}
              />
            ) : null}
            {showRefundRow ? (
              <ActionRow
                separated={showClientRow || showInvoiceRow}
                label="Создать возврат"
                onPress={() => onRefund?.(transaction)}
              />
            ) : null}
            {txAccountClosed && txAccountId ? (
              // Выход из тупика закрытого счёта: открыть счёт можно только
              // на его странице, отсюда туда и ведём.
              <ActionRow
                separated={showClientRow || showInvoiceRow || showRefundRow}
                label="Открыть страницу счёта"
                onPress={() => {
                  onClose();
                  router.push(`/accounts/${txAccountId}`);
                }}
              />
            ) : (
              <ActionRow
                separated={showClientRow || showInvoiceRow || showRefundRow}
                tone="danger"
                label="Удалить операцию"
                dimmed={busy}
                onPress={remove}
              />
            )}
          </SectionCard>
        ) : null}
      </View>

      {/* Выбор категории — тот же лист, что и везде. Шестерёнка внутри
          ведёт на страницу категорий: свои категории заводятся там, а не
          выдумываются заметкой в поле «Заметка». */}
      <ValuePickerSheet
        visible={categoryPickerOpen}
        title={isExpense ? "Категория расхода" : "Категория дохода"}
        options={cats.map((c) => ({
          id: c.id,
          label: c.name,
          color: c.color,
        }))}
        selectedId={categoryId}
        emptyLabel={
          isExpense
            ? "Пока нет ни одной категории расходов"
            : "Пока нет ни одной категории доходов"
        }
        onPick={setCategoryId}
        onSettings={() => router.push("/cabinet/categories")}
        settingsLabel="Категории операций"
        onClose={() => setCategoryPickerOpen(false)}
      />
    </BottomSheet>
  );
}
