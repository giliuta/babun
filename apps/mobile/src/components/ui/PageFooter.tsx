import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/theme/colors";

// ФУТЕР СТРАНИЦЫ — ГЛАВНОЕ ДЕЙСТВИЕ ВНИЗУ (AGENTS 7.1): 20 по бокам, 8 сверху,
// 10 снизу, кнопка во всю ширину. Пара листу — `SheetFooter`. Пока канон жил
// примером, страницы разошлись на три геометрии (20/8/10, 16/8/16, 16/12/28),
// и кнопка при переходе между вкладками сдвигалась на 4 pt вбок и 6 pt вниз.
//
// Футер стоит ВСЕГДА — пуст список или полон: место действия не зависит от
// содержимого, а пустое состояние — это слова (`EmptyState` без `action`).
// Над таб-баром нижнего выреза нет — внизу ровно 10. Страница без таб-бара
// (инвойс, чек — `Screen edges={["top"]}`) низ выреза не платит, поэтому её
// футер платит его сам (`standalone`), как подвал листа: max(вырез, 10).

/** Поля футера страницы: бока, верх, низ. */
export const PAGE_FOOTER_PADDING = { horizontal: 20, top: 8, bottom: 10 } as const;

export function PageFooter({
  children,
  gap = 8,
  standalone = false,
  bar = false,
}: {
  /** Кнопка (`GradientButton`) или кнопки столбиком. */
  children: ReactNode;
  /** Зазор между кнопками, если их несколько. */
  gap?: number;
  /** Страница без таб-бара: футер сам платит нижний вырез. */
  standalone?: boolean;
  /** Плашка с линией сверху — над прокручиваемой бумагой документа, чтобы
   *  кнопка не висела прямо на тексте. */
  bar?: boolean;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingHorizontal: PAGE_FOOTER_PADDING.horizontal,
        paddingTop: PAGE_FOOTER_PADDING.top,
        paddingBottom: standalone
          ? Math.max(insets.bottom, PAGE_FOOTER_PADDING.bottom)
          : PAGE_FOOTER_PADDING.bottom,
        gap,
        ...(bar
          ? { backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.separator }
          : null),
      }}
    >
      {children}
    </View>
  );
}
