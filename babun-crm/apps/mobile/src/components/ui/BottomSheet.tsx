import { useEffect, useState, type ReactNode } from "react";
import {
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  View,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { useReduceMotion } from "@/lib/reduce-motion";

// ─── Канонический нижний лист приложения ───────────────────────────────
// ЕДИНСТВЕННЫЙ способ показать выезжающую снизу панель. Заменяет собой
// самописные `Modal animationType="slide"`, которые тянули вверх ВЕСЬ модал
// вместе со скримом (серое затемнение «наползало» снизу — дёшево).
//
// Здесь скрим проявляется opacity-ом НА МЕСТЕ, а лист отдельно выезжает
// пружиной снизу и так же уезжает вниз. Всё гейтится на Reduce Motion.
// Правило: любой новый нижний лист = <BottomSheet>. См. DESIGN-SYSTEM.md.

const SCREEN_H = Dimensions.get("window").height;

// Пружина входа: почти критически задемпфирована — плавный «доводчик» без
// дешёвого пружинения. Выход — короткий ease-in вниз.
const SPRING = { damping: 28, stiffness: 300, mass: 1 } as const;

/** Сколько лист уезжает вниз. Экспортируется, потому что действие, которое
 *  открывает СВОЁ окно поверх (второй лист, Alert, «Поделиться»), обязано
 *  дождаться конца этой анимации — иначе оно не появится вовсе. */
export const SHEET_EXIT_MS = 260;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function BottomSheet({
  visible,
  onClose,
  children,
  /** Доля высоты экрана — потолок листа (контент выше скроллится внутри). */
  maxHeightRatio = 0.9,
  /** Показать «язычок» вверху (аффорданс листа). */
  grabber = true,
  /** Внутри листа есть ввод: поднимать его над клавиатурой. RN Modal —
   *  отдельное окно, и подъём экрана под ним листу не достаётся, поэтому
   *  KeyboardAvoidingView нужен ЗДЕСЬ. flex:1 обязателен: без него лист
   *  вырастает на высоту клавиатуры и уезжает шапкой за верхний край. */
  avoidKeyboard = false,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  maxHeightRatio?: number;
  grabber?: boolean;
  avoidKeyboard?: boolean;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  // Остаётся смонтированным на время анимации закрытия, потом снимается.
  const [mounted, setMounted] = useState(visible);

  const ty = useSharedValue(SCREEN_H); // сдвиг листа вниз (0 = на месте)
  const scrim = useSharedValue(0); // прозрачность затемнения (0…1)
  const sheetH = useSharedValue(0); // измеренная высота листа

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!mounted) return;
    if (visible) {
      // Вход: лист пружиной из-за нижнего края. Стартуем с ИЗМЕРЕННОЙ
      // высоты (фолбэк — экран): телепорт на весь экран делал вход и
      // выход несимметричными, вход «прилетал» из-под таб-бара.
      ty.value = sheetH.value > 0 ? sheetH.value : SCREEN_H;
      ty.value = reduced
        ? withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) })
        : withSpring(0, SPRING);
      scrim.value = withTiming(1, {
        duration: reduced ? 200 : 260,
        easing: Easing.out(Easing.quad),
      });
    } else {
      // Выход: лист вниз на свою высоту, скрим гаснет; затем размонтируем.
      const target = sheetH.value > 0 ? sheetH.value : SCREEN_H;
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
  }, [mounted, visible, reduced, ty, scrim, sheetH]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }],
  }));

  // Свайп вниз по граберу закрывает лист (грабер это и обещает). Жест
  // живёт только на верхней зоне — не конфликтует со скроллом тела.
  // Тянем лист за пальцем; отпустили за порогом (или рывком) — закрываем,
  // иначе пружиной возвращаем на место.
  const drag = Gesture.Pan()
    // Тянут лист вниз — клавиатура уходит первой. Иначе панель уползает ПОД
    // клавиатуру (отдельное окно выше приложения), палец идёт, а порог
    // закрытия не достигается: жест читается как сломанный.
    .onStart(() => {
      runOnJS(Keyboard.dismiss)();
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
        runOnJS(onClose)();
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

  if (!mounted) return null;

  const sheet = (
    <Animated.View
      onLayout={(e) => {
        sheetH.value = e.nativeEvent.layout.height;
      }}
      accessibilityViewIsModal
      // Жест-escape VoiceOver: из попапа одиночного выбора иначе не
      // выйти вообще, не выбрав значение.
      onAccessibilityEscape={onClose}
      style={[
        {
          maxHeight: SCREEN_H * maxHeightRatio,
          // Верхний вырез — не место для листа: под клавиатурой высокий лист
          // дорастал грабером до самых часов. Маргин отдаёт эту полосу
          // обратно, а сжатие ложится на тело листа.
          marginTop: insets.top,
          // СЖИМАЕМАЯ панель: под клавиатурой KeyboardAvoidingView отдаёт
          // меньше высоты, и лист, растущий по контенту, уезжал шапкой и
          // грабером за верхний край. Сжатие ложится на тело листа (у него
          // flexShrink: 1), а шапка и футер остаются на месте.
          flexShrink: 1,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          overflow: "hidden",
          backgroundColor: t.surface,
        },
        sheetStyle,
      ]}
    >
      {grabber ? (
        <GestureDetector gesture={drag}>
          <View className="items-center pb-1 pt-2.5">
            <View
              style={{
                width: 36,
                height: 5,
                borderRadius: 3,
                // «Чёрное не серое»: separator на surface ~1.1:1 — жест
                // обещан, а язычка не видно. Ink+alpha, как у системного.
                backgroundColor: "rgba(11,18,32,0.14)",
              }}
            />
          </View>
        </GestureDetector>
      ) : null}
      {children}
    </Animated.View>
  );

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* GestureHandlerRootView внутри Modal обязателен — иначе жест
          перетаскивания грабера не долетает (RN Modal — отдельное окно).
          style, не className: NativeWind v5 не красит компоненты-обёртки. */}
      <GestureHandlerRootView style={{ flex: 1, justifyContent: "flex-end" }}>
        <AnimatedPressable
          onPress={() => {
            haptics.tap();
            onClose();
          }}
          accessibilityRole="button"
          accessibilityLabel="Закрыть"
          style={[
            { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 },
            { backgroundColor: t.scrim },
            scrimStyle,
          ]}
        />
        {avoidKeyboard ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ flex: 1, justifyContent: "flex-end" }}
          >
            {sheet}
          </KeyboardAvoidingView>
        ) : (
          sheet
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}
