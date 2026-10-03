import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { PaymentMethod } from "@babun/shared/local/finance/transaction";
import { accountServesTeam } from "@babun/shared/local/finance/integrity";
import { formatMoneyForInput } from "@babun/shared/common/utils/money";
import { randomUuid } from "@babun/shared/sync";
import { tDynamic } from "@babun/shared/i18n/runtime";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { DateSpinner } from "@/components/ui/DateSpinner";
import { GradientButton } from "@/components/ui/GradientButton";
import { SectionCard } from "@/components/ui/SectionCard";
import { ValueRow } from "@/components/ui/ValueRow";
import { formatYMD, humanDay, parseYMD } from "@/features/appointments/helpers";
import { paymentMethodForAccountKind } from "@/features/appointments/payment";
import { PaymentTile, TILE_GAP, useTileWidth } from "@/features/appointments/PaymentTiles";
import { AmountBlock } from "@/features/finances/AmountBlock";
import type { AccountWithBalance } from "@/features/finances/accounts";
import { accountIcon } from "@/features/finances/account-ui";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { formatInvoiceMoney, parseMoneyAmount } from "./format";

// ПРИНЯТЬ ОПЛАТУ ПО ИНВОЙСУ — НАШИМИ БЛОКАМИ (владелец 2026-10-04: «сам вид
// принятия оплаты отвратительный, переделать»; «когда я нажимаю кнопку
// оплатить — чтоб всё чётко было»). Тот же язык, что у операции и «Оплаты»
// записи: блок «Сумма» (AmountBlock, остаток подписью), дата строкой с
// барабаном раскрывашкой (из листа второй лист не открывают), «Счёт» —
// плитками счетов. Способ оплаты не спрашивается: он следует из вида счёта
// (наличные — касса, карта — карточный, перевод — банк), как у чека. Кнопка
// одна, внизу; закрывают лист свайпом или скримом.
//
// Чек здесь НЕ выписывается: принять оплату и выписать чек — два разных шага
// (владелец 04.10: «могу принять оплату, а чек сгенерировать позже»).

