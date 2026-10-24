import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { X } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";
import { useReduceMotion } from "@/lib/reduce-motion";
import { chooseOption } from "@/lib/choose";
import { BUBBLE_SIDE, type BubbleSide } from "./tour-geometry";
import { finishTour, nextStep, tourReady, type TourChapter, type TourStep } from "./tour-store";
import { SPOT_MOVE_MS } from "./TourSpotlight";

// ПУЗЫРЬ ПОДСКАЗКИ: «Шаг N из M» и крестик, одна фраза, внизу «Пропустить»,
// точки шагов и «Дальше». Стрелка на краю пузыря смотрит на подсвеченное —
// пузырь и вырез читаются одной вещью, даже когда между ними половина экрана.

type Theme = ReturnType<typeof useThemeColors>;

/** Сторона квадрата, повёрнутого в стрелку. */
const CARET = 14;

export function TourBubble({
  step,
  chapter,
  index,
  total,
  top,
  side,
  caretX,
  onHeight,
}: {
  step: TourStep;
  chapter: TourChapter;
  index: number;
  total: number;
  top: number;
  side: BubbleSide;
  caretX: number;
  onHeight: (h: number) => void;
}) {
  const t = useThemeColors();
  const reduced = useReduceMotion();
  const last = index + 1 >= total;
  const hasSkip = !step.required && !last;
  const hasNext = step.kind !== "tap";
  const canNext = tourReady(step.needs);

  const close = async () => {
    const picked = await chooseOption("Завершить обучение?", [
      { label: `Завершить обучение ${chapter.about}` },
      { label: "Завершить всё обучение" },
    ]);
    if (picked === 0) finishTour("chapter");
    if (picked === 1) finishTour("all");
  };

  return (
    // Пузырь проявляется, когда вырез приехал к цели: шаги идут один за
    // другим, и рывок на каждом читался бы как перерисовка экрана.
    <Animated.View
      entering={reduced ? undefined : FadeIn.delay(SPOT_MOVE_MS - 80).duration(180)}
      accessibilityViewIsModal
      onLayout={(e) => onHeight(e.nativeEvent.layout.height)}
      style={{
        position: "absolute",
        top,
        left: BUBBLE_SIDE,
        right: BUBBLE_SIDE,
        backgroundColor: t.surface,
        borderRadius: t.radius.card,
        padding: 16,
      }}
    >
      {side === "over" ? null : (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: caretX - CARET / 2,
            ...(side === "below" ? { top: -CARET / 2 + 1 } : { bottom: -CARET / 2 + 1 }),
            width: CARET,
            height: CARET,
            borderRadius: 2,
            backgroundColor: t.surface,
            transform: [{ rotate: "45deg" }],
          }}
        />
      )}
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: t.caption }}>
          {chapter.intro ? "Новый раздел" : `Шаг ${index + 1} из ${total}`}
        </Text>
        <Pressable
          onPress={() => void close()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Завершить обучение"
        >
          <X color={t.sub} size={18} strokeWidth={2.2} />
        </Pressable>
      </View>
      <Text style={{ fontSize: 15, lineHeight: 21, color: t.body, marginTop: 4 }}>{step.text}</Text>
      {/* НИЖНЯЯ СТРОКА — ТОЛЬКО КОГДА В НЕЙ ЕСТЬ ЧТО НАЖАТЬ. У шага «нажмите
          сюда», который не пропускается, кнопок нет: строка с одними точками
          была пустой полосой, а ход и так виден по «Шаг N из M». */}
      {hasSkip || hasNext ? (
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14, minHeight: 36 }}>
          {hasSkip ? (
            <Pressable onPress={nextStep} hitSlop={12} accessibilityRole="button" style={{ minWidth: 92 }}>
              <Text style={{ fontSize: 15, fontWeight: "500", color: t.sub }}>Пропустить</Text>
            </Pressable>
          ) : (
            <View style={{ minWidth: 92 }} />
          )}
          {chapter.intro ? <View style={{ flex: 1 }} /> : <Dots index={index} total={total} t={t} />}
          {hasNext ? <NextButton last={last} canNext={canNext} onPress={nextStep} t={t} /> : <View style={{ minWidth: 92 }} />}
        </View>
      ) : null}
    </Animated.View>
  );
}

function NextButton({
  last,
  canNext,
  onPress,
  t,
}: {
  last: boolean;
  canNext: boolean;
  onPress: () => void;
  t: Theme;
}) {
  return (
    <Pressable
      onPress={canNext ? onPress : undefined}
      disabled={!canNext}
      accessibilityRole="button"
      accessibilityState={{ disabled: !canNext }}
      style={({ pressed }) => ({
        minWidth: 92,
        alignItems: "center",
        backgroundColor: canNext ? t.accent : t.disabledFill,
        opacity: pressed ? 0.85 : 1,
        borderRadius: t.radius.pill,
        paddingHorizontal: 18,
        paddingVertical: 9,
      })}
    >
      <Text style={{ color: canNext ? t.onAccent : t.muted, fontSize: 15, fontWeight: "600" }}>
        {last ? "Понятно" : "Дальше"}
      </Text>
    </Pressable>
  );
}

function Dots({ index, total, t }: { index: number; total: number; t: Theme }) {
  // Глава длинная — точек не больше двенадцати: дальше они сливаются в полосу.
  const shown = Math.min(total, 12);
  const at = total <= 12 ? index : Math.round((index / Math.max(1, total - 1)) * (shown - 1));
  return (
    <View style={{ flex: 1, flexDirection: "row", justifyContent: "center", gap: 5 }}>
      {Array.from({ length: shown }, (_, i) => (
        <View
          key={i}
          style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i === at ? t.accent : t.separator }}
        />
      ))}
    </View>
  );
}
