import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// Барабан времени — крупная активная цифра, соседи тише, линии среза по
// центральному ряду (вид портирован 1:1 из веб-TimeWheels). Правки вида — только
// здесь: этим барабаном время выбирают ВСЕ поверхности продукта (часы
// календаря, лист слота, попап времени записи).
//
// КОНЕЧНОГО БАРАБАНА БОЛЬШЕ НЕТ. `WheelColumn` (упирался в край списка) и его
// `HOURS` удалены 2026-08-17, когда последние два вызывающих переехали на
// `TimeWheelPair`: держать рядом два барабана с разным поведением у края
// значит иметь два разных ответа на один жест.

// wheel geometry (= web TimeWheels)
export const ITEM_H = 40;
export const VISIBLE_ROWS = 3;
export const COLUMN_W = 58;
const DIGIT_FONT = 26;
export const WHEEL_H = ITEM_H * VISIBLE_ROWS;
export const PAD = (WHEEL_H - ITEM_H) / 2;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Шаг минут во ВСЕХ барабанах продукта. Пятиминутка — владелец 2026-08-17:
 *  «минуты должны быть в пятиминутку — 00, 05, 10, 15, 20». */
export const MINUTE_STEP = 5;
export const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) =>
  pad2(i * MINUTE_STEP),
);

function WheelWithLines({ children }: { children: React.ReactNode }) {
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
}) {
  const t = useThemeColors();
  const ref = useRef<ScrollView>(null);
  const len = items.length;
  const mid = Math.floor(REPS / 2) * len;
  /** Абсолютный индекс в повторённой ленте — только для крупной цифры. */
  const [live, setLive] = useState(mid + value);
  // Правку ИЗВНЕ не путаем с прокруткой пальцем: докрут уже поставил ленту на
  // место, и повторный `scrollTo` дёрнул бы её под рукой. Стартовое −1 —
  // намеренно недостижимый индекс, поэтому на монтировании эффект СРАБОТАЕТ и
  // поставит ленту на ЦЕНТРАЛЬНУЮ копию: без этого кольцо крутится только вниз.
  const settledRef = useRef(-1);

  useEffect(() => {
    if (settledRef.current === value) return;
    settledRef.current = value;
    setLive(mid + value);
    const id = requestAnimationFrame(() =>
      ref.current?.scrollTo({ y: (mid + value) * ITEM_H, animated: false }),
    );
    return () => cancelAnimationFrame(id);
  }, [value, mid]);

  const norm = (i: number) => ((i % len) + len) % len;
  const idxAt = (y: number) => Math.round(y / ITEM_H);

  /** Запас хода, внутри которого лента НЕ переставляется: по целой копии
   *  цикла вверх и вниз от центра (при REPS = 7 это три копии в каждую
   *  сторону — столько одним жестом не проехать). */
  const SAFE_LO = len;
  const SAFE_HI = (REPS - 1) * len;

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
    if (recenter && (absolute < SAFE_LO || absolute >= SAFE_HI)) {
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
      style={{ width, height: WHEEL_H }}
      contentContainerStyle={{ paddingVertical: PAD }}
    >
      {Array.from({ length: REPS * len }, (_, i) => {
        const active = i === live;
        return (
          <View
            key={i}
            style={{ height: ITEM_H, alignItems: "center", justifyContent: "center" }}
          >
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
          </View>
        );
      })}
    </ScrollView>
  );
}

