import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import {
  Gesture,
  GestureDetector,
  // Горизонтальный трек обязан быть RNGH-ScrollView: только он корректно
  // договаривается с long-press-паном штриха (флик = скролл, удержание =
  // штрих, активация пана отменяет скролл).
  ScrollView,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { haptics } from "@/lib/haptics";
import type { PeriodMonth, PeriodValue } from "./filter";

// «Лента времени» v2 — сигнатурный контрол периода («Оттиск + Лента»,
// доработка по владельцу 2026-07-24: «чтоб я мог сам листать» +
// просторные подписи). Горизонтально ЛИСТАЕМЫЙ трек 24 месяцев:
// колонки фиксированной ширины 52pt с гравюрой плотности записей,
// лента открывается у текущего месяца, флик — в прошлое (нативная
// инерция, ощущение тумблера). ТАП по колонке = весь месяц;
// УДЕРЖАНИЕ + протяжка = диапазон месяцев (хаптик на активации и на
// каждой границе, на время штриха скролл замирает); повторный тап по
// единственному выбранному месяцу = «Всё время». Выбор = ink-оттиск
// #0B1220 с белой гравюрой (две плоскости с клипом — грамматика листа).
// Точные дни — колёса С–До по тапу на значение в заголовке секции.

const INK = "#0B1220";
const TRACK_H = 56;
const COL_W = 52;
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

  const maxCount = Math.max(1, ...months.map((m) => m.count));
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

  const tapAt = (x: number) => {
    haptics.tap();
    const i = colAt(x);
    // Повторный тап по единственному выбранному месяцу — «Всё время».
    if (selection && selection[0] === i && selection[1] === i) {
      onChange(null);
      return;
    }
    onChange({ preset: "custom", from: months[i].from, to: months[i].to });
  };

  const strokeBegin = () => {
    setStroking(true);
    haptics.tap();
  };
  const strokeEnd = () => setStroking(false);
  const hapticTick = () => haptics.tap();

  // Удержание 220мс включает штрих (флик без удержания = нативный скролл).
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
      panning.value = false;
      runOnJS(strokeEnd)();
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
    months.map((m) => {
      const isNow = m.key === nowKey;
      const barH = 4 + (m.count / maxCount) * 22;
      return (
        <View
          key={m.key}
          style={{
            width: COL_W,
            alignItems: "center",
            justifyContent: "flex-end",
            paddingBottom: 7,
          }}
        >
          {m.yearMark ? (
            <Text
              style={{
                position: "absolute",
                top: 6,
                fontSize: 9,
                fontWeight: "600",
                fontVariant: ["tabular-nums"],
                color: onInk ? "rgba(255,255,255,0.72)" : "rgba(11,18,32,0.4)",
              }}
            >
              {m.yearMark}
            </Text>
          ) : null}
          <View
            style={{
              width: 16,
              height: barH,
              borderRadius: 2,
              marginBottom: 5,
              backgroundColor: onInk
                ? "rgba(255,255,255,0.62)"
                : "rgba(11,18,32,0.18)",
            }}
          />
          <Text
            style={{
              fontSize: 11,
              fontWeight: isNow ? "700" : "500",
              letterSpacing: 0.2,
              color: onInk
                ? "#FFFFFF"
                : isNow
                  ? "rgba(11,18,32,0.85)"
                  : "rgba(11,18,32,0.48)",
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
            accessibilityHint="Тап — месяц, удержание с протяжкой — диапазон"
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
            {/* Базовая линия гравюры — волосок над подписями. */}
            <View
              style={{
                position: "absolute",
                left: PAD,
                width: contentW - PAD * 2,
                bottom: 24,
                height: 1,
                backgroundColor: "rgba(11,18,32,0.08)",
              }}
            />
            {/* Нижняя плоскость: гравюра в покое. */}
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
