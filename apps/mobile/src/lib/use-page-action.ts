import { useEffect, useRef, type MutableRefObject } from "react";
import { useRouter } from "expo-router";

// ДЕЙСТВИЕ ИЗ МЕНЮ СПИСКА («Поделиться PDF», «Принять оплату», «Выписать чек») —
// ОДНО НА СТРАНИЦУ ИНВОЙСА И ЧЕКА.
//
// Живёт в адресе (`?action=…`) и стирается, как только взято: «взведённое» один
// раз при открытии, оно не сработало бы, когда ссылка с другим действием меняет
// параметр уже открытой страницы; а не стёртое — повторилось бы при возврате.
// Берётся эффектом после отрисовки, когда страница готова (данные и права
// загружены), а не в теле рендера: тело вызывается чаще, чем кажется, и таймер
// в нём ставился бы повторно.
//
// Таймер (пауза, чтобы страница встала прежде, чем поверх поднимется лист) не
// снимается повторным запуском эффекта — стирание параметра само его
// перезапускает, — только уходом со страницы. Само действие берётся из ref в миг
// срабатывания: свежие права, остаток и готовность бумаги, а не те, что были
// при взведении.
//
// Возвращает ref, который страница заполняет действием (после ранних возвратов,
// когда всё нужное для него уже посчитано).

const ACTION_DELAY_MS = 450;

export function usePageAction(
  action: string | undefined,
  ready: boolean,
): MutableRefObject<((next: string) => void) | null> {
  const router = useRouter();
  const runRef = useRef<((next: string) => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!ready || !action || !runRef.current) return;
    const next = action;
    router.setParams({ action: undefined });
    timer.current = setTimeout(() => runRef.current?.(next), ACTION_DELAY_MS);
  }, [ready, action, router]);
  return runRef;
}
