import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AccessibilityInfo, Animated } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReduceMotion } from "@/lib/reduce-motion";
import { NoticeBar, isQuietTone, type NoticeTone } from "./NoticeBar";

/** Тона — общие с `NoticeBar`: одна плашка на весь продукт, разные места. */
type ToastType = NoticeTone;
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
  const reducedMotion = useReduceMotion();

  const hide = useCallback(() => {
    if (reducedMotion) {
      opacity.setValue(0);
      translateY.setValue(-12);
      setToast(null);
      return;
    }
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -12, duration: 220, useNativeDriver: true }),
    ]).start(() => setToast(null));
  }, [opacity, reducedMotion, translateY]);

  const show = useCallback(
    (message: string, type: ToastType = "success", action?: ToastAction) => {
      setToast({ id: Date.now(), message, type, action });
      // The toast is pointerEvents="none" and auto-dismisses — VoiceOver
      // users would never know it appeared without an explicit announcement.
      AccessibilityInfo.announceForAccessibility(
        action ? `${message}. Доступно действие: ${action.label}` : message,
      );
      if (reducedMotion) {
        opacity.setValue(1);
        translateY.setValue(0);
      } else {
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 180,
            useNativeDriver: true,
          }),
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
        ]).start();
      }
      if (timer.current) clearTimeout(timer.current);
      // С кнопкой держим дольше — человеку нужно успеть передумать.
      timer.current = setTimeout(hide, action ? 5000 : 2200);
    },
    [hide, opacity, reducedMotion, translateY],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const quiet = toast ? isQuietTone(toast.type) : false;

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents={toast.action ? "box-none" : "none"}
          style={{
            position: "absolute",
            // Тихая плашка — ПОЛОСА ВО ВСЮ ШИРИНУ, вплотную к верху: ровно
            // так лежит `CalendarNotice`, и поля с зазором делали бы из неё
            // висящую карточку. Остальные тона остаются карточкой.
            top: insets.top + (quiet ? 0 : 8),
            left: quiet ? 0 : 16,
            right: quiet ? 0 : 16,
            opacity,
            transform: [{ translateY }],
          }}
        >
          <NoticeBar
            tone={toast.type}
            message={toast.message}
            action={
              toast.action
                ? {
                    label: toast.action.label,
                    onPress: () => {
                      const run = toast.action?.onPress;
                      hide();
                      run?.();
                    },
                  }
                : undefined
            }
          />
        </Animated.View>
      ) : null}
    </ToastCtx.Provider>
  );
}
