import { Text, View } from "react-native";
import { FileText, History, Receipt as ReceiptIcon, Split } from "lucide-react-native";
import type {
  Appointment,
  AppointmentStatus,
} from "@babun/shared/local/appointments";
import { formatEURExact, moneySymbol } from "@babun/shared/common/utils/money";
import { SectionCard } from "@/components/ui/SectionCard";
import { useThemeColors } from "@/theme/colors";
import { accountIcon } from "@/features/finances/account-ui";
import { PaymentHistorySheet } from "@/features/finances/PaymentHistorySheet";
import { AccountEditorSheet } from "@/features/finances/account-editor/AccountEditorSheet";
import { paidTileIntent, type PaymentKind } from "./payment-draft";
import {
  ModeIconButton,
  NoAccountsNotice,
  PaymentStateRow,
  PaymentTile,
  TILE_GAP,
} from "./PaymentTiles";
import { paymentActions } from "./payment-block/payment-actions";
import { usePaymentBlock } from "./payment-block/use-payment-block";

// БЛОК «ОПЛАТА» (STORY-065). Тап по счёту — деньги получены и записаны СРАЗУ
// (владелец 2026-09-06: без черновика); визит закрывается, если начался.
// ОДНА кнопка суммы (стрелки врозь — «распределение», владелец) и для предоплаты, и для части: «это одна и та же
// функция — какая разница, столько-то или столько-то» (владелец). Плитка
// принимает деньги В ЛЮБОЙ МОМЕНТ (владелец 2026-09-24: «когда угодно могу
// нажать наличку — и оно будет оплачено, не обязательно, чтоб заканчивалось
// время»): до начала визита тап записывает всю сумму предоплатой, и запись
// оплачена заранее; после начала — оплатой. Раньше до начала плитки были
// погашены и отвечали «визит ещё не начался», и оплата у клиента «не
// записывалась». Введённая сумма — часть, остаток остаётся долгом или уходит
// на вторую плитку. Зелёная плитка при ОТКРЫТОМ поле прибавляет на тот же счёт
// (владелец: «оно должно плюсануть, а не снимать»): плитка одна на счёт, с
// суммой всех его платежей. Ошибочный платёж снимает тап по зелёной плитке без
// поля или «Снять» в тосте — сервер пишет сторно «деньги не поступили», не
// возврат. Деньги ждут кнопки только у новой записи: уходят с «Создать запись».

// Parts live in `payment-block/`: state and rights in `use-payment-block.ts`,
// tap handlers in `payment-actions.ts`.

export interface PendingPayment {
  accountId: string;
  /** Евро с копейками. */
  amount: number;
  kind: PaymentKind;
  /** Тап без поля суммы — «вся сумма»: при создании берётся итог формы на
   *  тот момент (`pendingPaymentToSend`), а не число с момента тапа. */
  full: boolean;
}

export interface PaymentBlockProps {
  /** Сохранённая запись (правка) или null (создание): деньги — только по ней. */
  appointment: Appointment | null;
  teamId: string | null;
  /** Итог формы — сумма к оплате у ещё не созданной записи. */
  totalDraft: number;
  /** Дата, начало и статус из формы — правило «визит начался». */
  visit: { date: string; timeStart: string; status: AppointmentStatus };
  pending: PendingPayment | null;
  onPendingChange: (next: PendingPayment | null) => void;
  /** Свежая запись после оплаты/снятия — страница подтягивает статус. */
  onAppointmentChanged: (fresh: Appointment) => void;
  /** Клиент в форме. Расходится с сохранённым — деньги не принимаем, пока
   *  запись не сохранена: платёж лёг бы на прежнего клиента. */
  clientId?: string | null;
}

