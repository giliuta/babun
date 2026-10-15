import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { LoopWheelColumn, WheelWithLines } from "./time-wheel/LoopWheelColumn";
import { DIGIT_FONT, MINUTES, MINUTE_STEP, pad2 } from "./time-wheel/wheel-geometry";

// Барабан времени — крупная активная цифра, соседи тише, линии среза по
// центральному ряду (вид портирован 1:1 из веб-TimeWheels). Правки вида — только
// здесь: этим барабаном время выбирают ВСЕ поверхности продукта (часы
// календаря, лист слота, попап времени записи).
//
// КОНЕЧНОГО БАРАБАНА БОЛЬШЕ НЕТ. `WheelColumn` (упирался в край списка) и его
// `HOURS` удалены 2026-08-17, когда последние два вызывающих переехали на
// `TimeWheelPair`: держать рядом два барабана с разным поведением у края
// значит иметь два разных ответа на один жест.
//
// Геометрия и арифметика кольца — `time-wheel/wheel-geometry.ts`, сама
// колонка — `time-wheel/LoopWheelColumn.tsx`.

export {
  COLUMN_W,
  ITEM_H,
  MINUTES,
  MINUTE_STEP,
  PAD,
  VISIBLE_ROWS,
  WHEEL_H,
} from "./time-wheel/wheel-geometry";
export { LoopWheelColumn, WheelWithLines } from "./time-wheel/LoopWheelColumn";

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
  singleSide = false,
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
  /** Половина одна: у операции время — момент, а не отрезок, и переключать
   *  нечего. Сегмент прячется, барабаны остаются те же. */
  singleSide?: boolean;
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
      {/* Половина одна — переключать нечего, и сегмент был бы контролом без
          назначения (владелец 2026-09-09: время операции — момент). */}
      {singleSide ? null : (
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
      )}
      <TimeWheelPair
        key={singleSide ? "start" : side}
        hour={singleSide ? start.hour : active.hour}
        minute={singleSide ? start.minute : active.minute}
        onChangeHour={(hour) =>
          side === "start" || singleSide
            ? onChangeStart({ hour })
            : onChangeEnd({ hour })
        }
        onChangeMinute={(minute) =>
          side === "start" || singleSide
            ? onChangeStart({ minute })
            : onChangeEnd({ minute })
        }
        labelPrefix={singleSide || side === "start" ? labels.start : labels.end}
        maxHour={!singleSide && side === "end" && allowEndOfDay ? 24 : 23}
      />
    </View>
  );
}
