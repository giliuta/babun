import { Fragment, type ReactNode } from "react";

/** Блоки тела формы — в порядке команды (`useBookingBlocks`/`useEventBlocks`
 *  отдают включённые уже по порядку; шапку тут не ищут). */
export function inOrder<T extends string>(
  order: readonly T[],
  parts: Partial<Record<T, ReactNode>>,
): ReactNode {
  return order.map((id) =>
    id in parts ? <Fragment key={id}>{parts[id]}</Fragment> : null,
  );
}
