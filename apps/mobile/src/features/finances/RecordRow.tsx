import { Pressable, Text, View } from "react-native";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
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

export function RecordRowView({
  row,
  tone,
  onPress,
}: {
  row: RecordRow;
  tone: RecordRowTone;
  onPress?: () => void;
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
  const money = toneColor(tone);
  const amount = `${row.amount < 0 ? "−" : ""}${formatEUR(Math.abs(row.amount))}`;
  // ЧТО и КОГДА — под именем клиента; дата не печатается, она заголовок дня.
  const what = whatLine(row);
  // Правая подпись: сначала то, что по этой же работе НЕ ЗАКРЫТО, потом своя
  // подпись списка (возраст долга), и лишь потом число платежей.
  const caption = row.extras?.length ? null : row.caption || paymentsLine(row);

  return (
    <View
      className="flex-row items-stretch"
      style={{ backgroundColor: t.surface }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={[
          row.title,
          what,
          `${TONE_WORD[tone]} ${formatEUR(Math.abs(row.amount))}`,
          row.appointmentId ? "открыть запись" : null,
        ]
          .filter(Boolean)
          .join(", ")}
        className="min-w-0 flex-1 flex-row items-center gap-3 py-2 pl-4 active:opacity-60"
        style={{ minHeight: 64, paddingRight: 16 }}
      >
        <View className="min-w-0 flex-1">
          <Text
            className="text-[15px] font-semibold"
            style={{ color: t.ink }}
            numberOfLines={1}
          >
            {row.title}
          </Text>
          {/* Запись без услуг и без времени — тоже строка, а не три ветки
              разметки: тире держит второй ярус на месте и ряд не прыгает. */}
          <Text className="text-[13px]" style={{ color: t.sub }} numberOfLines={1}>
            {what || "—"}
          </Text>
        </View>
        <View className="items-end">
          <Text
            className="text-[15px] font-bold"
            style={{ color: money, fontVariant: ["tabular-nums"] }}
          >
            {amount}
          </Text>
          {row.extras?.length ? (
            <Text className="text-[13px]" numberOfLines={1}>
              {row.extras.map((extra, i) => (
                <Text key={extra.tone}>
                  {i > 0 ? <Text style={{ color: t.faint }}>{" · "}</Text> : null}
                  {/* Слово тише суммы: глаз ловит число, а слово объясняет
                      его. Цвет у числа свой — долг янтарный, расход красный. */}
                  <Text style={{ color: t.faint }}>{EXTRA_WORD[extra.tone]} </Text>
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
            <Text className="text-[13px]" style={{ color: t.faint }} numberOfLines={1}>
              {caption}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}
