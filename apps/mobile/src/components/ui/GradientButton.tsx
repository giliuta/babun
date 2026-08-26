import { useEffect, useId, useState } from "react";
import { Pressable, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useThemeColors } from "@/theme/colors";
import { ctaGradient } from "@/components/ui/color-contrast";
import { useReduceMotion } from "@/lib/reduce-motion";
import { haptics } from "@/lib/haptics";
import { Spinner } from "@/components/ui/Spinner";

// «ПЛИТА» — единственная главная кнопка продукта.
//
// ОДНА СТЕПЕНЬ СВОБОДЫ: высота над страницей. Покой 8pt (brandShadow),
// нажатие 2pt (brandShadowPressed), выключено 0 (тени нет). Из неё выведено
// всё остальное: тень, вуаль, ход, пружина. Тень НЕ интерполируется строкой —
// два готовых слоя крест-фейдятся по opacity (чистый GPU; кто «упростит» до
// withTiming по строке, молча потеряет анимацию на части сборок).
//
// ДВИЖЕНИЕ ТОЛЬКО ПО ДЕЛУ: появления нет (кнопка ремонтируется на обычной
// навигации — тернарник по сегменту на «Финансах», смена шага в листах),
// в покое ноль кадров, петля в продукте одна и это Spinner. Бесконечный блик
// удалён: неподвижный предмет под неподвижной лампой не может иметь едущий
// отсвет. apps/mobile/docs/DESIGN-SYSTEM.md §5.
//
// МАССА ПРУЖИНИТ, СВЕТ — НЕТ: transform идёт spring'ом, цвет и прозрачность —
// только timing. Поэтому `dip` и `contact` — РАЗНЫЕ значения: пружина уходит
// в перелёт −2.6%, и общая с ней прозрачность вуали ушла бы в минус.
const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const;

const IN = { duration: 90, easing: Easing.out(Easing.quad) } as const;
const OUT = { duration: 160, easing: Easing.out(Easing.quad) } as const;
const RECOIL = { damping: 26, stiffness: 420, mass: 0.7 } as const; // ζ .758, покой ~215мс
const UP = { duration: 220, easing: Easing.out(Easing.cubic) } as const;
const DOWN = { duration: 160, easing: Easing.in(Easing.quad) } as const;

