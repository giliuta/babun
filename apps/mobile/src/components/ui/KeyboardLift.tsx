import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  View,
  type KeyboardMetrics,
  type StyleProp,
  type ViewStyle,
} from "react-native";

// ПОДЪЁМ НАД КЛАВИАТУРОЙ — ОДИН НА ВСЁ ПРИЛОЖЕНИЕ (владелец 12.10: «на
// андроид шторка загораживает всё»).
//
// Android-сборка рисует окна во весь экран (edge-to-edge), и система больше
// не сжимает окно под клавиатурой: прежнее `behavior={ios ? "padding" :
// undefined}` на Android не поднимало НИЧЕГО — клавиатура закрывала поля и
// кнопку листа целиком. А штатный KeyboardAvoidingView с "padding" на
// Android поднимает, но не опускает: событие `keyboardDidHide` приходит с
// `screenY` выше нижнего края (838 из 914 dp на Pixel 7), и лист оставался
// висеть на ~76 dp над низом экрана.
//
// iOS — штатный KeyboardAvoidingView, как было. Android — свой расчёт: рамка
// меряется в координатах экрана, подъём = насколько её низ заходит за верх
// клавиатуры; скрытие клавиатуры — ровно ноль.

type Props = {
  style?: StyleProp<ViewStyle>;
  /** Только iOS: рамка начинается ниже верха окна (шапка под вырезом).
   *  Android меряет рамку в координатах экрана и сдвиг не нужен. */
  keyboardVerticalOffset?: number;
  /** `box-none` — рамка сама касаний не ловит, только её содержимое. Нужно
   *  листу: рамка во весь экран лежит ПОВЕРХ затемнения (сосед, не предок),
   *  и тап мимо листа иначе не доходит до «Закрыть». */
  pointerEvents?: "box-none" | "auto";
  children?: ReactNode;
};

export function KeyboardLift(props: Props) {
  return Platform.OS === "android" ? <AndroidLift {...props} /> : <IosLift {...props} />;
}

function IosLift({ style, keyboardVerticalOffset, pointerEvents, children }: Props) {
  return (
    <KeyboardAvoidingView
      behavior="padding"
      pointerEvents={pointerEvents}
      keyboardVerticalOffset={keyboardVerticalOffset}
      style={style}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

function AndroidLift({ style, pointerEvents, children }: Props) {
  const ref = useRef<View>(null);
  const [lift, setLift] = useState(0);

  useEffect(() => {
    let alive = true;
    const raise = (kb: KeyboardMetrics) => {
      // Низ рамки до подъёма: рамка уже поднята на `lift`, её paddingBottom
      // входит в высоту, поэтому меряем всю рамку — она не сжимается.
      //
      // КООРДИНАТЫ ЭКРАНА, А НЕ ОКНА (13.10). `screenY` клавиатуры — от верха
      // экрана; `measureInWindow` на странице отсчитывает от низа строки
      // состояния (рамка под шапкой — 55 dp вместо 107), и подъём недобирал
      // ровно её высоту: «Создать клиента», «Создать запись» и подвалы
      // страниц уходили под клавиатуру. В шторке (своё окно `Modal` во весь
      // экран) оба счёта совпадали, поэтому листы поднимались верно.
      // `measure` даёт `pageY` от корня во весь экран — и там, и там.
      ref.current?.measure((_x, _y, _w, h, _pageX, pageY) => {
        if (!alive) return;
        setLift(Math.max(0, Math.round(pageY + h - kb.screenY)));
      });
    };
    const show = Keyboard.addListener("keyboardDidShow", (e) => raise(e.endCoordinates));
    const hide = Keyboard.addListener("keyboardDidHide", () => setLift(0));
    // Лист открылся, когда клавиатура уже стояла (поле на экране под ним).
    const now = Keyboard.isVisible() ? Keyboard.metrics() : undefined;
    if (now) raise(now);
    return () => {
      alive = false;
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <View ref={ref} pointerEvents={pointerEvents} style={[style, { paddingBottom: lift }]}>
      {children}
    </View>
  );
}
