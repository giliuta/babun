import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/** Показана ли клавиатура.
 *
 *  Нужен там, где мы САМИ платим нижний safe-area отступ (нижние листы:
 *  BottomSheet его не платит). Клавиатура iOS уже включает зону
 *  home-индикатора, поэтому её подъём + наш `insets.bottom` дают лишние ~34pt
 *  пустоты под кнопкой — а из-за потолка листа эти пункты отбираются у
 *  контента.
 *
 *  iOS: `will*` идёт в такт анимации клавиатуры, поэтому отступ меняется
 *  вместе с подъёмом, а не рывком после. На Android таких событий нет. */
export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(
      ios ? "keyboardWillShow" : "keyboardDidShow",
      () => setShown(true),
    );
    const hide = Keyboard.addListener(
      ios ? "keyboardWillHide" : "keyboardDidHide",
      () => setShown(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}
