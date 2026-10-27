import { type RefObject, useEffect, useRef } from "react";
import {
  Keyboard,
  TextInput,
  type HostInstance,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from "react-native";

/** `getInnerViewRef` есть у ScrollView во время работы, но не в его типах. */
type InnerViewOwner = { getInnerViewRef?: () => HostInstance | null };

/** Запас над полем, чтобы под ним было видно край блока, а не впритык. */
const MARGIN = 16;

/** ПОЛЕ В ФОКУСЕ ДОВОДИТСЯ ДО ГЛАЗА — после того, как лист поднялся.
 *
 *  iOS докручивает к полю в момент фокуса, а лист сжимается позже — когда
 *  выезжает клавиатура. Заметка внизу листа («Заметка операции», перевода,
 *  долга) в момент тапа была видна, а после подъёма оказывалась под футером
 *  и клавиатурой: каретки не видно, текст набирался вслепую. Поэтому после
 *  подъёма (`keyboardDidShow`) и при росте многострочного поля лист сам
 *  прокручивает тело так, чтобы поле в фокусе встало в видимую часть.
 *
 *  Поле вне этого листа (`measureLayout` не находит общего предка) не
 *  трогается. */
export function useRevealFocused(enabled: boolean, outerRef?: RefObject<ScrollView | null>) {
  const own = useRef<ScrollView | null>(null);
  const offset = useRef(0);
  const viewport = useRef(0);

  const reveal = () => {
    const scroll = own.current;
    const input: HostInstance | null = TextInput.State.currentlyFocusedInput();
    // Внутренний вид прокрутки — начало содержимого: координаты поля от него
    // не зависят от того, насколько тело уже прокручено. Нужен сам вид:
    // `getInnerViewNode` отдаёт номер, а `measureLayout` в новой архитектуре
    // по номеру молчит — не зовёт ни успех, ни отказ.
    const content = (scroll as InnerViewOwner | null)?.getInnerViewRef?.();
    if (!scroll || !input || !content || viewport.current <= 0) return;
    input.measureLayout(
      content,
      (_x, y, _w, h) => {
        const top = offset.current;
        const bottom = top + viewport.current;
        let next: number | null = null;
        if (y + h + MARGIN > bottom) next = y + h + MARGIN - viewport.current;
        else if (y - MARGIN < top) next = Math.max(0, y - MARGIN);
        if (next !== null) scroll.scrollTo({ y: next, animated: true });
      },
      () => undefined,
    );
  };
  const revealRef = useRef(reveal);
  revealRef.current = reveal;

  useEffect(() => {
    if (!enabled) return;
    const sub = Keyboard.addListener("keyboardDidShow", () => revealRef.current());
    return () => sub.remove();
  }, [enabled]);

  return {
    ref: (node: ScrollView | null) => {
      own.current = node;
      if (outerRef) outerRef.current = node;
    },
    scrollEventThrottle: 16,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = e.nativeEvent.contentOffset.y;
    },
    onLayout: (e: LayoutChangeEvent) => {
      viewport.current = e.nativeEvent.layout.height;
    },
    // Многострочное поле выросло на строку — каретка не уходит под футер.
    onContentSizeChange: () => {
      if (enabled && Keyboard.isVisible()) revealRef.current();
    },
  };
}
