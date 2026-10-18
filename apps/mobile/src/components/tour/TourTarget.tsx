import { createContext, useCallback, useContext, useMemo, type ReactNode, type RefObject } from "react";
import { View, type ScrollView } from "react-native";
import { registerTourTarget, tourTargetTapped, type TourScroll } from "./tour-store";

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

export function useTourHost(): string {
  return useContext(TourHostContext);
}

export function TourTarget({
  id,
  children,
  flex,
}: {
  id: string;
  children: ReactNode;
  /** Обёртка растягивается, как растягивался бы сам элемент (сетка, заголовок). */
  flex?: boolean;
}) {
  const host = useContext(TourHostContext);
  const scroll = useContext(TourScrollContext);
  // Ref стабилен: новая функция на каждой отрисовке снимала бы и ставила цель
  // заново, и слой подсказки перемерял бы её на каждый кадр экрана.
  const ref = useCallback(
    (node: View | null) => registerTourTarget(id, node ? { node, host, scroll } : null),
    [id, host, scroll],
  );
  return (
    <View
      // `collapsable={false}`: иначе Android выкидывает пустую обёртку из
      // дерева, и мерить становится нечего.
      collapsable={false}
      style={flex ? { flex: 1 } : undefined}
      ref={ref}
      // Касание доходит до обёртки при любом ответчике внутри: кнопка
      // жмётся как обычно, а обучение узнаёт, что нажали именно её.
      onTouchEnd={() => tourTargetTapped(id)}
    >
      {children}
    </View>
  );
}
