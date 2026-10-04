import { Text, View } from "react-native";

import { Card } from "@/components/ui/Card";
import { RecordRowView } from "@/features/finances/RecordRow";
import { useThemeColors } from "@/theme/colors";

import type { AccessLevel } from "../access-map";
import { PreviewFrame } from "./PreviewFrame";
import { row } from "./preview-sample";

// «ОГРАНИЧЕНИЯ» В ШТОРКЕ (владелец 03.10: «как в клиентах», для записей
// календаря и для доходов и расходов). Картинка — прошлое разной давности
// ТЕМ ЖЕ ВИДОМ, что на экране (владелец 03.10: «сделай красиво — как запись,
// а не списком»): записи — плитками сетки календаря цветом команды, деньги —
// строками ленты «Финансов». Что старше выбранного срока, бледнеет и
// подписано «не видит». Сроки — те же, что у сервера
// (`member_record_window_start`, `finance_transactions_window`); здесь
// хватает дней — это картинка, а не правило.

const SPAN_DAYS: Readonly<Record<string, number>> = {
  week: 7,
  near: 14,
  month: 31,
  quarter: 92,
  half: 183,
};

const SPAN_WORDS: Readonly<Record<string, string>> = {
  week: "последнюю неделю",
  near: "последние две недели",
  month: "последний месяц",
  quarter: "последние три месяца",
  half: "последние полгода",
};

interface Sample {
  title: string;
  daysAgo: number;
  when: string;
}

const RECORDS: readonly (Sample & { time: string; service: string })[] = [
  { title: "Анна Петрова", daysAgo: 3, when: "3 дня назад", time: "10:00–11:00", service: "Чистка кондиционера" },
  { title: "Иван Смирнов", daysAgo: 20, when: "3 недели назад", time: "12:00–13:00", service: "Заправка фреоном" },
  { title: "Мария Иванова", daysAgo: 75, when: "2,5 месяца назад", time: "09:00–10:30", service: "Установка" },
  { title: "Олег Сидоров", daysAgo: 300, when: "10 месяцев назад", time: "15:00–16:00", service: "Ремонт" },
];

const MONEY: readonly (Sample & { amount: number; service?: string })[] = [
  { title: "Анна Петрова", daysAgo: 3, when: "3 дня назад", amount: 120, service: "Чистка кондиционера" },
  { title: "Бензин", daysAgo: 20, when: "3 недели назад", amount: -40 },
  { title: "Мария Иванова", daysAgo: 75, when: "2,5 месяца назад", amount: 200, service: "Установка" },
  { title: "Фреон R32", daysAgo: 300, when: "10 месяцев назад", amount: -25 },
];

export function WindowPreview({
  blockKey,
  level,
  teamColor,
}: {
  blockKey: string;
  level: AccessLevel | undefined;
  teamColor: string;
}) {
  const t = useThemeColors();
  const money = blockKey === "finance.window";
  const span = level && level in SPAN_DAYS ? level : level === "own" || level === "all" ? "own" : "week";
  const days = span === "own" ? Infinity : SPAN_DAYS[span];
  const caption =
    span === "own"
      ? money
        ? "Видит доходы и расходы за всё время"
        : "Видит все записи команды"
      : money
        ? `Доходы и расходы — за ${SPAN_WORDS[span]}`
        : `Прошедшие записи — за ${SPAN_WORDS[span]}`;
  const when = (sample: Sample, seen: boolean) => (seen ? sample.when : `${sample.when} · не видит`);

  if (money) {
    return (
      <PreviewFrame state="read" caption={caption}>
        <View style={{ marginHorizontal: 16, marginTop: 8, gap: 8 }}>
          {MONEY.map((sample) => {
            const seen = sample.daysAgo <= days;
            return (
              <View key={sample.title + sample.daysAgo} style={{ opacity: seen ? 1 : 0.35 }}>
                <RecordRowView
                  row={row({
                    key: `${sample.title}-${sample.daysAgo}`,
                    title: sample.title,
                    amount: sample.amount,
                    services: sample.service ? [sample.service] : [],
                    subtitle: sample.service ? undefined : when(sample, seen),
                    caption: sample.service ? when(sample, seen) : undefined,
                  })}
                  tone={sample.amount < 0 ? "expense" : "income"}
                />
              </View>
            );
          })}
        </View>
      </PreviewFrame>
    );
  }

  return (
    <PreviewFrame state="read" caption={caption}>
      <Card style={{ marginHorizontal: 16, marginTop: 8, padding: 10, gap: 8 }}>
        {RECORDS.map((sample) => {
          const seen = sample.daysAgo <= days;
          return (
            // Плитка записи — как на сетке календаря: заливка и кромка цветом
            // команды, имя клиента и время с услугой.
            <View
              key={sample.title}
              style={{
                opacity: seen ? 1 : 0.35,
                borderRadius: 6,
                paddingHorizontal: 10,
                paddingVertical: 8,
                backgroundColor: `${teamColor}2e`,
                borderLeftWidth: 3,
                borderLeftColor: teamColor,
              }}
            >
              <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontSize: 14, fontWeight: "600", color: t.ink }}>
                {sample.title}
              </Text>
              <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontSize: 12, color: t.sub, marginTop: 1 }}>
                {`${sample.time} · ${sample.service}`}
              </Text>
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
                style={{ fontSize: 12, fontWeight: seen ? "400" : "600", color: seen ? t.faint : t.sub, marginTop: 1 }}
              >
                {when(sample, seen)}
              </Text>
            </View>
          );
        })}
      </Card>
    </PreviewFrame>
  );
}
