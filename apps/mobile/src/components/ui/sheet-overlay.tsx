import { useSyncExternalStore, type ReactNode } from "react";
import { View } from "react-native";

// ОКНО ПОВЕРХ ОКНА — КОРЕНЬ «ЗАСТЫВАНИЙ» (владелец 11.10: «приложение бывает
// застывает и ничего нажать нельзя — хочу убрать корень этого бага»).
//
// Каждый нижний лист — отдельное системное окно (`Modal`). Вопрос или выбор
// (`chooseOption`, `confirmThen`) рисует общий хост в корне приложения — тоже
// `Modal`. Позванный ИЗ открытого листа, он становился вторым окном поверх
// первого, а iOS такое окно не показывает и об этом не говорит: вопрос висел
// невидимым, кнопка «ничего не делала», а невидимое прозрачное окно могло
// остаться поверх экрана и забирать все касания. Чинилось это местами
// («спросить после закрытия листа», «убрать вопрос») — корень оставался.
//
// Теперь у каждого ОТКРЫТОГО листа внутри его окна есть «место для
// накладки» (`SheetOverlayOutlet`). Лист, которому разрешено ложиться поверх
// (`BottomSheet overlayIfStacked` — лист выбора и вопроса), открытый, пока
// другой лист на экране, рисуется в это место — внутри уже показанного окна,
// без второго. Закрылся лист под ним — накладка закрывается ответом «Отмена».

let nextId = 0;
export function newSheetId(): string {
  nextId += 1;
  return `sheet-${nextId}`;
}

/** Открытые листы со своим окном, снизу вверх. Закрывающийся сюда не входит:
 *  ложиться в уезжающее окно нельзя. */
const stack: string[] = [];
let overlay: { target: string; node: ReactNode } | null = null;

// ДВЕ ПОДПИСКИ, А НЕ ОДНА. Стопку слушают листы (пропал лист под накладкой),
// накладку — только места для неё. Одна общая подписка замыкала круг:
// накладка перерисовывалась → будила все листы → лист-накладка
// перерисовывался → снова клал себя в накладку (веб завис на первой же пробе).
const stackListeners = new Set<() => void>();
const overlayListeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  for (const cb of stackListeners) cb();
}

function emitOverlay() {
  for (const cb of overlayListeners) cb();
}

function subscribe(cb: () => void) {
  stackListeners.add(cb);
  return () => {
    stackListeners.delete(cb);
  };
}

function subscribeOverlay(cb: () => void) {
  overlayListeners.add(cb);
  return () => {
    overlayListeners.delete(cb);
  };
}

export function pushSheet(id: string) {
  if (stack.includes(id)) return;
  stack.push(id);
  emit();
}

export function removeSheet(id: string) {
  const i = stack.indexOf(id);
  if (i < 0) return;
  stack.splice(i, 1);
  if (overlay?.target === id) {
    overlay = null;
    emitOverlay();
  }
  emit();
}

/** Верхний открытый лист — сюда ляжет накладка. */
export function topSheet(): string | null {
  return stack.length > 0 ? stack[stack.length - 1]! : null;
}

export function isSheetOpen(id: string): boolean {
  return stack.includes(id);
}

export function setOverlay(target: string, node: ReactNode) {
  overlay = { target, node };
  emitOverlay();
}

export function clearOverlay(target: string) {
  if (overlay?.target !== target) return;
  overlay = null;
  emitOverlay();
}

/** Подписка на перемены стопки (для листа-накладки: пропал лист под ним). */
export function useSheetStackVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

/** Место для накладки внутри окна листа `id`. */
export function SheetOverlayOutlet({ id }: { id: string }) {
  const current = useSyncExternalStore(subscribeOverlay, () => overlay, () => overlay);
  if (!current || current.target !== id) return null;
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, justifyContent: "flex-end" }}
    >
      {current.node}
    </View>
  );
}
