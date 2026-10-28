import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Platform, View } from "react-native";
import { useThemeColors } from "@/theme/colors";
import { haptics } from "@/lib/haptics";
import { topSheet, useSheetStackVersion } from "@/components/ui/sheet-overlay";
import { caretOffset, placeBubble, spotFor, type Rect } from "./tour-geometry";
import { goToStep, nextStep, tourScreenShown, tourTarget, useTour } from "./tour-store";
import { TourBubble } from "./TourBubble";
import { TourSpotlight } from "./TourSpotlight";

// СЛОЙ ПОДСКАЗКИ ОДНОГО ОКНА. Экран темнеет, светлой остаётся подсвеченная
// цель, рядом — пузырь со стрелкой к ней (`TourBubble`).
//
// Слой забирает касания всего окна, кроме цели шага «нажмите» и «заполните»:
// туда касание проходит насквозь, как в игре — нажать можно только то, что
// показывают.
//
// Слой стоит в каждом окне: в корне приложения (над таб-баром) и в каждой
// шторке. Рисует его только окно, где сейчас лежит цель шага.

/** Куда докручивается цель в прокрутке: под шапку экрана. */
const SCROLL_TOP = 150;
/** Цель двигается вместе с экраном (клавиатура, анимация листа) — перемер. */
const REMEASURE_MS = 400;
/** Как часто проверять, на месте ли цель шага (пропуск и возврат). */
const OPTIONAL_WAIT_MS = 1500;

function measure(node: View): Promise<Rect> {
  return new Promise((resolve) => node.measureInWindow((x, y, w, h) => resolve({ x, y, w, h })));
}

export function TourLayer({ host }: { host: string }) {
  const tour = useTour();
  const { step, chapter } = tour;
  const target = step ? tourTarget(step.target) : undefined;
  // Поверх окна открыта шторка (выбор пояса после «нажмите сюда», вопрос
  // крестика) — подсказка этого окна ждёт под ней и не просвечивает.
  useSheetStackVersion();
  const top = topSheet();
  const covered = host === "root" ? top !== null : top !== host;
  const mine = !!step && target?.host === host && !covered;

  // Смена шага — лёгкий отклик под пальцем; ввод закончен — клавиатура
  // уходит: она закрывала низ окна, и пузырь следующего шага ложился поверх
  // только что набранного. Следит корневой слой: он есть всегда, а слой
  // шторки уходит вместе с ней.
  const prevStep = useRef(step);
  useEffect(() => {
    if (host !== "root" || prevStep.current === step) return;
    if (prevStep.current?.kind === "input") Keyboard.dismiss();
    if (step && prevStep.current) haptics.step();
    prevStep.current = step;
  }, [host, step]);

  // Цели нет, а экран открыт — строка закрыта правом: необязательный шаг
  // пропускается. Экран закрыт (смахнули шторку, вышли из настроек) — шаг
  // возвращает к тому, откуда экран открывается (`fallback`), а без него ждёт.
  // Решает только корневой слой, чтобы шаг не двигали два окна сразу.
  useEffect(() => {
    if (host !== "root" || !step || (!step.optional && !step.fallback)) return;
    const timer = setInterval(() => {
      if (tourTarget(step.target)) return;
      if (tourScreenShown(step.target)) {
        if (step.optional) nextStep();
        return;
      }
      if (step.fallback) goToStep(step.fallback);
    }, OPTIONAL_WAIT_MS);
    return () => clearInterval(timer);
  }, [host, step]);

  if (!mine || !step || !chapter || !target) return null;
  return <Overlay />;
}

function Overlay() {
  const t = useThemeColors();
  const { step, chapter, index, total } = useTour();
  const root = useRef<View>(null);
  // Вырез держит прежнюю цель, пока новая меряется: без этого между шагами
  // экран на миг темнел целиком.
  const [rect, setRect] = useState<Rect | null>(null);
  const [measuredFor, setMeasuredFor] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [bubbleH, setBubbleH] = useState(150);
  const [keep, setKeep] = useState<Rect | null>(null);
  const scrolledFor = useRef<string | null>(null);
  const keyboardH = useKeyboardHeight();

  const place = useCallback(async () => {
    const entry = step ? tourTarget(step.target) : undefined;
    if (!step || !entry || !root.current) return;
    const origin = await measure(root.current);
    let box = await measure(entry.node);
    // Цель в прокрутке и не на виду — докрутить один раз за шаг, потом мерить.
    if (entry.scroll && scrolledFor.current !== step.id) {
      scrolledFor.current = step.id;
      const delta = box.y - origin.y - SCROLL_TOP;
      if (Math.abs(delta) > 4) {
        entry.scroll.ref.current?.scrollTo({ y: Math.max(0, entry.scroll.y.current + delta), animated: true });
        await new Promise((r) => setTimeout(r, 320));
        box = await measure(entry.node);
      }
    }
    const next = { x: box.x - origin.x, y: box.y - origin.y, w: box.w, h: box.h };
    const kept = step.keepVisible ? tourTarget(step.keepVisible) : undefined;
    if (kept) {
      const k = await measure(kept.node);
      setKeep({ x: k.x - origin.x, y: k.y - origin.y, w: k.w, h: k.h });
    } else {
      setKeep(null);
    }
    setRect((prev) =>
      prev && Math.abs(prev.x - next.x) < 1 && Math.abs(prev.y - next.y) < 1 &&
      Math.abs(prev.w - next.w) < 1 && Math.abs(prev.h - next.h) < 1
        ? prev
        : next,
    );
    setMeasuredFor(step.id);
  }, [step]);

  useEffect(() => {
    void place();
    const timer = setInterval(() => void place(), REMEASURE_MS);
    return () => clearInterval(timer);
  }, [place]);

  if (!step || !chapter) return null;
  const scrimColor = `${t.ink}94`;
  const shape = tourTarget(step.target)?.shape ?? "card";
  const ready = rect && measuredFor === step.id;
  const geo = rect ? spotFor(rect, shape, size, t.radius.card) : null;
  const bubble = geo ? placeBubble(geo.spot, keep, bubbleH, size, keyboardH) : null;

  return (
    <View
      ref={root}
      pointerEvents="box-none"
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 1000, elevation: 1000 }}
    >
      {geo ? (
        <TourSpotlight
          spot={geo.spot}
          radius={geo.radius}
          size={size}
          color={scrimColor}
          passes={ready ? step.kind !== "info" : false}
          pulse={!!ready && step.kind === "tap"}
          pulseKey={step.id}
          accent={t.accent}
        />
      ) : (
        // Первая цель меряется и докручивается — экран уже тёмный.
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: scrimColor }} />
      )}
      {ready && geo && bubble ? (
        <TourBubble
          key={step.id}
          step={step}
          chapter={chapter}
          index={index}
          total={total}
          top={bubble.top}
          side={bubble.side}
          caretX={caretOffset(geo.spot, size)}
          onHeight={setBubbleH}
        />
      ) : null}
    </View>
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
