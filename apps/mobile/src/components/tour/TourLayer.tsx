import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Platform, Pressable, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { X } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";
import { useReduceMotion } from "@/lib/reduce-motion";
import { chooseOption } from "@/lib/choose";
import { topSheet, useSheetStackVersion } from "@/components/ui/sheet-overlay";
import { finishTour, nextStep, tourTarget, useTour } from "./tour-store";

// СЛОЙ ПОДСКАЗКИ ОДНОГО ОКНА. Экран темнеет, светлой остаётся подсвеченная
// цель, под ней (или над ней, если внизу нет места) — пузырь: «Шаг N из M»,
// одна фраза, крестик, «Пропустить», точки шагов, «Дальше».
//
// Слой забирает касания всего окна, кроме цели шага «нажмите» и «заполните»:
// туда касание проходит насквозь, как в игре — нажать можно только то, что
// показывают.
//
// Слой стоит в каждом окне: в корне приложения (над таб-баром) и в каждой
// шторке. Рисует его только окно, где сейчас лежит цель шага.

type Rect = { x: number; y: number; w: number; h: number };

const GAP = 12;
/** Куда докручивается цель в прокрутке: под шапку экрана. */
const SCROLL_TOP = 150;
/** Цель двигается вместе с экраном (клавиатура, анимация листа) — перемер. */
const REMEASURE_MS = 400;
/** Сколько ждать цель необязательного шага, прежде чем пропустить его. */
const OPTIONAL_WAIT_MS = 1500;

function measure(node: View): Promise<Rect> {
  return new Promise((resolve) => node.measureInWindow((x, y, w, h) => resolve({ x, y, w, h })));
}

export function TourLayer({ host }: { host: string }) {
  const t = useThemeColors();
  const tour = useTour();
  const { step, chapter } = tour;
  const target = step ? tourTarget(step.target) : undefined;
  // Поверх окна открыта шторка (выбор пояса после «нажмите сюда», вопрос
  // крестика) — подсказка этого окна ждёт под ней и не просвечивает.
  useSheetStackVersion();
  const top = topSheet();
  const covered = host === "root" ? top !== null : top !== host;
  const mine = !!step && target?.host === host && !covered;

  // Необязательный шаг без цели на экране пропускается — отвечает за это
  // только корневой слой, чтобы шаг не пропускали два окна сразу.
  useEffect(() => {
    if (host !== "root" || !step?.optional) return;
    const timer = setTimeout(() => {
      if (!tourTarget(step.target)) nextStep();
    }, OPTIONAL_WAIT_MS);
    return () => clearTimeout(timer);
  }, [host, step]);

  if (!mine || !step || !chapter || !target) return null;
  // Ключ — шаг: новый шаг меряет цель с нуля и заново докручивает к ней.
  return <Overlay key={step.id} t={t} />;
}

