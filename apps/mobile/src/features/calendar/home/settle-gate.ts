/** «ОТМЕНИТЬ» — СРАЗУ, А НЕ ПОСЛЕ ОТВЕТА СЕРВЕРА. Запись сдвигается в тот же
 *  кадр, а плашка с отменой ждала сеть 1–2 секунды: тап в эту паузу попадал
 *  в шапку под плашкой и открывал выбор вида. Плашка встаёт сразу, а сама
 *  отмена ждёт, чем кончилась правка: удалась — откатываем, сорвалась —
 *  откатывать нечего (её откатил кэш, и плашку сменила ошибка). */
export function settleGate(): { settled: Promise<boolean>; settle: (ok: boolean) => void } {
  let settle: (ok: boolean) => void = () => {};
  const settled = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  return { settled, settle };
}
