import { useEffect, useRef, type MutableRefObject } from "react";
import { Keyboard } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

// Motion of `BottomSheet`: enter/exit animation, scrim, and the drag-to-close
// gesture. Every callback below is a worklet and runs on the UI thread.

// Пружина входа: почти критически задемпфирована — плавный «доводчик» без
// дешёвого пружинения. Выход — короткий ease-in вниз.
const SPRING = { damping: 28, stiffness: 300, mass: 1 } as const;

/** Обычная JS-функция для `runOnJS`: жест не должен захватывать `Keyboard`. */
function dismissKeyboard() {
  Keyboard.dismiss();
}

export function useSheetMotion({
  mounted,
  visible,
  reduced,
  screenH,
  SCREEN_H,
  setMounted,
  onClose,
}: {
  mounted: boolean;
  visible: boolean;
  reduced: boolean;
  /** Window height read by the enter/exit effect without restarting it. */
  screenH: MutableRefObject<number>;
  /** Window height of this render (the gesture reads it directly). */
  SCREEN_H: number;
  setMounted: (next: boolean) => void;
  onClose: () => void;
}) {
  const ty = useSharedValue(SCREEN_H); // сдвиг листа вниз (0 = на месте)
  const scrim = useSharedValue(0); // прозрачность затемнения (0…1)
  const sheetH = useSharedValue(0); // измеренная высота листа

  useEffect(() => {
    if (!mounted) return;
    if (visible) {
      // Вход: лист пружиной из-за нижнего края. Стартуем с ИЗМЕРЕННОЙ
      // высоты (фолбэк — экран): телепорт на весь экран делал вход и
      // выход несимметричными, вход «прилетал» из-под таб-бара.
      ty.value = sheetH.value > 0 ? sheetH.value : screenH.current;
      ty.value = reduced
        ? withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) })
        : withSpring(0, SPRING);
      scrim.value = withTiming(1, {
        duration: reduced ? 200 : 260,
        easing: Easing.out(Easing.quad),
      });
    } else {
      // Выход: лист вниз на свою высоту, скрим гаснет; затем размонтируем.
      const target = sheetH.value > 0 ? sheetH.value : screenH.current;
      ty.value = withTiming(target, {
        duration: reduced ? 160 : 240,
        easing: Easing.in(Easing.cubic),
      });
      scrim.value = withTiming(
        0,
        // 240 — в такт листу (было 220, скрим гас раньше панели).
        { duration: reduced ? 160 : 240, easing: Easing.in(Easing.quad) },
        (fin) => {
          if (fin) runOnJS(setMounted)(false);
        },
      );
    }
    // `screenH` (a ref) and `setMounted` (a state setter) are stable: listing
    // them never re-runs the animation.
  }, [mounted, visible, reduced, ty, scrim, sheetH, screenH, setMounted]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }],
  }));

  // Свайп вниз по граберу закрывает лист (грабер это и обещает). Жест
  // живёт только на верхней зоне — не конфликтует со скроллом тела.
  // Тянем лист за пальцем; отпустили за порогом (или рывком) — закрываем,
  // иначе пружиной возвращаем на место.
  // Закрытие свайпом могут ОТКЛОНИТЬ (идёт запись — `useGuardedClose`): тогда
  // лист возвращается пружиной, а не висит там, где его бросили (13.10).
  // Принятое закрытие гасит `visible` — и возврат не нужен.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const closeFromDrag = () => {
    onClose();
    setTimeout(() => {
      if (!visibleRef.current) return;
      ty.value = withSpring(0, { ...SPRING, reduceMotion: ReduceMotion.Never });
      scrim.value = withTiming(1, { duration: 160 });
    }, 100);
  };

  const drag = Gesture.Pan()
    // УЕЗЖАЮЩИЙ ЛИСТ НЕ ТЯНЕТСЯ (13.10). Второй рывок во время выхода писал
    // `ty`/`scrim` и срывал анимацию выхода: колбэк размонтирования не
    // приходил (`fin === false`), а повторный `onClose` уже ничего не делал.
    // Лист оставался смонтированным — часто невидимым, но со скримом во весь
    // экран, который глотал каждый тап. На Android «Назад» не спасал.
    .enabled(visible)
    // Тянут лист вниз — клавиатура уходит первой. Иначе панель уползает ПОД
    // клавиатуру (отдельное окно выше приложения), палец идёт, а порог
    // закрытия не достигается: жест читается как сломанный.
    .onStart(() => {
      // СВОЯ ФУНКЦИЯ, А НЕ `Keyboard.dismiss` (2026-09-22): ссылка на метод
      // тянула в worklet весь объект `Keyboard`, и вызов на потоке UI падал
      // нативным abort — любой лист ронял приложение при свайпе за грабер.
      runOnJS(dismissKeyboard)();
    })
    .onChange((e) => {
      ty.value = Math.max(0, ty.value + e.changeY);
      // Скрим следует за пальцем: панель уезжала, а затемнение стояло
      // на месте до самого отпускания.
      const h = sheetH.value > 0 ? sheetH.value : SCREEN_H;
      scrim.value = Math.max(0, 1 - ty.value / h);
    })
    .onEnd((e) => {
      const h = sheetH.value > 0 ? sheetH.value : SCREEN_H;
      if (ty.value > h * 0.3 || e.velocityY > 800) {
        runOnJS(closeFromDrag)();
      } else {
        // Возврат за пальцем не должен телепортироваться при Reduce
        // Motion — это прямой отклик на жест, а не декорация.
        ty.value = withSpring(0, {
          ...SPRING,
          reduceMotion: ReduceMotion.Never,
        });
        scrim.value = withTiming(1, { duration: 160 });
      }
    });

  return { sheetH, scrimStyle, sheetStyle, drag };
}