export function PaymentBlock(props: PaymentBlockProps) {
  const { appointment, teamId, pending } = props;
  const t = useThemeColors();
  const state = usePaymentBlock(props);
  const {
    currency,
    tileWidth,
    accounts,
    accountsLoaded,
    accountsFailures,
    partText,
    setPartText,
    createOpen,
    setCreateOpen,
    canCreateAccount,
    receiptNext,
    bookingInPlan,
    tariffNudge,
    invoice,
    started,
    outstanding,
    rowsByAccount,
    unattributed,
    busy,
    amountMode,
    kindForTap,
    amountCents,
    problem,
    acceptsMoney,
    caption,
    historyOpen,
    setHistoryOpen,
    showAmountField,
    canSplit,
    canInvoice,
    canReceipt,
    receiptTariffLocked,
    invoiceTariffLocked,
    hasHistory,
    anyAction,
    showStateRow,
  } = state;
  const { handleTileTap, handlePaidTileTap, handleAmountToggle, handleReceipt, handleInvoice } =
    paymentActions(state, props);

  const captionColor =
    caption?.tone === "success"
      ? t.success
      : caption?.tone === "warning"
        ? t.warning
        : undefined;

  return (
    <SectionCard title="Оплата">
      {showStateRow ? (
      <PaymentStateRow
        caption={caption?.text}
        captionColor={captionColor}
        captionTone={caption && caption.tone !== "neutral" ? "money" : "neutral"}
        amount={
          showAmountField
            ? {
                symbol: moneySymbol(currency),
                value: partText ?? "",
                onChangeText: setPartText,
                hint:
                  problem === "exceeds"
                    ? "Больше остатка"
                    : problem === "empty"
                      ? `Остаток ${formatEURExact(outstanding / 100)}`
                      : `Останется ${formatEURExact((outstanding - amountCents) / 100)}`,
                hintTone: problem === "exceeds" ? "danger" : "neutral",
              }
            : undefined
        }
        right={
          anyAction ? (
            <>
              {canSplit ? (
                <ModeIconButton
                  icon={Split}
                  label={started ? "Часть суммы" : "Предоплата"}
                  active={amountMode}
                  dimmed={!bookingInPlan}
                  onPress={handleAmountToggle}
                />
              ) : null}
              {canInvoice ? (
                <ModeIconButton
                  icon={FileText}
                  label="Инвойс"
                  active={Boolean(invoice)}
                  dimmed={invoiceTariffLocked}
                  onPress={invoiceTariffLocked ? tariffNudge : handleInvoice}
                />
              ) : null}
              {canReceipt ? (
                <ModeIconButton
                  icon={ReceiptIcon}
                  label="Чек"
                  active={!receiptNext}
                  dimmed={receiptTariffLocked}
                  onPress={receiptTariffLocked ? tariffNudge : handleReceipt}
                />
              ) : null}
              {hasHistory ? (
                <ModeIconButton icon={History} label="История платежей" onPress={() => setHistoryOpen(true)} />
              ) : null}
            </>
          ) : null
        }
      />
      ) : null}
      {/* СТРОКИ ИНВОЙСА ЗДЕСЬ БОЛЬШЕ НЕТ (владелец 20.09: «ты сгенерировал
          инвойс — но он должен быть в файлах, в оплате нет его»). Выписанный
          документ живёт плашкой в блоке «Файлы», а в оплате остаётся только
          значок, которым его выписывают и открывают. */}
      {unattributed.map((row) => (
        <Text key={row.id} style={{ marginHorizontal: 16, marginTop: 4, fontSize: 13, color: t.sub }}>
          {row.kind === "prepayment" ? "Предоплата" : "Оплачено"} {formatEURExact(row.amount)} · счёт определён автоматически
        </Text>
      ))}
      {/* НЕ ЗАГРУЗИЛИСЬ — НЕ ЗНАЧИТ «НЕТ СЧЕТОВ». Ошибка сети раньше
          рисовалась как «У команды нет счёта — создать счёт»: плиток не было,
          оплата «не записывалась», а блок звал завести второй такой же счёт.
          Теперь блок говорит, что случилось, и сам повторяет запрос. */}
      {!teamId || (accounts.length === 0 && !accountsLoaded && accountsFailures === 0) ? null : accounts.length === 0 && !accountsLoaded ? (
        <Text style={{ marginHorizontal: 16, marginTop: 4, marginBottom: 12, fontSize: 13, color: t.sub }}>
          Счета не загрузились — пробуем ещё раз
        </Text>
      ) : accounts.length === 0 ? (
        <NoAccountsNotice canCreate={canCreateAccount} onCreate={() => setCreateOpen(true)} />
      ) : (
        <View
          className="flex-row flex-wrap"
          style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, gap: TILE_GAP }}
        >
          {accounts.map((account) => {
            const accountRowsForTile = rowsByAccount.get(account.id) ?? [];
            const paid = accountRowsForTile.reduce((sum, row) => sum + row.amount, 0);
            const isPaid = paid > 0;
            const isPending = pending?.accountId === account.id;
            // Пока сервер подтверждает платёж, плитки не гаснут: деньги уже
            // стоят на своей плитке, и серый всплеск всего ряда читался как
            // «думает». Повторный тап всё равно не пройдёт — `disabled`.
            const state = isPaid ? "paid" : isPending ? "pending" : !acceptsMoney ? "dim" : "idle";
            return (
              <PaymentTile
                key={account.id}
                icon={accountIcon(account)}
                label={account.name}
                color={account.color ?? t.ink}
                tint={account.color}
                width={tileWidth} compact
                state={state}
                amount={isPaid ? formatEURExact(paid) : undefined}
                disabled={busy}
                onPress={() =>
                  isPaid && paidTileIntent(amountMode) === "cancel"
                    ? void handlePaidTileTap(account, accountRowsForTile)
                    : handleTileTap(account)
                }
                accessibilityLabel={
                  isPaid
                    ? `${account.name}, получено ${formatEURExact(paid)}, ${amountMode ? `добавить ${formatEURExact(amountCents / 100)}` : "снять"}`
                    : `${account.name}, ${kindForTap === "prepayment" ? "предоплата" : "оплачено"} ${formatEURExact(amountCents / 100)}`
                }
              />
            );
          })}
        </View>
      )}
      <AccountEditorSheet
        visible={createOpen}
        accountId={null}
        onClose={() => setCreateOpen(false)}
        presetTeamId={teamId}
      />
      <PaymentHistorySheet
        visible={historyOpen}
        appointmentId={appointment?.id ?? null}
        onClose={() => setHistoryOpen(false)}
      />
    </SectionCard>
  );
}
