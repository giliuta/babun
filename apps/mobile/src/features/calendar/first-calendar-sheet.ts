import { useSyncExternalStore } from "react";

// ШТОРКА ПЕРВОГО КАЛЕНДАРЯ — ОДНА НА ПРИЛОЖЕНИЕ.
//
// Открывают её двое: кнопка «Создать календарь» на вкладке «Календарь» и
// закрытые вкладки ряда (пока календаря нет, тап по «Клиентам» ведёт сюда же,
// а не в пустоту). Ряд вкладок живёт в разметке табов, шторка — на экране
// календаря, и общего родителя с состоянием у них нет, поэтому флаг здесь.

let open = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

export function openFirstCalendarSheet(): void {
  set(true);
}

export function closeFirstCalendarSheet(): void {
  set(false);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFirstCalendarSheetOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => open);
}
