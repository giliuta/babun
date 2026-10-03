import { Text, View } from "react-native";
import {
  ArrowLeftRight,
  HandCoins,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react-native";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import { SelectRow } from "@/components/ui/select-rows";
import { useThemeColors } from "@/theme/colors";
import { paymentsLine, whatLine, type RecordRow } from "./record-rows";

// СТРОКА-ЗАПИСЬ — ОДИН ОБЪЕКТ НА ТРИ СПИСКА (владелец 2026-09-08: «один
// единый блочок записи, и там сразу пишется, какие услуги были сделаны»).
//
// Экран раскрывал шесть панелей и рисовал строку четырьмя разными способами:
// счета 60pt, операции 56, долги 44, документы 60. Пятого диалекта не заводим:
// «Доход», «Расход» и «Долги» берут эту строку, и правится она в одном месте.
//
// ГЕОМЕТРИЯ ВЫБРАНА ГЛАЗАМИ (правило 5.1, три варианта рядом на живом экране,
// владелец 2026-09-08): КЛИЕНТ ВЕДЁТ, услуги под ним, сумма и время справа.
// Услуга у сервисного бизнеса повторяется каждый день, а клиент — нет: когда
// крупным набрано «A/C Cleaning», десять строк подряд читаются как одна, и
// глазом нужную не найти. Это ровно та жалоба, с которой начался разбор.
//
// Перечень услуг длины переменной, поэтому усечение здесь ПРАВИЛО, а не
// `numberOfLines` наугад: два имени и «+N», иначе третья услуга съедала бы
// имя клиента.

export type RecordRowTone = "income" | "expense" | "debt" | "transfer";

/** Слово хвоста: что именно ещё не закрыто по этой работе. */
const EXTRA_WORD: Record<RecordRowTone, string> = {
  income: "доход",
  expense: "расход",
  debt: "долг",
  transfer: "перевод",
};

const TONE_WORD: Record<RecordRowTone, string> = {
  income: "доход",
  expense: "расход",
  debt: "долг",
  transfer: "перевод",
};

/** Плитка вида денег — тем же значком, что строка права «Доходы» /
 *  «Расходы» / «Долги» и плитка счёта для перевода. */
const TONE_ICON: Record<RecordRowTone, LucideIcon> = {
  income: TrendingUp,
  expense: TrendingDown,
  debt: HandCoins,
  transfer: ArrowLeftRight,
};

const noop = () => {};

export function RecordRowView({
  row,
  tone,
  onPress,
  onLongPress,
}: {
  row: RecordRow;
  tone: RecordRowTone;
  onPress?: () => void;
  /** Долгое нажатие — то же, что свайп строки, словами (удаление в ленте). */
  onLongPress?: () => void;
}) {
  const t = useThemeColors();
  // Перевод НЕЙТРАЛЕН для прибыли: деньги переехали между своими счетами.
  // Красить его зелёным нельзя — «−€55» зелёным читался как доход.
  const toneColor = (kind: RecordRowTone) =>
    kind === "income"
      ? t.success
      : kind === "debt"
        ? t.warning
        : kind === "transfer"
          ? t.sub
          : t.danger;
  const extraColor = toneColor;
  // Возврат в разрезе «Доход» — деньги, ушедшие клиенту: «−€30» зелёным
  // читался как приход (плитка и витрина красят его красным).
  const money =
    tone === "income" && row.amount < 0 ? t.danger : toneColor(tone);
  // Плюс печатается только у перевода, пересекающего ленту: цвет у него
  // нейтральный, и без знака «€55» на «Карте» не отличить от ушедших €55.
  const sign =
    row.amount < 0 ? "−" : row.crossesSlice && row.amount > 0 ? "+" : "";
  const amount = `${sign}${formatEUR(Math.abs(row.amount))}`;
  // ЧТО и КОГДА — под именем клиента; дата не печатается, она заголовок дня.
  const what = whatLine(row);
  // Правая подпись: сначала то, что по этой же работе НЕ ЗАКРЫТО, потом своя
  // подпись списка (возраст долга), и лишь потом число платежей.
  const caption = row.extras?.length ? null : row.caption || paymentsLine(row);

  // ПЛАШКА, КАК «ИСТОРИЯ» КЛИЕНТА (владелец 03.10 выбрал вариант 2 из трёх
  // на живом экране): белая скруглённая плашка, слева — плитка вида денег его
  // цветом (доход — вверх, расход и возврат — вниз, долг — монеты, перевод —
  // стрелки), справа — сумма тем же цветом и подпись под ней.
  const refund = tone === "income" && row.amount < 0;
  const icon: LucideIcon = refund ? TrendingDown : TONE_ICON[tone];
  return (
    <SelectRow
      icon={icon}
      color={money}
      plain
      title={row.title}
      // Запись без услуг и без времени — тоже строка: тире держит второй ярус
      // на месте, и плашки одной высоты.
      subtitle={what || "—"}
      accessibilityLabel={[
        row.title,
        what,
        `${TONE_WORD[tone]} ${formatEUR(Math.abs(row.amount))}`,
        row.appointmentId
          ? "открыть запись"
          : row.invoiceId
            ? "открыть инвойс"
          : row.debtId
            ? "открыть долг"
            : row.txId
              ? "открыть операцию"
              : null,
      ]
        .filter(Boolean)
        .join(", ")}
      // Без двери плашка — показание: нажатие ничего не делает.
      onPress={onPress ?? noop}
      onLongPress={onLongPress}
      trailing={
        <View
          style={{ alignItems: "flex-end", flexShrink: 0, maxWidth: "45%" }}
        >
          <Text
            maxFontSizeMultiplier={1.3}
            numberOfLines={1}
            style={{
              fontSize: 15,
              fontWeight: "700",
              color: money,
              fontVariant: ["tabular-nums"],
            }}
          >
            {amount}
          </Text>
          {row.extras?.length ? (
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 13 }}
              numberOfLines={1}
            >
              {row.extras.map((extra, i) => (
                <Text key={extra.tone}>
                  {i > 0 ? (
                    <Text style={{ color: t.faint }}>{" · "}</Text>
                  ) : null}
                  {/* Слово тише суммы: глаз ловит число, а слово объясняет
                      его. Цвет у числа свой — долг янтарный, расход красный. */}
                  <Text style={{ color: t.faint }}>
                    {EXTRA_WORD[extra.tone]}{" "}
                  </Text>
                  <Text
                    style={{
                      color: extraColor(extra.tone),
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {formatEUR(extra.amount)}
                  </Text>
                </Text>
              ))}
            </Text>
          ) : caption ? (
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 13, color: t.faint }}
              numberOfLines={1}
            >
              {caption}
            </Text>
          ) : null}
        </View>
      }
    />
  );
}
