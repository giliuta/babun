import { Text, View } from "react-native";
import { ArrowUpDown, CalendarDays, Wallet } from "lucide-react-native";
import {
  formatMoneyForInput,
  money,
  moneySign,
} from "@babun/shared/common/utils/money";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { GradientButton } from "@/components/ui/GradientButton";
import { SectionCard } from "@/components/ui/SectionCard";
import { SelectRow } from "@/components/ui/select-rows";
import { FOOTER_SIDE } from "@/components/ui/tokens";
import { InlineNoteField } from "@/components/blocks/InlineNoteField";
import { AmountBlock } from "../AmountBlock";
import { accountIcon } from "../account-ui";
import type { AccountWithBalance } from "../accounts";
import { dayPhrase } from "@/lib/period";
import { transferSourceCaption } from "./transfer-rules";
import type { TransferView } from "./transfer-view";

const noop = () => {};
const blockBody = { paddingHorizontal: 2, paddingVertical: 2 } as const;

// ─── Форма ───────────────────────────────────────────────────────────────

export function renderTransferFormStep(v: TransferView) {
  const {
    visible, guard, title, t, failure, reason, warning, amountCents, amountNum,
    currency, send, canSend, sending, occurredOn, businessToday, setDateDraft,
    setStep, from, to, swap, amount, setAmount, setFailure, note, setNote,
    label, sourceLocked,
  } = v;
  const sourceCaption = transferSourceCaption(from, businessToday, currency);

  const remainder = from?.balance ?? 0;
  const showRemainder =
    moneySign(remainder) > 0 && amountCents !== Math.round(remainder * 100);

  /** Плашка счёта стороны перевода — как плашки листа счёта: значок счёта,
   *  имя, остаток справа. Не выбран — «Выбрать счёт» скрепкой-дверью. */
  const accountPlaque = (
    side: "from" | "to",
    account: AccountWithBalance | null,
    caption: string | null,
  ) =>
    account ? (
      <SelectRow
        icon={accountIcon(account)}
        // Без своего цвета — нейтральная плитка, как в списке счетов.
        color={account.color ?? undefined}
        plain
        title={label(account)}
        value={caption ?? undefined}
        accessibilityLabel={`${side === "from" ? "Откуда" : "Куда"}: ${label(account)}`}
        // Пришли со строки счёта — источник это показание, а не выбор.
        onPress={side === "from" && sourceLocked ? noop : () => setStep(side)}
      />
    ) : (
      <ChooseRow
        compact
        icon={Wallet}
        label="Выбрать счёт"
        onPress={() => setStep(side)}
      />
    );

  return (
    <BottomSheet
      padded={false}
      visible={visible && !guard.hidden}
      onClose={guard.close}
      onExited={guard.onExited}
      title={title}
      scroll
      avoidKeyboard
      footer={
        <View style={{ paddingHorizontal: FOOTER_SIDE, gap: 8 }}>
          {(failure ?? reason ?? warning) ? (
            <Text
              accessibilityLiveRegion="polite"
              maxFontSizeMultiplier={1.3}
              style={{
                fontSize: 13,
                lineHeight: 18,
                textAlign: "center",
                color: failure ? t.danger : t.sub,
              }}
            >
              {failure ?? reason ?? warning}
            </Text>
          ) : null}
          {/* Получателя кнопка НЕ называет: он стоит в блоке «Куда» прямо над
              ней, а «на Наличка · Команда 2» ломала падеж и длинным именем
              выталкивала сумму из единственной строки кнопки. */}
          <GradientButton
            label={
              amountCents
                ? `Перевести ${money(amountNum, currency)}`
                : "Перевести"
            }
            onPress={send}
            disabled={!canSend}
            loading={sending}
          />
        </View>
      }
    >
      {/* ПЕРЕВОД — ТЕМИ ЖЕ БЛОКАМИ, ЧТО ОПЕРАЦИЯ И ДОЛГ (тот же дизайн): на прохладном фоне
          блоки с шапкой, в них плашки. Порядок — как думает человек: когда →
          откуда → куда → сколько → заметка. */}
      <View style={{ backgroundColor: t.canvas, paddingBottom: 24 }}>
        {/* КОГДА — обычно «Сегодня»; день выбирается вторым шагом листа,
            вперёд не ставится. */}
        <SectionCard dense title="Когда">
          <View style={blockBody}>
            <SelectRow
              icon={CalendarDays}
              color={t.accent}
              plain
              title={
                occurredOn === businessToday
                  ? `Сегодня, ${dayPhrase(businessToday)}`
                  : dayPhrase(occurredOn)
              }
              onPress={() => {
                setDateDraft(occurredOn);
                setStep("date");
              }}
            />
          </View>
        </SectionCard>

        <SectionCard dense title="Откуда">
          <View style={blockBody}>{accountPlaque("from", from, from ? sourceCaption : null)}</View>
        </SectionCard>

        {/* «ПОМЕНЯТЬ МЕСТАМИ» — значком в шапке «Куда», где его ищут после
            выбора обеих сторон. */}
        <SectionCard
          dense
          title="Куда"
          action={
            from && to
              ? { label: "Поменять местами", icon: ArrowUpDown, accent: true, onPress: swap }
              : undefined
          }
        >
          <View style={blockBody}>
            {accountPlaque("to", to, to ? money(to.balance, currency) : null)}
          </View>
        </SectionCard>

        {/* СУММА — общий блок денег продукта; «Весь остаток» — пилюлей в
            шапке, как «+ VAT» у операции. */}
        <AmountBlock
          value={amount}
          onChange={(next) => {
            setAmount(next);
            setFailure(null);
          }}
          accessibilityLabel="Сумма перевода"
          selectOnFocus
          action={
            showRemainder
              ? {
                  label: `Весь остаток ${money(remainder, currency)}`,
                  pill: true,
                  onPress: () => setAmount(formatMoneyForInput(remainder)),
                }
              : undefined
          }
        />

        <SectionCard dense title="Заметка">
          <InlineNoteField
            note={{ draft: note, setDraft: setNote, onFocus: () => {}, onBlur: () => {} }}
            placeholder="Заметка перевода"
            accessibilityLabel="Заметка перевода"
            maxLength={500}
          />
        </SectionCard>
      </View>
    </BottomSheet>
  );
}
