import { useEffect, useRef, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";
import {
  COLUMN_W,
  DIGIT_FONT,
  ITEM_H,
  PAD,
  VISIBLE_ROWS,
  outsideSafeRange,
  rowAt,
  wrapIndex,
} from "./wheel-geometry";

export function WheelWithLines({ children }: { children: ReactNode }) {
  return (
    <View style={{ position: "relative" }}>
      {children}
      <View
        pointerEvents="none"
        style={{ position: "absolute", left: 2, right: 2, top: PAD, height: 1, backgroundColor: "rgba(11,18,32,0.12)" }}
      />
      <View
        pointerEvents="none"
        style={{ position: "absolute", left: 2, right: 2, top: PAD + ITEM_H - 1, height: 1, backgroundColor: "rgba(11,18,32,0.12)" }}
      />
    </View>
  );
}

// ─── ЗАКОЛЬЦОВАННЫЙ БАРАБАН — КАНОНИЧЕСКИЙ ВЫБОР ВРЕМЕНИ ─────────────
//
// Владелец 2026-08-17: «не по списку, а именно тумблер: отдельно кручу часы,
// отдельно минуты, минуты в пятиминутку; когда дохожу до 24 — он продолжает
// дальше, до одного, двух, трёх. Зафиксировать в правилах, чтобы и в других
// настройках была такая же структура».
//
// ПОЧЕМУ ЗАКОЛЬЦОВАН. Конечный барабан упирается в край, и «поставить 01:00»
// с 23:00 стоит прокрутки через все сутки вверх. У кольца оба соседа 23:00 —
// это 22:00 и 00:00, поэтому граница смены ставится одним движением в любую
// сторону.
//
// КАК СДЕЛАНО КОЛЬЦО. RN `ScrollView` бесконечным быть не умеет, поэтому
// список повторён `REPS` раз, а после КАЖДОГО докрута лента молча
// переставляется на центральную копию: под линией среза стоит та же цифра,
// прыжок не виден, а запас хода снова полон в обе стороны. Первая версия
// пробовала переставлять только у кромки — на быстром флике лента успевала
// проскочить край и вставала в пустоту.
const REPS = 7;

export function LoopWheelColumn({
  items,
  value,
  onChange,
  accessibilityLabel,
  activeColor,
  accessibilityValueSuffix,
  width = COLUMN_W,
  fontSize,
  rows = VISIBLE_ROWS,
  renderItem,
}: {
  /** ОДИН цикл значений: 24 часа, 12 пятиминуток либо 59 часовых поясов. */
  items: string[];
  /** Индекс внутри цикла (0…items.length−1). */
  value: number;
  onChange: (idx: number) => void;
  accessibilityLabel: string;
  activeColor?: string;
  /** Суффикс к accessibilityValue («, вне рабочих часов») — VoiceOver обязан
   *  слышать состояние, а не только видеть цвет. */
  accessibilityValueSuffix?: string;
  /** Ширина колонки. Цифрам хватает узкой, названию пояса — нет. */
  width?: number;
  /** Кегль активной строки. Цифры крупные; словам такой кегль не по ширине. */
  fontSize?: number;
  /** Сколько строк видно разом. Трёх хватает часам и минутам — там значения
   *  известны наперёд. Длинному набору нужен обзор: у часовых поясов их 61,
   *  и по трём строкам не понять, куда крутить (владелец 2026-08-27: «около
   *  шести… или из семи: три сверху, три снизу и посередине одна»). */
  rows?: number;
  /** Своя разметка строки вместо простого текста. Нужна там, где в строке
   *  ДВА разных по важности куска: у часового пояса это город (главное) и
   *  смещение (справка). Одним кеглем они спорят, и строка читается как
   *  сплошная надпись. `items` при этом остаются строками — их произносит
   *  VoiceOver. */
  renderItem?: (item: string, active: boolean, index: number) => ReactNode;
}) {
  const t = useThemeColors();
  const ref = useRef<ScrollView>(null);
  // Геометрия своя у каждого экземпляра: высота — целое число строк, отступ
  // сверху и снизу — ровно половина остатка, иначе выбранная строка встаёт
  // не по центру и линия среза врёт.
  const wheelH = ITEM_H * rows;
  const pad = (wheelH - ITEM_H) / 2;
  const len = items.length;
  const mid = Math.floor(REPS / 2) * len;
  /** Абсолютный индекс в повторённой ленте — только для крупной цифры. */
  const [live, setLive] = useState(mid + value);
  // Правку ИЗВНЕ не путаем с прокруткой пальцем: докрут уже поставил ленту на
  // место, и повторный `scrollTo` дёрнул бы её под рукой. Стартовое −1 —
  // намеренно недостижимый индекс, поэтому на монтировании эффект СРАБОТАЕТ и
  // поставит ленту на ЦЕНТРАЛЬНУЮ копию: без этого кольцо крутится только вниз.
  const settledRef = useRef(-1);
  // Длина цикла тоже двигает ленту: у дня в барабане даты она меняется с
  // месяцем (31 → 28), центральная копия съезжает, и без перестановки под
  // линией стояло другое число, чем в значении (13.10).
  const settledMid = useRef(mid);

  useEffect(() => {
    if (settledRef.current === value && settledMid.current === mid) return;
    settledRef.current = value;
    settledMid.current = mid;
    setLive(mid + value);
    const id = requestAnimationFrame(() =>
      ref.current?.scrollTo({ y: (mid + value) * ITEM_H, animated: false }),
    );
    return () => cancelAnimationFrame(id);
  }, [value, mid]);

  const norm = (i: number) => wrapIndex(i, len);
  const idxAt = rowAt;

  /**
   * Докрут: запомнить выбранное значение.
   *
   * `recenter` СТАВИТСЯ ТОЛЬКО ПО КОНЦУ ИНЕРЦИИ, и это не мелочь. Первая
   * версия переставляла ленту и на конце ПЕРЕТАСКИВАНИЯ — то есть пока
   * инерция ещё живёт. `scrollTo` посреди инерции драки не выигрывает: лента
   * доезжает на строку назад, а значение уже ушло наружу, и барабан показывал
   * «30» под линией, сохранив «35». Поймано на живом симуляторе 2026-08-17.
   */
  const settle = (y: number, recenter: boolean) => {
    const absolute = idxAt(y);
    const picked = norm(absolute);
    settledRef.current = picked;
    setLive(mid + picked);
    // Переставляем только когда лента уехала из запаса хода: цифра под линией
    // при этом не меняется, поэтому переезда не видно.
    if (recenter && outsideSafeRange(absolute, len, REPS)) {
      ref.current?.scrollTo({ y: (mid + picked) * ITEM_H, animated: false });
    }
    if (picked !== value) onChange(picked);
  };

  const adjust = (delta: number) => {
    const next = norm(value + delta);
    settledRef.current = next;
    setLive(mid + next);
    ref.current?.scrollTo({ y: (mid + next) * ITEM_H, animated: true });
    onChange(next);
  };

  return (
    <ScrollView
      ref={ref}
      // ANDROID: колесо стоит в прокручиваемой шторке (форма услуги, тип
      // события, график команды). Без этого внешняя прокрутка забирала
      // вертикальный жест, и барабан не крутился — крутился весь лист (13.10).
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_H}
      decelerationRate="fast"
      scrollEventThrottle={16}
      onScroll={(e) => {
        const i = idxAt(e.nativeEvent.contentOffset.y);
        if (i !== live) setLive(i);
      }}
      // Оба события нужны: быстрый флик заканчивается momentum-end, медленное
      // перетаскивание без инерции — drag-end (momentum тогда не стреляет).
      // Переставлять ленту вправе только первый: см. `settle`.
      onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.y, true)}
      onScrollEndDrag={(e) => settle(e.nativeEvent.contentOffset.y, false)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{
        text: (items[norm(live)] ?? "") + (accessibilityValueSuffix ?? ""),
      }}
      accessibilityActions={[
        { name: "increment", label: "Увеличить" },
        { name: "decrement", label: "Уменьшить" },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment") adjust(1);
        if (event.nativeEvent.actionName === "decrement") adjust(-1);
      }}
      style={{ width, height: wheelH }}
      contentContainerStyle={{ paddingVertical: pad }}
    >
      {Array.from({ length: REPS * len }, (_, i) => {
        const active = i === live;
        return (
          <View
            key={i}
            style={{ height: ITEM_H, alignItems: "center", justifyContent: "center" }}
          >
            {renderItem ? (
              renderItem(items[norm(i)] ?? "", active, norm(i))
            ) : (
              <Text
                // Кап 1.2: геометрия колеса фиксированная — цифры не должны
                // вырастать из своего ряда при AX-шрифтах.
                maxFontSizeMultiplier={1.2}
                numberOfLines={1}
                style={{
                  fontVariant: ["tabular-nums"],
                  color: active ? activeColor ?? t.ink : t.placeholder,
                  fontWeight: active ? "700" : "500",
                  fontSize: active
                    ? fontSize ?? DIGIT_FONT
                    : (fontSize ?? DIGIT_FONT) - 3,
                  paddingHorizontal: 8,
                }}
              >
                {items[norm(i)]}
              </Text>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}
