import { createContext, useContext, useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import { View, type ScrollView, type StyleProp, type ViewStyle } from "react-native";
import { NavigationContext } from "@react-navigation/native";
import {
  registerTourTarget,
  tourTargetTapped,
  unregisterTourTarget,
  type TourScroll,
  type TourShape,
} from "./tour-store";

// ЭЛЕМЕНТ, КОТОРЫЙ ОБУЧЕНИЕ УМЕЕТ ПОДСВЕТИТЬ. Обёртка записывает себя в
// реестр вместе с «хозяином» — окном, где она нарисована: экран приложения
// или конкретная шторка (у шторки своё окно, и подсказка для поля в шторке
// рисуется внутри неё). Без идущего обучения обёртка — обычный View.

const TourHostContext = createContext("root");
const TourScrollContext = createContext<TourScroll | null>(null);

export const TourHostProvider = TourHostContext.Provider;

/** Прокрутка, внутри которой лежат цели: обучение докручивает к ним. */
export function TourScrollProvider({
  scrollRef,
  scrollY,
  children,
}: {
  scrollRef: RefObject<ScrollView | null>;
  scrollY: RefObject<number>;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ ref: scrollRef, y: scrollY as { current: number } }),
    [scrollRef, scrollY],
  );
  return <TourScrollContext.Provider value={value}>{children}</TourScrollContext.Provider>;
}

export function TourTarget({
  id,
  children,
  flex,
  shape = "card",
  style,
}: {
  id: string;
  children: ReactNode;
  /** Обёртка растягивается, как растягивался бы сам элемент (сетка, заголовок). */
  flex?: boolean;
  /** Форма подсветки (`TourShape`); по умолчанию — строка карточки. */
  shape?: TourShape;
  /** Раскладка самой обёртки, когда она стоит между кнопкой и её
   *  содержимым (подсветка по надписи, а не по всему полю кнопки). */
  style?: StyleProp<ViewStyle>;
}) {
  const host = useContext(TourHostContext);
  const scroll = useContext(TourScrollContext);
  const focused = useScreenFocused();
  // Узел — состоянием: запись в реестр идёт эффектом, который знает и узел, и
  // фокус экрана.
  const [node, setNode] = useState<View | null>(null);
  // ЦЕЛЬ ЕСТЬ, ТОЛЬКО ПОКА ЕЁ ЭКРАН В ФОКУСЕ. Экран под открытой поверх него
  // страницей стека остаётся смонтированным, и его цели мерились бы по
  // старым координатам: вырез и пузырь вставали поверх чужой страницы, а
  // «нажмите шестерёнку» указывало на «‹ Назад» — глава застревала. Ушёл
  // экран из фокуса — цель снята, шаг ждёт, пока экран вернётся.
  useEffect(() => {
    if (!node || !focused) return;
    registerTourTarget(id, { node, host, scroll, shape });
    return () => unregisterTourTarget(id, node);
  }, [node, focused, id, host, scroll, shape]);
  return (
    <View
      // `collapsable={false}`: иначе Android выкидывает пустую обёртку из
      // дерева, и мерить становится нечего.
      collapsable={false}
      style={[flex ? { flex: 1 } : null, style]}
      ref={setNode}
      // Касание доходит до обёртки при любом ответчике внутри: кнопка
      // жмётся как обычно, а обучение узнаёт, что нажали именно её.
      onTouchEnd={() => tourTargetTapped(id)}
    >
      {children}
    </View>
  );
}

/** В фокусе ли экран, где нарисована цель. Вне экрана навигации (таб-бар,
 *  корневые окна) — всегда да. Событие `blur` приходит и экрану, накрытому
 *  страницей стека, и экрану ушедшей вкладки. */
function useScreenFocused(): boolean {
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? true);
  useEffect(() => {
    if (!navigation) return;
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener("focus", () => setFocused(true));
    const offBlur = navigation.addListener("blur", () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);
  return focused;
}
