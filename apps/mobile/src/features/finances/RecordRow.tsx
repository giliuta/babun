import { Pressable, Text, View } from "react-native";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import { useThemeColors } from "@/theme/colors";
import { servicesLine, whenLine, type RecordRow } from "./record-rows";

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

export type RecordRowTone = "income" | "expense" | "debt";

const TONE_WORD: Record<RecordRowTone, string> = {
  income: "доход",
  expense: "расход",
  debt: "долг",
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
  const money =
    tone === "income" ? t.success : tone === "debt" ? t.warning : t.danger;
  const amount = `${row.amount < 0 ? "−" : ""}${formatEUR(Math.abs(row.amount))}`;
  const services = servicesLine(row.services);
  const when = whenLine(row);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[
        row.title,
        services,
        `${TONE_WORD[tone]} ${formatEUR(Math.abs(row.amount))}`,
        row.appointmentId ? "открыть запись" : null,
      ]
        .filter(Boolean)
        .join(", ")}
      className="flex-row items-center gap-3 px-4 active:opacity-60"
      style={{ backgroundColor: t.surface, minHeight: 64 }}
    >
      <View className="min-w-0 flex-1">
        <Text
          className="text-[15px] font-semibold"
          style={{ color: t.ink }}
          numberOfLines={1}
        >
          {row.title}
        </Text>
        {/* Запись без услуг — тоже строка, а не три ветки разметки: тире
            держит второй ярус на месте и ряд не прыгает по высоте. */}
        <Text className="text-[13px]" style={{ color: t.sub }} numberOfLines={1}>
          {services || "—"}
        </Text>
      </View>
      <View className="items-end">
        <Text
          className="text-[15px] font-bold"
          style={{ color: money, fontVariant: ["tabular-nums"] }}
        >
          {amount}
        </Text>
        {when ? (
          <Text className="text-[13px]" style={{ color: t.faint }} numberOfLines={1}>
            {when}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
