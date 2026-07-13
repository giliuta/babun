import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/theme/colors";

type ToastType = "success" | "error" | "info";
/** Кнопка-действие в тосте (Undo-паттерн): тост живёт дольше (5 с) и
 *  ловит тапы только по кнопке — остальной экран остаётся рабочим. */
type ToastAction = { label: string; onPress: () => void };
type ToastState = {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
};

const ToastCtx = createContext<
  (message: string, type?: ToastType, action?: ToastAction) => void
>(() => {});

export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-12)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const t = useThemeColors();

  const hide = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -12, duration: 220, useNativeDriver: true }),
    ]).start(() => setToast(null));
  }, [opacity, translateY]);

  const show = useCallback(
    (message: string, type: ToastType = "success", action?: ToastAction) => {
      setToast({ id: Date.now(), message, type, action });
      // The toast is pointerEvents="none" and auto-dismisses — VoiceOver
      // users would never know it appeared without an explicit announcement.
      AccessibilityInfo.announceForAccessibility(
        action ? `${message}. Доступно действие: ${action.label}` : message,
      );
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
      ]).start();
      if (timer.current) clearTimeout(timer.current);
      // С кнопкой держим дольше — человеку нужно успеть передумать.
      timer.current = setTimeout(hide, action ? 5000 : 2200);
    },
    [opacity, translateY, hide],
  );

  // info = inverse surface from the palette (ink ground, canvas text) — the
  // classic iOS dark toast in light mode, a light toast in dark mode.
  const info = toast?.type === "info";
  const toastBg = toast?.type === "error" ? t.danger : info ? t.ink : t.success;
  const toastText = info ? t.canvas : "#ffffff";

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents={toast.action ? "box-none" : "none"}
          style={{
            position: "absolute",
            top: insets.top + 8,
            left: 16,
            right: 16,
            opacity,
            transform: [{ translateY }],
          }}
        >
          <View
            className="flex-row items-center gap-3 rounded-2xl px-4 py-3 shadow-lg"
            style={{ backgroundColor: toastBg }}
          >
            <Text
              className="flex-1 text-sm font-semibold"
              style={{
                color: toastText,
                textAlign: toast.action ? "left" : "center",
              }}
            >
              {toast.message}
            </Text>
            {toast.action ? (
              <Pressable
                onPress={() => {
                  const run = toast.action?.onPress;
                  hide();
                  run?.();
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={toast.action.label}
                className="rounded-full px-3 py-1 active:opacity-70"
                style={{ backgroundColor: "rgba(255,255,255,0.22)" }}
              >
                <Text
                  className="text-sm font-bold"
                  style={{ color: toastText }}
                >
                  {toast.action.label}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </ToastCtx.Provider>
  );
}
