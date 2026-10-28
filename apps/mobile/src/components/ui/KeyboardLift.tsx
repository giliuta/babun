import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Keyboard,
  LayoutAnimation,
  Platform,
  View,
  type KeyboardEvent,
  type KeyboardMetrics,
  type StyleProp,
  type ViewStyle,
} from "react-native";

// ПОДЪЁМ НАД КЛАВИАТУРОЙ — ОДИН НА ВСЁ ПРИЛОЖЕНИЕ: без него на Android шторка
// загораживает всё.
//
// Android-сборка рисует окна во весь экран (edge-to-edge), и система больше
// не сжимает окно под клавиатурой: прежнее `behavior={ios ? "padding" :
// undefined}` на Android не поднимало НИЧЕГО — клавиатура закрывала поля и
// кнопку листа целиком. А штатный KeyboardAvoidingView с "padding" на
// Android поднимает, но не опускает: событие `keyboardDidHide` приходит с
// `screenY` выше нижнего края (838 из 914 dp на Pixel 7), и лист оставался
// висеть на ~76 dp над низом экрана.
//
// iOS штатный KeyboardAvoidingView тоже не годится: он сравнивает низ рамки
// из `onLayout` — в координатах РОДИТЕЛЯ — с `screenY` клавиатуры в
// координатах ЭКРАНА. Страница под вырезом (`Screen edges={["top"]}`,
// `SafeAreaView`) начинается на `insets.top` ниже, и подъём недобирал ровно
// его: «Пригласить», «Выставить инвойс», «Сменить пароль», «Создать аккаунт»
// уходили под клавиатуру на 47 pt (iPhone 17e). Вручную переданный сдвиг
// спасал только там, где его не забыли, а замерить его заранее нельзя: пока
// экран въезжает, он ещё не в окне.
//
// Поэтому расчёт один на обе платформы: рамка меряется в момент события
// клавиатуры, в координатах экрана, подъём = насколько её низ заходит за
// верх клавиатуры; скрытие клавиатуры — ровно ноль.

type Props = {
  style?: StyleProp<ViewStyle>;
  /** `box-none` — рамка сама касаний не ловит, только её содержимое. Нужно
   *  листу: рамка во весь экран лежит ПОВЕРХ затемнения (сосед, не предок),
   *  и тап мимо листа иначе не доходит до «Закрыть». */
  pointerEvents?: "box-none" | "auto";
  children?: ReactNode;
};

const IOS = Platform.OS === "ios";

/** Подъём едет в такт клавиатуре (iOS: длительность и кривая из события). */
function animateWith(e: KeyboardEvent | null) {
  if (!IOS || !e?.duration) return;
  const duration = Math.max(e.duration, 10);
  LayoutAnimation.configureNext({
    duration,
    update: { duration, type: LayoutAnimation.Types[e.easing] ?? LayoutAnimation.Types.keyboard },
  });
}

export function KeyboardLift({ style, pointerEvents, children }: Props) {
  const ref = useRef<View>(null);
  const [lift, setLiftState] = useState(0);
  const liftNow = useRef(0);
  // ПОСЛЕДНИЙ ЗАМЕР РАМКИ — чтобы поднять В ТОМ ЖЕ КАДРЕ, что пришло событие.
  // Замер асинхронный, и подъём, пришедший кадром позже, опаздывал к
  // докрутке формы к полю (запись докручивает к заметке через 300 мс после
  // фокуса): прокрутка считалась по ещё не сжатой странице, и заметка
  // оставалась под футером. Свежий замер потом уточняет подъём.
  const frame = useRef<{ pageY: number; h: number } | null>(null);
  const remember = () =>
    ref.current?.measure((_x, _y, _w, h, _pageX, pageY) => {
      frame.current = { pageY, h };
    });

  useEffect(() => {
    let alive = true;
    // КЛАВИАТУРА СЕЙЧАС СТОИТ — по нашим же событиям, а не `Keyboard.isVisible()`:
    // на iOS подъём идёт с `keyboardWillShow`, когда тот ещё `false`. Замер
    // асинхронный, и на медленном Android его ответ приходил ПОСЛЕ
    // `keyboardDidHide`: подъём возвращался, и лист висел посреди экрана с
    // пустотой под ним, хотя клавиатуры уже нет.
    let shown = false;
    const setLift = (next: number, e: KeyboardEvent | null) => {
      if (liftNow.current === next) return;
      liftNow.current = next;
      animateWith(e);
      setLiftState(next);
    };
    const raise = (kb: KeyboardMetrics, e: KeyboardEvent | null) => {
      // «Предпочитать плавные переходы» (Универсальный доступ iOS): событие
      // приходит с `screenY` 0 — клавиатура не выезжает, поднимать нечего.
      if (kb.screenY <= 0) return;
      shown = true;
      const known = frame.current;
      if (known) setLift(Math.max(0, Math.round(known.pageY + known.h - kb.screenY)), e);
      // Низ рамки до подъёма: рамка уже поднята на `lift`, её paddingBottom
      // входит в высоту, поэтому меряем всю рамку — она не сжимается.
      //
      // КООРДИНАТЫ ЭКРАНА, А НЕ ОКНА. `screenY` клавиатуры — от верха
      // экрана; `measureInWindow` на Android-странице отсчитывает от низа
      // строки состояния (рамка под шапкой — 55 dp вместо 107), и подъём
      // недобирал ровно её высоту. `measure` даёт `pageY` от корня во весь
      // экран — и на странице, и в шторке (своё окно `Modal`).
      ref.current?.measure((_x, _y, _w, h, _pageX, pageY) => {
        if (!alive) return;
        frame.current = { pageY, h };
        if (!shown) return;
        setLift(Math.max(0, Math.round(pageY + h - kb.screenY)), e);
      });
    };
    // iOS: `will*` — подъём в такт анимации клавиатуры, и `keyboardWillShow`
    // приходит снова, когда клавиатура меняет высоту (полоса подсказок,
    // другая раскладка). На Android таких событий нет.
    const show = Keyboard.addListener(IOS ? "keyboardWillShow" : "keyboardDidShow", (e) =>
      raise(e.endCoordinates, e),
    );
    const hide = Keyboard.addListener(IOS ? "keyboardWillHide" : "keyboardDidHide", (e) => {
      shown = false;
      setLift(0, e);
    });
    // Лист открылся, когда клавиатура уже стояла (поле на экране под ним).
    const now = Keyboard.isVisible() ? Keyboard.metrics() : undefined;
    if (now) raise(now, null);
    return () => {
      alive = false;
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <View
      ref={ref}
      pointerEvents={pointerEvents}
      // Замер — через `ref`: `currentTarget` события к моменту ответа уже
      // обнулён, и `measure` падал на null.
      onLayout={remember}
      style={[style, { paddingBottom: lift }]}
    >
      {children}
    </View>
  );
}
