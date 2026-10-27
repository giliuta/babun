import type { ReactNode } from "react";
import { View } from "react-native";

// ФУТЕР СТРАНИЦЫ — ГЛАВНОЕ ДЕЙСТВИЕ ВНИЗУ (AGENTS 7.1): 20 по бокам, 8 сверху,
// 10 снизу, кнопка во всю ширину. Пара листу — `SheetFooter`. Пока канон жил
// примером, страницы разошлись на три геометрии (20/8/10, 16/8/16, 16/12/28),
// и кнопка при переходе между вкладками сдвигалась на 4 pt вбок и 6 pt вниз.
//
// Футер стоит ВСЕГДА — пуст список или полон: место действия не зависит от
// содержимого, а пустое состояние — это слова (`EmptyState` без `action`).
// Нижний отступ выреза платит `Screen` страницы (`edges` с "bottom"), над
// таб-баром его нет — поэтому здесь ровно 10 в обоих случаях.

/** Поля футера страницы: бока, верх, низ. */
export const PAGE_FOOTER_PADDING = { horizontal: 20, top: 8, bottom: 10 } as const;

export function PageFooter({
  children,
  gap = 8,
}: {
  /** Кнопка (`GradientButton`) или кнопки столбиком. */
  children: ReactNode;
  /** Зазор между кнопками, если их несколько. */
  gap?: number;
}) {
  return (
    <View
      style={{
        paddingHorizontal: PAGE_FOOTER_PADDING.horizontal,
        paddingTop: PAGE_FOOTER_PADDING.top,
        paddingBottom: PAGE_FOOTER_PADDING.bottom,
        gap,
      }}
    >
      {children}
    </View>
  );
}