/**
 * ВРЕМЯ = ДВА ЗАКОЛЬЦОВАННЫХ БАРАБАНА «ЧЧ : ММ». Канонический контрол времени
 * продукта: часы отдельно, минуты пятиминутками, между ними немое двоеточие.
 *
 * `maxHour = 24` нужен ГРАНИЦЕ-КОНЦУ: «до 24:00» — это конец суток, и выразить
 * его часами 00…23 нельзя. У часа 24 минуты всегда 00 (1440-й минуты в сутках
 * не существует), поэтому барабан минут на этом часе стоит на нуле и молчит.
 *
 * ПОЛОВИНЫ КОММИТЯТСЯ ПОРОЗНЬ — `onChangeHour` и `onChangeMinute`, а не один
 * коллбэк с готовой парой. Причина не в стиле: колонка знает соседнее значение
 * только по своему пропу, и когда два коммита попадают в ОДИН батч React,
 * собранное «ЧЧ:ММ» уносит устаревшую половину. Этот баг здесь уже был —
 * см. историю `BookSlotSheet`. Разделив коллбэки, каждый вызывающий пишет свою
 * половину от ПРЕДЫДУЩЕГО состояния и потерять сосед не может.
 */
export function TimeWheelPair({
  hour,
  minute,
  onChangeHour,
  onChangeMinute,
  labelPrefix,
  maxHour = 23,
  activeColor,
  accessibilityValueSuffix,
  units,
}: {
  hour: number;
  minute: number;
  onChangeHour: (hour: number) => void;
  onChangeMinute: (minute: number) => void;
  /** Начало озвучки: «Начало, часы» / «Конец, минуты». */
  labelPrefix: string;
  maxHour?: 23 | 24;
  /** Цвет активной цифры — «вне рабочих часов» красит выбранное время амбером. */
  activeColor?: string;
  /** Суффикс озвучки состояния («, вне рабочих часов»). */
  accessibilityValueSuffix?: string;
  /** ПОДПИСИ «ч» и «мин» ПОД КОЛОНКАМИ. Нужны там, где барабан задаёт
   *  ДЛИТЕЛЬНОСТЬ: «00 : 30» в листе про цены честно читается как полпервого
   *  ночи. Там, где крутят ВРЕМЯ СУТОК (начало приёма, часы календаря),
   *  подписи не нужны — двоеточие там и означает часы суток. */
  units?: boolean;
}) {
  const t = useThemeColors();
  const hours = Array.from({ length: maxHour + 1 }, (_, i) => pad2(i));
  const endOfDay = hour >= 24;
  const wheels = (
    <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center" }}>
      <WheelWithLines>
        <LoopWheelColumn
          items={hours}
          value={Math.min(hour, maxHour)}
          onChange={onChangeHour}
          accessibilityLabel={`${labelPrefix}, часы`}
          activeColor={activeColor}
          accessibilityValueSuffix={accessibilityValueSuffix}
        />
      </WheelWithLines>
      <Text
        // Двоеточие декоративно: VoiceOver читает барабаны, а не разделитель.
        accessible={false}
        importantForAccessibility="no"
        maxFontSizeMultiplier={1.2}
        style={{
          fontSize: DIGIT_FONT,
          fontWeight: "300",
          color: t.chevron,
          paddingHorizontal: 2,
        }}
      >
        :
      </Text>
      <WheelWithLines>
        <LoopWheelColumn
          items={MINUTES}
          value={endOfDay ? 0 : Math.round(minute / MINUTE_STEP) % MINUTES.length}
          onChange={(i) => {
            // Конец суток минут не имеет: крутить их здесь нечего, и молча
            // превращать 24:00 в 24:35 нельзя.
            if (endOfDay) return;
            onChangeMinute(i * MINUTE_STEP);
          }}
          accessibilityLabel={`${labelPrefix}, минуты`}
          activeColor={endOfDay ? t.placeholder : activeColor}
          accessibilityValueSuffix={accessibilityValueSuffix}
        />
      </WheelWithLines>
    </View>
  );

  if (!units) return wheels;
  return (
    <View style={{ alignItems: "center" }}>
      {wheels}
      <View
        // Декорация: сами величины уже названы в озвучке колонок.
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={{ flexDirection: "row", justifyContent: "center", marginTop: 2 }}
      >
        <UnitCaption text="ч" />
        <View style={{ width: 18 }} />
        <UnitCaption text="мин" />
      </View>
    </View>
  );
}

