import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";
import type { DateSpinnerProps } from "./DateSpinner";
import { ITEM_H, LoopWheelColumn, PAD, WHEEL_H, WheelWithLines } from "./TimeWheel";

// ANDROID-ДВОЙНИК БАРАБАНА ДАТЫ — ТРИ КОЛЕСА, КАК НА iPHONE (13.10).
//
// На Android системный «спиннер» даты — не колесо в шторке, а ДИАЛОГ поверх
// всего: библиотека открывает его эффектом на каждую смену `onChange`, а
// вызывающие передают стрелку, новую на каждом рендере. Итог: диалог
// закрывал шторку сразу при открытии, после «ОК» открывался снова, на любой
// рефетч — снова, а «Отмена» приходила как ВЫБОР исходной даты («Без срока
// оплаты» у инвойса не держалось вовсе). Человек застревал в кругу диалогов.
//
// Здесь — те же три колеса, что у iPhone и веба (владелец 21.09: «день, месяц
// и год — барабанами»): день и месяц по кругу (как в барабане iOS), год — без
// кольца: «2036 → 1926» прокруткой вниз было бы ложью о порядке.

/** Месяц в родительном падеже: «14 · марта · 1987» читается датой целиком. */
const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Колесо без кольца — для года. Геометрия та же, что у `LoopWheelColumn`. */
function YearColumn({
  years,
  index,
  onPick,
}: {
  years: string[];
  index: number;
  onPick: (next: number) => void;
}) {
  const t = useThemeColors();
  const ref = useRef<ScrollView>(null);
  const [live, setLive] = useState(index);
  const settledRef = useRef(-1);

  useEffect(() => {
    if (settledRef.current === index) return;
    settledRef.current = index;
    setLive(index);
    const id = requestAnimationFrame(() =>
      ref.current?.scrollTo({ y: index * ITEM_H, animated: false }),
    );
    return () => cancelAnimationFrame(id);
  }, [index]);

  const settle = (y: number) => {
    const picked = Math.min(years.length - 1, Math.max(0, Math.round(y / ITEM_H)));
    settledRef.current = picked;
    setLive(picked);
    if (picked !== index) onPick(picked);
  };

  return (
    <ScrollView
      ref={ref}
      // Колесо живёт в прокручиваемой шторке: без этого Android отдаёт
      // вертикальный жест внешней прокрутке, и колесо не крутится.
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_H}
      decelerationRate="fast"
      scrollEventThrottle={16}
      onScroll={(e) => {
        const i = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
        if (i !== live) setLive(i);
      }}
      onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.y)}
      onScrollEndDrag={(e) => settle(e.nativeEvent.contentOffset.y)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Год"
      accessibilityValue={{ text: years[live] ?? "" }}
      style={{ width: 78, height: WHEEL_H }}
      contentContainerStyle={{ paddingVertical: PAD }}
    >
      {years.map((year, i) => {
        const active = i === live;
        return (
          <View key={year} style={{ height: ITEM_H, alignItems: "center", justifyContent: "center" }}>
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={{
                fontVariant: ["tabular-nums"],
                color: active ? t.ink : t.placeholder,
                fontWeight: active ? "600" : "400",
                fontSize: active ? 22 : 19,
              }}
            >
              {year}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

export function DateSpinner({ value, minimumDate, maximumDate, onChange }: DateSpinnerProps) {
  const year = value.getFullYear();
  const month = value.getMonth();
  const day = value.getDate();

  // ДИАПАЗОН ЛЕТ — ОДИН НА ВСЁ ОТКРЫТИЕ. Собранный вокруг ТЕКУЩЕГО года, он
  // сдвигался на каждом выборе прямо во время довода ленты: тянули на год,
  // под линией вставал другой, а сохранялся третий (поймано на эмуляторе).
  const [openYear] = useState(year);
  const minTime = minimumDate?.getTime();
  const maxTime = maximumDate?.getTime();
  const years = useMemo(() => {
    const minY = minTime != null ? new Date(minTime).getFullYear() : openYear - 100;
    const maxY = maxTime != null ? new Date(maxTime).getFullYear() : openYear + 10;
    const list: string[] = [];
    // Значение всегда есть в ленте: дата вне границ приезжает из старых
    // данных, и выкинуть её из барабана значит молча подменить ответ человека.
    for (let y = Math.min(minY, openYear); y <= Math.max(maxY, openYear); y += 1) list.push(String(y));
    return list;
  }, [minTime, maxTime, openYear]);
  const days = Array.from({ length: daysInMonth(year, month) }, (_, i) => String(i + 1));

  // Каждая колонка правит СВОЁ поле поверх самой свежей даты: две колонки,
  // докрученные почти разом, иначе откатывают друг друга (как у веба).
  const latest = useRef(value);
  latest.current = value;

  const commit = (part: { year?: number; month?: number; day?: number }) => {
    const cur = latest.current;
    const y = part.year ?? cur.getFullYear();
    const m = part.month ?? cur.getMonth();
    const d = part.day ?? cur.getDate();
    let next = new Date(y, m, Math.min(d, daysInMonth(y, m)));
    if (minimumDate && next < startOfDay(minimumDate)) next = startOfDay(minimumDate);
    if (maximumDate && next > startOfDay(maximumDate)) next = startOfDay(maximumDate);
    if (next.getTime() !== startOfDay(cur).getTime()) {
      latest.current = next;
      onChange(next);
    }
  };

  return (
    <View style={{ alignItems: "center", paddingVertical: 8 }}>
      <WheelWithLines>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <LoopWheelColumn
            items={days}
            value={day - 1}
            onChange={(i) => commit({ day: i + 1 })}
            accessibilityLabel="День"
            width={58}
            fontSize={22}
          />
          <LoopWheelColumn
            items={MONTHS}
            value={month}
            onChange={(i) => commit({ month: i })}
            accessibilityLabel="Месяц"
            width={124}
            fontSize={19}
          />
          <YearColumn
            years={years}
            index={Math.max(0, years.indexOf(String(year)))}
            onPick={(i) => commit({ year: Number(years[i]) })}
          />
        </View>
      </WheelWithLines>
    </View>
  );
}
