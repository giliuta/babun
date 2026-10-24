import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Platform, Pressable, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { X } from "lucide-react-native";
import Svg, { Path } from "react-native-svg";
import { useThemeColors } from "@/theme/colors";
import { useReduceMotion } from "@/lib/reduce-motion";
import { chooseOption } from "@/lib/choose";
import { topSheet, useSheetStackVersion } from "@/components/ui/sheet-overlay";
import { finishTour, nextStep, tourReady, tourScreenShown, tourTarget, useTour } from "./tour-store";

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
/** Отступ выреза вокруг кнопки или плитки. */
const CONTROL_PAD = 6;
/** Поле между вырезом и краем экрана. */
const EDGE = 4;

/** Вырез внутри экрана с полем `EDGE`: на краю он сжимается, а не режется. */
function clampToScreen(r: Rect, size: { w: number; h: number }): Rect {
  if (size.w === 0) return r;
  // Сжимается поровну с обеих сторон, чтобы цель осталась посередине выреза.
  const over = Math.max(0, EDGE - r.x, r.x + r.w - (size.w - EDGE));
  return { x: r.x + over, y: r.y, w: Math.max(0, r.w - over * 2), h: r.h };
}

/** Контур затемнения: весь экран и в нём скруглённая дыра по цели. */
function scrimPath(size: { w: number; h: number }, spot: Rect, radius: number): string {
  const r = Math.max(0, Math.min(radius, spot.w / 2, spot.h / 2));
  const { x, y, w, h } = spot;
  const hole =
    `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} ` +
    `V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} ` +
    `H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;
  return `M0,0 H${size.w} V${size.h} H0 Z ${hole}`;
}
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

  // Ввод закончен — клавиатура уходит: она закрывала низ окна, и пузырь
  // следующего шага ложился поверх только что набранного. Следит корневой
  // слой: он есть всегда, а слой шторки уходит вместе с ней.
  const prevStep = useRef(step);
  useEffect(() => {
    if (host !== "root") return;
    if (prevStep.current?.kind === "input" && prevStep.current !== step) Keyboard.dismiss();
    prevStep.current = step;
  }, [host, step]);

  // Необязательный шаг без цели на экране пропускается — отвечает за это
  // только корневой слой, чтобы шаг не пропускали два окна сразу.
  useEffect(() => {
    if (host !== "root" || !step?.optional) return;
    const timer = setInterval(() => {
      if (!tourTarget(step.target) && tourScreenShown(step.target)) nextStep();
    }, OPTIONAL_WAIT_MS);
    return () => clearInterval(timer);
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
  const [keep, setKeep] = useState<Rect | null>(null);
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
    const kept = step?.keepVisible ? tourTarget(step.keepVisible) : undefined;
    if (kept) {
      const k = await measure(kept.node);
      setKeep({ x: k.x - origin.x, y: k.y - origin.y, w: k.w, h: k.h });
    }
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
  const scrimColor = `${t.ink}94`;
  // ВЫРЕЗ ПО ФОРМЕ ЦЕЛИ. Строка карточки — ровно по карточке с её
  // скруглением; кнопка и плитка — с ровным отступом со всех сторон (рамка
  // по самому нажимаемому полю ложилась криво: у него свои несимметричные
  // поля); полоса во всю ширину — без скругления.
  const shape = tourTarget(step.target)?.shape ?? "card";
  const pad = shape === "control" ? CONTROL_PAD : 0;
  const radius = shape === "strip" ? 0 : t.radius.card + pad;
  // Вырез не выходит за край экрана: у значка в углу шапки (аналитика,
  // шестерёнка) отступ иначе срезался краем, и скругление пропадало.
  // Полоса во всю ширину остаётся во всю ширину.
  const raw = rect ? { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 } : null;
  const spot = raw && shape !== "strip" ? clampToScreen(raw, size) : raw;
  const block = { position: "absolute" as const };
  const passes = step.kind !== "info";
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

  let bubbleTop = 0;
  if (spot) {
    // Пузырь ставится вне цели и вне того, что шаг просит не закрывать.
    const top = keep ? Math.min(spot.y, keep.y) : spot.y;
    const bottomEdge = keep ? Math.max(spot.y + spot.h, keep.y + keep.h) : spot.y + spot.h;
    const below = bottomEdge + GAP;
    const above = top - GAP - bubbleH;
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
      {spot ? (
        <>
          {/* Затемнение со скруглённым вырезом — один контур «экран минус
              цель» (evenodd). Рамка-бордюр толщиной в экран для этого не
              годится: на тройной плотности такой слой больше предельной
              текстуры iOS и не рисуется вовсе. Касаний контур не ловит —
              их держат полосы ниже. */}
          <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0 }}>
            <Svg width={size.w} height={size.h}>
              <Path d={scrimPath(size, spot, radius)} fill={scrimColor} fillRule="evenodd" />
            </Svg>
          </View>
          {/* Касания вокруг выреза гасятся: нажать можно только показанное. */}
          <View style={{ ...block, left: 0, right: 0, top: 0, height: Math.max(0, spot.y) }} />
          <View style={{ ...block, left: 0, right: 0, top: spot.y + spot.h, bottom: 0 }} />
          <View style={{ ...block, left: 0, width: Math.max(0, spot.x), top: spot.y, height: spot.h }} />
          <View style={{ ...block, left: spot.x + spot.w, right: 0, top: spot.y, height: spot.h }} />
          {/* Пояснение: цель видна, но не нажимается. */}
          {passes ? null : (
            <View style={{ ...block, left: spot.x, top: spot.y, width: spot.w, height: spot.h }} />
          )}
          {step.kind === "tap" ? <Pulse spot={spot} radius={radius} t={t} /> : null}
          {/* Пузырь проявляется, а не выскакивает: шаги идут один за другим,
              и рывок на каждом читался бы как перерисовка экрана. */}
          <Animated.View
            entering={FadeIn.duration(180)}
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
                сюда», который не пропускается, кнопок нет: строка с одними
                точками была пустой полосой, а ход и так виден по «Шаг N из M». */}
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
                {hasNext ? (
                  <Pressable
                    onPress={canNext ? nextStep : undefined}
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
                ) : (
                  <View style={{ minWidth: 92 }} />
                )}
              </View>
            ) : null}
          </Animated.View>
        </>
      ) : (
        // Цель меряется и докручивается — экран уже тёмный, пузырь встанет на место.
        <View style={{ ...block, left: 0, right: 0, top: 0, bottom: 0, backgroundColor: scrimColor }} />
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
function Pulse({ spot, radius, t }: { spot: Rect; radius: number; t: ReturnType<typeof useThemeColors> }) {
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
  // Рамка сидит вплотную вокруг выреза и повторяет его скругление.
  const pad = 3;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: spot.x - pad,
          top: spot.y - pad,
          width: spot.w + pad * 2,
          height: spot.h + pad * 2,
          borderRadius: radius + pad,
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
