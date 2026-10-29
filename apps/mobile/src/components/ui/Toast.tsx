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
import { tDynamic } from "@babun/shared/i18n/runtime";
import { useReduceMotion } from "@/lib/reduce-motion";
import { NoticeBar, type NoticeTone } from "./NoticeBar";

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

/** ТОСТ ИЗ-ЗА ПРЕДЕЛОВ ДЕРЕВА. Сетка ошибок мутаций, sync-runtime и выход
 *  зовут сообщение не из компонента (`lib/notify.ts`); смонтированный
 *  `ToastProvider` даёт им свою полосу. Нет хоста — `false`, зовущий решает
 *  сам. */
let hostShow: ((message: string, type: ToastType, ms: number) => void) | null = null;
export function toastOutsideTree(message: string, type: ToastType, ms: number): boolean {
  if (!hostShow) return false;
  hostShow(message, type, ms);
  return true;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-12)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Тост, чья кнопка уже нажата: второй тап — пока плашка гаснет (220 мс) —
   *  не делает ничего. Двойное «Снять» уходило вторым снятием по уже снятому
   *  платежу: сервер отвечал «Платёж не найден», и экран откатывался назад. */
  const actedId = useRef<number | null>(null);
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
      // Только ДОИГРАННОЕ угасание убирает плашку. Новый тост в эти 220 мс
      // останавливает его анимацию, и колбэк приходит с `finished: false` —
      // иначе он стёр бы только что показанный тост (быстрый отказ сервера
      // после «Отменить» пропадал бы молча).
    ]).start(({ finished }) => {
      if (finished) setToast(null);
    });
  }, [opacity, reducedMotion, translateY]);

  const showFor = useCallback(
    (raw: string, type: ToastType, action: ToastAction | undefined, ms: number) => {
      // Текст тоста часто приходит с сервера (`error.message` из функции
      // базы) — сборка его не переводила, переводим при показе.
      const message = tDynamic(raw);
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
      timer.current = setTimeout(hide, ms);
    },
    [hide, opacity, reducedMotion, translateY],
  );
  const show = useCallback(
    (raw: string, type: ToastType = "success", action?: ToastAction) =>
      // С кнопкой держим дольше — человеку нужно успеть передумать.
      showFor(raw, type, action, action ? 5000 : 2200),
    [showFor],
  );
  useEffect(() => {
    const own = (message: string, type: ToastType, ms: number) => showFor(message, type, undefined, ms);
    hostShow = own;
    return () => {
      if (hostShow === own) hostShow = null;
    };
  }, [showFor]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {/* ПОЛОСА СМОНТИРОВАНА ВСЕГДА, ПУСТАЯ — КОГДА ТОСТА НЕТ.
          Если монтировать её вместе с тостом, появление запускается в том же
          вызове — до того, как вид встал на экран. После
          первого угасания значение прозрачности уже живёт в нативном
          аниматоре, и новый вид встаёт с нулём, а анимация к единице к этому
          моменту уже отыграла: тост «Перенесено · Отменить» вызывается, но
          невидим — отменить перенос было бы нечем. */}
      <Animated.View
        pointerEvents={toast?.action ? "box-none" : "none"}
        style={{
          position: "absolute",
          // ПОЛОСА ВО ВСЮ ШИРИНУ, вплотную к верху — у любого тона: ровно
          // так лежит `CalendarNotice`, и поля с зазором делали бы из неё
          // висящую карточку: все уведомления везде одинаковые.
          top: insets.top,
          left: 0,
          right: 0,
          opacity,
          transform: [{ translateY }],
        }}
      >
        {toast ? (
          <NoticeBar
            tone={toast.type}
            message={toast.message}
            action={
              toast.action
                ? {
                    label: toast.action.label,
                    onPress: () => {
                      if (actedId.current === toast.id) return;
                      actedId.current = toast.id;
                      const run = toast.action?.onPress;
                      hide();
                      run?.();
                    },
                  }
                : undefined
            }
          />
        ) : null}
      </Animated.View>
    </ToastCtx.Provider>
  );
}
