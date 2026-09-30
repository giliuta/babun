import { useEffect, useRef } from "react";
import type { DateSpinnerProps } from "./DateSpinner";

// ВЕБ-ДВОЙНИК БАРАБАНА ДАТЫ — ТРИ КОЛЕСА, КАК НА ТЕЛЕФОНЕ.
//
// Владелец 21.09, глядя на выгруженную дизайн-систему: «выбор дня рождения
// нужно сделать так, как у нас выбирается день, месяц и год, то есть
// тумблерами — это неправильно, как это сделано». Раньше шторка выбора даты
// на вебе показывала `<input type="date">` — поле браузера вместо барабана.
//
// ПОЧЕМУ НЕ `LoopWheelColumn`. Барабан времени зациклен и живёт на
// `onMomentumScrollEnd`/`snapToInterval` — событиях, которые react-native-web
// эмулирует по-своему. У ДАТЫ кольцо к тому же вредно: год не сосед сам себе,
// а «31 декабря → 1 января» прокруткой вверх — ложь о порядке. Поэтому здесь
// обычная прокрутка браузера с CSS-привязкой (`scroll-snap`): физику держит
// сам браузер, а мы только считываем, на какой строке она остановилась.
//
// ГЕОМЕТРИЯ ТА ЖЕ, что у колеса времени (`TimeWheel.tsx`): строка 40, видно
// три, две линии среза вокруг середины. Иначе выбор даты и выбор времени в
// одном продукте — две разные механики с разным лицом.

const ITEM_H = 40;
const ROWS = 3;
const WHEEL_H = ITEM_H * ROWS;
const PAD = (WHEEL_H - ITEM_H) / 2;
const HAIRLINE = "rgba(11,18,32,0.12)";
const INK = "#0b1220";
const MUTED = "rgba(11,18,32,0.45)";
const CLS = "babun-date-wheel";

/** Месяц в родительном падеже: барабан читается как дата целиком —
 *  «14 · марта · 1987», а не как три несвязанных слова. */
const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function Column({
  items,
  index,
  onPick,
  width,
  label,
}: {
  items: string[];
  index: number;
  onPick: (next: number) => void;
  width: number;
  label: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  /** До этого момента прокрутку не слушаем: её вызвали мы сами, поставив
   *  ленту на новое значение. Без этого правка одной колонки (31 марта → 30
   *  апреля) прилетала бы обратно как «человек выбрал 30». */
  const quietUntil = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const top = index * ITEM_H;
    if (Math.abs(el.scrollTop - top) < 1) return;
    quietUntil.current = Date.now() + 260;
    el.scrollTop = top;
  }, [index, items.length]);

  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current);
  }, []);

  return (
    <div
      ref={ref}
      className={CLS}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onScroll={() => {
        if (Date.now() < quietUntil.current) return;
        if (settle.current) clearTimeout(settle.current);
        // Прокрутка кончилась, когда она замолчала: у браузера нет события
        // «лента доехала и встала», а привязка доводит ленту сама.
        settle.current = setTimeout(() => {
          const el = ref.current;
          if (!el) return;
          const next = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_H)));
          if (next !== index) onPick(next);
        }, 120);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" && index < items.length - 1) onPick(index + 1);
        if (e.key === "ArrowUp" && index > 0) onPick(index - 1);
      }}
      style={{
        height: WHEEL_H,
        width,
        overflowY: "auto",
        scrollSnapType: "y mandatory",
        paddingTop: PAD,
        paddingBottom: PAD,
        outline: "none",
      }}
    >
      {items.map((item, i) => (
        <div
          key={item}
          aria-selected={i === index}
          role="option"
          style={{
            height: ITEM_H,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            scrollSnapAlign: "center",
            fontSize: i === index ? 22 : 19,
            fontWeight: i === index ? 600 : 400,
            color: i === index ? INK : MUTED,
            whiteSpace: "nowrap",
          }}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

export function DateSpinner({ value, minimumDate, maximumDate, onChange }: DateSpinnerProps) {
  const year = value.getFullYear();
  const month = value.getMonth();
  const day = value.getDate();

  const minY = minimumDate ? minimumDate.getFullYear() : Math.min(year - 100, year);
  const maxY = maximumDate ? maximumDate.getFullYear() : Math.max(year + 10, year);
  const years: string[] = [];
  // Значение всегда есть в ленте: дата вне границ приезжает из старых данных,
  // и выкинуть её из барабана значит молча подменить ответ человека.
  for (let y = Math.min(minY, year); y <= Math.max(maxY, year); y += 1) years.push(String(y));
  const days = Array.from({ length: daysInMonth(year, month) }, (_, i) => String(i + 1));

  // Каждая колонка правит СВОЁ поле поверх САМОЙ СВЕЖЕЙ даты, а не поверх той,
  // что была на её отрисовке. Две колонки, докрутившиеся почти одновременно,
  // иначе отменяют друг друга: вторая кладёт своё поле на устаревшие соседние
  // и откатывает первую (поймано опытом — день и месяц крутанули разом, день
  // вернулся обратно).
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
    <div
      style={{
        position: "relative",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        gap: 4,
        padding: "8px 0",
      }}
    >
      {/* Полосы прокрутки в барабане — лишняя графика: физику показывает сама
          лента. Псевдоэлемент инлайновым стилем не задать, поэтому правило. */}
      <style>{`.${CLS}{scrollbar-width:none;-ms-overflow-style:none}.${CLS}::-webkit-scrollbar{display:none}`}</style>
      <Column
        label="День"
        width={58}
        items={days}
        index={day - 1}
        onPick={(i) => commit({ day: i + 1 })}
      />
      <Column
        label="Месяц"
        width={116}
        items={MONTHS}
        index={month}
        onPick={(i) => commit({ month: i })}
      />
      <Column
        label="Год"
        width={78}
        items={years}
        index={years.indexOf(String(year))}
        onPick={(i) => commit({ year: Number(years[i]) })}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: PAD + 8,
          height: 1,
          background: HAIRLINE,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: PAD + ITEM_H + 7,
          height: 1,
          background: HAIRLINE,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
