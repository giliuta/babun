import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StepSlider } from "@/components/ui/StepSlider";
import { useThemeColors } from "@/theme/colors";
import {
  ZOOM_PCT_STEP,
  zoomFromPct,
  zoomPctHint,
  zoomToPct,
  type GridZoom,
} from "@/features/calendar/grid-memory";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { TimeRangePicker } from "@/components/ui/TimeWheel";
import { haptics } from "@/lib/haptics";
import { FOOTER_SIDE } from "@/components/ui/tokens";

// Пара границ «С … До …» одним нижним листом — диалект «Своего периода»
// финансов (PeriodWheelsModal): сегмент С|До выбирает границу, ниже она
// крутится, «Применить» коммитит.
//
// ГРАНИЦА СТАВИТСЯ ДВУМЯ БАРАБАНАМИ, А НЕ СПИСКОМ: отдельно часы, отдельно
// минуты (с шагом в пять), кольцо идёт дальше 24. Список из 24 строк отвечал
// только на «который час» и не умел сказать «в половину девятого»: минуты в нём
// не существовали вовсе. Барабаны — `TimeWheelPair`, канонический контрол
// времени продукта; правки вида и поведения кольца — там, а не здесь.
//
// «АВТОМАТИЧЕСКИ» ЗДЕСЬ НЕТ: тумблер прятал пару часов за словом,
// которое не отвечало на вопрос «а с какого же часа видно сетку»: человек
// открывал лист, чтобы НАЗВАТЬ часы, и первым делом видел переключатель,
// который эти часы скрывал. Пара 00:00–24:00 — не сентинел, а ровно то, что
// написано: сутки целиком.

interface HourRangeValue {
  start: number;
  end: number;
  startMinute?: number;
  endMinute?: number;
}

/** Минуты суток — в них удобно сравнивать границы, и только в них. */
function toMin(h: number, m: number): number {
  return h * 60 + m;
}

