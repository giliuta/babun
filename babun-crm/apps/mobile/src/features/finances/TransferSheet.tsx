import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { parseMoneyInputToCents } from "@babun/shared/common/utils/money";
import { randomUuid } from "@babun/shared/sync";
import { accountDisplayName } from "@babun/shared/local/finance/account";
import { transferValidationError } from "@babun/shared/local/finance/integrity";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import { GradientButton } from "@/components/ui/GradientButton";
import { useThemeColors } from "@/theme/colors";
import type { Team } from "@/features/reference/queries";
import { useCreateTransfer, type AccountWithBalance } from "./accounts";

// «Наличка · Юра» / «Revolut · Общий» — подпись различает одноимённые счета.
function transferLabel(
  account: AccountWithBalance,
  teamById: Map<string, Team>,
): string {
  if (account.scope === "company") return `${account.name} · Общий`;
  return accountDisplayName(
    account,
    account.brigade_id ? teamById.get(account.brigade_id)?.name : undefined,
  );
}

// Пара допустима, если это не два командных счёта разных бригад —
// межкомандные деньги идут через общий счёт компании (атрибуция потоков).
function pairAllowed(a: AccountWithBalance, b: AccountWithBalance): boolean {
  return !(
    a.scope === "team" &&
    b.scope === "team" &&
    a.brigade_id !== b.brigade_id
  );
}

export function TransferSheet({
  visible,
  onClose,
  accounts,
  teamById,
  presetFromId,
  presetAmount,
}: {
  visible: boolean;
  onClose: () => void;
  /** Активные счета с балансами (owner-only данные). */
  accounts: AccountWithBalance[];
  teamById: Map<string, Team>;
  /** Предзаполненный источник («Перевести остаток», деталь счёта). */
  presetFromId?: string | null;
  /** Предзаполненная сумма («Перевести остаток»). */
  presetAmount?: number | null;
}) {
  const t = useThemeColors();
  const transfer = useCreateTransfer();

  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [requestId, setRequestId] = useState(randomUuid);

  useEffect(() => {
    if (!visible) return;
    setFromId(presetFromId ?? null);
    setToId(null);
    setAmount(
      presetAmount != null && presetAmount > 0
        ? String(Math.round(presetAmount * 100) / 100)
        : "",
    );
    setRequestId(randomUuid());
  }, [visible, presetFromId, presetAmount]);

  const amountCents = parseMoneyInputToCents(amount);
  const amountNum = (amountCents ?? 0) / 100;
  const fromAccount = accounts.find((a) => a.id === fromId);
  const toAccount = accounts.find((a) => a.id === toId);
  const error =
    amountCents == null
      ? "Введите сумму больше нуля и не больше двух знаков после запятой"
      : transferValidationError(fromAccount, toAccount, amountNum);
  const canTransfer = error === null && !transfer.isPending;

  const doTransfer = async () => {
    if (!fromId || !toId || error) {
      Alert.alert("Перевод не выполнен", error ?? "Проверьте счета и сумму");
      return;
    }
    try {
      await transfer.mutateAsync({
        request_id: requestId,
        from_account_id: fromId,
        to_account_id: toId,
        amount: amountNum,
        brigade_id: fromAccount?.brigade_id ?? null,
      });
      onClose();
    } catch (e) {
      // Sheet stays open — nothing entered is lost.
      Alert.alert("Ошибка", (e as Error).message);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} avoidKeyboard>
      <View className="px-5 pb-2">
        <Text className="mb-3 text-lg font-bold" style={{ color: t.ink }}>
          Перевод между счетами
        </Text>
        <Text className="mb-2 text-xs font-medium" style={{ color: t.sub }}>
          Откуда
        </Text>
        <View className="mb-3 flex-row flex-wrap gap-2">
          {accounts.map((a) => (
            <Chip
              key={a.id}
              label={transferLabel(a, teamById)}
              color={t.danger}
              selected={fromId === a.id}
              onPress={() => {
                const nextFrom = a.id === fromId ? null : a.id;
                setFromId(nextFrom);
                const selectedTo = accounts.find((item) => item.id === toId);
                if (nextFrom && selectedTo && !pairAllowed(a, selectedTo)) {
                  setToId(null);
                }
              }}
            />
          ))}
        </View>
        <Text className="mb-2 text-xs font-medium" style={{ color: t.sub }}>
          Куда
        </Text>
        <View className="mb-3 flex-row flex-wrap gap-2">
          {accounts
            .filter(
              (a) =>
                a.id !== fromId && (!fromAccount || pairAllowed(fromAccount, a)),
            )
            .map((a) => (
              <Chip
                key={a.id}
                label={transferLabel(a, teamById)}
                color={t.success}
                selected={toId === a.id}
                onPress={() => setToId(a.id === toId ? null : a.id)}
              />
            ))}
        </View>
        <Field
          label="Сумма €"
          value={amount}
          onChangeText={setAmount}
          placeholder="0"
          keyboardType="decimal-pad"
        />
        {amount.length > 0 && error ? (
          <Text className="mb-3 text-sm" style={{ color: t.danger }}>
            {error}
          </Text>
        ) : null}
        <GradientButton
          label="Перевести"
          onPress={doTransfer}
          disabled={!canTransfer}
          loading={transfer.isPending}
        />
      </View>
    </BottomSheet>
  );
}