export function InvoicePaymentSheet({
  visible,
  total,
  paid,
  remaining,
  currency,
  businessToday,
  brigadeId,
  accounts,
  preferredAccountId,
  submitting,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  total: number;
  paid: number;
  remaining: number;
  currency: string;
  businessToday: string;
  brigadeId: string | null;
  accounts: AccountWithBalance[];
  /** Счёт, выбранный при выставлении («куда ждём деньги»): лист открывается
   *  на нём, если он жив и служит команде. */
  preferredAccountId?: string | null;
  submitting: boolean;
  onSubmit: (value: {
    request_id: string;
    amount: number;
    account_id: string;
    payment_method: PaymentMethod;
    occurred_on: string;
    business_today: string;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const tileWidth = useTileWidth();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(businessToday);
  const [dateOpen, setDateOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const initializedForOpen = useRef(false);

  // Счета, которые принимают деньги этой команды, — в порядке «Счетов».
  const usable = useMemo(
    () =>
      accounts
        .filter((a) => a.is_active && (brigadeId == null || accountServesTeam(a, brigadeId)))
        .sort((a, b) => a.position - b.position),
    [accounts, brigadeId],
  );

  useEffect(() => {
    if (!visible) {
      initializedForOpen.current = false;
      return;
    }
    if (initializedForOpen.current) return;
    initializedForOpen.current = true;
    const preferred = usable.find((a) => a.id === preferredAccountId);
    setAccountId(preferred?.id ?? usable[0]?.id ?? null);
    // Префилл — той же грамматикой, что набирает человек: «116,70».
    setAmount(formatMoneyForInput(remaining));
    setOccurredOn(businessToday);
    setDateOpen(false);
    setRequestId(randomUuid());
    setError(null);
  }, [visible, usable, preferredAccountId, remaining, businessToday]);

  const parsedAmount = parseMoneyAmount(amount);
  const paymentAmount = parsedAmount ?? 0;
  const validAmount = paymentAmount > 0 && paymentAmount <= remaining;
  const account = usable.find((a) => a.id === accountId) ?? null;

  // Пока платёж уходит, лист не закрывается: человек должен увидеть исход.
  const close = () => {
    if (!submitting) onClose();
  };

  const submit = async () => {
    if (!account || !requestId || !validAmount) return;
    setError(null);
    try {
      await onSubmit({
        request_id: requestId,
        amount: paymentAmount,
        account_id: account.id,
        payment_method: paymentMethodForAccountKind(account.kind) as PaymentMethod,
        occurred_on: occurredOn,
        business_today: businessToday,
      });
      haptics.success();
      onClose();
    } catch (submissionError) {
      // Отказ — текстом функции базы: переводим при показе.
      setError(tDynamic((submissionError as Error).message));
    }
  };

  const hint =
    amount && parsedAmount == null
      ? { text: "Не больше двух знаков после запятой", error: true }
      : amount && !validAmount
        ? { text: `Не больше остатка — ${formatInvoiceMoney(remaining, currency)}`, error: true }
        : {
            text:
              paid > 0
                ? `Оплачено ${formatInvoiceMoney(paid, currency)} из ${formatInvoiceMoney(total, currency)} · остаток ${formatInvoiceMoney(remaining, currency)}`
                : `К оплате ${formatInvoiceMoney(remaining, currency)}`,
          };

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={close}
      title="Принять оплату"
      scroll
      avoidKeyboard
      footer={
        <View style={{ paddingHorizontal: 16, gap: 8 }}>
          {error ? (
            <Text accessibilityRole="alert" className="text-center text-sm" style={{ color: t.danger }}>
              {error}
            </Text>
          ) : null}
          <GradientButton
            label={validAmount ? `Принять ${formatInvoiceMoney(paymentAmount, currency)}` : "Принять оплату"}
            onPress={() => void submit()}
            disabled={!account || !validAmount || submitting}
            loading={submitting}
          />
        </View>
      }
    >
      <View style={{ gap: 6, paddingBottom: 12 }}>
        <AmountBlock
          value={amount}
          onChange={setAmount}
          accessibilityLabel="Сумма платежа"
          hint={hint}
          selectOnFocus
        />

        <SectionCard title="Дата" dense>
          <ValueRow
            label="Дата платежа"
            value={humanDay(occurredOn)}
            expanded={dateOpen}
            onPress={() => setDateOpen((open) => !open)}
          />
          {dateOpen ? (
            <View style={{ alignItems: "center", paddingBottom: 8 }}>
              <DateSpinner
                value={parseYMD(occurredOn)}
                maximumDate={parseYMD(businessToday)}
                onChange={(next) => setOccurredOn(formatYMD(next))}
              />
            </View>
          ) : null}
        </SectionCard>

        {/* СЧЁТ — ПЛИТКАМИ, КАК В «ОПЛАТЕ» ЗАПИСИ И В ОПЕРАЦИИ. */}
        <SectionCard title="Счёт">
          {usable.length === 0 ? (
            <Text style={{ paddingHorizontal: 16, paddingVertical: 12, fontSize: 13, color: t.sub }}>
              У команды нет счёта — заведите его в «Счетах», иначе деньги некуда записать.
            </Text>
          ) : (
            <View
              className="flex-row flex-wrap"
              style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, gap: TILE_GAP }}
            >
              {usable.map((a) => (
                <PaymentTile
                  key={a.id}
                  icon={accountIcon(a)}
                  label={a.name}
                  color={a.color ?? t.ink}
                  tint={a.color}
                  width={tileWidth}
                  compact
                  state="idle"
                  selected={a.id === accountId}
                  onPress={() => setAccountId(a.id)}
                  accessibilityLabel={`Счёт: ${a.name}`}
                />
              ))}
            </View>
          )}
        </SectionCard>
      </View>
    </BottomSheet>
  );
}
