import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { haptics } from "@/lib/haptics";
import type { PeriodMonth, PeriodValue } from "./filter";

// «Лента времени» — сигнатурный контрол периода («Оттиск + Лента»,
// решение руководителя 2026-07-23). 12 месяцев одной строкой 48pt:
// каждая колонка несёт гравюру плотности записей (штрих ink 20%),
// ТАП по колонке = весь месяц, ГОРИЗОНТАЛЬНЫЙ штрих = диапазон месяцев
// (снап поколоночно, хаптик на границе), тап по уже выбранному
// одиночному месяцу = сброс во «Всё время». Выбор = ink-оттиск #0B1220
// (грамматика листа: выбранное печатается чёрным), внутри оттиска
// гравюра и подписи белые — реализовано двумя плоскостями: нижняя
// ink-версия + верхняя белая, клипнутая анимированным окном выбора.
// Точные дни и диапазоны старше окна живут в колёсах С–До (тап по
// значению в заголовке секции) — лента про месяцы, честно.

const INK = "#0B1220";
const TRACK_H = 48;
const PAD = 6; // внутренний отступ трека до первой/последней колонки

/** Индексы выбранных месяцев [i0, i1] если период точно совпадает с
 *  границами месяцев окна, иначе null (кастом с колёс — band скрыт). */
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
  const [width, setWidth] = useState(0);
  const colW = width > 0 ? (width - PAD * 2) / months.length : 0;

  const selection = selectionFromPeriod(months, period);

  // Анимированное окно выбора: границы в колонках (‑1 = пусто).
  const selA = useSharedValue(-1);
  const selB = useSharedValue(-1);
  // Во время штриха палец главнее внешнего состояния.
  const panning = useSharedValue(false);

  useEffect(() => {
    if (panning.value) return;
    selA.value = selection ? selection[0] : -1;
    selB.value = selection ? selection[1] : -1;
  }, [selection, selA, selB, panning]);

  const maxCount = Math.max(1, ...months.map((m) => m.count));

  // Коммит диапазона [a..b] — троттлится во время штриха, финально в onEnd.
  const lastCommit = useRef(0);
  const commit = (a: number, b: number, final: boolean) => {
    const now = Date.now();
    if (!final && now - lastCommit.current < 100) return;
    lastCommit.current = now;
    const [i0, i1] = a <= b ? [a, b] : [b, a];
    onChange({ preset: "custom", from: months[i0].from, to: months[i1].to });
  };

  const tapAt = (x: number) => {
    if (colW <= 0) return;
    const i = Math.min(
      months.length - 1,
      Math.max(0, Math.floor((x - PAD) / colW)),
    );
    haptics.tap();
    // Повторный тап по единственному выбранному месяцу — «Всё время».
    if (selection && selection[0] === i && selection[1] === i) {
      onChange(null);
      return;
    }
    onChange({ preset: "custom", from: months[i].from, to: months[i].to });
  };

  const hapticTick = () => haptics.tap();

  const pan = Gesture.Pan()
    // Осевая доминанта: горизонталь — наша, вертикаль отдаём скроллу листа.
    .activeOffsetX([-8, 8])
    .failOffsetY([-10, 10])
    .onStart((e) => {
      "worklet";
      if (colW <= 0) return;
      panning.value = true;
      const i = Math.min(
        months.length - 1,
        Math.max(0, Math.floor((e.x - PAD) / colW)),
      );
      selA.value = i;
      selB.value = i;
      runOnJS(hapticTick)();
    })
    .onChange((e) => {
      "worklet";
      if (colW <= 0 || selA.value < 0) return;
      const i = Math.min(
        months.length - 1,
        Math.max(0, Math.floor((e.x - PAD) / colW)),
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
    });

  const tap = Gesture.Tap().onEnd((e) => {
    "worklet";
    runOnJS(tapAt)(e.x);
  });

  const gesture = Gesture.Race(pan, tap);

  // Окно оттиска (нижний слой ink) и клип белой плоскости.
  const bandStyle = useAnimatedStyle(() => {
    const a = selA.value;
    const b = selB.value;
    if (a < 0 || colW <= 0) return { opacity: 0, left: 0, width: 0 };
    const [i0, i1] = a <= b ? [a, b] : [b, a];
    return {
      opacity: 1,
      left: PAD + i0 * colW,
      width: (i1 - i0 + 1) * colW,
    };
  });
  // Белая плоскость едет внутри клипа в противофазе — колонки совпадают.
  const innerShift = useAnimatedStyle(() => {
    const a = selA.value;
    const b = selB.value;
    if (a < 0 || colW <= 0) return { transform: [{ translateX: 0 }] };
    const i0 = Math.min(a, b);
    return { transform: [{ translateX: -(PAD + i0 * colW) }] };
  });

  const columns = (onInk: boolean) =>
    months.map((m) => {
      const barH = 3 + (m.count / maxCount) * 17;
      return (
        <View
          key={m.key}
          style={{
            width: colW,
            alignItems: "center",
            justifyContent: "flex-end",
            paddingBottom: 4,
          }}
        >
          {m.yearMark ? (
            <Text
              style={{
                position: "absolute",
                top: 3,
                fontSize: 8,
                fontWeight: "600",
                color: onInk ? "rgba(255,255,255,0.7)" : "rgba(11,18,32,0.45)",
              }}
            >
              {m.yearMark}
            </Text>
          ) : null}
          <View
            style={{
              width: Math.max(3, colW * 0.34),
              height: barH,
              borderRadius: 1.5,
              marginBottom: 3,
              backgroundColor: onInk
                ? "rgba(255,255,255,0.6)"
                : "rgba(11,18,32,0.2)",
            }}
          />
          <Text
            style={{
              fontSize: 9,
              fontWeight: "600",
              textTransform: "uppercase",
              letterSpacing: 0.2,
              color: onInk ? "#FFFFFF" : "rgba(11,18,32,0.45)",
            }}
          >
            {m.label}
          </Text>
        </View>
      );
    });

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Период по месяцам"
        accessibilityHint="Тап — месяц, горизонтальный жест — диапазон"
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
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{
          height: TRACK_H,
          borderRadius: 14,
          backgroundColor: "rgba(11,18,32,0.04)",
          overflow: "hidden",
        }}
      >
        {/* Базовая линия гравюры — волосок над подписями. */}
        <View
          style={{
            position: "absolute",
            left: PAD,
            right: PAD,
            bottom: 17,
            height: 1,
            backgroundColor: "rgba(11,18,32,0.08)",
          }}
        />
        {width > 0 ? (
          <>
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
                  borderRadius: 10,
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
          </>
        ) : null}
      </View>
    </GestureDetector>
  );
}
