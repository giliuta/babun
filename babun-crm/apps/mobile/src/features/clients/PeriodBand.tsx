import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import {
  Gesture,
  GestureDetector,
  // Горизонтальный трек обязан быть RNGH-ScrollView: только он корректно
  // договаривается с жестами колонок (флик = скролл без конфликтов).
  ScrollView,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { haptics } from "@/lib/haptics";
import type { PeriodMonth, PeriodValue } from "./filter";

// «Лента времени» v3 — по владельцу 2026-07-24: БЕЗ «мишуры» (гравюра
// удалена — только чистые названия месяцев), годы чётко разделены
// (вертикальный волосок перед январём + подпись года над его группой),
// и ДИАПАЗОН ДВУМЯ ТАПАМИ: тап «Фев» = месяц, тап «Май» следом =
// «Февраль — Май» (одиночный выбор расширяется вторым тапом; тап при
// активном диапазоне начинает новый одиночный; повторный тап по
// одиночному = «Всё время»). Никаких удержаний — флик просто листает
// (24 месяца, открытие у текущего). Бонус для быстрой руки: удержание
// 220мс + протяжка по-прежнему рисует диапазон одним жестом. Выбор =
// ink-оттиск #0B1220 с белыми подписями (две плоскости с клипом).

const INK = "#0B1220";
const TRACK_H = 48;
const COL_W = 56;
const PAD = 6;

/** Индексы выбранных месяцев [i0, i1], если период точно совпадает с
 *  границами месяцев окна, иначе null (кастом с колёс — оттиск скрыт). */
function selectionFromPeriod(
  months: PeriodMonth[],
  period: PeriodValue | null,
): [number, number] | null {
  if (!period) return null;
  const i0 = months.findIndex((m) => m.from === period.from);
  const i1 = months.findIndex((m) => m.to === period.to);
  if (i0 < 0 || i1 < 0 || i1 < i0) return null;
  return [i0, i1];
}

export function PeriodBand({
  months,
  period,
  onChange,
}: {
  months: PeriodMonth[];
  period: PeriodValue | null;
  onChange: (p: PeriodValue | null) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  // Штрих замораживает нативный скролл — палец рисует диапазон.
  const [stroking, setStroking] = useState(false);

  const selection = selectionFromPeriod(months, period);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const contentW = PAD * 2 + months.length * COL_W;

  // Анимированное окно оттиска: границы в колонках (-1 = пусто).
  const selA = useSharedValue(-1);
  const selB = useSharedValue(-1);
  const panning = useSharedValue(false);

  useEffect(() => {
    if (panning.value) return;
    selA.value = selection ? selection[0] : -1;
    selB.value = selection ? selection[1] : -1;
  }, [selection, selA, selB, panning]);

  // Открываемся у текущего месяца (правый край окна).
  useEffect(() => {
    const id = setTimeout(
      () => scrollRef.current?.scrollToEnd({ animated: false }),
      0,
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nowKey = months[months.length - 1]?.key;

  const colAt = (x: number) =>
    Math.min(months.length - 1, Math.max(0, Math.floor((x - PAD) / COL_W)));

  const lastCommit = useRef(0);
  const commit = (a: number, b: number, final: boolean) => {
    const now = Date.now();
    if (!final && now - lastCommit.current < 100) return;
    lastCommit.current = now;
    const [i0, i1] = a <= b ? [a, b] : [b, a];
    onChange({ preset: "custom", from: months[i0].from, to: months[i1].to });
  };

  // Тап-грамматика диапазона («упрощённо», владелец): одиночный месяц
  // расширяется вторым тапом до диапазона; тап при активном диапазоне
  // начинает новый одиночный; повторный тап одиночного — «Всё время».
  const tapAt = (x: number) => {
    haptics.tap();
    const i = colAt(x);
    const sel = selectionRef.current;
    if (sel) {
      const [a, b] = sel;
      if (a === i && b === i) {
        onChange(null);
        return;
      }
      if (a === b) {
        const [i0, i1] = a <= i ? [a, i] : [i, a];
        onChange({
          preset: "custom",
          from: months[i0].from,
          to: months[i1].to,
        });
        return;
      }
    }
    onChange({ preset: "custom", from: months[i].from, to: months[i].to });
  };

  const strokeBegin = () => {
    setStroking(true);
    haptics.tap();
  };
  const strokeEnd = () => setStroking(false);
  const hapticTick = () => haptics.tap();

  // Бонус быстрой руки: удержание 220мс включает штрих одним жестом
  // (флик без удержания = нативный скролл).
  const pan = Gesture.Pan()
    .activateAfterLongPress(220)
    .onStart((e) => {
      "worklet";
      panning.value = true;
      const i = Math.min(
        months.length - 1,
        Math.max(0, Math.floor((e.x - PAD) / COL_W)),
      );
      selA.value = i;
      selB.value = i;
      runOnJS(strokeBegin)();
    })
    .onChange((e) => {
      "worklet";
      if (selA.value < 0) return;
      const i = Math.min(
        months.length - 1,
        Math.max(0, Math.floor((e.x - PAD) / COL_W)),
      );
      if (i !== selB.value) {
        selB.value = i;
        runOnJS(hapticTick)();
        runOnJS(commit)(selA.value, i, false);
      }
    })
    .onEnd(() => {
      "worklet";
      if (selA.value >= 0) runOnJS(commit)(selA.value, selB.value, true);
    })
    .onFinalize(() => {
      "worklet";
      panning.value = false;
      runOnJS(strokeEnd)();
    });

  const tap = Gesture.Tap().onEnd((e) => {
    "worklet";
    runOnJS(tapAt)(e.x);
  });

  const gesture = Gesture.Race(pan, tap);

  const bandStyle = useAnimatedStyle(() => {
    const a = selA.value;
    const b = selB.value;
    if (a < 0) return { opacity: 0, left: 0, width: 0 };
    const [i0, i1] = a <= b ? [a, b] : [b, a];
    return {
      opacity: 1,
      left: PAD + i0 * COL_W,
      width: (i1 - i0 + 1) * COL_W,
    };
  });
  // Белая плоскость едет внутри клипа в противофазе — колонки совпадают.
  const innerShift = useAnimatedStyle(() => {
    const a = selA.value;
    const b = selB.value;
    if (a < 0) return { transform: [{ translateX: 0 }] };
    const i0 = Math.min(a, b);
    return { transform: [{ translateX: -(PAD + i0 * COL_W) }] };
  });

  const columns = (onInk: boolean) =>
    months.map((m, idx) => {
      const isNow = m.key === nowKey;
      // Год подписывается над январём (и над первой колонкой окна).
      const showYear = m.isJanuary || idx === 0;
      return (
        <View
          key={m.key}
          style={{
            width: COL_W,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Волосок-граница года по левому краю января. */}
          {m.isJanuary && idx > 0 ? (
            <View
              style={{
                position: "absolute",
                left: 0,
                top: 6,
                bottom: 6,
                width: 1,
                backgroundColor: onInk
                  ? "rgba(255,255,255,0.35)"
                  : "rgba(11,18,32,0.14)",
              }}
            />
          ) : null}
          {showYear ? (
            <Text
              style={{
                position: "absolute",
                top: 5,
                fontSize: 9,
                fontWeight: "600",
                fontVariant: ["tabular-nums"],
                letterSpacing: 0.3,
                color: onInk ? "rgba(255,255,255,0.72)" : "rgba(11,18,32,0.4)",
              }}
            >
              {m.year}
            </Text>
          ) : null}
          <Text
            style={{
              marginTop: showYear ? 8 : 0,
              fontSize: 13,
              fontWeight: isNow ? "700" : "500",
              letterSpacing: 0.2,
              color: onInk
                ? "#FFFFFF"
                : isNow
                  ? "rgba(11,18,32,0.85)"
                  : "rgba(11,18,32,0.52)",
            }}
          >
            {m.label}
          </Text>
        </View>
      );
    });

  return (
    <View
      style={{
        height: TRACK_H,
        borderRadius: 14,
        backgroundColor: "rgba(11,18,32,0.04)",
        overflow: "hidden",
      }}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        scrollEnabled={!stroking}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ width: contentW }}
      >
        <GestureDetector gesture={gesture}>
          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Период по месяцам"
            accessibilityHint="Тап — месяц, второй тап — диапазон до него"
            onAccessibilityAction={(e) => {
              const cur = selection ? selection[0] : months.length - 1;
              const next =
                e.nativeEvent.actionName === "increment"
                  ? Math.min(months.length - 1, cur + 1)
                  : Math.max(0, cur - 1);
              onChange({
                preset: "custom",
                from: months[next].from,
                to: months[next].to,
              });
            }}
            accessibilityActions={[
              { name: "increment" },
              { name: "decrement" },
            ]}
            style={{ width: contentW, height: TRACK_H }}
          >
            {/* Нижняя плоскость: месяцы в покое. */}
            <View
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: PAD,
                flexDirection: "row",
              }}
            >
              {columns(false)}
            </View>
            {/* Оттиск: ink-окно + белая копия колонок в противофазе. */}
            <Animated.View
              style={[
                {
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  borderRadius: 12,
                  backgroundColor: INK,
                  overflow: "hidden",
                },
                bandStyle,
              ]}
            >
              <Animated.View
                style={[
                  {
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: PAD,
                    flexDirection: "row",
                  },
                  innerShift,
                ]}
              >
                {columns(true)}
              </Animated.View>
            </Animated.View>
          </View>
        </GestureDetector>
      </ScrollView>
    </View>
  );
}