export function GradientButton({
  label,
  onPress,
  disabled,
  loading,
  tint,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tint?: string;
  accessibilityHint?: string;
}) {
  const t = useThemeColors();
  const reduced = useReduceMotion();
  const gid = useId();                       // хардкодный id="gbtn" схлопывал
                                             // два градиента при двух tint-кнопках
  const filled = loading || !disabled;
  const pressable = !disabled && !loading;
  const g = tint ? ctaGradient(tint) : null;
  const fromColor = g?.from ?? t.accentFrom;
  const toColor = g?.to ?? t.accentTo;
  const labelColor = g?.label ?? t.onAccent;
  const glassEdge = g ? g.sheen : true;
  // На бледных tint с чернильной подписью тёмная вуаль дала бы грязь и
  // УРОНИЛА бы контраст — знак вуали инвертируется вместе с подписью.
  const veilColor = glassEdge ? "#0b1220" : "#ffffff";
  const veilMax = glassEdge ? 0.1 : 0.14;
  const R = t.radius.card;
  const SHELL = { borderRadius: R, borderCurve: "continuous" } as const;

  const [box, setBox] = useState({ w: 0, h: 0 });

  const dip = useSharedValue(0);                    // масса (гасится Reduce Motion)
  const contact = useSharedValue(0);                // свет (живёт всегда)
  const live = useSharedValue(filled ? 1 : 0);      // заливка + цвет подписи
  const glow = useSharedValue(filled ? 1 : 0);      // высота над страницей
  const busy = useSharedValue(loading ? 1 : 0);

  useEffect(() => {
    if (filled) {
      live.value = withTiming(1, UP);
      // Тень отстаёт на 60мс: сначала предмет набирает материал, потом
      // отрывается от страницы. Тень раньше цвета читается как сбой отрисовки.
      glow.value = withDelay(60, withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) }));
    } else {
      live.value = withTiming(0, DOWN);
      glow.value = withTiming(0, DOWN);
    }
  }, [filled, live, glow]);

  useEffect(() => {
    busy.value = withTiming(loading ? 1 : 0, { duration: 160 });
  }, [loading, busy]);

  const dipStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dip.value * 1.5 }, { scale: 1 - dip.value * 0.015 }],
  }));
  const restShadowStyle = useAnimatedStyle(() => ({
    opacity: glow.value * (1 - contact.value) * (1 - busy.value * 0.45),
  }));
  const pressShadowStyle = useAnimatedStyle(() => ({ opacity: glow.value * contact.value }));
  const fillStyle = useAnimatedStyle(() => ({ opacity: live.value }));
  const veilStyle = useAnimatedStyle(() => ({ opacity: contact.value * veilMax }));
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(live.value, [0, 1], [t.sub, labelColor]),
  }));

  return (
    <Pressable
      onPress={pressable ? onPress : undefined}
      onPressIn={() => {
        if (!pressable) return;
        haptics.tap();
        // Вуаль работает И при Reduce Motion: флаг просит убрать ДВИЖЕНИЕ,
        // а не обратную связь. Без неё кнопка мёртвая на ощупь (текущий баг).
        contact.value = withTiming(1, IN);
        if (!reduced) dip.value = withTiming(1, IN);
      }}
      onPressOut={() => {
        contact.value = withTiming(0, OUT);
        if (!reduced) dip.value = withSpring(0, RECOIL);
      }}
      disabled={!pressable}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !pressable, busy: !!loading }}
    >
      {/* Трансформ на ВНЕШНЕЙ обёртке: тени едут вместе с корпусом, иначе
          из-под сжатого тела вылезает кобальтовый ободок. Здесь НЕТ
          overflow:hidden — он срезал бы тень. */}
      <Animated.View style={[{ position: "relative" }, dipStyle]}>
        <Animated.View
          pointerEvents="none"
          style={[FILL, SHELL, { backgroundColor: toColor, boxShadow: g?.shadow ?? t.brandShadow }, restShadowStyle]}
        />
        <Animated.View
          pointerEvents="none"
          style={[FILL, SHELL, { backgroundColor: toColor, boxShadow: g?.shadowPressed ?? t.brandShadowPressed }, pressShadowStyle]}
        />

        <View
          onLayout={(e) =>
            setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
          }
          style={{
            // minHeight + padding (не фиксированная высота): Dynamic Type
            // растит подпись, не обрезая её. Радиус от высоты НЕ зависит.
            minHeight: 52,
            paddingVertical: 14,
            ...SHELL,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: t.disabledFill,
          }}
        >
          {/* Заливка ПРОЯВЛЯЕТСЯ, а не подменяется. backgroundColor под SVG —
              намеренная страховка: если SVG где-то не отрисуется, кнопка
              выглядит ровным кобальтом, а не дырой. */}
          <Animated.View pointerEvents="none" style={[FILL, { backgroundColor: toColor }, fillStyle]}>
            {box.w > 0 ? (
              <Svg width={box.w} height={box.h}>
                <Defs>
                  {/* СВЕТ СВЕРХУ — как тень вниз и как верхняя кромка.
                      Прежняя «диагональ 135°» на боксе 370×52 фактически
                      горизонтальна: вертикаль даёт 52²/(370²+52²) = 1.9%
                      диапазона, то есть свет шёл СБОКУ и спорил с тенью.
                      userSpaceOnUse + числа: проценты не везде резолвятся. */}
                  <LinearGradient id={`f${gid}`} x1="0" y1="0" x2="0" y2={box.h} gradientUnits="userSpaceOnUse">
                    <Stop offset="0" stopColor={fromColor} />
                    <Stop offset="1" stopColor={toColor} />
                  </LinearGradient>
                  {/* Кромки гаснут к торцам: при r=10 непрерывная кривая
                      забирает 15.3pt с каждого конца, и линия с рублеными
                      краями обрывается о клип «носиком». */}
                  <LinearGradient id={`e${gid}`} x1="0" y1="0" x2={box.w} y2="0" gradientUnits="userSpaceOnUse">
                    <Stop offset="0" stopColor="#ffffff" stopOpacity="0" />
                    <Stop offset="0.18" stopColor="#ffffff" stopOpacity="0.45" />
                    <Stop offset="0.82" stopColor="#ffffff" stopOpacity="0.45" />
                    <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
                  </LinearGradient>
                  <LinearGradient id={`o${gid}`} x1="0" y1="0" x2={box.w} y2="0" gradientUnits="userSpaceOnUse">
                    <Stop offset="0" stopColor="#04102e" stopOpacity="0" />
                    <Stop offset="0.18" stopColor="#04102e" stopOpacity="0.18" />
                    <Stop offset="0.82" stopColor="#04102e" stopOpacity="0.18" />
                    <Stop offset="1" stopColor="#04102e" stopOpacity="0" />
                  </LinearGradient>
                </Defs>
                <Rect x={0} y={0} width={box.w} height={box.h} fill={`url(#f${gid})`} />
                {glassEdge ? (
                  <>
                    {/* Верх ловит небо, низ уходит от света: пара волосяных
                        линий и есть толщина плиты. y считается ОТ ИЗМЕРЕННОЙ
                        высоты — при Dynamic Type кнопка растёт. */}
                    <Rect x={0} y={0} width={box.w} height={1} fill={`url(#e${gid})`} />
                    <Rect x={0} y={box.h - 1} width={box.w} height={1} fill={`url(#o${gid})`} />
                  </>
                ) : null}
              </Svg>
            ) : null}
          </Animated.View>

          {/* Контактное затемнение вместо opacity 0.9: нажатие обязано
              ДОБАВЛЯТЬ читаемость (4.81 → 5.54:1 на светлом конце,
              6.89 → 7.46:1 на тёмном), а не отнимать. */}
          <Animated.View pointerEvents="none" style={[FILL, { backgroundColor: veilColor }, veilStyle]} />

          {loading ? (
            // Спиннер у ВЕДУЩЕГО края, абсолютной позицией: подпись не уезжает
            // ни на пункт. Свой accessible-узел скрыт — состояние несёт
            // accessibilityState.busy самой кнопки.
            <Animated.View
              entering={FadeIn.duration(140)}
              exiting={FadeOut.duration(100)}
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{ position: "absolute", left: 20, top: 0, bottom: 0, justifyContent: "center" }}
            >
              <Spinner size={18} color={labelColor} label="" />
            </Animated.View>
          ) : null}

          {/* Подпись НЕ исчезает при загрузке: это ровно тот момент, когда
              человек больше всего хочет знать, что происходит с его деньгами. */}
          <Animated.Text
            maxFontSizeMultiplier={1.3}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            style={[{ fontSize: 17, fontWeight: "600", letterSpacing: 0.2 }, labelStyle]}
          >
            {label}
          </Animated.Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}
