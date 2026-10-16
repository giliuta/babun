import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardShown } from "@/lib/keyboard";
import { GUTTER } from "@/components/ui/tokens";

/** Подвал листа — ЕДИНСТВЕННОЕ место, где лист платит нижний безопасный
 *  отступ. Отдельным компонентом, чтобы подписка на клавиатуру жила только у
 *  листов с подвалом: `BottomSheet` смонтирован у экрана всегда (закрытый он
 *  просто рисует null), и общий хук подписал бы на события клавиатуры все
 *  листы экрана разом.
 *
 *  Под клавиатурой отступ меньше: её кадр на iOS уже включает полосу
 *  home-индикатора, и обе высоты вместе давали ~34pt пустоты, которые потолок
 *  листа отбирал у содержимого. */
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
        paddingHorizontal: padded ? GUTTER : 0,
        paddingBottom: keyboardShown ? 12 : Math.max(insets.bottom, 16),
      }}
    >
      {children}
    </View>
  );
}
