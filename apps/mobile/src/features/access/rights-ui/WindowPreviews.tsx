import { Text, View } from "react-native";

import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { useThemeColors } from "@/theme/colors";

import type { AccessLevel } from "../access-map";
import { PreviewFrame } from "./PreviewFrame";

// «ОГРАНИЧЕНИЯ» В ШТОРКЕ (владелец 03.10: «как в клиентах», для записей
// календаря и для доходов и расходов). Картинка — прошлое разной давности:
// что старше выбранного срока, бледнеет и подписано «Не видит». Сроки — те
// же, что у сервера (`member_record_window_start`, `finance_transactions_window`);
// здесь хватает дней — это картинка, а не правило.

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

interface SampleRow {
  title: string;
  value?: string;
  daysAgo: number;
  when: string;
}

const RECORDS: readonly SampleRow[] = [
  { title: "Анна Петрова", daysAgo: 3, when: "3 дня назад" },
  { title: "Иван Смирнов", daysAgo: 20, when: "3 недели назад" },
  { title: "Мария Иванова", daysAgo: 75, when: "2,5 месяца назад" },
  { title: "Олег Сидоров", daysAgo: 300, when: "10 месяцев назад" },
];

const MONEY: readonly SampleRow[] = [
  { title: "Доход", value: "€120", daysAgo: 3, when: "3 дня назад" },
  { title: "Расход", value: "€40", daysAgo: 20, when: "3 недели назад" },
  { title: "Доход", value: "€200", daysAgo: 75, when: "2,5 месяца назад" },
  { title: "Расход", value: "€25", daysAgo: 300, when: "10 месяцев назад" },
];

export function WindowPreview({ blockKey, level }: { blockKey: string; level: AccessLevel | undefined }) {
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
  const rows = money ? MONEY : RECORDS;
  return (
    <PreviewFrame state="read" caption={caption}>
      <Card style={{ marginHorizontal: 16, marginTop: 8, overflow: "hidden" }}>
        {rows.map((row, i) => {
          const seen = row.daysAgo <= days;
          return (
            <View key={`${row.title}-${row.daysAgo}`}>
              {i > 0 ? <Divider inset={16} /> : null}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  opacity: seen ? 1 : 0.35,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
                    {row.title}
                  </Text>
                  <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: t.sub, marginTop: 2 }}>
                    {row.when}
                  </Text>
                </View>
                {seen ? (
                  row.value ? (
                    <Text
                      maxFontSizeMultiplier={1.3}
                      style={{
                        fontSize: 15,
                        fontWeight: "700",
                        fontVariant: ["tabular-nums"],
                        color: row.title === "Доход" ? t.success : t.danger,
                      }}
                    >
                      {row.value}
                    </Text>
                  ) : null
                ) : (
                  <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, fontWeight: "600", color: t.sub }}>
                    Не видит
                  </Text>
                )}
              </View>
            </View>
          );
        })}
      </Card>
    </PreviewFrame>
  );
}
