import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { parseMoneyInputToCents } from "@babun/shared/common/utils/money";
import {
  TX_TYPE_LABEL,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import type { Account } from "@babun/shared/local/finance/account";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ActionRow, RowGroup } from "@/components/ui/card-rows";
import { useThemeColors } from "@/theme/colors";
import { haptics } from "@/lib/haptics";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useLastNonNull } from "@/lib/use-last-non-null";
import { useTenant } from "@/features/settings/tenant";
import { useFeatureOn } from "@/features/settings/company-features";
import type { Team } from "@/features/reference/queries";
import { deleteOperationAlert, deleteTransferAlert } from "./account-alerts";
import { refundRemainingCents as refundRemainingCentsOf } from "./refund";
import { randomUuid } from "@babun/shared/sync";
import { useRouter, type Href } from "expo-router";
import { useReceipts } from "@/features/documents/receipts-queries";
import { MetaRow, PopupAmount, RefundForm } from "./transaction-popup/PopupParts";
import { popupMetaRows, transferLegsOf } from "./transaction-popup/popup-facts";
import { useTransferCounterpartAccountId } from "./transaction-popup/use-transfer-counterpart";

// ВИТРИНА ОПЕРАЦИИ — НИЖНИЙ ЛИСТ, А НЕ КАРТОЧКА ПОСЕРЕДИНЕ ЭКРАНА.
//
// Была центрированная карточка на своём `Modal` с собственными кнопками-
// пилюлями в 1px рамках — единственный такой жанр на весь продукт. Всплывающих
// жанров в дизайн-системе ровно два: `BottomSheet` и системный ActionSheet
// (владелец 2026-07-27: «мне не нравится, когда оно посередине вылазит — пусть
// снизу выезжает, как и всё»). Заодно ушли три самодельные вещи: скрим и
// анимация (их держит лист), крестик (у листа есть грабер и свайп) и пилюли
// действий — теперь это `ActionRow`, тот же ряд, что «Удалить объект» на
// карточке клиента.
//
// Содержимое не изменилось: сумма крупно, факты строками, действия рядами.
// «Создать возврат» по-прежнему пишет отрицательную строку через refund_of_id
// и упирается в остаток («до …»), а перевод отсюда только отменяется целиком.
export function TransactionPopup({
  visible,
  transaction,
  accounts,
  teams,
  categories,
  people,
  alreadyRefunded = 0,
  refundTotalsLoading = false,
  refundTotalsError = false,
  onClose,
  onInvoice,
  onClientOpen,
  onDelete,
  onRefund,
  allow,
}: {
  visible: boolean;
  transaction: FinanceTransaction | null;
  accounts: Account[];
  teams: Team[];
  categories: FinanceCategory[];
  /** Сотрудники — строка «Кому» у выплаты зарплаты. */
  people?: readonly { id: string; full_name: string }[];
  /** Σ already-refunded for this income — caps the new refund. */
  alreadyRefunded?: number;
  /** Σ возвратов ещё не приехала (первая загрузка `useRefundTotals`): кап
   *  неизвестен, поэтому «Создать возврат» прячется консервативно
   *  (`alreadyRefunded = Infinity`), а строка ниже обязана сказать почему —
   *  молчание читалось бы как «возврата тут не бывает». */
  refundTotalsLoading?: boolean;
  /** Запрос Σ возвратов упал: та же консервативная защита, другое слово. */
  refundTotalsError?: boolean;
  onClose: () => void;
  onInvoice: (tx: FinanceTransaction) => void;
  onClientOpen: (clientId: string) => void;
  onDelete: (tx: FinanceTransaction) => Promise<void>;
  onRefund: (tx: FinanceTransaction, amount: number, requestId: string) => Promise<void>;
  /** Что этому человеку открыто по уровню (этап 2 доступа). Не передано —
   *  открыто всё, как было: витрину зовут и с экранов без уровней. Ряд
   *  действия не рисуется вовсе — «видно, но при нажатии отказ» не бывает. */
  allow?: { refund?: boolean; invoice?: boolean; remove?: boolean };
}) {
  const t = useThemeColors();
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  // Id попытки возврата — один на открытую форму: повтор после потерянного
  // ответа упирается в тот же id и не проводит возврат второй раз.
  const [refundRequestId, setRefundRequestId] = useState(randomUuid);
  const [busy, setBusy] = useState(false);
  // Синхронный гард поверх busy: state включается только после ре-рендера,
  // и сверхбыстрый двойной тап «Возврат» успевал записать возврат дважды —
  // тот же класс бага, что savingRef в OperationSheet.
  const savingRef = useRef(false);
  /** Отложенное до полного ухода листа: вопрос об удалении (см. handleDelete). */
  const afterExit = useRef<(() => void) | null>(null);
  const currency = useTenant().data?.currency;
  const documentsOn = useFeatureOn("documents");
  const router = useRouter();
  // ОДНА ДВЕРЬ ВОЗВРАТА (владелец 04.10): у дохода с выписанным чеком возврат
  // идёт через чек — форма вернёт деньги и выпишет кредит-ноту, а не голую
  // минусовую строку без документа.
  const txReceipts = useReceipts({
    transactionIds: transaction?.id && transaction.type === "income" ? [transaction.id] : [],
    enabled: visible && !!transaction?.id && transaction.type === "income",
  });
  const liveReceipt =
    (txReceipts.data ?? []).find(
      (receipt) => receipt.transaction_id === transaction?.id && receipt.status === "issued",
    ) ?? null;
  const { data: counterpartAccountId } = useTransferCounterpartAccountId(
    visible ? transaction : null,
  );

  // Лист остаётся смонтированным — сбрасываем временное состояние на каждую
  // открытую операцию.
  useEffect(() => {
    if (!visible) return;
    setShowRefundForm(false);
    setRefundAmount("");
    setBusy(false);
  }, [visible, transaction?.id]);

  // ЛИСТ ДОЖИВАЕТ ДО КОНЦА УХОДА С ПОСЛЕДНЕЙ ОПЕРАЦИЕЙ. Родитель обнуляет
  // `transaction` в том же кадре, что и `visible`, и ранний `return null`
  // снимал лист целиком — без ухода и без `onExited`. А вопрос «Отменить
  // перевод?» / «Удалить операцию?» ждёт именно `onExited`: кнопка закрывала
  // лист и молчала (04.10, перевод Карта → Наличные так и остался в ленте).
  const shownTx = useLastNonNull(transaction);
  if (!shownTx) return null;
  const tx = shownTx;

  const account = accounts.find((a) => a.id === tx.account_id);
  const team = teams.find((x) => x.id === tx.team_id);
  const category = categories.find((c) => c.id === tx.category_id);

  const counterpartAccount = counterpartAccountId
    ? accounts.find((a) => a.id === counterpartAccountId)
    : undefined;
  const transferLegs = transferLegsOf(tx, account, counterpartAccount);

  const tone =
    tx.type === "income"
      ? t.success
      : tx.type === "expense" || tx.type === "refund"
        ? t.danger
        : t.ink;
  // ПЕРЕВОД БЕЗ ЗНАКА (прогон 2026-09-23): в ленте всех счетов он «€55»,
  // а карточка того же перевода печатала «−€55» — минус читается как расход.
  // Деньги переехали; откуда и куда — строки ниже.
  const sign =
    tx.type === "income" || tx.type === "transfer" ? "" : "−";

  // Auto rows are the immutable financial mirror of an appointment. They may
  // only be refunded through that appointment; a generic refund here would
  // leave its paid/prepaid fields disagreeing with the ledger.
  const isAppointmentLedger = tx.source === "auto";
  // Кап в центах — чистой функцией под тестом: float-математика здесь уже
  // ломалась однажды (см. refund.ts).
  const refundRemainingCents = refundRemainingCentsOf(
    tx.amount,
    alreadyRefunded,
  );
  const refundRemaining = refundRemainingCents / 100;
  const canRefund =
    (allow?.refund ?? true) &&
    tx.type === "income" &&
    !isAppointmentLedger &&
    // Оплата долга: возврат её долг не откроет — долг остался бы «закрытым»,
    // а деньги ушли бы клиенту (аудит 2026-09-30). Такой платёж снимают
    // удалением, тогда долг снова виден.
    !tx.debt_id &&
    // Кап неизвестен, пока Σ возвратов не приехала (или упала) — действие
    // не предлагаем, а не гасим молча: строка ниже называет причину.
    !refundTotalsLoading &&
    !refundTotalsError &&
    refundRemainingCents > 0;
  // ПОДПИСЬ ВМЕСТО МОЛЧАНИЯ. «Создать возврат» и так не появится, пока кап не
  // известен, — но пустое место рядом с доходом читалось бы как «у этой
  // операции возврата вообще не бывает». Условие то же, что у canRefund,
  // кроме самого кап-числа: показываем строку ИМЕННО тогда, когда причина —
  // загрузка или ошибка, а не типы/права/appointment-ledger.
  const refundStatusCaption =
    (allow?.refund ?? true) && tx.type === "income" && !isAppointmentLedger && !tx.debt_id
      ? refundTotalsLoading
        ? "Считаем, сколько уже возвращено…"
        : refundTotalsError
          ? "Не удалось проверить прошлые возвраты — возврат недоступен."
          : null
      : null;
  // Перевод УДАЛЯЕТСЯ, но не правится и не возвращается: сервер запрещает
  // редактировать ноги, а onDelete сверху отменяет перевод целиком — обе
  // ноги атомарно по transfer_group_id. Это единственная дверь к отмене
  // перевода с главного экрана.
  const canDelete = (allow?.remove ?? true) && !isAppointmentLedger && !tx.invoice_id;
  // «Инвойсы и чеки» выключены у компании (STORY-088) — пункта нет ни у кого.
  const canInvoice = (allow?.invoice ?? true) && tx.type === "income" && documentsOn;

  const refundCents = parseMoneyInputToCents(refundAmount);
  const refundNum = (refundCents ?? 0) / 100;
  const refundValid =
    refundCents != null && refundCents <= refundRemainingCents;

  const handleDelete = () => {
    // Доход с возвратом сервер удалить не даст — причина словами до вопроса,
    // а не «Системные поля финансовой операции нельзя изменять» после
    // (аудит 2026-10-03).
    if (tx.type === "income" && Number.isFinite(alreadyRefunded) && alreadyRefunded > 0) {
      haptics.warning();
      notify("Удалить нельзя", "По этому доходу есть возврат — сначала удалите возврат.");
      return;
    }
    // У перевода — свой текст (общий на продукт, account-alerts): человек
    // должен понимать, что отменяет ПЕРЕВОД ЦЕЛИКОМ — исчезнут обе операции,
    // а не одна строка ленты.
    const text =
      tx.type === "transfer"
        ? deleteTransferAlert()
        : // Один текст на свайп ленты, лист дня и эту витрину.
          deleteOperationAlert();
    // ИЗ ОТКРЫТОГО ЛИСТА СПРОСИТЬ НЕЛЬЗЯ (DS, LOCKED 2026-08-29) — вопрос
    // рисует хост приложения поверх окна листа, и iOS его не показывает.
    // Ждём `onExited`; см. тот же приём в OperationSheet.remove.
    afterExit.current = () => {
    confirmThen(
      text.title,
      {
        message: text.message,
        confirmLabel: text.confirm,
        destructive: true,
      },
      async () => {
        if (savingRef.current) return;
        savingRef.current = true;
        try {
          await onDelete(tx);
          haptics.success();
        } catch (e) {
          notify("Ошибка", (e as Error).message);
        } finally {
          savingRef.current = false;
        }
      },
    );
    };
    onClose();
  };

  const handleRefund = async () => {
    if (savingRef.current || !refundValid || busy) return;
    savingRef.current = true;
    setBusy(true);
    try {
      await onRefund(tx, refundNum, refundRequestId);
      haptics.success();
      onClose();
    } catch (e) {
      notify("Ошибка", (e as Error).message);
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  const metaRows = popupMetaRows({
    tx,
    category,
    people,
    transferLegs,
    account,
    team,
    teams,
    isAppointmentLedger,
    alreadyRefunded,
    refundRemainingCents,
  });

  // Действия — рядами того же языка, что «Удалить объект» на карточке
  // клиента. Порядок от безобидного к разрушительному, удаление последним.
  const actions: { label: string; tone?: "danger"; onPress: () => void }[] = [];
  if (canInvoice) {
    actions.push({
      label: tx.invoice_id ? "Открыть инвойс" : "Выставить инвойс",
      onPress: () => onInvoice(tx),
    });
  }
  if (tx.client_id) {
    actions.push({
      label: "Открыть клиента",
      onPress: () => onClientOpen(tx.client_id as string),
    });
  }
  if (canRefund) {
    actions.push({
      label: "Создать возврат",
      onPress: () => {
        if (liveReceipt && !tx.invoice_id) {
          afterExit.current = () =>
            router.push(`/documents/receipt-refund?receiptId=${liveReceipt.id}` as Href);
          onClose();
          return;
        }
        setShowRefundForm(true);
        setRefundAmount(String(refundRemaining));
        setRefundRequestId(randomUuid());
      },
    });
  }
  if (canDelete) {
    actions.push({
      label: tx.type === "transfer" ? "Отменить перевод" : "Удалить операцию",
      tone: "danger",
      onPress: handleDelete,
    });
  }

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      // Пока возврат/удаление в полёте, лист не закрывается ни свайпом, ни
      // тапом мимо: Alert об ошибке иначе прилетал поверх пустого экрана.
      onClose={busy ? () => {} : onClose}
      onExited={() => {
        const run = afterExit.current;
        afterExit.current = null;
        run?.();
      }}
      title={TX_TYPE_LABEL[tx.type]}
      avoidKeyboard
      scroll
    >
      <View style={{ paddingBottom: 24 }}>
        <PopupAmount sign={sign} amount={tx.amount} tone={tone} notes={tx.notes} />

        <RowGroup>
          {metaRows.map((row, i) => (
            <MetaRow
              key={row.label}
              label={row.label}
              value={row.value}
              first={i === 0}
            />
          ))}
        </RowGroup>

        {/* ПОДПИСЬ ВМЕСТО МОЛЧАНИЯ — пока кап возврата не известен (или
            запрос упал), «Создать возврат» не появляется вовсе; без этой
            строки пустое место рядом с доходом читалось бы как «возврата тут
            не бывает». */}
        {refundStatusCaption ? (
          <Text
            className="px-5 pb-1 pt-3 text-center text-[13px]"
            style={{ color: refundTotalsError ? t.danger : t.sub }}
          >
            {refundStatusCaption}
          </Text>
        ) : null}

        {!showRefundForm ? (
          actions.length > 0 ? (
            <RowGroup>
              {actions.map((action, i) => (
                <ActionRow
                  key={action.label}
                  label={action.label}
                  tone={action.tone}
                  separated={i > 0}
                  dimmed={busy}
                  onPress={action.onPress}
                />
              ))}
            </RowGroup>
          ) : null
        ) : (
          <RefundForm
            refundAmount={refundAmount}
            onChangeAmount={setRefundAmount}
            refundRemaining={refundRemaining}
            refundValid={refundValid}
            currency={currency}
            busy={busy}
            onRefund={handleRefund}
            onCancel={() => setShowRefundForm(false)}
          />
        )}
      </View>
    </BottomSheet>
  );
}
