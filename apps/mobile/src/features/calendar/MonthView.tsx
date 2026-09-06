import { memo, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  computeDayFinance,
  type DayFinanceTotals,
} from "@babun/shared/local/finance/day-summary";
import { getDayExtras } from "@babun/shared/local/day-extras";
import { useDayExtras, useFinanceServices } from "@/features/calendar/queries";
import {
  isWeekendColumn,
  weekdayIndex,
  weekdayLabels,
} from "@/features/calendar/week";
import { countOverdue } from "@/features/calendar/overdue";
import {
  edgeColor,
  readableTextOnColor,
} from "@/components/ui/color-contrast";
import { useThemeColors } from "@/theme/colors";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

function groupByDate(appointments: Appointment[]) {
  const map = new Map<string, Appointment[]>();
  for (const a of appointments) {
    const arr = map.get(a.date) ?? [];
    arr.push(a);
    map.set(a.date, arr);
  }
  return map;
}

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
  labelFor,
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
  /** Метка дня (город) — цветная точка у числа: месяц показывает маршрут
   *  меток так же, как шапки Дня/Недели (единая система дат). */
  labelFor?: (dateYmd: string) => { name: string; color: string } | null;
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
  const cells = useMemo(() => {
    const y = month.getFullYear();
    const m = month.getMonth();
    const startDow = weekdayIndex(new Date(y, m, 1).getDay());
    const out: Date[] = [];
    for (let i = 0; i < 42; i++) out.push(new Date(y, m, 1 - startDow + i));
    return out;
  }, [month]);
  const WD = weekdayLabels();

  const byDay = useMemo(() => groupByDate(appointments), [appointments]);
  const financeByDay = useMemo(
    () => groupByDate(financeAppointments),
    [financeAppointments],
  );

  const services = useFinanceServices();
  const { data: extrasMap = {} } = useDayExtras();

  // Финансы всех дней одной мемоизацией (аудит: computeDayFinance гонялся
  // по 42 клеткам в каждом рендере). Дни без записей, но с ручными
  // операциями (extras) тоже попадают в карту.
  const totalsByDay = useMemo(() => {
    const m = new Map<string, DayFinanceTotals>();
    if (!showFinance) return new Map<string, DayFinanceTotals>();
    const dates = new Set(financeByDay.keys());
    if (teamId) {
      const prefix = `${teamId}:`;
      for (const k of Object.keys(extrasMap)) {
        if (k.startsWith(prefix)) dates.add(k.slice(prefix.length));
      }
    }
    for (const date of dates) {
      m.set(
        date,
        computeDayFinance(
          financeByDay.get(date) ?? [],
          services,
          getDayExtras(extrasMap, teamId, date),
        ),
      );
    }
    return m;
  }, [financeByDay, services, extrasMap, teamId, showFinance]);

  const t = useThemeColors();
  const todayStr = todayYmd ?? ymd(new Date());

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
              const count = byDay.get(key)?.length ?? 0;
              const totals = totalsByDay.get(key) ?? null;
              const label = inMonth ? labelFor?.(key) ?? null : null;
              // ГРОМКО — ТОЛЬКО СЕГОДНЯ И ВПЕРЁД: в прошлом дозаполнять уже
              // нечего, а половина месяца в тёмных пилюлях убила бы сигнал
              // частотой. Гейта `inMonth` здесь НЕТ (в отличие от метки):
              // хвостовые дни чужого месяца — настоящие дни, и счётчик с
              // деньгами на них не гасится.
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
                  accessibilityLabel={`${d.getDate()} ${d.toLocaleDateString("ru-RU", { month: "long" })}${isToday ? ", сегодня" : ""}${count > 0 ? `, записей: ${count}` : ""}${unclosed > 0 ? `, не закрыто: ${unclosed}` : ""}${hole ? `, ${hole.name.toLowerCase()}` : ""}${label ? `, метка: ${label.name}` : ""}`}
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
                          Дня/Недели: маршрут читается и с высоты месяца. */}
                      {label ? (
                        <View
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: label.color,
                          }}
                        />
                      ) : null}
                    </View>
                    <View className="flex-row items-center" style={{ gap: 3 }}>
                    {/* НЕ ЗАКРЫТО — ПОЛЫЙ ЧИП, а записи — залитый или тихий.
                        Разводит их не только цвет: заливка ↔ обводка плюс
                        порядок (полый всегда слева) — нецветовые каналы. Чип
                        записей не двигается: он остаётся крайним справа, и для
                        дней без долгов вид клетки не меняется ни на пиксель. */}
                    {unclosed > 0 ? (
                      <View
                        className="rounded-full px-1.5"
                        style={{ borderWidth: 1, borderColor: t.warning }}
                      >
                        <Text
                          maxFontSizeMultiplier={1.3}
                          style={{
                            fontSize: 10,
                            fontWeight: "700",
                            lineHeight: 14,
                            color: t.warning,
                          }}
                        >
                          {unclosed}
                        </Text>
                      </View>
                    ) : null}
                    {/* ЧИП СЧЁТЧИКА ГОВОРИТ ТРЕМЯ ГРОМКОСТЯМИ, а нового
                        элемента в клетке не заводится. Пусто — чипа нет;
                        обычный день — тихая цифра чернилами без подложки; день
                        с незакрытой дырой сегодня или впереди — плотная пилюля
                        цвета худшей дыры с белой цифрой. Перепад держится не
                        на тоне, а на инверсии и количестве чернил: тихая цифра
                        занимает около одной двенадцатой громкой, поэтому
                        сигнал жив и в чёрно-белом, и при любом дальтонизме.
                        Кобальтового чипа в месяце больше нет: кобальт остаётся
                        за «сегодня» и за прибылью. */}
                    {count > 0 ? (
                      <View
                        className="rounded-full px-1.5"
                        style={{ backgroundColor: pill ?? "transparent" }}
                      >
                        <Text
                          maxFontSizeMultiplier={1.3}
                          style={{
                            fontSize: 10,
                            fontWeight: "700",
                            lineHeight: 16,
                            color: pill
                              ? readableTextOnColor(pill, t.ink, t.onAccent)
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
                  </View>
                  {totals?.hasAny ? (
                    <View className="mt-0.5 w-full">
                      <MoneyRow v={totals.planned} color={t.sub} skipZero />
                      <MoneyRow v={totals.earned} color={t.success} skipZero />
                      <MoneyRow v={totals.spent} color={t.danger} skipZero />
                      <MoneyRow
                        v={totals.profit}
                        color={totals.profit < 0 ? t.danger : t.accent}
                      />
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
// parity) — except profit, which always renders when the day has numbers.
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
      className="tabular-nums"
      numberOfLines={1}
      maxFontSizeMultiplier={1.3}
      style={{ fontSize: 10, fontWeight: "600", lineHeight: 13, color }}
    >
      {formatEUR(v)}
    </Text>
  );
}
