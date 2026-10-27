import { useEffect, useState } from "react";
import { Image, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { markSplashLeft } from "./splash-state";

// ЗАСТАВКА ЗАГРУЗКИ: логотип и снизу слово Babun. Системная заставка iPhone —
// белый лист и знак по центру — вшита в сборку и по воздуху не меняется.
// Поэтому за ней встаёт такая же картинка, пиксель в пиксель (тот же файл, та
// же раскладка «contain» во весь экран), а под знаком проявляется «Babun».
// Стыка не видно: системная уходит, а на её месте то же самое, только со
// словом. Держится, пока первый экран не готов (`markBootReady` — календарь
// загрузил данные), но не дольше `MAX_MS`; уходит растворением.

const MAX_MS = 6000;
const SPLASH = require("../../../assets/splash-icon.png");
/** Нижний край знака внутри картинки заставки (1024 px, знак 295…745). */
const MARK_BOTTOM = 745 / 1024;

let ready = false;
const listeners = new Set<() => void>();

/** Первый экран готов — заставка уходит. Зовёт календарь, когда загрузил. */
export function markBootReady(): void {
  if (ready) return;
  ready = true;
  for (const cb of listeners) cb();
}

export function BootSplash({ hold }: { hold: boolean }) {
  // `hold` — вход есть и экран ещё грузится; без входа заставка уходит сразу:
  // у экрана входа своё появление со знаком.
  const { width, height } = useWindowDimensions();
  const [gone, setGone] = useState(false);
  const fade = useSharedValue(1);
  const word = useSharedValue(0);

  useEffect(() => {
    word.value = withDelay(120, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
  }, [word]);

  useEffect(() => {
    if (gone) return;
    const leave = () => {
      markSplashLeft();
      fade.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) }, (done) => {
        if (done) runOnJS(setGone)(true);
      });
    };
    if (!hold || ready) {
      leave();
      return;
    }
    listeners.add(leave);
    const timer = setTimeout(leave, MAX_MS);
    return () => {
      listeners.delete(leave);
      clearTimeout(timer);
    };
  }, [hold, gone, fade]);

  const rootStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: word.value,
    transform: [{ translateY: (1 - word.value) * 8 }],
  }));

  if (gone) return null;
  // «contain» квадратной картинки во весь экран — сторона по узкой стороне.
  const side = Math.min(width, height);
  const top = (height - side) / 2;
  return (
    <Animated.View
      pointerEvents={hold ? "auto" : "none"}
      style={[
        { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#ffffff" },
        rootStyle,
      ]}
    >
      <Image
        source={SPLASH}
        style={{ position: "absolute", left: (width - side) / 2, top, width: side, height: side }}
        resizeMode="contain"
      />
      <Animated.View
        style={[
          { position: "absolute", left: 0, right: 0, top: top + side * MARK_BOTTOM + 18, alignItems: "center" },
          wordStyle,
        ]}
      >
        <View>
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 34, lineHeight: 40, fontWeight: "800", letterSpacing: -0.6, color: "#0B1220" }}
          >
            Babun
          </Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}
