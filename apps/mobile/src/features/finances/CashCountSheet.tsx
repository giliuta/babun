import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import {
  money,
  moneySign,
  parseMoneyInputToCents,
} from "@babun/shared/common/utils/money";
import { isOnline, randomUuid, useIsOnline } from "@babun/shared/sync";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { GradientButton } from "@/components/ui/GradientButton";
import { MoneyField } from "@/components/ui/MoneyField";
import { FieldRow, RowGroupBody } from "@/components/ui/card-rows";
import { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { useTenant } from "@/features/settings/tenant";
import type { AccountWithBalance } from "./accounts";
import { useRecordCashCount, type CashCount } from "./cash-counts";

// ЛИСТ ПЕРЕСЧЁТА КАССЫ (ТЗ 2026-08-10 §5.5).
//
// ШАГ 1 — СЛЕПОЙ ВВОД. Ожидаемая сумма не показана НИГДЕ на этом шаге: если
// человек видит «должно быть €1 240», он пишет €1 240. Это розничный стандарт
// blind count, и без него сверка перестаёт быть сверкой — она становится
// подтверждением учёта.
//
// ШАГ 2 — РАЗНИЦА В ТОМ ЖЕ ЛИСТЕ. Второго листа поверх первого не бывает
// (`BottomSheet` — это RN Modal), а «Назад» обязано возвращать набранное.
//
// ДВА ТАПА, А НЕ ОДИН. Списание разницы — отдельное осознанное действие
// («Записать недостачу €35»), а не побочный эффект пересчёта: операция в
// расходах компании не должна появляться от нажатия «Готово».
//
// ПЕЧАТАЕМ ТО, ЧТО ВЕРНУЛ СЕРВЕР. Разница на шаге 2 — это ПРЕДПОЛОЖЕНИЕ по
// остатку, который уже лежит на телефоне; между показом и нажатием могла
// пройти оплата, поэтому настоящий ожидаемый остаток считает RPC под замком
// леджера. Тост говорит серверными числами, даже если кнопка обещала другое.

/** Финансы онлайн-only НА ЗАПИСЬ (§8): без сети кнопка гасится и говорит
 *  почему. Крутящаяся кнопка страшнее ошибки — человек не знает, записалось
 *  ли. */
const OFFLINE_REASON =
  "Без сети пересчёт не записывается. Пересчитайте кассу и оформите, когда "
  + "появится связь.";

/** Связь пропала МЕЖДУ нажатием и ответом. Повтор безопасен: `request_id`
 *  привязан к намерению, и сервер вернёт ту же сверку, а не запишет вторую. */
const OFFLINE_MID_FLIGHT =
  "Связь пропала. Нажмите ещё раз, когда появится сеть — вторая сверка не "
  + "запишется.";

type Step = "count" | "result";

export function CashCountSheet({
  visible,
  onClose,
  account,
  subtitle,
}: {
  visible: boolean;
  onClose: () => void;
  /** Пересчитывают ТОЛЬКО наличные: на карте и в банке остаток считает банк.
   *  `null` — счёт исчез, пока лист открывали. */
  account: AccountWithBalance | null;
  /** «Наличные · Команда Юра» — собирает вызывающая сторона. */
  subtitle: string;
}) {
  const t = useThemeColors();
  const online = useIsOnline();
  const toast = useToast();
  const record = useRecordCashCount();
  const currency = useTenant().data?.currency;

  const [step, setStep] = useState<Step>("count");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Счёт и его подпись держим У СЕБЯ: вызывающая сторона на закрытии обнуляет
  // свой id, и без этого лист исчезал бы мгновенно, мимо анимации выезда, а
  // подпись успевала мигнуть пустотой. Живой счёт всегда перезаписывает
  // показанный — остаток в листе едет за сервером, пока лист открыт.
  const [shown, setShown] = useState<{
    account: AccountWithBalance;
    subtitle: string;
  } | null>(account ? { account, subtitle } : null);
  useEffect(() => {
    if (account) setShown({ account, subtitle });
  }, [account, subtitle]);

  // Каждое ОТКРЫТИЕ листа начинает заново, но только по фронту: фоновый
  // рефетч счетов при открытом листе не должен стирать набранное.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (!visible) {
      wasVisible.current = false;
      return;
    }
    if (wasVisible.current) return;
    wasVisible.current = true;
    setStep("count");
    setAmount("");
    setNote("");
    setFailure(null);
  }, [visible]);

  /** `request_id` привязан к НАМЕРЕНИЮ: повтор после потерянного ответа обязан
   *  попасть в тот же серверный дедуп, а изменённая сумма или комментарий —
   *  это уже другая сверка (сервер отобьёт повтор с другими данными). */
  const intent = useRef<{ key: string; id: string } | null>(null);
  const requestIdFor = (key: string): string => {
    if (intent.current?.key !== key) intent.current = { key, id: randomUuid() };
    return intent.current.id;
  };

  // Ноль — законный ответ: «касса пуста» это результат пересчёта, а не
  // отсутствие ввода. По умолчанию парсер отбивает ноль (для сумм операций он
  // и правда бессмыслен), поэтому здесь он разрешён явно.
  const countedCents = parseMoneyInputToCents(amount, { allowZero: true });
  const counted = (countedCents ?? 0) / 100;
  // Предположение по остатку, который уже на телефоне. Настоящую разницу
  // считает сервер — см. шапку файла.
  const expected = shown?.account.balance ?? 0;
  const preview = useMemo(
    () => (countedCents === null ? 0 : counted - expected),
    [countedCents, counted, expected],
  );
  const previewSign = moneySign(preview);

  const reason = !online
    ? OFFLINE_REASON
    : countedCents === null
      ? "Введите сумму, которая сейчас в кассе"
      : null;

  const submit = async () => {
    if (!shown || countedCents === null) return;
    // Сеть проверяется В МОМЕНТ нажатия: между последним кадром и тапом связь
    // могла пропасть, и мутация ушла бы в paused — кнопка крутилась бы вечно.
    if (!isOnline()) {
      setFailure(OFFLINE_REASON);
      return;
    }
    const trimmedNote = note.trim();
    const requestId = requestIdFor(
      `${shown.account.id}|${countedCents}|${trimmedNote}`,
    );
    setSending(true);
    setFailure(null);
    try {
      const result = await record.mutateAsync({
        requestId,
        accountId: shown.account.id,
        counted,
        note: trimmedNote || null,
      });
      haptics.success();
      toast(resultToast(result, shown.account.name, currency), "success");
      intent.current = null;
      onClose();
    } catch (e) {
      // Лист остаётся открытым — набранное не теряется, а повтор попадёт в тот
      // же серверный дедуп по неизменившемуся `request_id`.
      const message = e instanceof Error ? e.message : "";
      setFailure(
        isOnline() ? message || "Не удалось записать пересчёт" : OFFLINE_MID_FLIGHT,
      );
    } finally {
      setSending(false);
    }
  };

  if (!shown) return null;

  // ─── Шаг 1: слепой ввод ──────────────────────────────────────────────────

  if (step === "count") {
    return (
      <BottomSheet
      padded={false}
        visible={visible}
        onClose={onClose}
        title="Пересчитайте кассу"
        scroll
        avoidKeyboard
        footer={
          <View style={{ paddingHorizontal: 20, gap: 8 }}>
            <Text
              maxFontSizeMultiplier={1.3}
              style={{
                fontSize: 13,
                lineHeight: 18,
                textAlign: "center",
                color: t.faint,
              }}
            >
              {/* Правило слепого ввода печатается вслух: иначе отсутствие
                  «должно быть» читается как недоделка экрана.
                  Офлайн причина встаёт НА ЭТОМ шаге, а не на втором: дать
                  пересчитать кассу и упереться в мёртвую кнопку на шаге
                  разницы — это работа впустую (тот же закон, по которому
                  группа «Действия» на карточке счёта гаснет целиком). */}
              {online
                ? "Сколько по учёту — покажем после ввода."
                : OFFLINE_REASON}
            </Text>
            <GradientButton
              label="Готово"
              onPress={() => setStep("result")}
              disabled={countedCents === null || !online}
            />
          </View>
        }
      >
        <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
          <Text
            maxFontSizeMultiplier={1.3}
            style={{
              marginBottom: 12,
              marginHorizontal: 4,
              fontSize: 13,
              lineHeight: 18,
              color: t.faint,
            }}
          >
            {shown.subtitle}
          </Text>
          <MoneyField
            label="Сколько денег в кассе сейчас"
            value={amount}
            onChangeText={(v) => {
              setAmount(v);
              setFailure(null);
            }}
            currency={currency}
            autoFocus
          />
        </View>
      </BottomSheet>
    );
  }

  // ─── Шаг 2: разница ──────────────────────────────────────────────────────

  const verdict =
    previewSign === 0
      ? { text: "Сходится", color: t.ink, action: "Сходится" }
      : previewSign > 0
        ? {
            text: `Излишек ${money(preview, currency)}`,
            color: t.success,
            action: `Записать излишек ${money(preview, currency)}`,
          }
        : {
            text: `Недостача ${money(Math.abs(preview), currency)}`,
            color: t.danger,
            action: `Записать недостачу ${money(Math.abs(preview), currency)}`,
          };

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      title="Пересчёт кассы"
      scroll
      avoidKeyboard
      footer={
        <View style={{ paddingHorizontal: 20, gap: 8 }}>
          {(failure ?? reason) ? (
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
              {failure ?? reason}
            </Text>
          ) : null}
          <GradientButton
            label={verdict.action}
            onPress={submit}
            disabled={reason !== null || sending}
            loading={sending}
          />
        </View>
      }
    >
      <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
        <Pressable
          onPress={() => setStep("count")}
          accessibilityRole="button"
          accessibilityLabel="Назад, изменить сумму"
          hitSlop={8}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 2,
            alignSelf: "flex-start",
            minHeight: 44,
            paddingRight: 12,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <ChevronLeft color={t.accent} size={20} strokeWidth={2.2} />
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ fontSize: 15, fontWeight: "600", color: t.accent }}
          >
            Назад
          </Text>
        </Pressable>

        <View
          accessible
          accessibilityLabel={[
            shown.subtitle,
            `по учёту ${money(expected, currency)}`,
            `насчитали ${money(counted, currency)}`,
            verdict.text,
          ].join(", ")}
          style={{ marginTop: 4, marginHorizontal: 4 }}
        >
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ fontSize: 13, lineHeight: 18, color: t.faint }}
          >
            {shown.subtitle}
          </Text>
          <SumRow label="По учёту" value={money(expected, currency)} />
          <SumRow label="Насчитали" value={money(counted, currency)} />
          <Text
            maxFontSizeMultiplier={1.3}
            style={{
              marginTop: 10,
              fontSize: 28,
              lineHeight: 34,
              fontWeight: "800",
              color: verdict.color,
              fontVariant: ["tabular-nums"],
            }}
          >
            {verdict.text}
          </Text>
        </View>

        <View style={{ marginTop: 14 }}>
          <RowGroupBody>
            <FieldRow
              label="Комментарий"
              value={note}
              placeholder="Необязательно"
              stacked
              // На каждый символ: кнопка листа не снимает фокус с поля, и
              // коммит по blur до неё бы не дошёл — комментарий терялся бы.
              live
              onSave={setNote}
            />
          </RowGroupBody>
        </View>
      </View>
    </BottomSheet>
  );
}

/** Строка «слово — сумма» шага разницы. */
function SumRow({ label, value }: { label: string; value: string }) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 32,
      }}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        style={{ flexShrink: 1, fontSize: 15, color: t.sub }}
      >
        {label}
      </Text>
      <View style={{ flex: 1, alignItems: "flex-end" }}>
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            fontSize: 15,
            fontWeight: "600",
            color: t.ink,
            fontVariant: ["tabular-nums"],
          }}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

/**
 * Тост говорит СЕРВЕРНЫМИ числами: пока лист был открыт, могла пройти оплата,
 * и тогда «Сходится» на кнопке обернётся записанной недостачей. Человек обязан
 * узнать об этом от продукта, а не из ленты операций через неделю.
 */
function resultToast(
  result: CashCount,
  accountName: string,
  currency: string | undefined,
): string {
  const sign = moneySign(result.delta);
  if (sign === 0) return `«${accountName}»: касса сошлась`;
  const amount = money(Math.abs(result.delta), currency);
  return sign > 0
    ? `«${accountName}»: излишек ${amount} записан`
    : `«${accountName}»: недостача ${amount} записана`;
}
