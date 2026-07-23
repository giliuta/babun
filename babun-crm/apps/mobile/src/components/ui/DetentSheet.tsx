import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  type ReactNode,
} from "react";
import { Dimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  interpolate,
  Extrapolation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useThemeColors } from "@/theme/colors";

// ─── Немодальный лист с детентами («живой список») ─────────────────────
// Родной брат канонического BottomSheet для случая, когда контент ПОЗАДИ
// должен оставаться видимым и живым: live-apply фильтры — тап в листе, а
// список за ним перестраивается на глазах (диалект Apple Maps / Find My).
//
// Отличия от BottomSheet (Modal): рендерится В ДЕРЕВЕ экрана, вне панели
// касания свободно проходят к списку (pointerEvents="box-none"). Два
// детента: medium (~55%, БЕЗ скрима) и large (~92%, скрим проявляется
// только на верхнем отрезке хода 70→92% высоты). Грабер и шапка тянут
// между детентами; глубокий свайп вниз или рывок — закрытие. На medium
// перетаскивается вся панель (тело статично), на large тело скроллится
// само — панель тянется только за грабер/шапку. Футер НЕ едет с панелью:
// он прижат к низу экрана отдельным слоем и виден на любом детенте.
// Reduce Motion гасит пружины. Правило BottomSheet остаётся: модальные
// листы — только <BottomSheet>; DetentSheet — только для live-apply.

const SCREEN_H = Dimensions.get("window").height;
const SPRING = { damping: 28, stiffness: 300, mass: 1 } as const;

export type Detent = "medium" | "large";

export interface DetentSheetHandle {
  /** Поднять лист до large (например, чтобы показать инлайн-колесо). */
  expand: () => void;
}

export const DetentSheet = forwardRef<
  DetentSheetHandle,
  {
    visible: boolean;
    onClose: () => void;
    /** Текущий детент — для честного глагола CTA и отступов списка. */
    onDetentChange?: (detent: Detent) => void;
    children: ReactNode;
    /** Прижатый к низу экрана слой (CTA) — виден на любом детенте. */
    footer?: ReactNode;
    mediumRatio?: number;
    largeRatio?: number;
  }
>(function DetentSheet(
  {
    visible,
    onClose,
    onDetentChange,
    children,
    footer,
    mediumRatio = 0.55,
    largeRatio = 0.92,
  },
  ref,
) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const [detent, setDetent] = useState<Detent>("medium");
  // Высота ЭКРАННОЙ области (без таб-бара) — меряется всегда смонтированным
  // корнем-оверлеем; large не должен залезать под статус-бар.
  const [rootH, setRootH] = useState(0);

  const H = Math.max(
    1,
    Math.min(SCREEN_H * largeRatio, rootH - insets.top - 10),
  ); // высота панели (полная, large)
  const MED = Math.min(SCREEN_H * mediumRatio, H);
  const MED_TY = H - MED; // сдвиг панели на medium
  // Скрим 0→0.35 на верхнем отрезке хода (ниже — список живой, чистый).
  const SCRIM_TY = Math.max(1, (MED_TY * 2) / 5);

  const ty = useSharedValue(H); // 0 = large · MED_TY = medium · H = скрыт

  const settle = (target: number) => {
    "worklet";
    ty.value = reduced
      ? withTiming(target, { duration: 0 })
      : withSpring(target, SPRING);
  };

  const reportDetent = (d: Detent) => {
    setDetent(d);
    onDetentChange?.(d);
  };

  useEffect(() => {
    if (visible && rootH > 0) setMounted(true);
  }, [visible, rootH]);

  useEffect(() => {
    if (!mounted) return;
    if (visible) {
      ty.value = H;
      settle(MED_TY);
      reportDetent("medium");
    } else {
      ty.value = withTiming(
        H,
        { duration: reduced ? 0 : 240, easing: Easing.in(Easing.cubic) },
        (fin) => {
          if (fin) runOnJS(setMounted)(false);
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, visible, reduced]);

  useImperativeHandle(ref, () => ({
    expand: () => {
      settle(0);
      reportDetent("large");
    },
  }));

  // Снап к ближайшему детенту с учётом скорости; глубокий ход вниз
  // от medium (или рывок) — закрытие.
  const snap = (velocityY: number) => {
    "worklet";
    const projected = ty.value + velocityY * 0.12;
    if (projected > MED_TY + (H - MED_TY) * 0.5 || velocityY > 1200) {
      runOnJS(onClose)();
      return;
    }
    const target = projected < MED_TY / 2 ? 0 : MED_TY;
    settle(target);
    runOnJS(reportDetent)(target === 0 ? "large" : "medium");
  };

  const headerDrag = Gesture.Pan()
    .onChange((e) => {
      ty.value = Math.min(H, Math.max(0, ty.value + e.changeY));
    })
    .onEnd((e) => snap(e.velocityY));


  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      ty.value,
      [0, SCRIM_TY],
      [0.35, 0],
      Extrapolation.CLAMP,
    ),
  }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }],
  }));

  // Корень-оверлей смонтирован ВСЕГДА (box-none — касания проходят к
  // списку): его layout даёт rootH ещё до первого открытия.
  return (
    <View
      pointerEvents="box-none"
      onLayout={(e) => setRootH(e.nativeEvent.layout.height)}
      style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}
    >
      {/* Скрим существует только на large — на medium список живой и
          кликабельный. Тап по скриму опускает обратно на medium. */}
      {mounted && detent === "large" ? (
        <Animated.View
          onTouchEnd={() => {
            settle(MED_TY);
            reportDetent("medium");
          }}
          accessibilityRole="button"
          accessibilityLabel="Свернуть фильтры"
          style={[
            { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 },
            { backgroundColor: "#0B1220" },
            scrimStyle,
          ]}
        />
      ) : null}

      {mounted ? (
      <Animated.View
        style={[
          {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: H,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            backgroundColor: t.surface,
            // Немодальному листу нужна тень-отрыв от живого списка.
            shadowColor: "#0B1220",
            shadowOpacity: 0.16,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: -6 },
            elevation: 16,
          },
          panelStyle,
        ]}
      >
        <GestureDetector gesture={headerDrag}>
          <View className="items-center pb-1 pt-2.5">
            <View
              style={{
                width: 36,
                height: 5,
                borderRadius: 3,
                backgroundColor: "rgba(11,18,32,0.14)",
              }}
            />
          </View>
        </GestureDetector>
        {/* Тело скроллится на ЛЮБОМ детенте (скрыть секции за сгибом без
            скролла — ловушка обнаруживаемости); высоту меняет только
            перетаскивание за язычок/шапку. */}
        <View style={{ flex: 1, overflow: "hidden" }}>{children}</View>
      </Animated.View>
      ) : null}

      {/* Футер-слой: прижат к низу ЭКРАНА, не едет с панелью — CTA со
          счётчиком виден на любом детенте. */}
      {mounted && footer ? (
        <View
          pointerEvents="box-none"
          style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
});
