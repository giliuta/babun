import { useEffect, useState, type ReactNode } from "react";
import { Dimensions, Modal, Pressable, View } from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useThemeColors } from "@/theme/colors";

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

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function BottomSheet({
  visible,
  onClose,
  children,
  /** Доля высоты экрана — потолок листа (контент выше скроллится внутри). */
  maxHeightRatio = 0.9,
  /** Показать «язычок» вверху (аффорданс листа). */
  grabber = true,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  maxHeightRatio?: number;
  grabber?: boolean;
}) {
  const t = useThemeColors();
  const reduced = useReducedMotion();
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
      // Вход: лист пружиной из-за нижнего края, скрим — плавно на месте.
      ty.value = SCREEN_H;
      ty.value = reduced
        ? withTiming(0, { duration: 0 })
        : withSpring(0, SPRING);
      scrim.value = withTiming(1, {
        duration: reduced ? 0 : 260,
        easing: Easing.out(Easing.quad),
      });
    } else {
      // Выход: лист вниз на свою высоту, скрим гаснет; затем размонтируем.
      const target = sheetH.value > 0 ? sheetH.value : SCREEN_H;
      ty.value = withTiming(target, {
        duration: reduced ? 0 : 240,
        easing: Easing.in(Easing.cubic),
      });
      scrim.value = withTiming(
        0,
        { duration: reduced ? 0 : 220, easing: Easing.in(Easing.quad) },
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
    .onChange((e) => {
      ty.value = Math.max(0, ty.value + e.changeY);
    })
    .onEnd((e) => {
      const h = sheetH.value > 0 ? sheetH.value : SCREEN_H;
      if (ty.value > h * 0.3 || e.velocityY > 800) {
        runOnJS(onClose)();
      } else {
        ty.value = withSpring(0, SPRING);
      }
    });

  if (!mounted) return null;

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
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Закрыть"
          style={[
            { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 },
            { backgroundColor: t.scrim },
            scrimStyle,
          ]}
        />
        <Animated.View
          onLayout={(e) => {
            sheetH.value = e.nativeEvent.layout.height;
          }}
          accessibilityViewIsModal
          style={[
            {
              maxHeight: SCREEN_H * maxHeightRatio,
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
      </GestureHandlerRootView>
    </Modal>
  );
}
