import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  formatEURExact as formatEUR,
  parseMoneyInputToCents,
} from "@babun/shared/common/utils/money";
import {
  PAYMENT_METHOD_LABEL,
  TX_TYPE_LABEL,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import {
  accountDisplayName,
  type Account,
} from "@babun/shared/local/finance/account";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { MoneyField } from "@/components/ui/MoneyField";
import { ActionRow, RowGroup } from "@/components/ui/card-rows";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { haptics } from "@/lib/haptics";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useTenant } from "@/features/settings/tenant";
import { humanDay } from "@/features/appointments/helpers";
import type { Team } from "@/features/reference/queries";
import { deleteTransferAlert } from "./account-alerts";
import { refundRemainingCents as refundRemainingCentsOf } from "./refund";

/** Строка-факт витрины: ярлык слева, значение справа. Читается, но не
 *  правится — правка живёт в форме операции. */
function MetaRow({
  label,
  value,
  first,
}: {
  label: string;
  value: string;
  /** Первая строка группы шва над собой не имеет. */
  first?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View
      className="flex-row items-center justify-between px-4 py-2.5"
      style={{
        borderTopWidth: first ? 0 : 1,
        borderTopColor: t.separator,
      }}
    >
      <Text className="text-[13px]" style={{ color: t.sub }}>
        {label}
      </Text>
      <Text
        className="ml-2 flex-1 text-right text-[13px] font-medium"
        style={{ color: t.ink }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * Вторая нога перевода — id её счёта. Ленты грузят срез периода/счёта, и
 * парной строки в пропсах может не оказаться вовсе (карточка кассы видит
 * только свои операции), поэтому попап спрашивает её у леджера сам. Пара по
 * инварианту БД ровно из двух строк — первого совпадения достаточно.
 */
function useTransferCounterpartAccountId(tx: FinanceTransaction | null) {
  const tenantId = useTenantId();
  const leg =
    tx && tx.type === "transfer" && tx.transfer_group_id
      ? { id: tx.id, groupId: tx.transfer_group_id }
      : null;
  return useQuery({
    queryKey: ["transfer-counterpart", tenantId, leg?.id],
    enabled: !!tenantId && !!leg,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("finance_transactions")
        .select("account_id")
        .eq("tenant_id", tenantId as string)
        .eq("transfer_group_id", (leg as { groupId: string }).groupId)
        .neq("id", (leg as { id: string }).id)
        .limit(1);
      if (error) throw new Error(error.message);
      return data?.[0]?.account_id ?? null;
    },
  });
}

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
  alreadyRefunded = 0,
  onClose,
  onInvoice,
  onClientOpen,
  onDelete,
  onRefund,
}: {
  visible: boolean;
  transaction: FinanceTransaction | null;
  accounts: Account[];
  teams: Team[];
  categories: FinanceCategory[];
  /** Σ already-refunded for this income — caps the new refund. */
  alreadyRefunded?: number;
  onClose: () => void;
  onInvoice: (tx: FinanceTransaction) => void;
  onClientOpen: (clientId: string) => void;
  onDelete: (tx: FinanceTransaction) => Promise<void>;
  onRefund: (tx: FinanceTransaction, amount: number) => Promise<void>;
}) {
  const t = useThemeColors();
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [busy, setBusy] = useState(false);
  // Синхронный гард поверх busy: state включается только после ре-рендера,
  // и сверхбыстрый двойной тап «Возврат» успевал записать возврат дважды —
  // тот же класс бага, что savingRef в OperationSheet.
  const savingRef = useRef(false);
  const currency = useTenant().data?.currency;
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

  if (!transaction) return null;
  const tx = transaction;

  const account = accounts.find((a) => a.id === tx.account_id);
  const team = teams.find((x) => x.id === tx.team_id);
  const category = categories.find((c) => c.id === tx.category_id);

  // Полные имена ног перевода («Наличка · Команда 2»): команды у сторон
  // разные, и без владельца строки «Откуда/Куда» не отвечают на главный
  // вопрос перевода. Корреспондент, выпавший из справочника (закрытый счёт
  // не приехал в пропсы), честно оставляет попап на старой строке «Счёт».
  const ownerName = (a: Account): string | undefined =>
    (a.brigade_id && teams.find((x) => x.id === a.brigade_id)?.name) ||
    undefined;
  const counterpartAccount = counterpartAccountId
    ? accounts.find((a) => a.id === counterpartAccountId)
    : undefined;
  const transferLegs =
    tx.type === "transfer" && account && counterpartAccount
      ? {
          // Своя нога подписана знаком: минус — деньги ушли отсюда.
          from: tx.amount < 0 ? account : counterpartAccount,
          to: tx.amount < 0 ? counterpartAccount : account,
        }
      : null;

  const tone =
    tx.type === "income"
      ? t.success
      : tx.type === "expense" || tx.type === "refund"
        ? t.danger
        : t.ink;
  const sign =
    tx.type === "income" || (tx.type === "transfer" && tx.amount > 0)
      ? ""
      : "−";

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
    tx.type === "income" && !isAppointmentLedger && refundRemainingCents > 0;
  // Перевод УДАЛЯЕТСЯ, но не правится и не возвращается: сервер запрещает
  // редактировать ноги, а onDelete сверху отменяет перевод целиком — обе
  // ноги атомарно по transfer_group_id. Это единственная дверь к отмене
  // перевода с главного экрана.
  const canDelete = !isAppointmentLedger && !tx.invoice_id;
  const canInvoice = tx.type === "income";

  const refundCents = parseMoneyInputToCents(refundAmount);
  const refundNum = (refundCents ?? 0) / 100;
  const refundValid =
    refundCents != null && refundCents <= refundRemainingCents;

  const handleDelete = () => {
    // У перевода — свой текст (общий на продукт, account-alerts): человек
    // должен понимать, что отменяет ПЕРЕВОД ЦЕЛИКОМ — исчезнут обе операции,
    // а не одна строка ленты.
    const text =
      tx.type === "transfer"
        ? deleteTransferAlert()
        : {
            title: "Удалить операцию?",
            message: "Действие нельзя отменить.",
            confirm: "Удалить",
          };
    confirmThen(
      text.title,
      {
        message: text.message,
        confirmLabel: text.confirm,
        destructive: true,
      },
      async () => {
        if (savingRef.current || busy) return;
        savingRef.current = true;
        setBusy(true);
        try {
          await onDelete(tx);
          haptics.success();
          onClose();
        } catch (e) {
          notify("Ошибка", (e as Error).message);
        } finally {
          savingRef.current = false;
          setBusy(false);
        }
      },
    );
  };

  const handleRefund = async () => {
    if (savingRef.current || !refundValid || busy) return;
    savingRef.current = true;
    setBusy(true);
    try {
      await onRefund(tx, refundNum);
      haptics.success();
      onClose();
    } catch (e) {
      notify("Ошибка", (e as Error).message);
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  // ФАКТЫ ОПЕРАЦИИ ОДНИМ СПИСКОМ. Собираются массивом, а не россыпью JSX,
  // ровно ради одного: шов рисуется между строками, и первая обязана знать,
  // что она первая, — какие именно строки существуют, зависит от операции.
  const metaRows: { label: string; value: string }[] = [
    { label: "Дата", value: humanDay(tx.occurred_on) },
  ];
  if (category) metaRows.push({ label: "Категория", value: category.name });
  // Перевод отвечает «откуда и куда ушли деньги» обеими ногами; пока вторая
  // не найдена — обычная строка «Счёт».
  if (transferLegs) {
    metaRows.push({
      label: "Откуда",
      value: accountDisplayName(transferLegs.from, ownerName(transferLegs.from)),
    });
    metaRows.push({
      label: "Куда",
      value: accountDisplayName(transferLegs.to, ownerName(transferLegs.to)),
    });
  } else if (account) {
    metaRows.push({ label: "Счёт", value: account.name });
  }
  if (team) metaRows.push({ label: "Команда", value: team.name });
  if (tx.payment_method) {
    metaRows.push({
      label: "Способ оплаты",
      value: PAYMENT_METHOD_LABEL[tx.payment_method] ?? tx.payment_method,
    });
  }
  // Снимок налога, если он есть: до этой строки ставку операции было негде
  // увидеть, кроме формы правки (а у auto-строк — нигде). Нулевой снимок — не
  // налог, а его отсутствие.
  if (tx.vat_amount != null && tx.vat_amount !== 0) {
    metaRows.push({
      label: "НДС",
      value: `в т.ч. ${formatEUR(Math.abs(tx.vat_amount))}${
        tx.vat_rate != null ? ` (${tx.vat_rate}%)` : ""
      }`,
    });
  }
  if (tx.source === "auto") {
    metaRows.push({ label: "Источник", value: "Автоматически (из записи)" });
  }
  if (isAppointmentLedger) {
    metaRows.push({ label: "Изменение", value: "Через связанную заявку" });
  }
  if (Number.isFinite(alreadyRefunded) && alreadyRefunded > 0) {
    metaRows.push({
      label: "Уже возвращено",
      value:
        refundRemainingCents === 0
          ? `${formatEUR(alreadyRefunded)} · полностью`
          : formatEUR(alreadyRefunded),
    });
  }

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
        setShowRefundForm(true);
        setRefundAmount(String(refundRemaining));
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
      title={TX_TYPE_LABEL[tx.type]}
      avoidKeyboard
      scroll
    >
      <View style={{ paddingBottom: 24 }}>
        {/* СУММА — ГЕРОЙ ЛИСТА: ради неё его и открыли. Знак и цвет говорят
            направление денег раньше, чем прочитан ярлык. */}
        <View className="items-center px-5 pb-1">
          <Text
            className="text-[32px] font-bold"
            style={{ color: tone, fontVariant: ["tabular-nums"] }}
          >
            {sign}
            {formatEUR(Math.abs(tx.amount))}
          </Text>
          {tx.notes ? (
            <Text
              className="mt-1 text-center text-[13px]"
              style={{ color: t.sub }}
            >
              {tx.notes}
            </Text>
          ) : null}
        </View>

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
          <>
            <View style={{ paddingHorizontal: GUTTER, paddingTop: 16 }}>
              <MoneyField
                label={`Сумма возврата (до ${formatEUR(refundRemaining)})`}
                value={refundAmount}
                onChangeText={setRefundAmount}
                currency={currency}
                autoFocus
                error={
                  refundAmount && !refundValid
                    ? `Не больше ${formatEUR(refundRemaining)} и больше нуля`
                    : null
                }
              />
            </View>
            <RowGroup>
              <ActionRow
                label="Вернуть"
                tone="danger"
                dimmed={!refundValid || busy}
                onPress={handleRefund}
              />
              <ActionRow
                label="Отмена"
                separated
                dimmed={busy}
                onPress={() => setShowRefundForm(false)}
              />
            </RowGroup>
          </>
        )}
      </View>
    </BottomSheet>
  );
}
