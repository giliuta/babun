import { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { X } from "lucide-react-native";
import {
  formatEURExact as formatEUR,
  parseMoneyInputToCents,
} from "@babun/shared/common/utils/money";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type { Account } from "@babun/shared/local/finance/account";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { humanDay } from "@/features/appointments/helpers";
import type { Team } from "@/features/reference/queries";

const METHOD_LABEL: Record<string, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
  other: "Иное",
};

const TYPE_LABEL: Record<string, string> = {
  income: "Поступление",
  expense: "Расход",
  refund: "Возврат",
  transfer: "Перевод",
};

function MetaRow({ label, value }: { label: string; value: string }) {
  const t = useThemeColors();
  return (
    <View
      className="flex-row items-center justify-between px-3 py-2"
      style={{ borderTopWidth: 1, borderTopColor: t.separator }}
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

// Tx-detail popup — port of the web TransactionPopup: centered card with
// the headline amount, meta rows and actions.
// (opens the OperationSheet); «Создать возврат» writes a negative refund
// row tied via refund_of_id and capped by «до остатка» (web semantics).
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

  // The modal stays mounted — reset transient state per opened tx.
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
  // Деньги сравниваются ТОЛЬКО в центах: float-вычитание (10 − 1.12 =
  // 8.879999…) ломало префилл и запрещало вернуть ровно остаток.
  const refundRemainingCents = Math.max(
    0,
    Math.round(tx.amount * 100) - Math.round(alreadyRefunded * 100),
  );
  const refundRemaining = refundRemainingCents / 100;
  const canRefund =
    tx.type === "income" && !isAppointmentLedger && refundRemainingCents > 0;
  const canDelete =
    !isAppointmentLedger && !tx.invoice_id && tx.type !== "transfer";
  const canInvoice = tx.type === "income";

  const refundCents = parseMoneyInputToCents(refundAmount);
  const refundNum = (refundCents ?? 0) / 100;
  const refundValid =
    refundCents != null && refundCents <= refundRemainingCents;

  const handleDelete = () => {
    Alert.alert("Удалить операцию?", "Действие нельзя отменить.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          if (busy) return;
          setBusy(true);
          try {
            await onDelete(tx);
            onClose();
          } catch (e) {
            Alert.alert("Ошибка", (e as Error).message);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const handleRefund = async () => {
    if (!refundValid || busy) return;
    setBusy(true);
    try {
      await onRefund(tx, refundNum);
      onClose();
    } catch (e) {
      Alert.alert("Ошибка", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const actionBtn = (
    label: string,
    onPress: () => void,
    kind: "primary" | "danger" | "plain",
    disabled?: boolean,
  ) => (
    <Pressable
      key={label}
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-1 items-center justify-center rounded-full active:opacity-80"
      style={{
        height: 44,
        backgroundColor:
          kind === "primary" ? t.accent : "transparent",
        borderWidth: kind === "primary" ? 0 : 1,
        borderColor:
          kind === "danger" ? t.danger + "66" : t.separator,
        opacity: disabled || busy ? 0.5 : 1,
      }}
    >
      <Text
        className="text-[13px] font-semibold"
        style={{
          color:
            kind === "primary"
              ? t.onAccent
              : kind === "danger"
                ? t.danger
                : t.ink,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 items-center justify-center px-6"
        style={{ backgroundColor: t.scrim }}
      >
        <Pressable
          className="absolute inset-0"
          onPress={onClose}
          accessible={false}
        />
        <View
          className="w-full overflow-hidden rounded-3xl"
          style={{ backgroundColor: t.surface, maxWidth: 360 }}
        >
          {/* header */}
          <View
            className="flex-row items-center justify-center py-3"
            style={{ borderBottomWidth: 1, borderBottomColor: t.separator }}
          >
            <Text className="text-base font-semibold" style={{ color: t.ink }}>
              {TYPE_LABEL[tx.type]}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Закрыть"
              className="absolute right-3 h-8 w-8 items-center justify-center rounded-full"
              style={{ backgroundColor: t.pressed }}
            >
              <X color={t.sub} size={ICON.sm} />
            </Pressable>
          </View>

          <View className="px-4 py-3" style={{ gap: 12 }}>
            {/* headline amount */}
            <View className="items-center py-1">
              <Text
                className="text-[32px] font-bold tabular-nums"
                style={{ color: tone }}
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

            {/* meta rows */}
            <View
              className="overflow-hidden rounded-xl"
              style={{ backgroundColor: t.canvas }}
            >
              <View className="flex-row items-center justify-between px-3 py-2">
                <Text className="text-[13px]" style={{ color: t.sub }}>
                  Дата
                </Text>
                <Text className="text-[13px] font-medium" style={{ color: t.ink }}>
                  {humanDay(tx.occurred_on)}
                </Text>
              </View>
              {category ? <MetaRow label="Категория" value={category.name} /> : null}
              {account ? <MetaRow label="Счёт" value={account.name} /> : null}
              {team ? <MetaRow label="Команда" value={team.name} /> : null}
              {tx.payment_method ? (
                <MetaRow
                  label="Способ оплаты"
                  value={METHOD_LABEL[tx.payment_method] ?? tx.payment_method}
                />
              ) : null}
              {tx.source === "auto" ? (
                <MetaRow label="Источник" value="Автоматически (из записи)" />
              ) : null}
              {isAppointmentLedger ? (
                <MetaRow label="Изменение" value="Через связанную заявку" />
              ) : null}
              {Number.isFinite(alreadyRefunded) && alreadyRefunded > 0 ? (
                <MetaRow
                  label="Уже возвращено"
                  value={
                    refundRemainingCents === 0
                      ? `${formatEUR(alreadyRefunded)} · полностью`
                      : formatEUR(alreadyRefunded)
                  }
                />
              ) : null}
            </View>

            {/* actions */}
            {!showRefundForm ? (
              <View style={{ gap: 8 }}>
                {canInvoice
                  ? actionBtn(
                      tx.invoice_id ? "Открыть инвойс" : "Выставить инвойс",
                      () => onInvoice(tx),
                      "plain",
                    )
                  : null}
                {tx.client_id
                  ? actionBtn(
                      "Открыть клиента",
                      () => onClientOpen(tx.client_id as string),
                      "plain",
                    )
                  : null}
                {canDelete || canRefund ? (
                  <View className="flex-row" style={{ gap: 8 }}>
                    {canDelete ? actionBtn("Удалить", handleDelete, "danger") : null}
                    {canRefund
                      ? actionBtn(
                          "Создать возврат",
                          () => {
                            setShowRefundForm(true);
                            setRefundAmount(String(refundRemaining));
                          },
                          "plain",
                        )
                      : null}
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                <Text className="text-xs font-medium" style={{ color: t.sub }}>
                  Сумма возврата (до {formatEUR(refundRemaining)})
                </Text>
                <View
                  className="flex-row items-center rounded-xl px-3"
                  style={{ backgroundColor: t.canvas, height: 44 }}
                >
                  <Text className="text-[15px]" style={{ color: t.sub }}>
                    €
                  </Text>
                  <TextInput
                    value={refundAmount}
                    onChangeText={setRefundAmount}
                    keyboardType="decimal-pad"
                    autoFocus
                    placeholder="0"
                    placeholderTextColor={t.placeholder}
                    selectionColor={t.accent}
                    keyboardAppearance="light"
                    accessibilityLabel="Сумма возврата"
                    className="ml-1 flex-1 text-[15px] tabular-nums"
                    style={{ color: t.ink }}
                  />
                </View>
                {refundAmount && !refundValid ? (
                  <Text className="text-xs" style={{ color: t.danger }}>
                    Не больше {formatEUR(refundRemaining)} и больше нуля
                  </Text>
                ) : null}
                <View className="flex-row" style={{ gap: 8 }}>
                  {actionBtn("Отмена", () => setShowRefundForm(false), "plain")}
                  <Pressable
                    onPress={handleRefund}
                    disabled={!refundValid || busy}
                    accessibilityRole="button"
                    accessibilityLabel="Подтвердить возврат"
                    className="flex-1 items-center justify-center rounded-full active:opacity-80"
                    style={{
                      height: 44,
                      backgroundColor: t.danger,
                      opacity: !refundValid || busy ? 0.5 : 1,
                    }}
                  >
                    <Text
                      className="text-[13px] font-semibold"
                      style={{ color: "#ffffff" }}
                    >
                      Возврат
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