export function HourRangeSheet({
  visible,
  title,
  value,
  allowEndOfDay,
  onClose,
  onApply,
  zoom,
  hoursEditable = true,
}: {
  visible: boolean;
  title: string;
  /** Текущая пара — читается буквально, включая минуты. */
  value: HourRangeValue;
  /** Конец умеет быть 24:00 — это про ОКНО календаря. У смены и у перерыва
   *  конец приходится на час суток, а не на их конец. */
  allowEndOfDay?: boolean;
  onClose: () => void;
  onApply: (v: {
    start: number;
    end: number;
    startMinute: number;
    endMinute: number;
  }) => void;
  /** МАСШТАБ ПРИ ОТКРЫТИИ (ползунок в процентах). Личный — телефона, не команды;
   *  `vh` — прошлый замер сетки. */
  zoom?: {
    initial: GridZoom | null;
    vh: number | null;
    onApply: (zoom: GridZoom) => void;
  };
  /** Часы команды менять нельзя — лист только с масштабом. */
  hoursEditable?: boolean;
}) {
  const t = useThemeColors();
  const [start, setStart] = useState({ hour: 8, minute: 0 });
  const [end, setEnd] = useState({ hour: 20, minute: 0 });
  // Окно, которое увидит сетка: часы наружу, как в `calendar/index` сетки.
  const span = Math.max(
    1,
    Math.ceil((end.hour * 60 + end.minute) / 60) - Math.floor((start.hour * 60 + start.minute) / 60),
  );
  const [pct, setPct] = useState(0);
  // Ползунок при открытии: масштаб пишется, только если его сдвинули.
  // Иначе каждое «Применить» переписывало личный масштаб округлённым до 5 %
  // (null по умолчанию становился явным и другим), а смена часов при том же
  // проценте меняла, сколько часов видно, — открытая сетка прыгала.
  const openedPct = useRef<number | null>(null);

  // Ресинк черновика — по фронту открытия (приём PeriodWheelsModal): рефетч
  // настроек не должен перескакивать границу, которую человек сейчас крутит.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setStart({ hour: value.start, minute: value.startMinute ?? 0 });
      setEnd({ hour: value.end, minute: value.endMinute ?? 0 });
      if (zoom) {
        const openSpan = Math.max(
          1,
          Math.ceil((value.end * 60 + (value.endMinute ?? 0)) / 60) -
            Math.floor((value.start * 60 + (value.startMinute ?? 0)) / 60),
        );
        const initialPct = zoomToPct(zoom.initial, openSpan, zoom.vh);
        openedPct.current = initialPct;
        setPct(initialPct);
      }
    }
    wasVisible.current = visible;
  }, [visible, value, zoom]);

  const apply = () => {
    haptics.tap();
    if (hoursEditable) {
      onApply({
        start: start.hour,
        end: end.hour,
        startMinute: start.minute,
        endMinute: end.minute,
      });
    }
    if (zoom && pct !== openedPct.current) zoom.onApply(zoomFromPct(pct, span, zoom.vh));
    onClose();
  };

  // КОНЕЦ ОБЯЗАН БЫТЬ ПОЗЖЕ НАЧАЛА, и правит это лист, а не отказ сервера
  // (в базе то же правило стоит проверкой `calendar_settings_window_order_check`).
  // Двигаем МИНИМАЛЬНО — на один шаг барабана, а не «на час вперёд»: человек
  // крутил начало, а не конец, и переписывать ему конец сильнее необходимого
  // значит отобрать уже сделанный выбор.
  //
  // Половины пишутся ФУНКЦИОНАЛЬНО и порознь (`TimeWheelPair` для этого и
  // разделяет коллбэки): два коммита в одном батче React иначе теряют соседнее
  // значение.
  const changeStart = (patch: { hour?: number; minute?: number }) => {
    setStart((prev) => {
      const next = { ...prev, ...patch };
      setEnd((prevEnd) => {
        if (toMin(next.hour, next.minute) < toMin(prevEnd.hour, prevEnd.minute)) {
          return prevEnd;
        }
        const bumped = Math.min(24 * 60, toMin(next.hour, next.minute) + 5);
        return bumped >= 24 * 60
          ? { hour: 24, minute: 0 }
          : { hour: Math.floor(bumped / 60), minute: bumped % 60 };
      });
      return next;
    });
  };

  const changeEnd = (patch: { hour?: number; minute?: number }) => {
    setEnd((prev) => {
      const next = { ...prev, ...patch };
      setStart((prevStart) => {
        if (toMin(next.hour, next.minute) > toMin(prevStart.hour, prevStart.minute)) {
          return prevStart;
        }
        const bumped = Math.max(0, toMin(next.hour, next.minute) - 5);
        return { hour: Math.floor(bumped / 60), minute: bumped % 60 };
      });
      return next;
    });
  };

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      title={title}
      footer={
        <View style={{ paddingHorizontal: FOOTER_SIDE }}>
          <Button label="Применить" onPress={apply} />
        </View>
      }
    >
      {hoursEditable ? (
        <View className="px-5 pb-4">
          <TimeRangePicker
            start={start}
            end={end}
            onChangeStart={changeStart}
            onChangeEnd={changeEnd}
            allowEndOfDay={allowEndOfDay}
          />
        </View>
      ) : null}
      {zoom ? (
        <View className="px-5 pb-4" style={{ paddingTop: hoursEditable ? 4 : 8 }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
              Масштаб при открытии
            </Text>
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 17, fontWeight: "700", color: t.accent, fontVariant: ["tabular-nums"] }}
            >
              {pct}%
            </Text>
          </View>
          <View style={{ marginTop: 6 }}>
            <StepSlider
              value={pct}
              min={0}
              max={100}
              step={ZOOM_PCT_STEP}
              onChange={setPct}
              accessibilityLabel="Масштаб при открытии"
            />
          </View>
          <Text maxFontSizeMultiplier={1.3} style={{ marginTop: 2, fontSize: 13, color: t.sub }}>
            {zoomPctHint(pct, span, zoom.vh)}
          </Text>
        </View>
      ) : null}
    </BottomSheet>
  );
}