function Overlay({ t }: { t: ReturnType<typeof useThemeColors> }) {
  const { step, chapter, index, total } = useTour();
  const root = useRef<View>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [bubbleH, setBubbleH] = useState(150);
  const scrolled = useRef(false);
  const keyboardH = useKeyboardHeight();

  const place = useCallback(async () => {
    const entry = step ? tourTarget(step.target) : undefined;
    if (!entry || !root.current) return;
    const origin = await measure(root.current);
    let box = await measure(entry.node);
    // Цель в прокрутке и не на виду — докрутить один раз, потом мерить.
    if (entry.scroll && !scrolled.current) {
      scrolled.current = true;
      const delta = box.y - origin.y - SCROLL_TOP;
      if (Math.abs(delta) > 4) {
        entry.scroll.ref.current?.scrollTo({ y: Math.max(0, entry.scroll.y.current + delta), animated: true });
        await new Promise((r) => setTimeout(r, 320));
        box = await measure(entry.node);
      }
    }
    const next = { x: box.x - origin.x, y: box.y - origin.y, w: box.w, h: box.h };
    setRect((prev) =>
      prev && Math.abs(prev.x - next.x) < 1 && Math.abs(prev.y - next.y) < 1 &&
      Math.abs(prev.w - next.w) < 1 && Math.abs(prev.h - next.h) < 1
        ? prev
        : next,
    );
  }, [step]);

  useEffect(() => {
    void place();
    const timer = setInterval(() => void place(), REMEASURE_MS);
    return () => clearInterval(timer);
  }, [place]);

  if (!step || !chapter) return null;
  const scrim = { position: "absolute" as const, backgroundColor: `${t.ink}94` };
  const passes = step.kind !== "info";
  const last = index + 1 >= total;

  const close = async () => {
    const picked = await chooseOption("Завершить обучение?", [
      { label: `Завершить обучение ${chapter.about}` },
      { label: "Завершить всё обучение" },
    ]);
    if (picked === 0) finishTour("chapter");
    if (picked === 1) finishTour("all");
  };

  let bubbleTop = 0;
  if (rect) {
    const below = rect.y + rect.h + GAP;
    const above = rect.y - GAP - bubbleH;
    const bottom = size.h - keyboardH;
    // Внизу места нет — над целью; нет и там (цель во весь экран) — у нижнего края.
    bubbleTop = below + bubbleH <= bottom - GAP ? below : above >= GAP ? above : bottom - bubbleH - 24;
  }

  return (
    <View
      ref={root}
      pointerEvents="box-none"
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 1000, elevation: 1000 }}
    >
      {rect ? (
        <>
          <View style={{ ...scrim, left: 0, right: 0, top: 0, height: Math.max(0, rect.y) }} />
          <View style={{ ...scrim, left: 0, right: 0, top: rect.y + rect.h, bottom: 0 }} />
          <View style={{ ...scrim, left: 0, width: Math.max(0, rect.x), top: rect.y, height: rect.h }} />
          <View style={{ ...scrim, left: rect.x + rect.w, right: 0, top: rect.y, height: rect.h }} />
          {/* Пояснение: цель видна, но не нажимается. */}
          {passes ? null : (
            <View style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
          )}
          {step.kind === "tap" ? <Pulse rect={rect} t={t} /> : null}
          <View
            accessibilityViewIsModal
            onLayout={(e) => setBubbleH(e.nativeEvent.layout.height)}
            style={{
              position: "absolute",
              top: bubbleTop,
              left: 16,
              right: 16,
              backgroundColor: t.surface,
              borderRadius: t.radius.card,
              padding: 16,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: t.caption }}>
                {`Шаг ${index + 1} из ${total}`}
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
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14, minHeight: 36 }}>
              {step.required || last ? (
                <View style={{ minWidth: 92 }} />
              ) : (
                <Pressable onPress={nextStep} hitSlop={12} accessibilityRole="button" style={{ minWidth: 92 }}>
                  <Text style={{ fontSize: 15, fontWeight: "500", color: t.sub }}>Пропустить</Text>
                </Pressable>
              )}
              <Dots index={index} total={total} t={t} />
              {step.kind === "tap" ? (
                <View style={{ minWidth: 92 }} />
              ) : (
                <Pressable
                  onPress={nextStep}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    minWidth: 92,
                    alignItems: "center",
                    backgroundColor: t.accent,
                    opacity: pressed ? 0.85 : 1,
                    borderRadius: t.radius.pill,
                    paddingHorizontal: 18,
                    paddingVertical: 9,
                  })}
                >
                  <Text style={{ color: t.onAccent, fontSize: 15, fontWeight: "600" }}>
                    {last ? "Понятно" : "Дальше"}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </>
      ) : (
        // Цель меряется и докручивается — экран уже тёмный, пузырь встанет на место.
        <View style={{ ...scrim, left: 0, right: 0, top: 0, bottom: 0 }} />
      )}
    </View>
  );
}

function Dots({ index, total, t }: { index: number; total: number; t: ReturnType<typeof useThemeColors> }) {
  // Глава длинная — точек не больше двенадцати: дальше они сливаются в полосу.
  const shown = Math.min(total, 12);
  const at = total <= 12 ? index : Math.round((index / (total - 1)) * (shown - 1));
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

/** Рамка цели «нажмите сюда»: дышит, пока на неё не нажали. */
function Pulse({ rect, t }: { rect: Rect; t: ReturnType<typeof useThemeColors> }) {
  const reduced = useReduceMotion();
  const phase = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    phase.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(phase);
  }, [phase, reduced]);
  const style = useAnimatedStyle(() => ({
    opacity: reduced ? 1 : 1 - phase.value,
    transform: [{ scale: reduced ? 1 : 1 + phase.value * 0.06 }],
  }));
  const pad = 4;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: rect.x - pad,
          top: rect.y - pad,
          width: rect.w + pad * 2,
          height: rect.h + pad * 2,
          borderRadius: t.radius.card + pad,
          borderWidth: 3,
          borderColor: t.accent,
        },
        style,
      ]}
    />
  );
}

/** Высота клавиатуры — с первого кадра. Подсказка в шторке с полем
 *  появляется, когда клавиатура УЖЕ открыта: слушать одни события значило бы
 *  считать её закрытой, и пузырь под полем уходил бы под клавиатуру. */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(() =>
    Keyboard.isVisible() ? (Keyboard.metrics()?.height ?? 0) : 0,
  );
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) =>
      setHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
