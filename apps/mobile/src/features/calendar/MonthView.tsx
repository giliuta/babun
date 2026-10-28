import { memo, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  isWeekendColumn,
  weekdayLabels,
} from "@/features/calendar/week";
import { countOverdue } from "@/features/calendar/overdue";
import {
  edgeColor,
  readableTextOnColor,
} from "@/components/ui/color-contrast";
import { useThemeColors } from "@/theme/colors";
import { useSituationPalette } from "@/features/appointments/booking-prefs";
import { dayMonthLabel } from "./day-month-label";
import { dayRecordCount } from "./day-money";
import { groupByDate, monthCells, ymd } from "./month-view/month-grid";
import { useMonthMoney } from "./month-view/use-month-money";

// Month overview — web MonthView parity: bordered 6×7 grid (first day per
// «Первый день недели»),
// out-of-month cells on the grouped canvas, today = filled accent pill,
// weekend numbers red, appointment-count chip top-right, and the per-day
// money mini-list (planned / earned / spent / profit) from the same
// day-summary source as the week footer, so the two can never disagree.
// memo: три страницы месяца живут в пейджере — соседи не должны
// пересчитываться на каждый тик родителя.
export const MonthView = memo(function MonthView({
  month,
  appointments,
  financeAppointments,
  teamId,
  todayYmd,
  nowHm: nowHmProp,
  labelFor,
  isDayOff,
  holeFor,
  onPickDay,
  onPickLabelDay,
  showFinance = true,
}: {
  month: Date; // first of the displayed month
  /** Видимый набор (фильтры сетки, вкл. «Скрывать отменённые») —
   *  счётчики-чипы дней. */
  appointments: Appointment[];
  /** Денежный набор — БЕЗ «Скрывать отменённые»: визуальная настройка не
   *  должна менять итоги money-мини-списка (судьбу отменённых в деньгах
   *  решает сам computeDayFinance). */
  financeAppointments: Appointment[];
  /** Active team — day extras are stored per (team, date); with no team
   *  selected extras are skipped (same as the day-finance footer). */
  teamId: string | null;
  /** Business-timezone today (YYYY-MM-DD); falls back to device time. */
  todayYmd?: string;
  /** «Сейчас» по времени бизнеса (HH:MM) — пара к `todayYmd`: долг дня
   *  считается по тем же часам, что сетка. Нет — часы телефона. */
  nowHm?: string;
  /** Метка дня (город) — цветная точка у числа: месяц показывает маршрут
   *  меток так же, как шапки Дня/Недели (единая система дат). */
  labelFor?: (dateYmd: string) => { name: string; color: string } | null;
  /** У команды на эту дату выходной (график: «не работаем»). Как в Неделе и
   *  Дне, выходной заменяет метку: нейтральная точка вместо цветной. */
  isDayOff?: (dateYmd: string) => boolean;
  /** Дыра дня — «чего этой работе не хватает», агрегатом на день: первая
   *  незакрытая ситуация по `COLOR_SITUATIONS`. Месяц говорит «сюда надо
   *  зайти»; имя дыры остаётся ленте и озвучке. */
  holeFor?: (dateYmd: string) => { name: string; color: string } | null;
  /** Долгий тап по дню — провалиться в Неделю этого дня (тап без меток —
   *  тоже, см. onPickLabelDay). */
  onPickDay: (d: Date) => void;
  /** Тап по дню — попап метки (undefined, когда у команды нет меток:
   *  тогда и обычный тап открывает Неделю). */
  onPickLabelDay?: (dateYmd: string) => void;
  /** Company money is owner-only; other roles still get counts and labels. */
  showFinance?: boolean;
}) {
  const cells = useMemo(() => monthCells(month), [month]);
  const WD = weekdayLabels();

  const byDay = useMemo(() => groupByDate(appointments), [appointments]);
  const financeByDay = useMemo(
    () => groupByDate(financeAppointments),
    [financeAppointments],
  );

  // Деньги клеток — `month-view/use-month-money.ts`.
  const { todayStr, totalsByDay } = useMonthMoney({
    cells,
    financeAppointments,
    financeByDay,
    teamId,
    todayYmd,
    nowHmProp,
    showFinance,
  });

  const t = useThemeColors();
  // ДОЛГ МЕСЯЦА — ЦВЕТОМ «ДОЛГА» ИЗ НАСТРОЙКИ, как блоки недели; затемнён до
  // читаемого мелким кеглем. Долг выключен — прежний янтарь.
  const debtHue = useSituationPalette(teamId).unpaid;
  const debtColor = debtHue ? edgeColor(debtHue) : t.warning;

  return (
    <View style={{ flex: 1, backgroundColor: t.surface }}>
      {/* weekday header — weekend columns red (полный danger, без
          приглушения: принцип «из чёрного, не серого» + контраст AA). */}
      <View
        className="flex-row"
        style={{
          backgroundColor: t.canvas,
          borderBottomWidth: 1,
          borderBottomColor: t.separator,
        }}
      >
        {WD.map((w, i) => (
          <Text
            key={w}
            className="flex-1 py-2 text-center"
            style={{
              fontSize: 12,
              fontWeight: "600",
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: isWeekendColumn(i) ? t.danger : t.sub,
            }}
          >
            {w}
          </Text>
        ))}
      </View>
      <View className="flex-1">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <View key={row} className="flex-1 flex-row">
            {cells.slice(row * 7, row * 7 + 7).map((d) => {
              const key = ymd(d);
              const inMonth = d.getMonth() === month.getMonth();
              const isToday = key === todayStr;
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
              const count = dayRecordCount(byDay.get(key) ?? []);
              const totals = totalsByDay.get(key) ?? null;
              // Метка — и на хвостовых днях чужого месяца: тап по ним открывает шторку метки, а поставленная
              // метка точкой не показывалась — выбор пропадал на глазах.
              // ВЫХОДНОЙ — И В МЕСЯЦЕ: «Выходной» из
              // шторки метки в Месяце не менял клетку вовсе, хотя Неделя и
              // День показывают его вместо метки.
              const dayOff = isDayOff?.(key) === true;
              const label = dayOff ? null : labelFor?.(key) ?? null;
              // ГРОМКО — ТОЛЬКО СЕГОДНЯ И ВПЕРЁД: в прошлом дозаполнять уже
              // нечего, а половина месяца в тёмных пилюлях убила бы сигнал
              // частотой. Гейта `inMonth` здесь НЕТ: хвостовые дни чужого
              // месяца — настоящие дни, и счётчик с деньгами на них не гасится.
              const hole = count > 0 && key >= todayStr ? holeFor?.(key) ?? null : null;
              const pill = hole ? edgeColor(hole.color) : null;
              // СКОЛЬКО РАБОТ НЕ ЗАКРЫТО. В сетке просрочка говорит толщиной
              // канта — каналом СРАВНИТЕЛЬНЫМ: на сплошь просроченной прошлой
              // неделе все канты одинаково толстые, и «сколько висит» по ним
              // не прочесть. Это деньги, и ответ обязан жить там, где он не
              // зависит от плотности, — на уровне дня.
              //
              // `nowMinutes` не передаётся СОЗНАТЕЛЬНО: чип месяца отвечает за
              // долги ПРОШЛОГО, сегодняшнюю работу ещё закрывают, и мигать на
              // ней с высоты месяца нечего. Плюс месяц не перерисовывается раз
              // в минуту — три страницы по 42 клетки.
              const unclosed = countOverdue(byDay.get(key) ?? [], todayStr, null);
              return (
                <Pressable
                  key={key}
                  onPress={() =>
                    onPickLabelDay ? onPickLabelDay(key) : onPickDay(d)
                  }
                  onLongPress={() => onPickDay(d)}
                  delayLongPress={350}
                  accessibilityRole="button"
                  accessibilityLabel={`${dayMonthLabel(d)}${isToday ? ", сегодня" : ""}${count > 0 ? `, записей: ${count}` : ""}${unclosed > 0 ? `, не закрыто: ${unclosed}` : ""}${hole ? `, ${hole.name.toLowerCase()}` : ""}${dayOff ? ", выходной" : label ? `, метка: ${label.name}` : ""}`}
                  accessibilityHint={
                    onPickLabelDay
                      ? "Нажатие меняет метку, долгое нажатие открывает неделю"
                      : "Нажатие открывает неделю"
                  }
                  className="flex-1 active:opacity-60"
                  style={{
                    padding: 4,
                    borderRightWidth: 1,
                    borderBottomWidth: 1,
                    borderColor: t.separator,
                    backgroundColor: inMonth ? t.surface : t.canvas,
                    overflow: "hidden",
                  }}
                >
                  <View className="w-full flex-row items-center justify-between">
                    <View className="flex-row items-center" style={{ gap: 3 }}>
                      {/* Сегодня — кобальтовое число (единая грамматика с
                          шапками Дня/Недели: цвет вместо фигур). */}
                      <Text
                        style={{
                          fontSize: 13,
                          fontWeight: isToday ? "700" : "600",
                          color: isToday
                            ? t.accent
                            : inMonth
                              ? isWeekend
                                ? t.danger
                                : t.ink
                              : t.faint,
                        }}
                      >
                        {d.getDate()}
                      </Text>
                      {/* Точка метки — тот же цвет города, что в шапках
                          Дня/Недели: маршрут читается и с высоты месяца.
                          Выходной — точка без пигмента (`chevron`): цвет
                          отдан меткам, красная точка путалась с красной
                          меткой. */}
                      {label || dayOff ? (
                        <View
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: dayOff ? t.chevron : label?.color,
                          }}
                        />
                      ) : null}
                    </View>
                    {/* ОДИН ЧИП, ЧЕТЫРЕ ГРОМКОСТИ, И НИКАКОГО ВТОРОГО. Пусто —
                        чипа нет; обычный день — тихая цифра чернилами без
                        подложки; день с незакрытой дырой сегодня или впереди —
                        плотная пилюля цвета худшей дыры с белой цифрой;
                        прошедший день с незакрытыми работами — ЯНТАРНЫЙ КАНТ
                        вокруг той же цифры.

                        Второй чип рядом сюда не влезает физически: клетка
                        56pt, внутри 48pt, а число дня с точкой метки и два
                        чипа занимают 65 — обрезка съедала бы счётчик. Один чип
                        с кантом занимает 42.

                        Цифра ВСЕГДА одна и та же — сколько записей в дне;
                        меняется только оправа. Кант отвечает «сюда надо
                        вернуться», а сколько именно висит, называет озвучка и
                        сам день. Пилюля и кант не встречаются: пилюля живёт
                        сегодня и вперёд, кант — только в прошлом.

                        Перепад держится не на тоне: тихая цифра занимает около
                        одной двенадцатой чернил громкой, плюс инверсия, плюс
                        контур. Сигнал жив в чёрно-белом и при любом
                        дальтонизме. Кобальтового чипа в месяце больше нет:
                        кобальт остаётся за «сегодня» и за прибылью. */}
                    {count > 0 ? (
                      <View
                        className="rounded-full px-1.5"
                        style={{
                          backgroundColor: pill ?? "transparent",
                          borderWidth: !pill && unclosed > 0 ? 1 : 0,
                          borderColor: t.warning,
                        }}
                      >
                        <Text
                          maxFontSizeMultiplier={1.3}
                          style={{
                            fontSize: 11,
                            fontWeight: "700",
                            lineHeight: !pill && unclosed > 0 ? 14 : 16,
                            color: pill
                              ? readableTextOnColor(pill, t.ink, t.onAccent)
                              : unclosed > 0
                                ? t.warning
                                : inMonth
                                  ? t.sub
                                  : t.faint,
                          }}
                        >
                          {count}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {totals &&
                  (totals.planned !== 0 ||
                    totals.debt !== 0 ||
                    totals.income !== 0 ||
                    totals.expense !== 0) ? (
                    <View className="mt-0.5 w-full">
                      {/* Серым — ещё ожидается, янтарём — долг прошедших
                          записей: план в прошлом стал долгом, а не пропал. */}
                      <MoneyRow v={totals.planned} color={t.sub} skipZero />
                      <MoneyRow v={totals.debt} color={debtColor} skipZero />
                      <MoneyRow v={totals.income} color={t.success} skipZero />
                      <MoneyRow v={totals.expense} color={t.danger} skipZero />
                      {/* Прибыль — только когда в дне были деньги: у дня с
                          одним планом синий «€0» читался как данные. */}
                      {totals.income !== 0 || totals.expense !== 0 ? (
                        <MoneyRow
                          v={totals.profit}
                          color={totals.profit < 0 ? t.danger : t.accent}
                        />
                      ) : null}
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
});

// One line of the in-cell money mini-list. Zero rows are dropped (web
// parity); profit renders when the day had income or expense.
function MoneyRow({
  v,
  color,
  skipZero,
}: {
  v: number;
  color: string;
  skipZero?: boolean;
}) {
  if (skipZero && v === 0) return null;
  return (
    <Text
      numberOfLines={1}
      maxFontSizeMultiplier={1.3}
      style={{ fontVariant: ["tabular-nums"], fontSize: 11, fontWeight: "600", lineHeight: 14, color }}
    >
      {formatEUR(v)}
    </Text>
  );
}
