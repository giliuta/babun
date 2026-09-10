import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Tag } from "lucide-react-native";
import type {
  FinanceTransaction,
  PaymentMethod,
} from "@babun/shared/local/finance/transaction";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { ActionRow } from "@/components/ui/card-rows";
import { Chip } from "@/components/ui/Chip";
import { OperationReceiptRow } from "./OperationReceiptRow";
import { AmountBlock } from "./AmountBlock";
import { CategoryBlock } from "./CategoryBlock";
import { paymentMethodForAccountKind } from "@/features/appointments/payment";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { InlineNoteField } from "@/features/appointments/InlineNoteField";
import { WhenRow } from "@/features/appointments/BookingSummary";
import { WhenSheet } from "@/features/appointments/WhenSheet";
import {
  PaymentTile,
  TILE_GAP,
  useTileWidth,
} from "@/features/appointments/PaymentTiles";

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
import { PickerSheet } from "@/components/ui/PickerSheet";
import { iconPreset } from "@/components/ui/icon-set";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
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
import { formatHM } from "@/features/appointments/helpers";
import { useRouter } from "expo-router";
import { useTeams } from "@/features/reference/queries";
import {
  useDeleteTransaction,
  useFinanceCategories,
  useInsertTransaction,
  useUpdateTransaction,
} from "./queries";
import { useAccountsWithBalances } from "./accounts";
import { accountIcon } from "./account-ui";

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
  debtPayment,
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
  /** ПЛАТЁЖ ПО ДОЛГУ. Долг сам по себе не деньги: движением денег становится
   *  ровно эта операция, поэтому платить по нему нечем, кроме обычной формы.
   *  Что известно заранее — кому, сколько осталось и в какую сторону, —
   *  форма не переспрашивает; человеку остаётся счёт. */
  debtPayment?: {
    debtId: string;
    counterparty: string;
    /** Остаток долга: сумма минус уже уплаченное. */
    amount: number;
    clientId: string | null;
  } | null;
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
  const tileWidth = useTileWidth();
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
  // Время операции (владелец 2026-09-07: «выбираю дату, время»). Новая —
  // сейчас; у старой строки времени может не быть — тогда его предлагают
  // указать, а не подставляют выдуманное.
  const [time, setTime] = useState<string | null>(() => formatHM(new Date()));
  const [notes, setNotes] = useState("");
  // Документ, подтверждающий операцию (путь в приватном бакете).
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  // Категория выбирается ЛИСТОМ, а не лентой чипов: категорий бывает два
  // десятка, и половина ленты всегда за краем экрана.
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  // Дата и время правятся ТЕМ ЖЕ листом, что у записи.
  const [whenOpen, setWhenOpen] = useState(false);
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
  /** Отложенное до полного ухода листа: см. `remove` и `runAfterExit`. */
  const afterExit = useRef<(() => void) | null>(null);

  // Гидрация ТОЛЬКО по фронту открытия/смене операции: смена businessToday
  // в полночь или фоновый рефетч не должны стирать заполняемую форму.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) {
      hydratedFor.current = null;
      return;
    }
    const key =
      transaction?.id ?? (debtPayment ? `debt:${debtPayment.debtId}` : "new");
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
      setTime(transaction.occurred_time ?? null);
      setNotes(transaction.notes ?? "");
      setReceiptUrl(transaction.receipt_url ?? null);
    } else {
      setType(defaultType);
      setVatTouched(false);
      // Остаток долга подставлен, но не заперт: отдать можно и часть — тогда
      // долг останется висеть на разницу, как и должен.
      setAmount(debtPayment ? String(debtPayment.amount) : "");
      setCategoryId(null);
      setTeamId(defaultTeamId ?? null);
      setAccountId(null);
      setDate(businessToday);
      setTime(formatHM(new Date()));
      setNotes(debtPayment ? `Долг: ${debtPayment.counterparty}` : "");
      setReceiptUrl(null);
    }
    // Hydrate once per opened transaction id (guarded by hydratedFor).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    visible,
    defaultTeamId,
    defaultType,
    transaction?.id,
    businessToday,
    debtPayment,
  ]);

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
  // Категория говорит собой: иконка и цвет из справочника, как у типа события
  // в записи. Не выбрана — нейтральный ярлычок, а не пустое место.
  const category = categoryId
    ? categories.find((c) => c.id === categoryId) ?? null
    : null;
  // Значок и цвет категории живут теперь в самом блоке (`CategoryBlock`) —
  // одном на долг и операцию: две копии этой развилки уже начинали расходиться.

  const save = async () => {
    // Синхронный гард: isPending включается только после ре-рендера,
    // сверхбыстрый двойной тап успевал бы дважды.
    if (savingRef.current) return;
    // Сеть проверяется В МОМЕНТ нажатия, а не только реактивным `online`:
    // между последним кадром и тапом связь могла пропасть.
    if (!isOnline()) {
      notify("Нет сети", OFFLINE_OPERATION);
      return;
    }
    if (txAccountClosed) {
      notify("Счёт закрыт", CLOSED_ACCOUNT_REASON);
      return;
    }
    if (amountCents == null) {
      notify(
        "Проверьте сумму",
        "Введите сумму больше нуля и не больше двух знаков после запятой.",
      );
      return;
    }
    if (belowRefunded) {
      notify(
        "Возвращено больше",
        `По этому доходу уже возвращено ${formatEUR(refundedTotal)}. Сумма не может стать меньше возвращённого — сначала удалите возврат.`,
      );
      return;
    }
    if (!teamId || !accountId) {
      notify("Не выбран счёт", "Операции нужны команда и её счёт. Команда выбирается чипом на экране финансов.");
      return;
    }
    if (accountMismatch || !payment) {
      notify(
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
        occurred_time: time,
        receipt_url: receiptUrl,
        business_today: businessToday,
        // Связь с долгом — она и делает операцию его погашением: остаток
        // считается по привязанным платежам, а не колонкой в долге.
        ...(debtPayment
          ? { debt_id: debtPayment.debtId, client_id: debtPayment.clientId }
          : {}),
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
      notify("Ошибка", (e as Error).message);
    } finally {
      savingRef.current = false;
    }
  };

  const remove = () => {
    if (!transaction) return;
    const target = transaction;
    // ИЗ ОТКРЫТОГО ЛИСТА СПРОСИТЬ НЕЛЬЗЯ (DS, LOCKED 2026-08-29): вопрос
    // рисует хост приложения, а лист — отдельное окно `Modal`. Открытый в тот
    // же кадр, вопрос получал от iOS «already presenting» и не появлялся
    // вовсе: кнопка «Удалить» молчала, и это была единственная дверь к откату
    // денег с экрана (2026-09-08). Сперва уезжаем, спрашиваем по `onExited` —
    // тем же способом, что «Удалить объект» в листе правки объекта.
    //
    // Тело вопроса — ПОСЛЕДСТВИЕ, а не «нельзя отменить» (правила текстов
    // account-alerts): человек решает по тому, что произойдёт с деньгами.
    afterExit.current = () => {
      confirmThen(
        "Удалить операцию?",
        {
          message: "Операция исчезнет из ленты, остаток счёта пересчитается.",
          confirmLabel: "Удалить",
          destructive: true,
        },
        async () => {
          try {
            await del.mutateAsync(target.id);
            haptics.success();
          } catch (e) {
            notify("Ошибка", (e as Error).message);
          }
        },
      );
    };
    onClose();
  };

  // Пока мутация в полёте, лист не закрывается ни скримом, ни свайпом:
  // ошибка сохранения должна прилететь в открытую форму, а не поверх уже
  // закрытой ленты, где набранное потеряно.
  const guardedClose = () => {
    if (!busy) onClose();
  };

  /** Что сделать, когда окно листа СНЯТО. Вопрос об удалении живёт здесь: см.
   *  `remove` и закон `BottomSheet.onExited`. */
  const runAfterExit = () => {
    const run = afterExit.current;
    afterExit.current = null;
    run?.();
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
      onExited={runAfterExit}
      title={
        debtPayment ? "Оплата долга" : isEdit ? "Операция" : "Новая операция"
      }
      // Команда не выбирается — она приехала чипом с экрана финансов. Строкой
      // поля она выглядела нажимаемой; здесь она просто подписана.
      subtitle={
        teamId ? (teams.find((t) => t.id === teamId)?.name ?? undefined) : "Компания"
      }
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
              debtPayment
                ? "Записать оплату"
                : isEdit
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
          // У платежа по долгу направление уже решено самим долгом: «мне
          // должны» гасят доходом, «я должен» — расходом. Переключатель здесь
          // только называет сторону.
          disabled={isEdit || !!debtPayment}
          style={{ marginHorizontal: GUTTER, marginTop: 12 }}
        />

        {/* 2. КОГДА — ТОТ ЖЕ БЛОК, ЧТО В ЗАПИСИ (владелец 2026-09-09: «посмотри
            по архитектуре, как мы делаем блок время»). Строка «день · время»
            открывает тот же лист с полосой недель и барабанами, каким
            назначают визит. Разница одна: у операции время — МОМЕНТ, а не
            отрезок, поэтому сегмент «Начало | Конец» в листе спрятан.

            Здесь стоял системный пикер iOS внутри строки — чужой продукту
            контрол и второй способ сказать то же самое. */}
        <WhenRow
          date={date}
          timeStart={time ?? formatHM(new Date())}
          onPress={() => {
            if (time == null) setTime(formatHM(new Date()));
            setWhenOpen(true);
            haptics.tap();
          }}
        />

        {/* 3. КАТЕГОРИЯ И 4. СУММА — ТЕ ЖЕ БЛОКИ, ЧТО У ДОЛГА (владелец
            2026-09-10: «операции сделай так же, как долги — блок категории,
            блок сумма, ниже заметка, ниже файл; берёшь то, что уже имеем»).

            Были склеены в одну карточку ради компактности, и от блока
            оставалась строка поля: слово «Категория» слева, серое «Выбрать» в
            хвосте, сумма без подписи. Блок узнают по шапке и границам раньше,
            чем читают, — а компактность взята воздухом, а не слиянием. */}
        <CategoryBlock
          category={category ?? null}
          onPress={() => {
            setCategoryPickerOpen(true);
            haptics.tap();
          }}
        />

        <AmountBlock
          value={amount}
          onChange={setAmount}
          accessibilityLabel="Сумма операции"
          color={isExpense ? th.danger : th.success}
          autoFocus
        />

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

        {/* 5. Счёт — ПЛИТКАМИ, КАК В ЗАПИСИ (владелец 2026-09-09: «счёт делаем
            так же, как в записи клиента: иконки полноценные, наличные или
            карта»). Лента чипов называла счёт словом; плитка несёт его значок
            и цвет — те же, что человек задал счёту в финансах, и тот же
            контрол, которым принимают оплату на записи. */}
        {accountsFailed ? (
          <SectionCard title="Счёт">
            <Text className="px-4 py-3 text-sm" style={{ color: th.faint }}>
              Счета не загрузились. Обновите экран финансов и откройте форму
              заново.
            </Text>
          </SectionCard>
        ) : teamAccounts.length > 0 ? (
          <SectionCard title="Счёт">
            <View
              className="flex-row flex-wrap"
              style={{
                paddingHorizontal: 16,
                paddingTop: 8,
                paddingBottom: 10,
                gap: TILE_GAP,
              }}
            >
              {teamAccounts.map((a) => (
                <PaymentTile
                  key={a.id}
                  icon={accountIcon(a)}
                  label={a.name}
                  color={a.color ?? th.ink}
                  tint={a.color}
                  width={tileWidth}
                  // Плитка держит СВОЙ цвет и в покое, и выбранной — им счёт
                  // и узнают. Radio-семантика: счёт обязателен, повторный тап
                  // выбор не снимает.
                  state="idle"
                  selected={accountId === a.id}
                  disabled={busy}
                  onPress={() => {
                    setAccountTouched(true);
                    setAccountId(a.id);
                  }}
                  accessibilityLabel={`Счёт: ${a.name}`}
                />
              ))}
            </View>
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

        {/* 6. ЗАМЕТКА. Подсказка НАЗЫВАЕТ поле, а не объясняет примером
            (владелец 2026-09-10 о заметке долга: «как объяснение не надо, это
            „например, обещал…“»). Разные подсказки по направлению ушли вместе
            с примером. */}
        <SectionCard title="Заметка" dense>
          <InlineNoteField
            note={{
              draft: notes,
              setDraft: setNotes,
              onFocus: () => {},
              onBlur: () => {},
            }}
            placeholder="Заметка операции"
            accessibilityLabel="Заметка операции"
            maxLength={500}
          />
        </SectionCard>

        {/* 7. ФАЙЛ — та же строка, что у долга и у файлов записи. */}
        <SectionCard title="Файл" dense>
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
      {/* ВЫБОР КАТЕГОРИИ — ТОТ ЖЕ ЛИСТ, ЧТО «ТИП СОБЫТИЯ» В ЗАПИСИ (владелец
          2026-09-09). Значок и цвет у категорий лежат в справочнике, а прежний
          лист рисовал только точку цвета: список читался как столбик слов.
          Ничего нового не заводим — берём готовый примитив продукта. */}
      {/* Полоса недель, барабаны и язык — те же, что у записи; сегмент
          «Начало | Конец» спрятан: у операции время одно. */}
      <WhenSheet
        open={whenOpen}
        onClose={() => setWhenOpen(false)}
        date={date}
        timeStart={time ?? formatHM(new Date())}
        timeEnd={time ?? formatHM(new Date())}
        allDay={false}
        allowAllDay={false}
        singleTime
        onCommit={(next) => {
          setDate(next.date);
          setTime(next.timeStart);
        }}
      />
      <PickerSheet
        visible={categoryPickerOpen}
        title={isExpense ? "Категория расхода" : "Категория дохода"}
        items={cats.map((c) => ({
          id: c.id,
          label: c.name,
          icon: iconPreset(c.icon) ?? c.icon ?? Tag,
          color: c.color ?? th.accent,
          onPress: () => setCategoryId(c.id),
        }))}
        selectedId={categoryId}
        onSettings={() => router.push("/cabinet/categories")}
        settingsLabel="Категории операций"
        onClose={() => setCategoryPickerOpen(false)}
      />
    </BottomSheet>
  );
}
