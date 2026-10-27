import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";
import type { KeyboardTypeOptions } from "react-native";

/** КЛАВИАТУРА ТОЛЬКО С ЛАТИНИЦЕЙ — для того, что пишется только латиницей:
 *  @username в Instagram и Telegram, IBAN, VAT, серийный номер, имя
 *  отправителя SMS. С русской раскладкой человек сперва набирал кириллицу,
 *  стирал и искал глобус. Своё значение у каждой платформы: iOS прячет
 *  остальные языки при `ascii-capable`, Android даёт латиницу без подсказок
 *  при `visible-password` (символы при этом видны — это не поле пароля). */
export const LATIN_KEYBOARD: KeyboardTypeOptions =
  Platform.OS === "ios" ? "ascii-capable" : Platform.OS === "android" ? "visible-password" : "default";

/** Показана ли клавиатура.
 *
 *  Нужен там, где платится нижний safe-area отступ: сам `BottomSheet` за свой
 *  проп `footer`, а лист — за собственный подвал, если он его рисует мимо
 *  этого пропа. Клавиатура iOS уже включает зону
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
