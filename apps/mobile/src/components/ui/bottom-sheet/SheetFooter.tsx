import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardShown } from "@/lib/keyboard";
import { FOOTER_SIDE } from "@/components/ui/tokens";

/** Подвал листа — ЕДИНСТВЕННОЕ место, где лист платит нижний безопасный
 *  отступ. Отдельным компонентом, чтобы подписка на клавиатуру жила только у
 *  листов с подвалом: `BottomSheet` смонтирован у экрана всегда (закрытый он
 *  просто рисует null), и общий хук подписал бы на события клавиатуры все
 *  листы экрана разом.
 *
 *  Под клавиатурой отступ меньше: её кадр на iOS уже включает полосу
 *  home-индикатора, и обе высоты вместе давали ~34pt пустоты, которые потолок
 *  листа отбирал у содержимого.
 *
 *  Бока — `FOOTER_SIDE`, те же 20, что у кнопки внизу страницы: лист и
 *  страница кончаются одной и той же кнопкой. Лист без полей (`padded={false}`)
 *  ставит их у своей обёртки сам — тем же числом, а лист с полями своей
 *  обёртки с полями не заводит: вместе выходило 32–36. */
export function SheetFooter({
  children,
  padded,
}: {
  children: ReactNode;
  padded?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();
  return (
    <View
      style={{
        paddingHorizontal: padded ? FOOTER_SIDE : 0,
        paddingBottom: keyboardShown ? 12 : Math.max(insets.bottom, 16),
      }}
    >
      {children}
    </View>
  );
}