function UnitCaption({ text }: { text: string }) {
  const t = useThemeColors();
  return (
    <Text
      maxFontSizeMultiplier={1.2}
      style={{
        width: 56,
        textAlign: "center",
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 0.4,
        color: t.faint,
      }}
    >
      {text}
    </Text>
  );
}

/**
 * ПАРА ГРАНИЦ «С … До …» — сегмент плюс барабаны активной стороны.
 *
 * Четыре барабана разом на телефон не влезают и читаются как приборная панель,
 * поэтому крутится одна граница, а вторая ждёт своей вкладки. Диалект взят у
 * «Своего периода» финансов: сегмент сверху ПОКАЗЫВАЕТ обе величины, так что
 * пара видна целиком всегда, даже когда правится половина.
 *
 * `side` живёт внутри: это состояние КОНТРОЛА, а не данных, и вызывающему знать
 * о нём нечего. `key` на барабанах по стороне — лента должна пересобраться на
 * новом значении, а не доезжать до него анимацией с чужого места.
 */
export function TimeRangePicker({
  start,
  end,
  onChangeStart,
  onChangeEnd,
  labels = { start: "Начало", end: "Конец" },
  allowEndOfDay = true,
}: {
  start: { hour: number; minute: number };
  end: { hour: number; minute: number };
  onChangeStart: (patch: { hour?: number; minute?: number }) => void;
  onChangeEnd: (patch: { hour?: number; minute?: number }) => void;
  /** Ярлыки половин. По умолчанию «Начало»/«Конец» — ОДИН язык на продукт:
   *  «С»/«До» жили только здесь и рядом с графиком дня читались как другой
   *  контрол (владелец 2026-08-17: «сделай тут не „с/до", а начало-конец, то же
   *  самое, как и там»). Переопределяют их только там, где половины принадлежат
   *  не смене: «Перерыв с»/«Перерыв до». */
  labels?: { start: string; end: string };
  /** Конец умеет быть 24:00 (окно календаря). У смены дня — нет: рабочий день
   *  заканчивается часом суток, а не их концом. */
  allowEndOfDay?: boolean;
}) {
  const t = useThemeColors();
  const [side, setSide] = useState<"start" | "end">("start");
  const active = side === "start" ? start : end;

  const segment = (
    key: "start" | "end",
    label: string,
    v: { hour: number; minute: number },
  ) => {
    const on = side === key;
    return (
      <Pressable
        key={key}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${label}: ${pad2(v.hour)}:${pad2(v.minute)}`}
        onPress={() => {
          haptics.tap();
          setSide(key);
        }}
        style={{
          flex: 1,
          minHeight: 48,
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: 4,
          borderRadius: t.radius.card - 4,
          backgroundColor: on ? t.surface : "transparent",
        }}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            fontSize: 11,
            fontWeight: "600",
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: on ? t.accent : t.faint,
          }}
        >
          {label}
        </Text>
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            fontSize: 15,
            fontWeight: "600",
            color: t.ink,
            fontVariant: ["tabular-nums"],
          }}
        >
          {`${pad2(v.hour)}:${pad2(v.minute)}`}
        </Text>
      </Pressable>
    );
  };

  return (
    <View>
      <View
        style={{
          flexDirection: "row",
          gap: 4,
          padding: 4,
          marginBottom: 12,
          backgroundColor: t.fill,
          borderRadius: t.radius.card,
        }}
      >
        {segment("start", labels.start, start)}
        {segment("end", labels.end, end)}
      </View>
      <TimeWheelPair
        key={side}
        hour={active.hour}
        minute={active.minute}
        onChangeHour={(hour) =>
          side === "start" ? onChangeStart({ hour }) : onChangeEnd({ hour })
        }
        onChangeMinute={(minute) =>
          side === "start" ? onChangeStart({ minute }) : onChangeEnd({ minute })
        }
        labelPrefix={side === "start" ? labels.start : labels.end}
        maxHour={side === "end" && allowEndOfDay ? 24 : 23}
      />
    </View>
  );
}
